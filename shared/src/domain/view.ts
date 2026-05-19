import type { GamePhase, PhaseState } from './phase.js';
import type { CurrentTransfer, GameRoom, GameStatus, PublicLogEntry, RegularSkillState, RoomStatus, WinState } from './game-state.js';
import type { PendingAction } from './pending-action.js';
import type { AliveState, CharacterId, CharacterVisibility, Faction, Gender, InfoTruth, PlayerId, RoomId, UserId } from './types.js';

export interface RoomView {
  roomId: RoomId;
  status: RoomStatus;
  ownerUserId: UserId;
  seats: RoomSeatView[];
  game?: PublicGameView;
}

export interface RoomSeatView {
  seatIndex: number;
  userId: UserId;
  playerId?: PlayerId;
  displayName: string;
  ready: boolean;
  connected: boolean;
  isOwner: boolean;
}

export interface PublicGameView {
  roomId: RoomId;
  status: GameStatus;
  phase: PhaseState;
  roundNumber: number;
  activeSeatIndex: number;
  players: PublicPlayerView[];
  currentTransfer?: PublicCurrentTransferView;
  pendingActionsForMe: PendingAction[];
  publicLog: PublicLogEntry[];
  winner?: WinState['winner'];
  version: number;
}

export interface PublicPlayerView {
  playerId: PlayerId;
  userId: UserId;
  displayName: string;
  seatIndex: number;
  aliveState: AliveState;
  identityRevealed: boolean;
  revealedFaction: Faction | undefined;
  characterId?: CharacterId;
  characterName?: string;
  characterImageUrl?: string;
  characterVisibility?: CharacterVisibility;
  characterRevealed: boolean;
  gender?: Gender;
  trueInfoCount: number;
  falseInfoCount: number;
}

export interface PrivatePlayerView extends PublicPlayerView {
  faction: Faction;
  regularSkills: RegularSkillState;
}

export interface PublicCurrentTransferView {
  transferId: CurrentTransfer['transferId'];
  fromPlayerId: PlayerId;
  targetPlayerId: PlayerId;
  declaredTruth: InfoTruth;
  finalReceiverPlayerId?: PlayerId;
  forcedReceive: boolean;
  receiveDecision?: CurrentTransfer['receiveDecision'];
  settled: boolean;
}

export interface SessionView {
  userId: UserId;
  displayName: string | undefined;
  roomId: RoomId | undefined;
  playerId?: PlayerId;
}

export const roomToSeatViews = (room: GameRoom): RoomSeatView[] =>
  room.seats.map((seat) => ({
    ...seat,
    isOwner: seat.userId === room.ownerUserId,
  }));

export const phaseLabel: Record<GamePhase, string> = {
  Lobby: '等待房间',
  Setup: '开局设置',
  VictoryDeclareWindow: '宣胜窗口',
  SkillWindow: '技能阶段',
  TransferDeclare: '传递声明',
  ReactionWindow: '响应窗口',
  ReceiveDecision: '接收/拒收',
  InfoSettle: '情报结算',
  DyingWindow: '濒死阶段',
  DeathSettle: '死亡结算',
  TurnEnd: '回合结束',
  GameOver: '游戏结束',
};
