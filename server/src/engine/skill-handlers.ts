/**
 * 技能处理器注册式挂接
 *
 * 将人物技能实现从 game-room-runtime 的大型 switch/case 中提取出来，
 * 每个技能注册为一个独立处理器，通过 skillId 查找。
 *
 * 每个处理器仍然通过闭包访问 runtime 的内部方法（addInfo、burnInfos 等），
 * 避免一次性重构所有内部 API。
 */

import type { DomainResult, GameEvent, GameState, InfoId, Player, PlayerId } from '@wujian/shared';
import { err, ok } from '@wujian/shared';

export interface SkillInput {
  targetPlayerId: PlayerId | undefined;
  secondaryTargetPlayerId: PlayerId | undefined;
  transfer: { targetPlayerId: PlayerId; truth: 'true' | 'false' } | undefined;
}

export interface SkillHandler {
  skillId: string;
  canUse(runtime: SkillRuntimeAccess, game: GameState, player: Player, input: SkillInput): DomainResult<void>;
  resolve(runtime: SkillRuntimeAccess, game: GameState, player: Player, input: SkillInput): DomainResult<GameState>;
}

/**
 * 暴露 runtime 的内部能力给技能处理器（最小接口）。
 */
export interface SkillRuntimeAccess {
  addLog(game: GameState, key: string, params: Record<string, string | number | boolean>): void;
  addPrivateLog(game: GameState, playerId: PlayerId, key: string, params: Record<string, string | number | boolean>): void;
  addInfo(game: GameState, ownerId: PlayerId, truth: 'true' | 'false', sourceId: PlayerId | undefined, reason: string): InfoId;
  burnInfos(game: GameState, ownerId: PlayerId, count: number, sourceId: PlayerId | undefined, reason: string, truthFilter?: 'true' | 'false'): number;
  moveInfo(game: GameState, infoId: InfoId, toPlayerId: PlayerId, reason: string): void;
  revealCharacter(game: GameState, player: Player): void;
  appendEvent(game: GameState, payload: GameEvent): void;
  recordPendingAct(game: GameState, playerId: PlayerId): void;
  hasSkill(player: Player | undefined, skillId: string): boolean;
  infoCount(game: GameState, playerId: PlayerId, truth: 'true' | 'false'): number;
  infoIdsByTruth(game: GameState, playerId: PlayerId, truth: 'true' | 'false'): InfoId[];
  playerName(game: GameState, playerId: PlayerId): string;
  activePlayer(game: GameState): Player;
  afterInfoChanged(game: GameState): GameState;
  maybeResolveReaction(game: GameState): GameState;
  advanceTurn(game: GameState): GameState;
  handleDeclareTransfer(game: GameState, playerId: PlayerId, targetPlayerId: PlayerId, truth: 'true' | 'false'): DomainResult<GameState>;
  isCharacterSkillDisabled(game: GameState, player: Player): boolean;
  settleTransfer(game: GameState): GameState;
  firstDyingCandidate(game: GameState): PlayerId | undefined;
  startDying(game: GameState, playerId: PlayerId, cause: string): GameState;
  openPendingAction(game: GameState, kind: string, eligibleIds: PlayerId[], context: unknown): unknown;
  enterPhase(game: GameState, phase: string, context: unknown): GameState;
  /** 诸葛亮「八阵」星标记：在当前回合窗口标记一名玩家，返回标记数量或失败原因。 */
  markStar(game: GameState, playerId: PlayerId, targetPlayerId: PlayerId): DomainResult<number>;
  /** 获取星标记总数。 */
  starMarkCount(game: GameState): number;
  /** 弃掉全部星标记（八阵发动后）。 */
  clearStarMarks(game: GameState): void;
  /** 进入竖锯轮。 */
  enterJigsawRound(game: GameState, playerId: PlayerId): DomainResult<GameState>;
  /** 标记牢狱。 */
  markPrison(game: GameState, targetPlayerId: PlayerId, sourcePlayerId: PlayerId): void;
  /** 关闭目标玩家当前所有公开情报（盖伏）。 */
  coverUpInfo(game: GameState, targetPlayerId: PlayerId): void;
  /** 获取玩家情报列表（仅 ID）。 */
  allInfoIds(game: GameState, playerId: PlayerId): InfoId[];
  /** 切换玩家性别。 */
  switchGender(player: Player, newGender: 'male' | 'female'): void;
}

type HandlerFactory = (runtime: SkillRuntimeAccess) => SkillHandler;

const rememberSkillIdentity = (player: Player, target: Player, source = 'skill'): void => {
  if (player.knownIdentities.some((known) => known.targetPlayerId === target.playerId && known.faction === target.faction)) return;
  player.knownIdentities.push({ targetPlayerId: target.playerId, faction: target.faction, source: source as 'skill' });
};

const incrementCounter = (player: Player, key: string, amount = 1): void => {
  player.missionCounters[key] = ((player.missionCounters[key] as number) ?? 0) + amount;
};

const requireAliveOtherTarget = (game: GameState, player: Player, targetPlayerId: PlayerId | undefined, code: string, message: string): DomainResult<Player> => {
  if (!targetPlayerId || targetPlayerId === player.playerId) return err(`${code}.targetRequired`, message);
  const target = game.players[targetPlayerId];
  if (!target || target.aliveState !== 'alive') return err(`${code}.targetNotFound`, '目标不存在或未存活');
  return ok(target);
};

const handlerFactories = new Map<string, HandlerFactory>();

export function registerSkillHandler(skillId: string, factory: HandlerFactory): void {
  handlerFactories.set(skillId, factory);
}

export function getSkillHandler(skillId: string, runtime: SkillRuntimeAccess): SkillHandler | undefined {
  const factory = handlerFactories.get(skillId);
  return factory?.(runtime);
}

export function hasHandler(skillId: string): boolean {
  return handlerFactories.has(skillId);
}

// ───────────────── 技能处理器注册 ─────────────────

// mie_ji（刘建明 - 灭迹）
registerSkillHandler('mie_ji', (rt) => ({
  skillId: 'mie_ji',
  canUse(runtime, game, player, input) {
    if (!['SkillWindow', 'ReactionWindow', 'DyingWindow'].includes(game.phase.phase)) return err('mieJi.invalidPhase', '灭迹只能在传递、技能、濒死阶段使用');
    if (player.flags.mie_ji_used) return err('mieJi.used', 'MVP 中灭迹每局限一次');
    if (!input.targetPlayerId || input.targetPlayerId === player.playerId) return err('mieJi.targetRequired', '灭迹需要选择另一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target) return err('mieJi.targetNotFound', '目标不存在');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    runtime.revealCharacter(game, player);
    player.flags.mie_ji_used = true;
    const burned = runtime.burnInfos(game, input.targetPlayerId!, 3, player.playerId, 'mie_ji');
    runtime.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'mie_ji', targetPlayerId: input.targetPlayerId } as GameEvent);
    runtime.addLog(game, 'character.mieJi', { player: player.displayName, target: target.displayName, count: burned });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// jie_lu（福尔摩斯 - 揭露）
registerSkillHandler('jie_lu', (rt) => ({
  skillId: 'jie_lu',
  canUse(runtime, game, player, _input) {
    const transfer = game.currentTransfer;
    if (!transfer || transfer.fromPlayerId === player.playerId || game.phase.phase !== 'ReactionWindow') return err('jieLu.invalidPhase', '揭露只能在他人的传递响应窗口使用');
    if (player.flags.jie_lu_lost) return err('jieLu.lost', '揭露已经失去');
    return ok(undefined);
  },
  resolve(runtime, game, player, _input) {
    const transfer = game.currentTransfer!;
    runtime.revealCharacter(game, player);
    runtime.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'jie_lu' });
    runtime.recordPendingAct(game, player.playerId);
    player.missionCounters['jie_lu_used'] = ((player.missionCounters['jie_lu_used'] as number) ?? 0) + 1;
    if (transfer.declaredTruth === 'true') {
      player.flags.jie_lu_lost = true;
      const infoId = runtime.addInfo(game, player.playerId, 'true', player.playerId, 'jie_lu');
      runtime.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'jie_lu' });
      transfer.infoId = infoId;
      transfer.settled = true;
      runtime.addLog(game, 'character.jieLuTrue', { player: player.displayName });
      delete game.currentTransfer;
      const dying = runtime.firstDyingCandidate(game);
      if (dying) return ok(runtime.startDying(game, dying, 'falseInfoLimit'));
      return ok(runtime.advanceTurn(game));
    }
    runtime.addLog(game, 'character.jieLuFalse', { player: player.displayName });
    return ok(runtime.maybeResolveReaction(game));
  },
}));

// yi_yi（成步堂龙一 - 异议）
registerSkillHandler('yi_yi', (rt) => ({
  skillId: 'yi_yi',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('yiYi.invalidPhase', '异议只能在技能阶段使用');
    if (!input.targetPlayerId || input.targetPlayerId === player.playerId) return err('yiYi.targetRequired', '异议需要选择另一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target) return err('yiYi.targetNotFound', '目标不存在');
    const key = `yi_yi_target_${input.targetPlayerId}`;
    if (player.flags[key]) return err('yiYi.targetUsed', '异议对每名玩家限一次');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    const key = `yi_yi_target_${input.targetPlayerId}`;
    player.flags[key] = true;
    target.flags.character_skill_disabled_until_turn_serial = game.turn.turnSerial + 1;
    runtime.appendEvent(game, { type: 'CharacterSkillDisabled', sourcePlayerId: player.playerId, targetPlayerId: input.targetPlayerId, skillId: 'yi_yi', untilTurnSerial: game.turn.turnSerial + 1 } as GameEvent);
    runtime.addLog(game, 'character.yiYi', { player: player.displayName, target: target.displayName });
    return ok(game);
  },
}));

// ni_zhuan（成步堂龙一 - 逆转）
registerSkillHandler('ni_zhuan', (rt) => ({
  skillId: 'ni_zhuan',
  canUse(runtime, game, player, input) {
    if (!['SkillWindow', 'TransferDeclare'].includes(game.phase.phase)) return err('niZhuan.invalidPhase', '逆转只能在传递或技能阶段使用');
    if (!input.targetPlayerId || input.targetPlayerId === player.playerId) return err('niZhuan.targetRequired', '逆转需要选择另一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target) return err('niZhuan.targetNotFound', '目标不存在');
    if (player.infoIds.length < 1 || target.infoIds.length < 1) return err('niZhuan.noInfo', '双方都至少需要一张情报');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    player.identityRevealed = true;
    const mine = [...player.infoIds];
    const theirs = [...target.infoIds];
    player.infoIds = theirs;
    target.infoIds = mine;
    for (const id of mine) game.infoCards[id]!.ownerPlayerId = target.playerId;
    for (const id of theirs) game.infoCards[id]!.ownerPlayerId = player.playerId;
    player.missionCounters['ni_zhuan_used'] = ((player.missionCounters['ni_zhuan_used'] as number) ?? 0) + 1;
    runtime.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'ni_zhuan', targetPlayerId: input.targetPlayerId } as GameEvent);
    runtime.addLog(game, 'character.niZhuan', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// guan_fan（开膛手杰克 - 惯犯）
registerSkillHandler('guan_fan', (rt) => ({
  skillId: 'guan_fan',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('guanFan.invalidPhase', '惯犯只能在技能阶段使用');
    if (!player.flags.guan_fan_available) return err('guanFan.notAvailable', '尚未满足惯犯触发条件');
    if (!input.targetPlayerId || input.targetPlayerId === player.playerId) return err('guanFan.targetRequired', '惯犯需要选择另一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState !== 'alive') return err('guanFan.targetNotFound', '目标不存在或未存活');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    runtime.addInfo(game, input.targetPlayerId!, 'false', player.playerId, 'guan_fan');
    runtime.addInfo(game, input.targetPlayerId!, 'false', player.playerId, 'guan_fan');
    player.flags.guan_fan_available = false;
    player.flags.zhao_zhang_lost = true;
    runtime.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'zhao_zhang' });
    runtime.addLog(game, 'character.guanFan', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// du_bo（秋濑或 - 赌博）
registerSkillHandler('du_bo', (rt) => ({
  skillId: 'du_bo',
  canUse(runtime, game, player, input) {
    if (!['SkillWindow', 'DyingWindow'].includes(game.phase.phase)) return err('duBo.invalidPhase', '赌博只能在技能阶段或自己的濒死阶段使用');
    if (game.phase.phase === 'DyingWindow' && player.aliveState !== 'dying') return err('duBo.notDying', '只有自己的濒死阶段可以濒死赌博');
    if (player.flags.du_bo_round === game.turn.roundNumber) return err('duBo.roundUsed', '赌博每轮限一次');
    if (!input.targetPlayerId || input.targetPlayerId === player.playerId) return err('duBo.targetRequired', '赌博需要选择另一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState === 'dead') return err('duBo.targetNotFound', '目标不存在或已死亡');
    const key = `du_bo_target_${input.targetPlayerId}`;
    if (player.flags[key]) return err('duBo.targetUsed', '赌博对每名玩家限一次');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    const key = `du_bo_target_${input.targetPlayerId}`;
    player.flags.du_bo_round = game.turn.roundNumber;
    player.flags[key] = true;
    const playerGetsTrue = Math.random() < 0.5;
    runtime.addInfo(game, player.playerId, playerGetsTrue ? 'true' : 'false', player.playerId, 'du_bo');
    runtime.addInfo(game, input.targetPlayerId!, playerGetsTrue ? 'false' : 'true', player.playerId, 'du_bo');
    runtime.addLog(game, 'character.duBo', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// bian_hu（绫里千寻 - 辩护）
registerSkillHandler('bian_hu', (rt) => ({
  skillId: 'bian_hu',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('bianHu.invalidPhase', '辩护只能在技能阶段使用');
    if (!input.targetPlayerId || input.targetPlayerId === player.playerId) return err('bianHu.targetRequired', '辩护需要选择另一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target) return err('bianHu.targetNotFound', '目标不存在');
    const myTrue = runtime.infoIdsByTruth(game, player.playerId, 'true');
    const targetFalse = runtime.infoIdsByTruth(game, input.targetPlayerId, 'false');
    if (Math.min(myTrue.length, targetFalse.length) < 1) return err('bianHu.noInfo', '需要你的真情报和目标假情报');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const myTrue = runtime.infoIdsByTruth(game, player.playerId, 'true');
    const targetFalse = runtime.infoIdsByTruth(game, input.targetPlayerId!, 'false');
    const count = Math.min(myTrue.length, targetFalse.length);
    for (let i = 0; i < count; i++) {
      runtime.moveInfo(game, myTrue[i]!, input.targetPlayerId!, 'bian_hu');
      runtime.moveInfo(game, targetFalse[i]!, player.playerId, 'bian_hu');
    }
    runtime.addLog(game, 'character.bianHu', { player: player.displayName, target: game.players[input.targetPlayerId!]!.displayName, count });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// ling_mei（绫里千寻 - 灵媒）
registerSkillHandler('ling_mei', (rt) => ({
  skillId: 'ling_mei',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('lingMei.invalidPhase', '灵媒借传只能在技能阶段使用');
    if (!input.targetPlayerId || !input.secondaryTargetPlayerId) return err('lingMei.targetRequired', '灵媒需要选择死者和传递目标');
    const dead = game.players[input.targetPlayerId];
    const target = game.players[input.secondaryTargetPlayerId];
    if (!dead || dead.aliveState !== 'dead') return err('lingMei.notDead', '灵媒来源必须是已死亡玩家');
    if (!target || target.aliveState !== 'alive') return err('lingMei.targetNotAlive', '灵媒目标必须存活');
    const key = `ling_mei_dead_${input.targetPlayerId}`;
    if (player.flags[key]) return err('lingMei.used', '每名死者限借传一次');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const dead = game.players[input.targetPlayerId!]!;
    const target = game.players[input.secondaryTargetPlayerId!]!;
    const truth = input.transfer?.truth ?? 'true';
    const key = `ling_mei_dead_${input.targetPlayerId}`;
    player.flags[key] = true;
    runtime.addInfo(game, input.secondaryTargetPlayerId!, truth, input.targetPlayerId, 'ling_mei');
    runtime.addLog(game, 'character.lingMei', { player: player.displayName, dead: dead.displayName, target: target.displayName, truth });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// qi_yue（C.C - 契约）
registerSkillHandler('qi_yue', (rt) => ({
  skillId: 'qi_yue',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'TransferDeclare') return err('qiYue.invalidPhase', '契约只能在自己的传递阶段使用');
    if (runtime.activePlayer(game).playerId !== player.playerId) return err('qiYue.notActive', '只有当前回合玩家可以发动契约');
    if (player.flags.qi_yue_lost) return err('qiYue.lost', '契约已经放弃');
    if (!input.targetPlayerId || !input.secondaryTargetPlayerId ||
        input.targetPlayerId === input.secondaryTargetPlayerId ||
        input.targetPlayerId === player.playerId ||
        input.secondaryTargetPlayerId === player.playerId) {
      return err('qiYue.targetRequired', '契约需要选择两名不同其他玩家');
    }
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const truth = input.transfer?.truth ?? 'true';
    player.flags.cc_pending_second_transfer = input.secondaryTargetPlayerId!;
    runtime.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'qi_yue', targetPlayerId: input.targetPlayerId, secondaryTargetPlayerId: input.secondaryTargetPlayerId } as GameEvent);
    return runtime.handleDeclareTransfer(game, player.playerId, input.targetPlayerId!, truth);
  },
}));

// shou_hu（C.C - 守护）
registerSkillHandler('shou_hu', (rt) => ({
  skillId: 'shou_hu',
  canUse(_runtime, game, player, _input) {
    if (game.phase.phase !== 'SkillWindow') return err('shouHu.invalidPhase', '守护只能在技能阶段使用');
    if (player.flags.qi_yue_lost) return err('shouHu.lost', '已经放弃契约');
    const targetId = player.flags.shou_hu_target;
    if (typeof targetId !== 'string') return err('shouHu.notAvailable', '没有可守护的真情报接收者');
    const target = game.players[targetId as PlayerId];
    if (!target) return err('shouHu.targetNotFound', '守护目标不存在');
    return ok(undefined);
  },
  resolve(runtime, game, player, _input) {
    const targetId = player.flags.shou_hu_target as PlayerId;
    const target = game.players[targetId]!;
    const burned = runtime.burnInfos(game, target.playerId, 1, player.playerId, 'shou_hu', 'false');
    if (burned < 1) return err('shouHu.noFalse', '目标没有假情报可烧毁');
    player.flags.qi_yue_lost = true;
    delete player.flags.shou_hu_target;
    runtime.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'qi_yue' });
    runtime.addLog(game, 'character.shouHu', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// xin_sheng（我妻由乃 - 新生）
registerSkillHandler('xin_sheng', (rt) => ({
  skillId: 'xin_sheng',
  canUse(_runtime, game, player, _input) {
    if (game.phase.phase !== 'DyingWindow' || player.aliveState !== 'dying') return err('xinSheng.invalidPhase', '新生只能在自己的濒死阶段使用');
    if (player.flags.beng_huai_lost) return err('xinSheng.used', '已经放弃崩坏');
    return ok(undefined);
  },
  resolve(runtime, game, player, _input) {
    const burned = runtime.burnInfos(game, player.playerId, 1, player.playerId, 'xin_sheng', 'false');
    if (burned < 1) return err('xinSheng.noFalse', '没有假情报可烧毁');
    player.flags.beng_huai_lost = true;
    runtime.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'beng_huai' });
    player.missionCounters['xin_sheng_used'] = ((player.missionCounters['xin_sheng_used'] as number) ?? 0) + 1;
    if (runtime.infoCount(game, player.playerId, 'false') < player.falseInfoLimit) {
      player.aliveState = 'alive';
      runtime.addLog(game, 'character.xinShengSaved', { player: player.displayName });
      return ok(runtime.advanceTurn(game));
    }
    return ok(game);
  },
}));

// jiu_ji（陈永仁 - 就计）
registerSkillHandler('jiu_ji', (rt) => ({
  skillId: 'jiu_ji',
  canUse(_runtime, game, player, _input) {
    if (game.phase.phase !== 'DyingWindow' || player.aliveState !== 'dying') return err('jiuJi.invalidPhase', '就计返还只能在自己的濒死阶段使用');
    const sourceId = player.flags.jiu_ji_return_source;
    if (typeof sourceId !== 'string') return err('jiuJi.notAvailable', '没有可返还的传递假情报');
    return ok(undefined);
  },
  resolve(runtime, game, player, _input) {
    const sourceId = player.flags.jiu_ji_return_source as PlayerId;
    const falseInfo = runtime.infoIdsByTruth(game, player.playerId, 'false')[0];
    if (!falseInfo) return err('jiuJi.noFalse', '没有假情报可返还');
    runtime.revealCharacter(game, player);
    runtime.moveInfo(game, falseInfo, sourceId, 'jiu_ji');
    delete player.flags.jiu_ji_return_source;
    runtime.addLog(game, 'character.jiuJiReturn', { player: player.displayName, target: runtime.playerName(game, sourceId) });
    if (runtime.infoCount(game, player.playerId, 'false') < player.falseInfoLimit) {
      player.aliveState = 'alive';
      return ok(runtime.advanceTurn(game));
    }
    return ok(game);
  },
}));

// cai_jue（夜神月 - 裁决）
registerSkillHandler('cai_jue', (rt) => ({
  skillId: 'cai_jue',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('caiJue.invalidPhase', '裁决只能在技能阶段使用');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'caiJue', '裁决需要选择另一名玩家');
    if (!targetResult.ok) return targetResult;
    const key = `cai_jue_target_${input.targetPlayerId}`;
    if (player.flags[key]) return err('caiJue.targetUsed', '裁决对每名玩家限一次');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    player.flags[`cai_jue_target_${input.targetPlayerId}`] = true;
    incrementCounter(player, 'cai_jue_used');
    runtime.revealCharacter(game, player);
    runtime.addInfo(game, target.playerId, 'false', player.playerId, 'cai_jue');
    runtime.addLog(game, 'character.caiJue', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// ba_zhen（诸葛亮 - 八阵）★ 星标记系统
registerSkillHandler('ba_zhen', (rt) => ({
  skillId: 'ba_zhen',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('baZhen.invalidPhase', '八阵只能在技能阶段使用');
    if (!input.targetPlayerId) return err('baZhen.targetRequired', '八阵需要选择一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState === 'dead') return err('baZhen.targetNotFound', '目标不存在或已死亡');
    // 每 SkillWindow/ReactionWindow 最多 1 个星标记；全场最多 3 个
    if (runtime.starMarkCount(game) >= 3) return err('baZhen.starMarkFull', '星标记已达到全场上限（3个）');
    // 检查是否已有本窗口的星标记
    const thisWindowMarked = game.phase.phase;
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    const markResult = runtime.markStar(game, player.playerId, input.targetPlayerId!);
    if (!markResult.ok) return markResult;
    const markCount = markResult.value;
    // 星标记 ≥ 3 时可弃全体星标记使下家不能宣告胜利
    if (markCount >= 3) {
      runtime.clearStarMarks(game);
      runtime.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'ba_zhen', targetPlayerId: input.targetPlayerId } as GameEvent);
      runtime.addLog(game, 'skill.zhuGeEightFormation', { player: player.displayName, count: 3 });
      // 禁止下一位存活玩家的宣胜
      const aliveSeats = Object.values(game.players).filter((p) => p.aliveState === 'alive').sort((a, b) => a.seatIndex - b.seatIndex);
      const currentSeat = game.turn.activeSeatIndex;
      const nextPlayer = aliveSeats.find((p) => p.seatIndex > currentSeat) ?? aliveSeats[0];
      if (nextPlayer) {
        nextPlayer.flags['no_victory_declare_until_turn'] = game.turn.turnSerial + 1;
        runtime.addLog(game, 'skill.zhuGeBlockVictory', { player: player.displayName, target: nextPlayer.displayName });
      }
    } else {
      const burned = runtime.burnInfos(game, target.playerId, 1, player.playerId, 'ba_zhen', 'false');
      runtime.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'ba_zhen', targetPlayerId: input.targetPlayerId } as GameEvent);
      runtime.addLog(game, 'character.baZhen', { player: player.displayName, target: target.displayName, count: burned });
    }
    runtime.revealCharacter(game, player);
    incrementCounter(player, 'ba_zhen_used');
    incrementCounter(player, 'false_info_cleansed', 1);
    return ok(runtime.afterInfoChanged(game));
  },
}));

// sou_cha（御剑怜侍 - 搜查）+ 牢狱机制
registerSkillHandler('sou_cha', (rt) => ({
  skillId: 'sou_cha',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('souCha.invalidPhase', '搜查只能在技能阶段使用');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'souCha', '搜查需要选择另一名玩家');
    if (!targetResult.ok) return targetResult;
    const key = `sou_cha_target_${input.targetPlayerId}`;
    if (player.flags[key]) return err('souCha.targetUsed', '搜查对每名玩家限一次');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    player.flags[`sou_cha_target_${input.targetPlayerId}`] = true;
    rememberSkillIdentity(player, target);
    // 牢狱：被搜查玩家获得 prison 标记，技能阶段禁止使用人物技能
    runtime.markPrison(game, input.targetPlayerId!, player.playerId);
    // 盖伏目标全部公开情报
    runtime.coverUpInfo(game, input.targetPlayerId!);
    runtime.revealCharacter(game, player);
    incrementCounter(player, 'sou_cha_used');
    runtime.addPrivateLog(game, player.playerId, 'character.souCha', { player: player.displayName, target: target.displayName, faction: target.faction, character: target.characterName ?? '未知角色' });
    runtime.addLog(game, 'skill.prisonMarked', { player: player.displayName, target: target.displayName });
    return ok(game);
  },
}));

// shu_ju（约翰克莱默 - 竖锯）★ 竖锯轮机制
registerSkillHandler('shu_ju', (rt) => ({
  skillId: 'shu_ju',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('shuJu.invalidPhase', '竖锯只能在技能阶段使用');
    if (game.jigsawRoundActive) return err('shuJu.alreadyActive', '竖锯轮已经在进行中');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'shuJu', '竖锯需要选择一名玩家');
    if (!targetResult.ok) return targetResult;
    if (player.flags.shu_ju_used) return err('shuJu.used', 'MVP 中竖锯每局限一次');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    player.flags.shu_ju_used = true;
    runtime.revealCharacter(game, player);
    runtime.addInfo(game, target.playerId, 'false', player.playerId, 'shu_ju');
    runtime.addInfo(game, player.playerId, 'true', player.playerId, 'shu_ju');
    incrementCounter(player, 'shu_ju_false_added');
    runtime.addLog(game, 'character.shuJu', { player: player.displayName, target: target.displayName });
    // 进入竖锯轮
    const jigsawResult = runtime.enterJigsawRound(game, player.playerId);
    if (!jigsawResult.ok) return jigsawResult;
    return ok(jigsawResult.value);
  },
}));

// jigsawStart（竖锯轮自动流程 - 由 runtime 在 handleCommand 中调用）
registerSkillHandler('jigsaw_start', (rt) => ({
  skillId: 'jigsaw_start',
  canUse(_runtime, game, player, _input) {
    if (!game.jigsawRoundActive) return err('jigsawStart.notActive', '竖锯轮未激活');
    return ok(undefined);
  },
  resolve(runtime, game, player, _input) {
    // 竖锯轮中该玩家的回合：与当前回合相同但额外烧毁竖锯标记情报
    const markId = game.jigsawMark;
    if (markId) {
      const markPlayer = game.players[markId];
      if (markPlayer) {
        const burned = runtime.burnInfos(game, markId, 1, player.playerId, 'jigsaw');
        runtime.addLog(game, 'skill.jigsawBurned', { player: player.displayName, mark: markPlayer.displayName, count: burned });
      }
    }
    // 竖锯轮中禁止人物技能 + 禁止宣胜
    player.flags['jigsaw_disabled'] = true;
    return ok(game);
  },
}));

// qi_zha（秋山深一 - 欺诈）★ 交换传递中情报
registerSkillHandler('qi_zha', (rt) => ({
  skillId: 'qi_zha',
  canUse(runtime, game, player, input) {
    if (game.phase.phase === 'ReactionWindow') {
      if (!game.currentTransfer || game.currentTransfer.fromPlayerId === player.playerId) return err('qiZha.noTransfer', '欺诈只能看破他人的传递');
      return ok(undefined);
    }
    if (game.phase.phase !== 'SkillWindow') return err('qiZha.invalidPhase', '欺诈只能在响应窗口或技能阶段使用');
    return requireAliveOtherTarget(game, player, input.targetPlayerId, 'qiZha', '欺诈需要选择另一名玩家').ok ? ok(undefined) : requireAliveOtherTarget(game, player, input.targetPlayerId, 'qiZha', '欺诈需要选择另一名玩家') as DomainResult<void>;
  },
  resolve(runtime, game, player, input) {
    if (game.phase.phase === 'ReactionWindow' && game.currentTransfer) {
      // 欺诈看破：获知传递真假
      incrementCounter(player, 'qi_zha_seen');
      if (game.currentTransfer.declaredTruth === 'false') incrementCounter(player, 'qi_zha_false_seen');
      runtime.recordPendingAct(game, player.playerId);
      runtime.addPrivateLog(game, player.playerId, 'character.qiZhaPeek', { player: player.displayName, truth: game.currentTransfer.declaredTruth });
      return ok(runtime.maybeResolveReaction(game));
    }
    const target = game.players[input.targetPlayerId!]!;
    target.flags.character_skill_disabled_until_turn_serial = game.turn.turnSerial + 1;
    incrementCounter(player, 'qi_zha_used');
    runtime.addLog(game, 'character.qiZhaDisable', { player: player.displayName, target: target.displayName });
    return ok(game);
  },
}));

// fraudSwap（秋山深一 - 欺诈交换：响应窗口中交换传递中情报与自己的手牌）
registerSkillHandler('fraudSwap', (rt) => ({
  skillId: 'fraudSwap',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'ReactionWindow') return err('fraudSwap.invalidPhase', '欺诈交换只能在响应窗口使用');
    if (!game.currentTransfer || game.currentTransfer.fromPlayerId === player.playerId) return err('fraudSwap.notApplicable', '你已经是传递者');
    if (!input.transfer || !input.transfer.targetPlayerId) return err('fraudSwap.noTarget', '需要选择交换目标');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const transfer = game.currentTransfer!;
    // 交换传递中的情报与手牌中随机一张
    const myInfos = runtime.allInfoIds(game, player.playerId);
    if (myInfos.length === 0) return err('fraudSwap.noInfo', '你没有可交换的情报');
    const myInfo = myInfos[0]!;
    // 获取传递情报（MVP简化：创建一个新的传递情报表示交换）
    const fromPlayerId = transfer.fromPlayerId;
    const fromPlayer = game.players[fromPlayerId];
    runtime.moveInfo(game, myInfo, fromPlayerId, 'fraud_swap');
    runtime.appendEvent(game, { type: 'FraudSwapped', playerId: player.playerId, fromPlayerId, toPlayerId: fromPlayerId } as GameEvent);
    incrementCounter(player, 'qi_zha_used');
    runtime.recordPendingAct(game, player.playerId);
    runtime.addLog(game, 'skill.fraudSwapped', { player: player.displayName, target: fromPlayer?.displayName ?? fromPlayerId });
    return ok(runtime.maybeResolveReaction(game));
  },
}));

// kai_yan（弥海砂 - 开眼）
registerSkillHandler('kai_yan', (rt) => ({
  skillId: 'kai_yan',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('kaiYan.invalidPhase', '开眼只能在技能阶段使用');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'kaiYan', '开眼需要选择另一名玩家');
    if (!targetResult.ok) return targetResult;
    const key = `kai_yan_target_${input.targetPlayerId}`;
    if (player.flags[key]) return err('kaiYan.targetUsed', '开眼对每名玩家限一次');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    player.flags[`kai_yan_target_${input.targetPlayerId}`] = true;
    rememberSkillIdentity(player, target);
    runtime.addInfo(game, player.playerId, 'false', player.playerId, 'kai_yan');
    incrementCounter(player, 'kai_yan_used');
    runtime.addPrivateLog(game, player.playerId, 'character.kaiYan', { player: player.displayName, target: target.displayName, faction: target.faction, character: target.characterName ?? '未知角色' });
    runtime.addLog(game, 'character.kaiYanPublic', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// jiu_shu（神崎直 - 救赎）
registerSkillHandler('jiu_shu', (rt) => ({
  skillId: 'jiu_shu',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('jiuShu.invalidPhase', '救赎只能在技能阶段使用');
    if (!input.targetPlayerId) return err('jiuShu.targetRequired', '救赎需要选择一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState === 'dead') return err('jiuShu.targetNotFound', '目标不存在或已死亡');
    if (runtime.infoCount(game, target.playerId, 'false') < 1) return err('jiuShu.noFalse', '目标没有假情报可烧毁');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    const burned = runtime.burnInfos(game, target.playerId, 1, player.playerId, 'jiu_shu', 'false');
    incrementCounter(player, 'jiu_shu_burned', burned);
    incrementCounter(player, 'false_info_cleansed', burned);
    runtime.addLog(game, 'character.jiuShu', { player: player.displayName, target: target.displayName, count: burned });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// bao_mi（贝尔摩德 - 保密）
registerSkillHandler('bao_mi', (rt) => ({
  skillId: 'bao_mi',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('baoMi.invalidPhase', '保密只能在技能阶段使用');
    return requireAliveOtherTarget(game, player, input.targetPlayerId, 'baoMi', '保密需要选择另一名玩家').ok ? ok(undefined) : requireAliveOtherTarget(game, player, input.targetPlayerId, 'baoMi', '保密需要选择另一名玩家') as DomainResult<void>;
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    rememberSkillIdentity(player, target);
    player.characterRevealed = false;
    incrementCounter(player, 'bao_mi_used');
    runtime.addPrivateLog(game, player.playerId, 'character.baoMi', { player: player.displayName, target: target.displayName, faction: target.faction });
    runtime.addLog(game, 'character.baoMiPublic', { player: player.displayName, target: target.displayName });
    return ok(game);
  },
}));

// jiao_ji（川岛芳子 - 交际）
registerSkillHandler('jiao_ji', (rt) => ({
  skillId: 'jiao_ji',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('jiaoJi.invalidPhase', '交际只能在技能阶段使用');
    return requireAliveOtherTarget(game, player, input.targetPlayerId, 'jiaoJi', '交际需要选择另一名玩家').ok ? ok(undefined) : requireAliveOtherTarget(game, player, input.targetPlayerId, 'jiaoJi', '交际需要选择另一名玩家') as DomainResult<void>;
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    rememberSkillIdentity(player, target);
    incrementCounter(player, 'jiao_ji_used');
    runtime.addPrivateLog(game, player.playerId, 'character.jiaoJi', { player: player.displayName, target: target.displayName, faction: target.faction });
    runtime.addLog(game, 'character.jiaoJiPublic', { player: player.displayName, target: target.displayName });
    return ok(game);
  },
}));

// jue_qing（川岛芳子 - 绝情）
registerSkillHandler('jue_qing', (rt) => ({
  skillId: 'jue_qing',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('jueQing.invalidPhase', '绝情只能在技能阶段使用');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'jueQing', '绝情需要选择男性玩家');
    if (!targetResult.ok) return targetResult;
    if (targetResult.value.gender !== 'male') return err('jueQing.notMale', '绝情目标必须是男性角色');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    runtime.revealCharacter(game, player);
    runtime.addInfo(game, target.playerId, 'false', player.playerId, 'jue_qing');
    incrementCounter(player, 'jue_qing_used');
    runtime.addLog(game, 'character.jueQing', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// chang_wei（魏忠贤 - 厂卫）
registerSkillHandler('chang_wei', (rt) => ({
  skillId: 'chang_wei',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('changWei.invalidPhase', '厂卫只能在技能阶段使用');
    if (!input.targetPlayerId) return err('changWei.targetRequired', '厂卫需要选择一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState === 'dead') return err('changWei.targetNotFound', '目标不存在或已死亡');
    if (runtime.infoCount(game, target.playerId, 'false') < 1) return err('changWei.noFalse', '目标没有假情报可烧毁');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    const burned = runtime.burnInfos(game, target.playerId, 1, player.playerId, 'chang_wei', 'false');
    incrementCounter(player, 'chang_wei_burned', burned);
    runtime.addLog(game, 'character.changWei', { player: player.displayName, target: target.displayName, count: burned });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// die_zhan（史密斯夫妇 - 谍战）
registerSkillHandler('die_zhan', (rt) => ({
  skillId: 'die_zhan',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('dieZhan.invalidPhase', '谍战只能在技能阶段使用');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'dieZhan', '谍战需要选择另一名玩家');
    if (!targetResult.ok) return targetResult;
    if (player.infoIds.length < 1 || targetResult.value.infoIds.length < 1) return err('dieZhan.noInfo', '双方都至少需要一张情报');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    runtime.revealCharacter(game, player);
    const mine = player.infoIds[0]!;
    const theirs = target.infoIds[0]!;
    runtime.moveInfo(game, mine, target.playerId, 'die_zhan');
    runtime.moveInfo(game, theirs, player.playerId, 'die_zhan');
    incrementCounter(player, 'die_zhan_moved', 2);
    runtime.addLog(game, 'character.dieZhan', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// fu_fu（史密斯夫妇 - 夫妇）
registerSkillHandler('fu_fu', (rt) => ({
  skillId: 'fu_fu',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('fuFu.invalidPhase', '夫妇只能在技能阶段使用');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'fuFu', '夫妇需要选择另一名玩家');
    if (!targetResult.ok) return targetResult;
    if (targetResult.value.infoIds.length < 1) return err('fuFu.noInfo', '目标没有情报可烧毁');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    runtime.revealCharacter(game, player);
    const burned = runtime.burnInfos(game, target.playerId, 2, player.playerId, 'fu_fu');
    incrementCounter(player, 'fu_fu_burned', burned);
    runtime.addLog(game, 'character.fuFu', { player: player.displayName, target: target.displayName, count: burned });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// beng_huai（我妻由乃 - 崩坏）
registerSkillHandler('beng_huai', (rt) => ({
  skillId: 'beng_huai',
  canUse(_runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('bengHuai.invalidPhase', '崩坏只能在技能阶段使用');
    if (player.flags.beng_huai_lost) return err('bengHuai.lost', '崩坏已放弃');
    if (!player.flags.beng_huai_available) return err('bengHuai.notAvailable', '尚未获得可触发的假情报');
    if (!input.targetPlayerId || input.targetPlayerId === player.playerId) return err('bengHuai.targetRequired', '崩坏需要选择另一名玩家');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState !== 'alive') return err('bengHuai.targetNotFound', '目标不存在或未存活');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    player.flags.beng_huai_available = false;
    runtime.addInfo(game, input.targetPlayerId!, 'false', player.playerId, 'beng_huai');
    runtime.addLog(game, 'character.bengHuai', { player: player.displayName, target: target.displayName });
    return ok(runtime.afterInfoChanged(game));
  },
}));

// ───────────────── 第二批角色原规则还原新增处理器 ─────────────────

// kaiYanActiveView（弥海砂 - 开眼主动查看隐藏角色）
registerSkillHandler('kaiYanActiveView', (rt) => ({
  skillId: 'kaiYanActiveView',
  canUse(runtime, game, player, input) {
    if (game.phase.phase !== 'SkillWindow') return err('kaiYanActive.invalidPhase', '开眼只能在技能阶段使用');
    const targetResult = requireAliveOtherTarget(game, player, input.targetPlayerId, 'kaiYanActive', '开眼需要选择另一名玩家');
    return targetResult.ok ? ok(undefined) : targetResult;
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    rememberSkillIdentity(player, target);
    incrementCounter(player, 'kai_yan_used');
    runtime.addPrivateLog(game, player.playerId, 'skill.kaiYanView', {
      player: player.displayName,
      target: target.displayName,
      faction: target.faction,
      character: target.characterName ?? '未知角色',
      hidden: target.characterVisibility === 'hidden' ? '是' : '否',
    });
    runtime.addLog(game, 'skill.kaiYanViewPublic', { player: player.displayName, target: target.displayName });
    return ok(game);
  },
}));

// switchGender（魏忠贤 - 宦党性别切换）
registerSkillHandler('switchGender', (rt) => ({
  skillId: 'switchGender',
  canUse(_runtime, game, player, _input) {
    if (game.phase.phase !== 'SkillWindow') return err('switchGender.invalidPhase', '宦党只能在技能阶段切换性别');
    if (player.flags['gender_switched_this_turn'] === game.turn.turnSerial) return err('switchGender.used', '本回合已切换过性别');
    return ok(undefined);
  },
  resolve(runtime, game, player, _input) {
    const newGender = player.gender === 'male' ? 'female' : 'male';
    runtime.switchGender(player, newGender as 'male' | 'female');
    player.flags['gender_switched_this_turn'] = game.turn.turnSerial;
    runtime.addLog(game, 'skill.genderSwitched', { player: player.displayName, gender: newGender === 'male' ? '男' : '女' });
    return ok(game);
  },
}));

// confidentialBlock（贝尔摩德 - 保密：锁定无效化）
registerSkillHandler('confidentialBlock', (rt) => ({
  skillId: 'confidentialBlock',
  canUse(_runtime, game, player, input) {
    if (game.phase.phase !== 'ReactionWindow') return err('confBlock.invalidPhase', '保密只能在响应窗口使用');
    if (!game.currentTransfer) return err('confBlock.noTransfer', '没有当前传递');
    // 只有当贝尔摩德本人被锁定时才有效
    if (!game.currentTransfer.lockedByPlayerIds.length) return err('confBlock.notLocked', '本次传递未被锁定');
    return ok(undefined);
  },
  resolve(runtime, game, player, _input) {
    const transfer = game.currentTransfer!;
    transfer.lockedByPlayerIds = [];
    transfer.forcedReceive = false;
    runtime.recordPendingAct(game, player.playerId);
    runtime.addLog(game, 'skill.confidentialBlocked', { player: player.displayName });
    return ok(runtime.maybeResolveReaction(game));
  },
}));

// smithRedirect（史密斯夫妇 - 谍战改接收方）
registerSkillHandler('smithRedirect', (rt) => ({
  skillId: 'smithRedirect',
  canUse(_runtime, game, player, input) {
    if (game.phase.phase !== 'ReactionWindow') return err('smithRedirect.invalidPhase', '谍战改接收方只能在响应窗口使用');
    if (!game.currentTransfer) return err('smithRedirect.noTransfer', '没有当前传递');
    if (!input.targetPlayerId) return err('smithRedirect.noTarget', '需要选择新的接收方');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState !== 'alive') return err('smithRedirect.targetNotFound', '目标不存在或未存活');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const transfer = game.currentTransfer!;
    const oldTarget = game.players[transfer.targetPlayerId];
    transfer.targetPlayerId = input.targetPlayerId!;
    runtime.recordPendingAct(game, player.playerId);
    incrementCounter(player, 'die_zhan_moved');
    runtime.addLog(game, 'skill.smithRedirected', {
      player: player.displayName,
      from: oldTarget?.displayName ?? transfer.targetPlayerId,
      to: game.players[input.targetPlayerId!]?.displayName ?? input.targetPlayerId!,
    });
    return ok(runtime.maybeResolveReaction(game));
  },
}));

// jiaoJiExtend（川岛芳子 - 交际扩展目标）
registerSkillHandler('jiaoJiExtend', (rt) => ({
  skillId: 'jiaoJiExtend',
  canUse(_runtime, game, player, input) {
    if (game.phase.phase !== 'ReactionWindow') return err('jiaoJiExtend.invalidPhase', '交际扩展只能在响应窗口使用');
    if (!input.targetPlayerId) return err('jiaoJiExtend.noTarget', '需要选择扩展目标');
    const target = game.players[input.targetPlayerId];
    if (!target || target.aliveState === 'dead') return err('jiaoJiExtend.targetNotFound', '目标不存在或已死亡');
    return ok(undefined);
  },
  resolve(runtime, game, player, input) {
    const target = game.players[input.targetPlayerId!]!;
    rememberSkillIdentity(player, target);
    incrementCounter(player, 'jiao_ji_used');
    runtime.recordPendingAct(game, player.playerId);
    runtime.addPrivateLog(game, player.playerId, 'skill.jiaoJiExtended', { player: player.displayName, target: target.displayName, faction: target.faction });
    runtime.addLog(game, 'skill.jiaoJiExtendedPublic', { player: player.displayName, target: target.displayName });
    return ok(runtime.maybeResolveReaction(game));
  },
}));
