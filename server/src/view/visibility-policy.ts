import type { GameState, PendingAction, Player, PrivateLogEntry, PublicLogEntry, UserId } from '@wujian/shared';

export const viewerPlayerForUser = (state: GameState, viewerUserId?: UserId): Player | undefined =>
  viewerUserId ? Object.values(state.players).find((player) => player.userId === viewerUserId) : undefined;

export const isSelf = (viewer: Player | undefined, target: Player): boolean => viewer?.playerId === target.playerId;

export const canViewFaction = (viewer: Player | undefined, target: Player): boolean =>
  isSelf(viewer, target) || target.identityRevealed;

export const canViewCharacter = (viewer: Player | undefined, target: Player): boolean =>
  isSelf(viewer, target) || target.characterRevealed || target.characterVisibility === 'public';

export const canViewSkillDetails = (viewer: Player | undefined, target: Player): boolean => canViewCharacter(viewer, target);

export const canViewPrivateLog = (viewer: Player | undefined, target: Player): boolean => isSelf(viewer, target);

const privateLogKeys = new Set([
  'character.jiuJiKnown',
  'character.tanJiu',
  'mission.ccTargetSelected',
  'mission.deathDelayMet.private',
  'probe.success',
  'probe.failed',
  'transfer.declaredTruth',
  'transfer.rejectedTruth',
  'character.souCha',
  'character.qiZhaPeek',
  'character.kaiYan',
  'character.baoMi',
  'character.jiaoJi',
]);

const hiddenCharacterParamKeys = new Set(['characterId', 'characterName', 'targetCharacterId', 'targetCharacterName']);

const shouldRedactCharacterParam = (state: GameState, viewer: Player | undefined, key: string, value: string | number | boolean): boolean => {
  if (!hiddenCharacterParamKeys.has(key)) return false;
  if (typeof value !== 'string') return false;
  const target = Object.values(state.players).find((player) => player.characterId === value || player.characterName === value);
  if (!target) return false;
  return !canViewCharacter(viewer, target);
};

const redactParams = (state: GameState, viewer: Player | undefined, params: PublicLogEntry['params']): PublicLogEntry['params'] => {
  const next: PublicLogEntry['params'] = {};
  for (const [key, value] of Object.entries(params)) {
    if (shouldRedactCharacterParam(state, viewer, key, value)) {
      next[key] = '隐藏角色';
      continue;
    }
    next[key] = value;
  }
  return next;
};

export const visiblePublicLogEntries = (state: GameState, viewer: Player | undefined): PublicLogEntry[] =>
  state.publicLog
    .filter((entry) => !privateLogKeys.has(entry.messageKey))
    .map((entry) => ({
      ...entry,
      params: redactParams(state, viewer, entry.params),
    }));

export const visiblePrivateLogEntries = (state: GameState, viewer: Player | undefined, target: Player): PrivateLogEntry[] => {
  if (!canViewPrivateLog(viewer, target)) return [];
  return (state.privateLogs as Record<string, PrivateLogEntry[]>)[target.playerId] ?? [];
};

export const redactPendingActionForViewer = (action: PendingAction): PendingAction => {
  if (action.context.type !== 'generic') return action;
  const data = action.context.data ?? {};
  const redactedData = { ...data };
  // setup choice 等私密目标只发给 eligible 玩家，但这里仍额外避免把已选择目标混入通用上下文。
  delete redactedData['selectedTargetPlayerId'];
  delete redactedData['ccMissionTargetPlayerId'];
  return {
    ...action,
    context: { type: 'generic', data: redactedData },
  };
};
