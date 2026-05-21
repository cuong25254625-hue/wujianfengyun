import type { ClientMessage, RoomId, ServerMessage, UserId } from '@wujian/shared';

export type MessageHandler = (message: ServerMessage) => void;
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error' | 'reconnecting';
export type ConnectionStatusHandler = (status: ConnectionStatus) => void;

const SESSION_STORAGE_KEY = 'wujianfengyun.session.v1';

interface PersistedSession {
  userId?: UserId | undefined;
  roomId?: RoomId | undefined;
  displayName?: string | undefined;
}

const canUseStorage = (): boolean => typeof window !== 'undefined' && Boolean(window.localStorage);

const loadPersistedSession = (): PersistedSession => {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) as PersistedSession : {};
  } catch {
    return {};
  }
};

const savePersistedSession = (session: PersistedSession): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage 可能被浏览器隐私策略禁用，忽略即可。
  }
};

export class WsClient {
  private socket: WebSocket | undefined;
  private handlers = new Set<MessageHandler>();
  private statusHandlers = new Set<ConnectionStatusHandler>();
  private pendingMessages: ClientMessage[] = [];
  private status: ConnectionStatus = 'closed';

  // 重连状态
  private connectUrl = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 12;
  private baseReconnectDelay = 800;
  private wasOpen = false;

  // 用于重连时恢复身份
  private reconnectUserId: UserId | undefined;
  private reconnectRoomId: RoomId | undefined;
  private displayName: string | undefined;

  // 标记是否正在等待 reconnect 响应，防止 hello 覆盖正确的 userId
  private reconnectInFlight = false;

  constructor() {
    const persisted = loadPersistedSession();
    this.reconnectUserId = persisted.userId;
    this.reconnectRoomId = persisted.roomId;
    this.displayName = persisted.displayName;
  }

  connect(url = import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:8787`): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;

    this.connectUrl = url;
    this.stopReconnectTimer();
    this.setStatus(this.wasOpen ? 'reconnecting' : 'connecting');
    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.wasOpen = true;
      this.setStatus('open');

      // 重连成功后，先发送 reconnect 恢复会话，再刷新待发消息
      if (this.reconnectUserId && this.reconnectRoomId) {
        this.reconnectInFlight = true;
        this.socket?.send(JSON.stringify({
          type: 'reconnect',
          userId: this.reconnectUserId,
          roomId: this.reconnectRoomId,
        } satisfies ClientMessage));
      } else if (this.displayName) {
        this.socket?.send(JSON.stringify({ type: 'hello', displayName: this.displayName } satisfies ClientMessage));
      } else {
        // 全新用户，发送空 hello 让服务器分配 userId
        this.socket?.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage));
      }

      this.flushPendingMessages();
    });

    this.socket.addEventListener('close', () => {
      if (this.wasOpen && this.status !== 'closed') {
        // 连接曾成功打开，尝试自动重连
        this.startReconnect();
      } else {
        this.setStatus('closed');
      }
    });

    this.socket.addEventListener('error', () => {
      // error 之后通常会触发 close，由 close 事件统一处理重连
      // 仅在从未成功连接过时直接标记 error
      if (!this.wasOpen) {
        this.setStatus('error');
      }
    });

    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      // 记录身份用于重连
      if (msg.type === 'hello') {
        // 重连进行中不覆盖 userId，因为服务器可能先发了新连接的临时 userId
        // 真正的 userId 会在 roomView 或 reconnect 对应的 hello 中下发
        if (!this.reconnectInFlight) {
          this.reconnectUserId = msg.session.userId;
        }
        this.displayName = msg.session.displayName;
        if (msg.session.roomId && !this.reconnectInFlight) {
          this.reconnectRoomId = msg.session.roomId;
        }
        this.persistSession();
      }
      if (msg.type === 'roomCreated' || msg.type === 'joinedRoom') {
        this.reconnectRoomId = msg.roomId;
        this.persistSession();
      }
      if (msg.type === 'roomView') {
        // 收到房间视图说明 reconnect 成功（或正常进入房间）
        this.reconnectInFlight = false;
        this.reconnectUserId = msg.session.userId;
        this.reconnectRoomId = msg.room.roomId;
        this.displayName = msg.session.displayName;
        this.persistSession();
      }
      if (msg.type === 'commandRejected' || msg.type === 'error') {
        // reconnect 失败时清除标记，让后续 hello 可以正常更新
        this.reconnectInFlight = false;
      }
      this.handlers.forEach((handler) => handler(msg));
    });
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(handler: ConnectionStatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  send(message: ClientMessage): void {
    this.rememberOutgoingMessage(message);
    if (!this.socket || this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED) {
      this.pendingMessages.push(message);
      if (this.connectUrl && this.status !== 'connecting' && this.status !== 'reconnecting') {
        this.startReconnect();
      }
      return;
    }

    if (this.socket.readyState !== WebSocket.OPEN) {
      this.pendingMessages.push(message);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  requestSync(roomId?: RoomId): void {
    const targetRoomId = roomId ?? this.reconnectRoomId;
    if (!targetRoomId) return;
    this.send({ type: 'requestSync', roomId: targetRoomId });
  }

  /** 手动强制重连（跳过退避等待） */
  forceReconnect(): void {
    this.stopReconnectTimer();
    const url = this.connectUrl || (import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:8787`);
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      this.socket.close();
      this.socket = undefined;
    }
    this.connect(url);
  }

  forgetSession(): void {
    this.reconnectUserId = undefined;
    this.reconnectRoomId = undefined;
    this.displayName = undefined;
    this.reconnectInFlight = false;
    this.pendingMessages = this.pendingMessages.filter((message) => message.type !== 'requestSync' && message.type !== 'reconnect');
    if (canUseStorage()) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  forgetRoom(): void {
    this.reconnectRoomId = undefined;
    this.reconnectInFlight = false;
    this.pendingMessages = this.pendingMessages.filter((message) => {
      if (message.type === 'requestSync' || message.type === 'reconnect') return false;
      if (message.type === 'roomCommand' && 'roomId' in message.command) return false;
      if (message.type === 'playerCommand') return false;
      return true;
    });
    this.persistSession();
  }

  get reconnectInfo(): { attempt: number; max: number; isReconnecting: boolean } {
    return {
      attempt: this.reconnectAttempts,
      max: this.maxReconnectAttempts,
      isReconnecting: this.status === 'reconnecting',
    };
  }

  get persistedSession(): PersistedSession {
    return {
      userId: this.reconnectUserId,
      roomId: this.reconnectRoomId,
      displayName: this.displayName,
    };
  }

  private flushPendingMessages(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const messages = this.pendingMessages.splice(0);
    for (const message of messages) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private startReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('closed');
      return;
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    // 指数退避：0.8s → 1.6s → 3.2s → 6.4s → ... 最大 25s
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      25000,
    );
    // 叠加少量随机抖动避免惊群
    const jitter = delay * 0.2 * Math.random();
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.connectUrl);
    }, delay + jitter);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  private rememberOutgoingMessage(message: ClientMessage): void {
    if (message.type === 'hello') {
      this.displayName = message.displayName ?? this.displayName;
    }
    if (message.type === 'reconnect') {
      this.reconnectUserId = message.userId;
      this.reconnectRoomId = message.roomId;
    }
    if (message.type === 'requestSync') {
      this.reconnectRoomId = message.roomId;
    }
    if (message.type === 'roomCommand') {
      const command = message.command;
      if (command.type === 'CreateRoom' || command.type === 'JoinRoom' || command.type === 'UpdateDisplayName') {
        this.displayName = command.displayName;
      }
      if ('roomId' in command) {
        this.reconnectRoomId = command.roomId;
      }
    }
    if (message.type === 'playerCommand') {
      this.reconnectRoomId = message.roomId;
    }
    this.persistSession();
  }

  private persistSession(): void {
    savePersistedSession({
      userId: this.reconnectUserId,
      roomId: this.reconnectRoomId,
      displayName: this.displayName,
    });
  }
}
