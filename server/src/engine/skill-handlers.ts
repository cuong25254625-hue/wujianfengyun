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
}

type HandlerFactory = (runtime: SkillRuntimeAccess) => SkillHandler;

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
