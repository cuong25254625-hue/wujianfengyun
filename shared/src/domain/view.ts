import type { GamePhase, PhaseState } from './phase.js';
import type { CurrentTransfer, FinalPkState, GameRoom, GameStatus, PrivateLogEntry, PublicLogEntry, RegularSkillState, RoomStatus, SetupState, WinState } from './game-state.js';
import type { PendingAction } from './pending-action.js';
import type { AliveState, CharacterId, CharacterVisibility, Faction, Gender, InfoTruth, PlayerId, RoomId, UserId } from './types.js';

export interface CharacterChoiceView {
  characterId: CharacterId;
  name: string;
  visibility: CharacterVisibility;
  gender: Gender;
  imageUrl: string;
  skillIds: string[];
}

export interface RoomView {
  roomId: RoomId;
  status: RoomStatus;
  ownerUserId: UserId;
  seats: RoomSeatView[];
  availableCharacters: CharacterChoiceView[];
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
  /** @deprecated 旧版大厅预选展示字段，新流程不再公开使用。 */
  characterPreferenceId?: CharacterId;
  /** @deprecated 旧版大厅预选展示字段，新流程不再公开使用。 */
  characterPreferenceName?: string;
  characterOptions?: CharacterChoiceView[];
  characterSelected?: boolean;
}

export interface SkillView {
  skillId: string;
  name: string;
  description: string;
  timing: string;
  type: 'regular' | 'character';
  usable: boolean;
  hint?: string;
}

export interface SystemHintView {
  level: 'info' | 'warning' | 'success';
  title: string;
  message: string;
  actionText?: string;
  relatedPhase?: GamePhase;
}

export interface PublicGameView {
  roomId: RoomId;
  status: GameStatus;
  setupState?: SetupState;
  finalPk?: FinalPkState;
  phase: PhaseState;
  roundNumber: number;
  activeSeatIndex: number;
  players: PublicPlayerView[];
  currentTransfer?: PublicCurrentTransferView;
  pendingActionsForMe: PendingAction[];
  systemHints: SystemHintView[];
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
  characterSkills?: SkillView[];
  trueInfoCount: number;
  falseInfoCount: number;
}

export interface PrivatePlayerView extends PublicPlayerView {
  faction: Faction;
  regularSkills: RegularSkillState;
  ownSkills: SkillView[];
  privateLog: PrivateLogEntry[];
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
