import type { ClientMessage, ServerMessage } from '@wujian/shared';

export type MessageHandler = (message: ServerMessage) => void;
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';
export type ConnectionStatusHandler = (status: ConnectionStatus) => void;

export class WsClient {
  private socket?: WebSocket;
  private handlers = new Set<MessageHandler>();
  private statusHandlers = new Set<ConnectionStatusHandler>();
  private pendingMessages: ClientMessage[] = [];
  private status: ConnectionStatus = 'closed';

  connect(url = import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:8787`): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;

    this.setStatus('connecting');
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.setStatus('open');
      this.flushPendingMessages();
    });
    this.socket.addEventListener('close', () => this.setStatus('closed'));
    this.socket.addEventListener('error', () => this.setStatus('error'));
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      this.handlers.forEach((handler) => handler(message));
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

  private flushPendingMessages(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const messages = this.pendingMessages.splice(0);
    for (const message of messages) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }
}
