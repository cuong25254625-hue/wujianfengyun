import type { GameConfig } from './config.js';
import type { RoomSeat } from './game-state.js';
import type { PhaseContext, GamePhase } from './phase.js';
import type { CharacterId, CharacterVisibility, Faction, Gender, PlayerId, RoomId, UserId } from './types.js';

export interface EventEnvelope<T extends GameEvent = GameEvent> {
  eventId: string;
  roomId: RoomId;
  type: T['type'];
  payload: T;
  createdAt: number;
  gameVersionBefore: number;
}

export type GameEvent = RoomEvent | SetupEvent | PhaseEvent | TransferEvent | RegularSkillEvent | CharacterSkillEvent | InfoEvent | DyingDeathEvent | VictoryEvent | GmEvent;

export type RoomEvent =
  | { type: 'RoomCreated'; roomId: RoomId; ownerUserId: UserId }
  | { type: 'PlayerJoined'; userId: UserId; seatIndex: number; playerId: PlayerId; displayName: string }
  | { type: 'PlayerReadyChanged'; userId: UserId; ready: boolean }
  | { type: 'RoomSeatsChanged'; seats: RoomSeat[] };

export type SetupEvent =
  | { type: 'GameStarted'; config: GameConfig }
  | { type: 'IdentityAssigned'; playerId: PlayerId; faction: Faction }
  | {
      type: 'CharacterAssigned';
      playerId: PlayerId;
      characterId: CharacterId;
      characterName: string;
      imageUrl?: string;
      visibility: CharacterVisibility;
      gender: Gender;
    };

export type PhaseEvent =
  | { type: 'PhaseChanged'; from: GamePhase; to: GamePhase; context: PhaseContext }
  | { type: 'TurnAdvanced'; roundNumber: number; activeSeatIndex: number };

export type TransferEvent =
  | { type: 'TransferDeclared'; transferId: string; fromPlayerId: PlayerId; targetPlayerId: PlayerId; declaredTruth: 'true' | 'false' }
  | { type: 'ReceiveDecisionMade'; transferId: string; playerId: PlayerId; decision: 'receive' | 'reject' }
  | { type: 'TransferSettled'; transferId: string; finalReceiverPlayerId: PlayerId; infoId: string; decision: 'receive' | 'reject' };

export type RegularSkillEvent =
  | { type: 'ProbeUsed'; sourcePlayerId: PlayerId; targetPlayerId: PlayerId; declaredFaction: Faction }
  | { type: 'LockUsed'; sourcePlayerId: PlayerId; transferId: string; targetPlayerId: PlayerId }
  | { type: 'InterceptUsed'; sourcePlayerId: PlayerId; transferId: string; targetPlayerId: PlayerId; success: boolean };

export type CharacterSkillEvent =
  | { type: 'CharacterSkillUsed'; sourcePlayerId: PlayerId; skillId: string; targetPlayerId?: PlayerId; secondaryTargetPlayerId?: PlayerId }
  | { type: 'CharacterRevealed'; playerId: PlayerId; characterId: CharacterId; characterName: string }
  | { type: 'CharacterSkillDisabled'; sourcePlayerId: PlayerId; targetPlayerId: PlayerId; skillId: string; untilTurnSerial: number }
  | { type: 'CharacterSkillLost'; playerId: PlayerId; skillId: string };

export type InfoEvent =
  | { type: 'InfoBurned'; infoId: string; ownerPlayerId: PlayerId; sourcePlayerId?: PlayerId; reason: string }
  | { type: 'InfoMoved'; infoId: string; fromPlayerId: PlayerId; toPlayerId: PlayerId; reason: string }
  | { type: 'ExtraInfoAdded'; infoId: string; ownerPlayerId: PlayerId; truth: 'true' | 'false'; sourcePlayerId?: PlayerId; reason: string };

export type DyingDeathEvent =
  | { type: 'DyingStarted'; playerId: PlayerId; cause: string }
  | { type: 'PlayerDied'; playerId: PlayerId; cause: string; killerPlayerId?: PlayerId }
  | { type: 'IdentityRevealedByDeath'; playerId: PlayerId; faction: Faction }
  | { type: 'KillRewardGranted'; playerId: PlayerId; reward: 'probe'; amount: number };

export type VictoryEvent =
  | { type: 'VictoryCandidateFound'; playerIds: PlayerId[] }
  | { type: 'VictoryDeclared'; playerId: PlayerId; faction: Faction; reason: 'threeTrueInfo' | 'clearField' | 'secretMission' }
  | { type: 'GameFinished'; faction: Faction | 'none' };

export type GmEvent =
  | { type: 'GmPhaseForced'; fromPhase: GamePhase; toPhase: GamePhase; triggeredBy: UserId }
  | { type: 'GmGameForcedEnd'; triggeredBy: UserId };
