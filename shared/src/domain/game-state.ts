import type { GameConfig } from './config.js';
import type { PhaseState } from './phase.js';
import type { EventEnvelope, GameEvent } from './event.js';
import type { PendingAction } from './pending-action.js';
import type {
  AliveState,
  CharacterId,
  CharacterVisibility,
  Faction,
  Gender,
  InfoId,
  InfoTruth,
  PendingActionId,
  PlayerId,
  RoomId,
  UserId,
} from './types.js';

export type RoomStatus = 'lobby' | 'playing' | 'finished' | 'closed';
export type GameStatus = 'setup' | 'running' | 'settling' | 'finished';

export interface RoomSeat {
  seatIndex: number;
  userId: UserId;
  playerId?: PlayerId;
  displayName: string;
  ready: boolean;
  connected: boolean;
  /** @deprecated 旧版大厅预选字段，保留用于兼容旧视图；新流程使用开局后私密候选。 */
  characterPreferenceId?: CharacterId;
  characterOptionIds?: CharacterId[];
  selectedCharacterId?: CharacterId;
}

export interface GameRoom {
  roomId: RoomId;
  status: RoomStatus;
  ownerUserId: UserId;
  seats: RoomSeat[];
  game?: GameState;
  createdAt: number;
  updatedAt: number;
}

export type SetupStep = 'characterSelection' | 'openingOptions' | 'complete';

export interface SetupState {
  step: SetupStep;
  requiredPlayerIds: PlayerId[];
  completedPlayerIds: PlayerId[];
}

export interface FinalPkState {
  whitePlayerId: PlayerId;
  opponentPlayerId: PlayerId;
  enteredAtTurnSerial: number;
  transfersAfterEntry: number;
  burnUsed: boolean;
}

export interface GameState {
  roomId: RoomId;
  config: GameConfig;
  status: GameStatus;
  setupState?: SetupState;
  finalPk?: FinalPkState;
  players: Record<PlayerId, Player>;
  turn: TurnState;
  phase: PhaseState;
  infoCards: Record<InfoId, InfoCard>;
  currentTransfer?: CurrentTransfer;
  eventQueue: EventEnvelope<GameEvent>[];
  pendingActions: Record<PendingActionId, PendingAction>;
  publicLog: PublicLogEntry[];
  privateLogs: Record<PlayerId, PrivateLogEntry[]>;
  deathQueue: unknown[];
  winState: WinState;
  version: number;
}

export interface TurnState {
  roundNumber: number;
  activeSeatIndex: number;
  turnSerial: number;
}

export interface Player {
  playerId: PlayerId;
  userId: UserId;
  displayName: string;
  seatIndex: number;
  faction: Faction;
  identityRevealed: boolean;
  characterId?: CharacterId;
  characterName?: string;
  characterImageUrl?: string;
  characterVisibility: CharacterVisibility;
  characterRevealed: boolean;
  gender: Gender;
  aliveState: AliveState;
  falseInfoLimit: number;
  infoIds: InfoId[];
  regularSkills: RegularSkillState;
  knownPartners: PlayerId[];
  knownIdentities: KnownIdentity[];
  flags: Record<string, boolean | number | string>;
  tags: string[];
  missionStatus: MissionStatus;
  missionCounters: Record<string, number>;
}

export type MissionStatus = 'pending' | 'met' | 'declared';

export interface RegularSkillState {
  probeRemaining: number;
  lockRemaining: number;
  interceptRemaining: number;
  mutualKnownPlayerId?: PlayerId;
}

export interface KnownIdentity {
  targetPlayerId: PlayerId;
  faction?: Faction;
  characterId?: CharacterId;
  source: 'probe' | 'skill' | 'system';
}

export interface InfoCard {
  infoId: InfoId;
  truth: InfoTruth;
  sourcePlayerId?: PlayerId;
  ownerPlayerId: PlayerId;
  public: boolean;
  createdBy: 'transfer' | 'skill' | 'system';
  createdEventId?: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface CurrentTransfer {
  transferId: string;
  fromPlayerId: PlayerId;
  targetPlayerId: PlayerId;
  declaredTruth: InfoTruth;
  infoId?: InfoId;
  lockedByPlayerIds: PlayerId[];
  interceptedByPlayerId?: PlayerId;
  finalReceiverPlayerId?: PlayerId;
  forcedReceive: boolean;
  receiveDecision?: 'receive' | 'reject';
  settled: boolean;
}

export interface PublicLogEntry {
  id: string;
  messageKey: string;
  params: Record<string, string | number | boolean>;
  createdAt: number;
}

export interface PrivateLogEntry {
  id: string;
  messageKey: string;
  params: Record<string, string | number | boolean>;
  createdAt: number;
}

export interface WinState {
  finished: boolean;
  winner?: {
    faction: Faction;
    declaredByPlayerId: PlayerId;
    reason: 'threeTrueInfo' | 'clearField' | 'secretMission';
    missionPlayerId?: PlayerId;
  };
}
