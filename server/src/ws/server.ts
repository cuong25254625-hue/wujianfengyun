import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, PlayerCommand, RoomClientCommand, RoomId, ServerMessage } from '@wujian/shared';
import type { DomainError } from '@wujian/shared';
import { RoomManager } from '../rooms/room-manager.js';
import { toRoomView } from '../view/public-view.js';
import { ClientSession } from './session.js';

interface ConnectedClient {
  socket: WebSocket;
  session: ClientSession;
}

const makeError = (code: string, message: string): DomainError => ({ code, message });

export class GameWebSocketServer {
  private readonly wss: WebSocketServer;
  private readonly rooms = new RoomManager();
  private readonly clients = new Set<ConnectedClient>();

  constructor(private readonly port: number) {
    this.wss = new WebSocketServer({ port });
  }

  start(): void {
    this.wss.on('connection', (socket) => {
      const client: ConnectedClient = { socket, session: new ClientSession() };
      this.clients.add(client);
      this.send(client, { type: 'hello', session: client.session.toView() });

      socket.on('message', (data) => this.handleMessage(client, data.toString()));
      socket.on('close', () => {
        this.clients.delete(client);
        if (client.session.roomId) {
          const runtimeResult = this.rooms.getRuntime(client.session.roomId);
          if (runtimeResult.ok) {
            runtimeResult.value.setConnected(client.session.userId, false);
            this.broadcastRoom(client.session.roomId);
          }
        }
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
      return;
    }

    if (message.type === 'roomCommand') {
      this.handleRoomCommand(client, message.command);
      return;
    }

    if (message.type === 'playerCommand') {
      this.handlePlayerCommand(client, message.roomId, message.command);
    }
  }

  private handlePlayerCommand(client: ConnectedClient, roomId: RoomId, command: PlayerCommand): void {
    const runtimeResult = this.rooms.getRuntime(roomId);
    if (!runtimeResult.ok) {
      this.send(client, { type: 'error', error: runtimeResult.error });
      return;
    }
    const result = runtimeResult.value.handlePlayerCommand(client.session.userId, command);
    if (!result.ok) {
      this.send(client, { type: 'error', error: result.error });
      return;
    }
    this.broadcastRoom(roomId);
  }

  private handleRoomCommand(client: ConnectedClient, command: RoomClientCommand): void {
    switch (command.type) {
      case 'CreateRoom': {
        const displayName = command.displayName.trim() || '房主';
        client.session.displayName = displayName;
        const runtime = this.rooms.createRoom(client.session.userId, displayName);
        client.session.roomId = runtime.room.roomId;
        this.send(client, { type: 'roomCreated', roomId: runtime.room.roomId });
        this.broadcastRoom(runtime.room.roomId);
        return;
      }
      case 'JoinRoom': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.send(client, { type: 'error', error: runtimeResult.error });
          return;
        }
        const displayName = command.displayName.trim() || '玩家';
        client.session.displayName = displayName;
        const joined = runtimeResult.value.join({ userId: client.session.userId, displayName });
        if (!joined.ok) {
          this.send(client, { type: 'error', error: joined.error });
          return;
        }
        client.session.roomId = command.roomId;
        this.send(client, { type: 'joinedRoom', roomId: command.roomId });
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'UpdateDisplayName': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.send(client, { type: 'error', error: runtimeResult.error });
          return;
        }
        const displayName = command.displayName.trim() || '玩家';
        client.session.displayName = displayName;
        const result = runtimeResult.value.updateDisplayName(client.session.userId, displayName);
        if (!result.ok) {
          this.send(client, { type: 'error', error: result.error });
          return;
        }
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'SetReady': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.send(client, { type: 'error', error: runtimeResult.error });
          return;
        }
        const result = runtimeResult.value.setReady(client.session.userId, command.ready);
        if (!result.ok) {
          this.send(client, { type: 'error', error: result.error });
          return;
        }
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'StartGame': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.send(client, { type: 'error', error: runtimeResult.error });
          return;
        }
        const result = runtimeResult.value.startGame(client.session.userId);
        if (!result.ok) {
          this.send(client, { type: 'error', error: result.error });
          return;
        }
        this.broadcastRoom(command.roomId);
        return;
      }
      case 'GmForceAdvance': {
        const runtimeResult = this.rooms.getRuntime(command.roomId);
        if (!runtimeResult.ok) {
          this.send(client, { type: 'error', error: runtimeResult.error });
          return;
        }
        const result = runtimeResult.value.forceAdvancePhase(client.session.userId);
        if (!result.ok) {
          this.send(client, { type: 'error', error: result.error });
          return;
        }
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

  private send(client: ConnectedClient, message: ServerMessage): void {
    if (client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify(message));
  }
}
