import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, PlayerCommand, RoomClientCommand, RoomId, ServerMessage, UserId } from '@wujian/shared';
import type { DomainError } from '@wujian/shared';
import { RoomManager } from '../rooms/room-manager.js';
import { toRoomView } from '../view/public-view.js';
import { ClientSession } from './session.js';
import { loadRooms, startAutoSave, stopAutoSave, saveRooms } from '../engine/persistence.js';

interface ConnectedClient {
  socket: WebSocket;
  session: ClientSession;
}

const makeError = (code: string, message: string): DomainError => ({ code, message });
const disconnectKey = (roomId: RoomId, userId: UserId | string): string => `${roomId}:${userId}`;

export class GameWebSocketServer {
  private readonly wss: WebSocketServer;
  private readonly rooms = new RoomManager();
  private readonly clients = new Set<ConnectedClient>();

  // 延迟断开计时器：roomId:userId → timer，用于防止断线重连时的竞态
  private readonly pendingDisconnects = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly port: number) {
    this.wss = new WebSocketServer({ port });
    // 从磁盘恢复之前保存的房间（服务器重启后恢复状态）
    try {
      const savedRooms = loadRooms();
      if (savedRooms.size > 0) {
        this.rooms.restoreFromPersistence(savedRooms);
        console.log(`[persistence] 已恢复 ${savedRooms.size} 个房间`);
      }
    } catch (err) {
      console.error('[persistence] 房间恢复失败，将使用空白状态:', (err as Error).message);
    }
  }

  start(): void {
    // 启动定期自动保存
    startAutoSave(() => this.rooms.getAllRoomStates());

    // 监听进程退出信号，优雅保存
    const shutdown = () => {
      console.log('[persistence] 收到退出信号，正在保存房间...');
      stopAutoSave(() => this.rooms.getAllRoomStates());
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    this.wss.on('connection', (socket) => {
      const client: ConnectedClient = { socket, session: new ClientSession() };
      this.clients.add(client);
      this.send(client, { type: 'hello', session: client.session.toView() });

      socket.on('message', (data) => this.handleMessage(client, data.toString()));
      socket.on('close', () => {
        this.clients.delete(client);
        const userId = client.session.userId;
        const roomId = client.session.roomId;
        if (!roomId) return;

        // 如果已经有同 userId 的新连接接管座位，就不标记断线。
        const stillConnected = [...this.clients].some((item) => item.session.roomId === roomId && item.session.userId === userId);
        if (stillConnected) return;

        // 延迟 5 秒再标记断开，留时间给客户端重连
        const key = disconnectKey(roomId, userId);
        const timer = setTimeout(() => {
          const runtimeResult = this.rooms.getRuntime(roomId);
          if (runtimeResult.ok) {
            runtimeResult.value.setConnected(userId, false);
            this.broadcastRoom(roomId);
          }
          this.pendingDisconnects.delete(key);
        }, 5000);
        this.pendingDisconnects.set(key, timer);
      });
    });
  }

  private handleMessage(client: ConnectedClient, raw: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(client, { type: 'error', error: makeError('protocol.invalidJson', '消息不是合法 JSON') });
      return;
    }

    if (message.type === 'hello') {
      client.session.displayName = message.displayName?.trim() || client.session.displayName || '玩家';
      this.send(client, { type: 'hello', session: client.session.toView() });
      this.ack(client, message.clientCommandId);
      return;
    }

    if (message.type === 'reconnect') {
      this.handleReconnect(client, message.userId, message.roomId, message.clientCommandId);
      return;
    }

    if (message.type === 'requestSync') {
      this.handleRequestSync(client, message.roomId, message.clientCommandId);
      return;
    }

    if (message.type === 'roomCommand') {
      this.handleRoomCommand(client, message.command, message.clientCommandId);
      return;
    }

    if (message.type === 'playerCommand') {
      this.handlePlayerCommand(client, message.roomId, message.command, message.clientCommandId);
    }
  }

  private handlePlayerCommand(client: ConnectedClient, roomId: RoomId, command: PlayerCommand, clientCommandId?: string): void {
    const runtimeResult = this.rooms.getRuntime(roomId);
    if (!runtimeResult.ok) {
      this.reject(client, runtimeResult.error, clientCommandId);
      return;
    }
    const beforeVersion = runtimeResult.value.room.game?.version;
    const result = runtimeResult.value.handlePlayerCommand(client.session.userId, command);
    if (!result.ok) {
      this.reject(client, result.error, clientCommandId, beforeVersion);
      return;
    }
    const roomVersion = runtimeResult.value.room.game?.version;
    this.ack(client, clientCommandId, roomVersion);
    this.broadcastRoom(roomId);
  }

  private handleRoomCommand(client: ConnectedClient, command: RoomClientCommand, clientCommandId?: string): void {
    switch (command.type) {
      case 'CreateRoom': {
        const displayName = command.displayName.trim() || '房主';
        client.session.displayName = displayName;
        const runtime = this.rooms.createRoom(client.session.userId, displayName);
        client.session.roomId = runtime.room.roomId;
        this.send(client, { type: 'roomCreated', roomId: runtime.room.roomId });
        this.ack(client, clientCommandId, runtime.room.game?.version);
        this.broadcastRoom(runtime.room.roomId);
        return;
      }
      case 'JoinRoom': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.reject(client, runtimeResult.error, clientCommandId);
          return;
        }
        const displayName = command.displayName.trim() || '玩家';
        client.session.displayName = displayName;
        const joined = runtimeResult.value.join({ userId: client.session.userId, displayName });
        if (!joined.ok) {
          this.reject(client, joined.error, clientCommandId, runtimeResult.value.room.game?.version);
          return;
        }
        client.session.roomId = command.roomId;
        this.send(client, { type: 'joinedRoom', roomId: command.roomId });
        this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'UpdateDisplayName': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.reject(client, runtimeResult.error, clientCommandId);
          return;
        }
        const displayName = command.displayName.trim() || '玩家';
        client.session.displayName = displayName;
        const result = runtimeResult.value.updateDisplayName(client.session.userId, displayName);
        if (!result.ok) {
          this.reject(client, result.error, clientCommandId, runtimeResult.value.room.game?.version);
          return;
        }
        this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'SelectCharacter': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.reject(client, runtimeResult.error, clientCommandId);
          return;
        }
        const result = runtimeResult.value.selectCharacter(client.session.userId, command.characterId);
        if (!result.ok) {
          this.reject(client, result.error, clientCommandId, runtimeResult.value.room.game?.version);
          return;
        }
        this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'SubmitSetupChoice': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.reject(client, runtimeResult.error, clientCommandId);
          return;
        }
        const result = runtimeResult.value.submitSetupChoice(client.session.userId, command.choiceKey, command.targetPlayerId);
        if (!result.ok) {
          this.reject(client, result.error, clientCommandId, runtimeResult.value.room.game?.version);
          return;
        }
        this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'SetReady': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.reject(client, runtimeResult.error, clientCommandId);
          return;
        }
        const result = runtimeResult.value.setReady(client.session.userId, command.ready);
        if (!result.ok) {
          this.reject(client, result.error, clientCommandId, runtimeResult.value.room.game?.version);
          return;
        }
        this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'StartGame': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.reject(client, runtimeResult.error, clientCommandId);
          return;
        }
        const result = runtimeResult.value.startGame(client.session.userId);
        if (!result.ok) {
          this.reject(client, result.error, clientCommandId, runtimeResult.value.room.game?.version);
          return;
        }
        this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'GmForceAdvance': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.reject(client, runtimeResult.error, clientCommandId);
          return;
        }
        const result = runtimeResult.value.forceAdvancePhase(client.session.userId);
        if (!result.ok) {
          this.reject(client, result.error, clientCommandId, runtimeResult.value.room.game?.version);
          return;
        }
        this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
        this.broadcastRoom(command.roomId);
        return;
      }
    }
  }

  private broadcastRoom(roomId: RoomId): void {
    const room = this.rooms.getRoom(roomId);
    if (!room) return;

    for (const client of this.clients) {
      if (client.session.roomId !== roomId) continue;
      this.send(client, {
        type: 'roomView',
        room: toRoomView(room, client.session.userId),
        session: client.session.toView(),
      });
    }
  }

  private handleReconnect(client: ConnectedClient, userId: string, roomId: RoomId, clientCommandId?: string): void {
    // 取消该 room:user 的延迟断开计时器
    const key = disconnectKey(roomId, userId);
    const timer = this.pendingDisconnects.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingDisconnects.delete(key);
    }

    const runtimeResult = this.rooms.getRuntime(roomId);
    if (!runtimeResult.ok) {
      this.reject(client, runtimeResult.error, clientCommandId);
      return;
    }

    const seat = runtimeResult.value.room.seats.find((s) => s.userId === userId);
    if (!seat) {
      this.reject(client, makeError('reconnect.seatNotFound', '未找到你的座位，房间可能已经关闭'), clientCommandId, runtimeResult.value.room.game?.version);
      return;
    }

    // 同一座位如果已有旧连接，关闭旧连接，避免双客户端同时操作。
    for (const other of [...this.clients]) {
      if (other === client) continue;
      if (other.session.roomId === roomId && other.session.userId === userId) {
        other.socket.close(4000, 'replaced by reconnect');
        this.clients.delete(other);
      }
    }

    // 恢复会话身份
    client.session.userId = userId as UserId;
    client.session.roomId = roomId;
    if (seat.displayName) {
      client.session.displayName = seat.displayName;
    }

    // 标记为已连接
    runtimeResult.value.setConnected(userId as UserId, true);

    this.send(client, { type: 'hello', session: client.session.toView() });
    this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
    // 下发完整房间状态
    this.broadcastRoom(roomId);
  }

  private handleRequestSync(client: ConnectedClient, roomId: RoomId, clientCommandId?: string): void {
    const runtimeResult = this.rooms.getRuntime(roomId);
    if (!runtimeResult.ok) {
      this.reject(client, runtimeResult.error, clientCommandId);
      return;
    }
    if (!runtimeResult.value.room.seats.some((seat) => seat.userId === client.session.userId)) {
      this.reject(client, makeError('sync.notInRoom', '你不在该房间中，无法同步状态'), clientCommandId, runtimeResult.value.room.game?.version);
      return;
    }
    client.session.roomId = roomId;
    this.ack(client, clientCommandId, runtimeResult.value.room.game?.version);
    this.send(client, {
      type: 'roomView',
      room: toRoomView(runtimeResult.value.room, client.session.userId),
      session: client.session.toView(),
    });
  }

  private ack(client: ConnectedClient, clientCommandId?: string, roomVersion?: number): void {
    if (!clientCommandId) return;
    this.send(client, {
      type: 'commandAck',
      clientCommandId,
      ...(roomVersion !== undefined ? { roomVersion } : {}),
    });
  }

  private reject(client: ConnectedClient, error: DomainError, clientCommandId?: string, roomVersion?: number): void {
    if (clientCommandId) {
      this.send(client, {
        type: 'commandRejected',
        clientCommandId,
        error,
        ...(roomVersion !== undefined ? { roomVersion } : {}),
      });
    }
    this.send(client, { type: 'error', error });
  }

  private send(client: ConnectedClient, message: ServerMessage): void {
    if (client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify(message));
  }
}
