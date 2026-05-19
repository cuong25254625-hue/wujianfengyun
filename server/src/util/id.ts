import type { EventId, InfoId, PendingActionId, PlayerId, RoomId, SessionId, UserId } from '@wujian/shared';

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const randomToken = (length = 8): string =>
  Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

export const createRoomId = (): RoomId => randomToken(6) as RoomId;
export const createUserId = (): UserId => `user_${crypto.randomUUID()}` as UserId;
export const createSessionId = (): SessionId => `session_${crypto.randomUUID()}` as SessionId;
export const createPlayerId = (): PlayerId => `player_${crypto.randomUUID()}` as PlayerId;
export const createEventId = (): EventId => `event_${crypto.randomUUID()}` as EventId;
export const createInfoId = (): InfoId => `info_${crypto.randomUUID()}` as InfoId;
export const createPendingActionId = (): PendingActionId => `pending_${crypto.randomUUID()}` as PendingActionId;
