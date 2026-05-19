import type { PlayerCommand, RoomClientCommand } from '../domain/command.js';
import type { DomainError, RoomId, UserId } from '../domain/types.js';
import type { RoomView, SessionView } from '../domain/view.js';

export type ClientMessage =
  | { type: 'hello'; displayName?: string }
  | { type: 'roomCommand'; command: RoomClientCommand }
  | { type: 'playerCommand'; roomId: RoomId; command: PlayerCommand };

export type ServerMessage =
  | { type: 'hello'; session: SessionView }
  | { type: 'roomView'; room: RoomView; session: SessionView }
  | { type: 'roomCreated'; roomId: RoomId }
  | { type: 'joinedRoom'; roomId: RoomId }
  | { type: 'error'; error: DomainError }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export interface ClientSessionSnapshot {
  userId: UserId;
  roomId?: RoomId;
}
