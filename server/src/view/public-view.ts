import type {
  GameRoom,
  GameState,
  GamePhase,
  Player,
  PrivatePlayerView,
  PendingAction,
  PublicGameView,
  PublicPlayerView,
  RoomView,
  SystemHintView,
  UserId,
  CharacterId,
} from '@wujian/shared';
import { MVP_CHARACTER_POOL } from '../engine/character-registry.js';
import { getRegularSkillViews, getSkillViews } from '../engine/skill-registry.js';
import {
  canViewCharacter,
  canViewFaction,
  canViewSkillDetails,
  redactPendingActionForViewer,
  viewerPlayerForUser,
  visiblePrivateLogEntries,
  visiblePublicLogEntries,
} from './visibility-policy.js';

const countInfos = (state: GameState, playerId: string) => {
  const infos = Object.values(state.infoCards).filter((info) => info.ownerPlayerId === playerId);
  return {
    trueInfoCount: infos.filter((info) => info.truth === 'true').length,
    falseInfoCount: infos.filter((info) => info.truth === 'false').length,
  };
};

const pendingActionsForUser = (state: GameState, viewerUserId?: UserId): PendingAction[] => {
  if (!viewerUserId) return [];
  const player = Object.values(state.players).find((item) => item.userId === viewerUserId);
  if (!player) return [];
  return Object.values(state.pendingActions)
    .filter((action) => action.status === 'open' && action.eligiblePlayerIds.includes(player.playerId))
    .map((action) => redactPendingActionForViewer(action));
};

const characterDefinitionById = new Map(MVP_CHARACTER_POOL.map((character) => [character.characterId, character]));

const playerForUser = (state: GameState, viewerUserId?: UserId): Player | undefined => viewerPlayerForUser(state, viewerUserId);

const playerName = (state: GameState, playerId: string | undefined): string =>
  playerId ? (state.players[playerId as keyof typeof state.players]?.displayName ?? '未知玩家') : '未知玩家';

const phaseHintText: Record<GamePhase, string> = {
  Lobby: '等待玩家加入和准备。',
  Setup: '正在进行开局设置。',
  VictoryDeclareWindow: '每个技能阶段开始前会先检查是否有人可以宣胜。',
  SkillWindow: '当前玩家可以使用试探或人物技能，处理完成后进入传递。',
  TransferDeclare: '当前玩家需要选择接收目标并声明传递真/假情报。',
  ReactionWindow: '符合条件的玩家可以使用锁定、截获或人物技能响应传递。',
  ReceiveDecision: '最终接收者需要选择接收或拒收情报。',
  InfoSettle: '系统正在结算情报归属。',
  DyingWindow: '濒死玩家可以尝试濒死技能，否则将结算死亡。',
  DeathSettle: '系统正在结算死亡和身份公开。',
  TurnEnd: '当前回合即将结束。',
  GameOver: '游戏已经结束。',
};

const buildSystemHints = (state: GameState, viewerUserId?: UserId): SystemHintView[] => {
  const viewer = playerForUser(state, viewerUserId);
  const activePlayer = Object.values(state.players).find((player) => player.seatIndex === state.turn.activeSeatIndex);
  const pending = pendingActionsForUser(state, viewerUserId);
  const hints: SystemHintView[] = [];

  if (state.winState.winner) {
    const factionName = state.winState.winner.faction === 'red' ? '红方' : state.winState.winner.faction === 'blue' ? '蓝方' : '白方';
    const isWhite = state.winState.winner.faction === 'white' && state.winState.winner.missionPlayerId;
    const whiteName = isWhite ? playerName(state, state.winState.winner.missionPlayerId) : '';
    hints.push({
      level: 'success',
      title: '游戏结束',
      message: isWhite ? `${whiteName}（白方）通过机密任务宣告胜利。` : `${factionName}已宣告胜利。`,
      relatedPhase: 'GameOver',
    });
    return hints;
  }

  if (pending.length > 0) {
    const first = pending[0];
    if (first) {
      const actionText = first.kind === 'victoryDeclareWindow'
        ? '处理宣胜窗口'
        : first.kind === 'regularSkillWindow' || first.kind === 'characterSkillWindow'
          ? '处理技能窗口'
          : first.kind === 'receiveDecision'
            ? '接收或拒收'
            : first.kind === 'dyingSkillWindow'
              ? '处理濒死'
              : '处理待操作';
      hints.push({
        level: first.kind === 'dyingSkillWindow' ? 'warning' : 'info',
        title: '轮到你操作',
        message: `你有 ${pending.length} 个待处理动作，请根据当前阶段完成操作。`,
        actionText,
        relatedPhase: state.phase.phase,
      });
    }
  }

  if (state.phase.phase === 'TransferDeclare' && activePlayer?.playerId === viewer?.playerId) {
    hints.push({ level: 'info', title: '请选择传递', message: '选择一名存活玩家，并声明要传递真情报或假情报。', actionText: '声明传递', relatedPhase: 'TransferDeclare' });
  }

  if (state.phase.phase === 'ReceiveDecision' && state.currentTransfer) {
    const receiverId = state.currentTransfer.finalReceiverPlayerId ?? state.currentTransfer.targetPlayerId;
    if (receiverId === viewer?.playerId) {
      hints.push({
        level: state.currentTransfer.forcedReceive ? 'warning' : 'info',
        title: '请处理情报',
        message: state.currentTransfer.forcedReceive ? '你已被锁定，必须接收这张情报。' : '你是最终接收者，可以选择接收或拒收这张情报。',
        actionText: '接收/拒收',
        relatedPhase: 'ReceiveDecision',
      });
    }
  }

  if (state.phase.phase === 'DyingWindow' && state.phase.context.type === 'dying') {
    const dyingName = playerName(state, state.phase.context.playerId);
    hints.push({
      level: state.phase.context.playerId === viewer?.playerId ? 'warning' : 'info',
      title: state.phase.context.playerId === viewer?.playerId ? '你已进入濒死' : `${dyingName} 进入濒死`,
      message: state.phase.context.playerId === viewer?.playerId ? '你可以尝试濒死人物技能；若无法解除濒死，请结算死亡。' : `等待 ${dyingName} 处理濒死窗口。`,
      actionText: state.phase.context.playerId === viewer?.playerId ? '处理濒死' : '等待处理',
      relatedPhase: 'DyingWindow',
    });
  }

  if (hints.length === 0) {
    hints.push({
      level: 'info',
      title: activePlayer?.playerId === viewer?.playerId ? '当前是你的回合' : `等待 ${activePlayer?.displayName ?? '当前玩家'} 操作`,
      message: phaseHintText[state.phase.phase],
      actionText: activePlayer?.playerId === viewer?.playerId ? '查看可用操作' : '等待',
      relatedPhase: state.phase.phase,
    });
  }

  return hints;
};

const characterSkillViews = (player: Player) => {
  const definition = player.characterId ? characterDefinitionById.get(player.characterId) : undefined;
  return definition ? getSkillViews(definition.skillIds) : [];
};

export const toPublicPlayerView = (state: GameState, playerId: string, viewerUserId?: UserId): PublicPlayerView | PrivatePlayerView => {
  const player = state.players[playerId as keyof typeof state.players];
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }

  const viewer = viewerPlayerForUser(state, viewerUserId);
  const isSelf = player.userId === viewerUserId;
  const characterVisible = canViewCharacter(viewer, player);
  const factionVisible = canViewFaction(viewer, player);
  const skillDetailsVisible = canViewSkillDetails(viewer, player);
  const base: PublicPlayerView = {
    playerId: player.playerId,
    userId: player.userId,
    displayName: player.displayName,
    seatIndex: player.seatIndex,
    aliveState: player.aliveState,
    identityRevealed: player.identityRevealed,
    revealedFaction: factionVisible ? player.faction : undefined,
    ...(characterVisible && player.characterId ? { characterId: player.characterId } : {}),
    ...(characterVisible && player.characterName ? { characterName: player.characterName } : {}),
    ...(characterVisible && player.characterImageUrl ? { characterImageUrl: player.characterImageUrl } : {}),
    characterVisibility: player.characterVisibility,
    characterRevealed: player.characterRevealed,
    gender: player.gender,
    ...(skillDetailsVisible ? { characterSkills: characterSkillViews(player) } : {}),
    ...countInfos(state, playerId),
  };

  if (!isSelf) return base;

  return {
    ...base,
    faction: player.faction,
    regularSkills: player.regularSkills,
    ownSkills: [...getRegularSkillViews(player.regularSkills), ...characterSkillViews(player)],
    privateLog: visiblePrivateLogEntries(state, viewer, player),
  };
};

export const toPublicGameView = (state: GameState, viewerUserId?: UserId): PublicGameView => {
  const view: PublicGameView = {
    roomId: state.roomId,
    status: state.status,
    ...(state.setupState ? { setupState: state.setupState } : {}),
    ...(state.finalPk ? { finalPk: state.finalPk } : {}),
    phase: state.phase,
    roundNumber: state.turn.roundNumber,
    activeSeatIndex: state.turn.activeSeatIndex,
    players: Object.keys(state.players)
      .map((playerId) => toPublicPlayerView(state, playerId, viewerUserId))
      .sort((left, right) => left.seatIndex - right.seatIndex),
    pendingActionsForMe: pendingActionsForUser(state, viewerUserId),
    systemHints: buildSystemHints(state, viewerUserId),
    publicLog: visiblePublicLogEntries(state, viewerPlayerForUser(state, viewerUserId)),
    winner: state.winState.winner,
    version: state.version,
  };

  if (state.currentTransfer) {
    view.currentTransfer = {
      transferId: state.currentTransfer.transferId,
      fromPlayerId: state.currentTransfer.fromPlayerId,
      targetPlayerId: state.currentTransfer.targetPlayerId,
      declaredTruth: state.currentTransfer.declaredTruth,
      forcedReceive: state.currentTransfer.forcedReceive,
      settled: state.currentTransfer.settled,
    };
    if (state.currentTransfer.finalReceiverPlayerId) view.currentTransfer.finalReceiverPlayerId = state.currentTransfer.finalReceiverPlayerId;
    if (state.currentTransfer.receiveDecision) view.currentTransfer.receiveDecision = state.currentTransfer.receiveDecision;
  }

  return view;
};

export const toRoomView = (room: GameRoom, viewerUserId?: UserId): RoomView => {
  const characterById = new Map(MVP_CHARACTER_POOL.map((character) => [character.characterId, character]));
  const toChoice = (characterId: CharacterId) => {
    const character = characterById.get(characterId);
    return character
      ? {
        characterId: character.characterId,
        name: character.name,
        visibility: character.visibility,
        gender: character.gender,
        imageUrl: character.imageUrl,
        skillIds: character.skillIds,
      }
      : undefined;
  };

  const view: RoomView = {
    roomId: room.roomId,
    status: room.status,
    ownerUserId: room.ownerUserId,
    seats: room.seats.map((seat) => {
      const ownOptions = seat.userId === viewerUserId
        ? seat.characterOptionIds?.map((id) => toChoice(id)).filter((choice): choice is NonNullable<typeof choice> => Boolean(choice))
        : undefined;
      return {
        seatIndex: seat.seatIndex,
        userId: seat.userId,
        ...(seat.playerId ? { playerId: seat.playerId } : {}),
        displayName: seat.displayName,
        ready: seat.ready,
        connected: seat.connected,
        isOwner: seat.userId === room.ownerUserId,
        characterSelected: Boolean(seat.selectedCharacterId),
        ...(ownOptions && ownOptions.length > 0 ? { characterOptions: ownOptions } : {}),
      };
    }),
    availableCharacters: [],
  };

  if (room.game) {
    view.game = toPublicGameView(room.game, viewerUserId);
  }

  return view;
};
