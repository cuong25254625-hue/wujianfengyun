export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type RoomId = Brand<string, 'RoomId'>;
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type CharacterId = Brand<string, 'CharacterId'>;
export type InfoId = Brand<string, 'InfoId'>;
export type EventId = Brand<string, 'EventId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type PendingActionId = Brand<string, 'PendingActionId'>;

export type Faction = 'red' | 'blue' | 'white';
export type AliveState = 'alive' | 'dying' | 'dead';
export type InfoTruth = 'true' | 'false';
export type Gender = 'male' | 'female' | 'unknown';
export type CharacterVisibility = 'public' | 'hidden';
export type ReceiveDecision = 'receive' | 'reject';

export interface DomainError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type DomainResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

export const ok = <T>(value: T): DomainResult<T> => ({ ok: true, value });

export const err = (code: string, message: string, details?: Record<string, unknown>): DomainResult<never> => ({
  ok: false,
  error: details ? { code, message, details } : { code, message },
});
