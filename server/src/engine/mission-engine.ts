import type { CharacterId, GameState, Player, PlayerId } from '@wujian/shared';

/**
 * 白方机密任务引擎 — MVP Phase 1
 *
 * 每个白方角色携带一个机密任务。任务条件在 VictoryDeclareWindow
 * 被检查。死亡延迟型（※）任务在角色死亡时记下完成状态，
 * 下一个 VictoryDeclareWindow 自动结算。
 */

export interface MissionResult {
  met: boolean;
  reason: string;
  deathDelay?: boolean;
}

/**
 * 检查指定玩家是否完成了其角色的机密任务。
 * 仅在 faction === 'white' 时有效。
 */
export function checkMission(game: GameState, playerId: PlayerId): MissionResult {
  const player = game.players[playerId];
  if (!player || player.faction !== 'white') return { met: false, reason: '不是白方角色' };

  switch (player.characterId as string) {
    case 'char_001_chen_yong_ren':
      return checkChenYongRen(player, game);
    case 'char_002_liu_jian_ming':
      return checkLiuJianMing(player, game);
    case 'char_004_holmes':
      return checkHolmes(player, game);
    case 'char_006_naruhodo':
      return checkNaruhodo(player, game);
    case 'char_008_jack_the_ripper':
      return checkJack(player, game);
    case 'char_009_akise_aru':
      return checkAkiseAru(player, game);
    case 'char_014_ayazato_chihiro':
      return checkAyazatoChihiro(player, game);
    case 'char_016_cc':
      return checkCC(player, game);
    case 'char_017_ayanami_rei':
      return checkAyanamiRei(player, game);
    case 'char_020_gasai_yuno':
      return checkGasaiYuno(player, game);
    default:
      // 未实现任务的白方角色：默认真情报 ≥3
      return checkDefault(player, game);
  }
}

/**
 * 在玩家死亡时检查其是否有死亡延迟任务，若满足则标记为 met。
 * 返回已标记的角色数量。
 */
export function markDeathDelayMissions(game: GameState, dyingPlayerId: PlayerId): number {
  const player = game.players[dyingPlayerId];
  if (!player || player.faction !== 'white' || player.missionStatus !== 'pending') return 0;

  const result = checkMission(game, dyingPlayerId);
  if (result.met && result.deathDelay) {
    player.missionStatus = 'met';
    return 1;
  }
  return 0;
}

/**
 * 检查是否有玩家存在已完成但未宣告的死亡延迟任务，
 * 如有则在 VictoryDeclareWindow 自动宣告。
 */
export function checkDeathDelayVictories(game: GameState): PlayerId[] {
  return Object.values(game.players)
    .filter((p) => p.faction === 'white' && p.missionStatus === 'met' && p.aliveState === 'dead')
    .map((p) => p.playerId);
}

// === 内部检查函数 ===

function countTrueInfos(game: GameState, playerId: PlayerId): number {
  return Object.values(game.infoCards).filter((c) => c.ownerPlayerId === playerId && c.truth === 'true').length;
}

function countTotalInfos(game: GameState, playerId: PlayerId): number {
  return Object.values(game.infoCards).filter((c) => c.ownerPlayerId === playerId).length;
}

function infoGap(game: GameState, playerId: PlayerId): number {
  const mine = countTotalInfos(game, playerId);
  const others = Object.values(game.players)
    .filter((p) => p.playerId !== playerId && p.aliveState === 'alive')
    .map((p) => countTotalInfos(game, p.playerId));
  if (others.length === 0) return mine;
  return mine - Math.min(...others);
}

function getCounter(player: Player, key: string): number {
  return (player.missionCounters[key] as number) ?? 0;
}

// 001 陈永仁：你传出的假情报导致其他玩家死亡
function checkChenYongRen(player: Player, _game: GameState): MissionResult {
  const caused = getCounter(player, 'caused_death');
  if (caused >= 1) return { met: true, reason: `你的假情报已导致 ${caused} 名玩家死亡。` };
  return { met: false, reason: '尚未有玩家因你传出的假情报死亡。' };
}

// 002 刘建明：你面前有 ≥2 真情报
function checkLiuJianMing(player: Player, game: GameState): MissionResult {
  const trueCount = countTrueInfos(game, player.playerId);
  if (trueCount >= 2) return { met: true, reason: `你面前有 ${trueCount} 张真情报。` };
  return { met: false, reason: '你当前面前真情报不足 2 张。' };
}

// 004 福尔摩斯：揭露技能已使用 + 面前 3 真情报
function checkHolmes(player: Player, game: GameState): MissionResult {
  const used = getCounter(player, 'jie_lu_used');
  const trueCount = countTrueInfos(game, player.playerId);
  if (used >= 1 && trueCount >= 3) return { met: true, reason: `揭露已使用，面前有 ${trueCount} 张真情报。` };
  return { met: false, reason: '需使用揭露并获得 3 张真情报。' };
}

// 006 成步堂龙一：逆转已使用 + 与其他存活玩家的情报数差 ≥2
function checkNaruhodo(player: Player, game: GameState): MissionResult {
  const used = getCounter(player, 'ni_zhuan_used');
  const gap = infoGap(game, player.playerId);
  if (used >= 1 && gap >= 2) return { met: true, reason: `逆转已使用，情报差为 ${gap}。` };
  return { met: false, reason: '需使用逆转并形成 ≥2 情报差。' };
}

// 008 杰克：亲手杀死过女性角色
function checkJack(player: Player, _game: GameState): MissionResult {
  const killed = getCounter(player, 'killed_female');
  if (killed >= 1) return { met: true, reason: `你已亲手杀死 ${killed} 名女性角色。` };
  return { met: false, reason: '尚未亲手杀死女性角色。' };
}

// 009 秋濑或：※死亡时 ≥2 真情报（延迟宣胜）
function checkAkiseAru(player: Player, game: GameState): MissionResult {
  const trueCount = countTrueInfos(game, player.playerId);
  if (trueCount >= 2) return { met: true, reason: `死亡延迟：面前有 ${trueCount} 张真情报。`, deathDelay: true };
  return { met: false, reason: '死亡延迟：需在死亡时面前有 2 张以上真情报。' };
}

// 014 绫里千寻：※第一个死亡（延迟宣胜）
function checkAyazatoChihiro(player: Player, game: GameState): MissionResult {
  const deadCount = Object.values(game.players).filter((p) => p.aliveState === 'dead').length;
  // 自己是第一个死的 → 自己是唯一死者
  const isFirstDead = deadCount <= 1 && player.aliveState === 'dead';
  // 如果还没死，检查：还没有任何人死亡
  const noOneDeadYet = deadCount === 0;
  if (isFirstDead) return { met: true, reason: '你是第一个死亡的玩家。', deathDelay: true };
  if (noOneDeadYet && player.aliveState === 'alive') return { met: false, reason: '需成为第一个死亡的玩家。' };
  return { met: false, reason: '已有其他玩家先死亡。' };
}

// 016 C.C：※被指定目标杀死（延迟宣胜）
function checkCC(player: Player, game: GameState): MissionResult {
  const targetId = player.flags.cc_mission_target as PlayerId | undefined;
  if (!targetId) return { met: false, reason: '尚未指定目标。' };
  const killedByTarget = getCounter(player, 'killed_by_target');
  if (killedByTarget >= 1) return { met: true, reason: '你已被指定目标杀死。', deathDelay: true };
  // 还没被目标杀死
  if (player.aliveState === 'dead') return { met: false, reason: '已死亡但并非被指定目标所杀。' };
  return { met: false, reason: '需被指定目标杀死。' };
}

// 017 绫波丽：克隆已使用 + (有人因此死亡 或 所有存活 ≥2 情报)
function checkAyanamiRei(player: Player, game: GameState): MissionResult {
  const used = getCounter(player, 'ke_long_used');
  if (used < 1) return { met: false, reason: '尚未使用克隆。' };

  const cloneKilled = getCounter(player, 'clone_caused_death');
  if (cloneKilled >= 1) return { met: true, reason: '克隆已使用，已导致他人死亡。' };

  const allAlive = Object.values(game.players).filter((p) => p.aliveState === 'alive' && p.playerId !== player.playerId);
  const allHaveTwo = allAlive.length > 0 && allAlive.every((p) => countTotalInfos(game, p.playerId) >= 2);
  if (allHaveTwo) return { met: true, reason: '克隆已使用，所有存活玩家面前都有 ≥2 张情报。' };

  return { met: false, reason: '需克隆导致他人死亡或所有存活玩家 ≥2 情报。' };
}

// 020 我妻由乃：新生已使用 + 面前 ≥3 真情报
function checkGasaiYuno(player: Player, game: GameState): MissionResult {
  const used = getCounter(player, 'xin_sheng_used');
  const trueCount = countTrueInfos(game, player.playerId);
  if (used >= 1 && trueCount >= 3) return { met: true, reason: `新生已使用，面前有 ${trueCount} 张真情报。` };
  return { met: false, reason: '需使用新生并获得 3 张真情报。' };
}

// 默认条件：面前 ≥3 真情报
function checkDefault(player: Player, game: GameState): MissionResult {
  const trueCount = countTrueInfos(game, player.playerId);
  if (trueCount >= 3) return { met: true, reason: `你面前有 ${trueCount} 张真情报。` };
  return { met: false, reason: '需集齐 3 张真情报。' };
}
