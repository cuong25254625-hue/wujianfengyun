import type { PlayerCommand, RoomClientCommand } from '../domain/command.js';
import type { DomainError, RoomId, UserId } from '../domain/types.js';
import type { RoomView, SessionView } from '../domain/view.js';

export type ClientMessage =
  | { type: 'hello'; displayName?: string; clientCommandId?: string }
  | { type: 'reconnect'; roomId: RoomId; userId: UserId; clientCommandId?: string }
  | { type: 'requestSync'; roomId: RoomId; clientCommandId?: string }
  | { type: 'roomCommand'; command: RoomClientCommand; clientCommandId?: string }
  | { type: 'playerCommand'; roomId: RoomId; command: PlayerCommand; clientCommandId?: string };

export type ServerMessage =
  | { type: 'hello'; session: SessionView }
  | { type: 'roomView'; room: RoomView; session: SessionView }
  | { type: 'lobbyView'; rooms: import('../domain/view.js').RoomSummary[] }
  | { type: 'roomCreated'; roomId: RoomId }
  | { type: 'joinedRoom'; roomId: RoomId }
  | { type: 'leftRoom' }
  | { type: 'commandAck'; clientCommandId: string; roomVersion?: number }
  | { type: 'commandRejected'; clientCommandId?: string; error: DomainError; roomVersion?: number }
  | { type: 'error'; error: DomainError }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export interface ClientSessionSnapshot {
  userId: UserId;
  roomId?: RoomId;
}
