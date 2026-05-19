import {
  type Faction,
  type IdentityCounts,
  IDENTITY_COUNTS_BY_PLAYER_COUNT,
  type PlayerCount,
  factionsFromCounts,
  isSupportedPlayerCount,
} from '@wujian/shared';

export const getIdentityCounts = (playerCount: number): IdentityCounts => {
  if (!isSupportedPlayerCount(playerCount)) {
    throw new Error(`Unsupported player count: ${playerCount}. MVP supports 4-8 players.`);
  }

  return IDENTITY_COUNTS_BY_PLAYER_COUNT[playerCount as PlayerCount];
};

export const shuffle = <T>(items: readonly T[], random: () => number = Math.random): T[] => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = next[index];
    const replacement = next[swapIndex];
    if (current === undefined || replacement === undefined) continue;
    next[index] = replacement;
    next[swapIndex] = current;
  }
  return next;
};

export const assignIdentities = (playerCount: number, random: () => number = Math.random): Faction[] => {
  const counts = getIdentityCounts(playerCount);
  return shuffle(factionsFromCounts(counts), random);
};
