import type { ClientMessage, RoomId, ServerMessage, UserId } from '@wujian/shared';

export type MessageHandler = (message: ServerMessage) => void;
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error' | 'reconnecting';
export type ConnectionStatusHandler = (status: ConnectionStatus) => void;

export class WsClient {
  private socket?: WebSocket;
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
  private reconnectUserId?: UserId;
  private reconnectRoomId?: RoomId;

  connect(url = import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:8787`): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;

    this.connectUrl = url;
    this.stopReconnectTimer();
    this.setStatus('connecting');
    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.wasOpen = true;
      this.setStatus('open');

      // 重连成功后，先发送 reconnect 恢复会话，再刷新待发消息
      if (this.reconnectUserId && this.reconnectRoomId) {
        this.socket?.send(JSON.stringify({
          type: 'reconnect',
          userId: this.reconnectUserId,
          roomId: this.reconnectRoomId,
        } satisfies ClientMessage));
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
        this.reconnectUserId = msg.session.userId;
        if (msg.session.roomId) {
          this.reconnectRoomId = msg.session.roomId;
        }
      }
      if (msg.type === 'roomView') {
        this.reconnectUserId = msg.session.userId;
        this.reconnectRoomId = msg.room.roomId;
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
    if (!this.socket || this.socket.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(message);
      return;
    }

    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  /** 手动强制重连（跳过退避等待） */
  forceReconnect(): void {
    this.stopReconnectTimer();
    this.connect(this.connectUrl);
  }

  get reconnectInfo(): { attempt: number; max: number; isReconnecting: boolean } {
    return {
      attempt: this.reconnectAttempts,
      max: this.maxReconnectAttempts,
      isReconnecting: this.status === 'reconnecting',
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
}
