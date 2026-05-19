import type { Faction } from './types.js';

export type PlayerCount = 4 | 5 | 6 | 7 | 8;

export interface IdentityCounts {
  red: number;
  blue: number;
  white: number;
}

export const IDENTITY_COUNTS_BY_PLAYER_COUNT: Record<PlayerCount, IdentityCounts> = {
  4: { red: 2, blue: 2, white: 0 },
  5: { red: 2, blue: 2, white: 1 },
  6: { red: 2, blue: 2, white: 2 },
  7: { red: 3, blue: 3, white: 1 },
  8: { red: 3, blue: 3, white: 2 },
};

export type ResponsePriorityPolicy = 'seatOrderFromActivePlayer' | 'serverReceiveOrder' | 'explicitPriorityQueue';
export type SkillWindowPolicy = 'allEligiblePlayersPassOrAct' | 'activePlayerEndsWindow' | 'serverTimer';

export interface RegularSkillCounts {
  probe: number;
  lock: number;
  intercept: number;
}

export interface GameConfig {
  playerCount: PlayerCount;
  responsePriorityPolicy: ResponsePriorityPolicy;
  skillWindowPolicy: SkillWindowPolicy;
  falseInfoLimitDefault: number;
  initialRegularSkillCounts: RegularSkillCounts;
  enableWhiteSecretMission: boolean;
  enableCharacterSkills: boolean;
}

export const DEFAULT_REGULAR_SKILL_COUNTS: RegularSkillCounts = {
  probe: 1,
  lock: 1,
  intercept: 1,
};

export const createDefaultGameConfig = (playerCount: PlayerCount): GameConfig => ({
  playerCount,
  responsePriorityPolicy: 'seatOrderFromActivePlayer',
  skillWindowPolicy: 'allEligiblePlayersPassOrAct',
  falseInfoLimitDefault: 2,
  initialRegularSkillCounts: DEFAULT_REGULAR_SKILL_COUNTS,
  enableWhiteSecretMission: false,
  enableCharacterSkills: false,
});

export const isSupportedPlayerCount = (count: number): count is PlayerCount => count >= 4 && count <= 8;

export const factionsFromCounts = (counts: IdentityCounts): Faction[] => [
  ...Array.from({ length: counts.red }, () => 'red' as const),
  ...Array.from({ length: counts.blue }, () => 'blue' as const),
  ...Array.from({ length: counts.white }, () => 'white' as const),
];
