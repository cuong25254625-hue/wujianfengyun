import type {
  GameRoom,
  GameState,
  PrivatePlayerView,
  PendingAction,
  PublicGameView,
  PublicPlayerView,
  RoomView,
  UserId,
} from '@wujian/shared';
import { roomToSeatViews } from '@wujian/shared';

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
  return Object.values(state.pendingActions).filter(
    (action) => action.status === 'open' && action.eligiblePlayerIds.includes(player.playerId),
  );
};

export const toPublicPlayerView = (state: GameState, playerId: string, viewerUserId?: UserId): PublicPlayerView | PrivatePlayerView => {
  const player = state.players[playerId as keyof typeof state.players];
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }

  const base: PublicPlayerView = {
    playerId: player.playerId,
    userId: player.userId,
    displayName: player.displayName,
    seatIndex: player.seatIndex,
    aliveState: player.aliveState,
    identityRevealed: player.identityRevealed,
    revealedFaction: player.identityRevealed || player.userId === viewerUserId ? player.faction : undefined,
    ...(player.characterId ? { characterId: player.characterId } : {}),
    ...(player.characterName ? { characterName: player.characterName } : {}),
    ...(player.characterImageUrl && (player.characterRevealed || player.userId === viewerUserId) ? { characterImageUrl: player.characterImageUrl } : {}),
    characterVisibility: player.characterVisibility,
    characterRevealed: player.characterRevealed,
    gender: player.gender,
    ...countInfos(state, playerId),
  };

  if (player.userId !== viewerUserId) return base;

  return {
    ...base,
    faction: player.faction,
    regularSkills: player.regularSkills,
  };
};

export const toPublicGameView = (state: GameState, viewerUserId?: UserId): PublicGameView => {
  const view: PublicGameView = {
    roomId: state.roomId,
    status: state.status,
    phase: state.phase,
    roundNumber: state.turn.roundNumber,
    activeSeatIndex: state.turn.activeSeatIndex,
    players: Object.keys(state.players)
      .map((playerId) => toPublicPlayerView(state, playerId, viewerUserId))
      .sort((left, right) => left.seatIndex - right.seatIndex),
    pendingActionsForMe: pendingActionsForUser(state, viewerUserId),
    publicLog: state.publicLog,
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
  const view: RoomView = {
    roomId: room.roomId,
    status: room.status,
    ownerUserId: room.ownerUserId,
    seats: roomToSeatViews(room),
  };

  if (room.game) {
    view.game = toPublicGameView(room.game, viewerUserId);
  }

  return view;
};
