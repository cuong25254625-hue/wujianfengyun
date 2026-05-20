import {
  createDefaultGameConfig,
  type CurrentTransfer,
  type DomainResult,
  type EventEnvelope,
  type Faction,
  type GameEvent,
  type GamePhase,
  type GameRoom,
  type GameState,
  type InfoCard,
  type InfoId,
  type PendingAction,
  type PendingActionId,
  type PhaseContext,
  type Player,
  type PlayerCommand,
  type PlayerId,
  type PublicLogEntry,
  type RoomId,
  type RoomSeat,
  type UserId,
  err,
  isSupportedPlayerCount,
  ok,
} from '@wujian/shared';
import { assignMvpCharacters } from '../engine/character-registry.js';
import { assignIdentities } from '../engine/identity-engine.js';
import { createEventId, createInfoId, createPendingActionId, createPlayerId } from '../util/id.js';
import { checkMission, markDeathDelayMissions, checkDeathDelayVictories } from '../engine/mission-engine.js';

export interface JoinRoomInput {
  userId: UserId;
  displayName: string;
}

export class GameRoomRuntime {
  readonly room: GameRoom;

  constructor(roomId: RoomId, ownerUserId: UserId, ownerName: string) {
    const now = Date.now();
    this.room = {
      roomId,
      ownerUserId,
      status: 'lobby',
      seats: [this.createSeat(0, ownerUserId, ownerName, ownerUserId)],
      createdAt: now,
      updatedAt: now,
    };
  }

  join(input: JoinRoomInput): DomainResult<RoomSeat> {
    const existing = this.room.seats.find((seat) => seat.userId === input.userId);
    if (existing) {
      this.updateDisplayName(input.userId, input.displayName);
      return ok(existing);
    }

    if (this.room.status !== 'lobby') {
      return err('room.alreadyStarted', '游戏已经开始，暂不能加入');
    }

    if (this.room.seats.length >= 8) {
      return err('room.full', '房间已满，MVP 最多支持 8 人');
    }

    const seat = this.createSeat(this.nextSeatIndex(), input.userId, input.displayName);
    this.room.seats.push(seat);
    this.touch();
    return ok(seat);
  }

  setReady(userId: UserId, ready: boolean): DomainResult<void> {
    const seat = this.room.seats.find((item) => item.userId === userId);
    if (!seat) return err('room.notJoined', '你还未加入房间');
    seat.ready = ready;
    this.touch();
    return ok(undefined);
  }

  selectCharacter(userId: UserId, characterId: string): DomainResult<void> {
    if (this.room.status !== 'lobby') return err('room.alreadyStarted', '游戏已经开始，不能再更换角色');
    const seat = this.room.seats.find((item) => item.userId === userId);
    if (!seat) return err('room.notJoined', '你还未加入房间');
    const duplicate = this.room.seats.find((item) => item.userId !== userId && item.characterPreferenceId === characterId);
    if (duplicate) return err('character.taken', '该角色已被其他玩家预选');
    const character = assignMvpCharacters(8).find((item) => item.characterId === characterId);
    if (!character) return err('character.notFound', '角色不存在');
    seat.characterPreferenceId = character.characterId;
    seat.ready = false;
    this.touch();
    return ok(undefined);
  }

  updateDisplayName(userId: UserId, displayName: string): DomainResult<void> {
    const trimmed = displayName.trim();
    if (!trimmed) return err('room.invalidName', '昵称不能为空');

    const seat = this.room.seats.find((item) => item.userId === userId);
    if (!seat) return err('room.notJoined', '你还未加入房间');

    seat.displayName = trimmed;
    if (this.room.game) {
      const player = Object.values(this.room.game.players).find((item) => item.userId === userId);
      if (player) player.displayName = trimmed;
    }
    this.touch();
    return ok(undefined);
  }

  setConnected(userId: UserId, connected: boolean): void {
    const seat = this.room.seats.find((item) => item.userId === userId);
    if (!seat) return;
    seat.connected = connected;
    this.touch();
  }

  startGame(userId: UserId): DomainResult<GameState> {
    if (userId !== this.room.ownerUserId) {
      return err('room.notOwner', '只有房主可以开始游戏');
    }

    if (this.room.status !== 'lobby') {
      return err('room.alreadyStarted', '游戏已经开始');
    }

    if (!isSupportedPlayerCount(this.room.seats.length)) {
      return err('room.unsupportedPlayerCount', 'MVP 支持 4-8 人开局');
    }

    const unready = this.room.seats.filter((seat) => seat.userId !== this.room.ownerUserId && !seat.ready);
    if (unready.length > 0) {
      return err('room.playersNotReady', '还有玩家未准备');
    }

    const game = this.createInitialGameState();
    this.room.game = game;
    this.room.status = 'playing';
    this.touch();
    return ok(game);
  }

  handlePlayerCommand(userId: UserId, command: PlayerCommand): DomainResult<GameState> {
    const game = this.room.game;
    if (!game || this.room.status !== 'playing') return err('game.notRunning', '游戏尚未进行中');

    const player = this.playerByUser(userId);
    if (!player) return err('game.playerNotFound', '你不在本局游戏中');
    if (command.playerId !== player.playerId) return err('game.playerMismatch', '只能提交自己的玩家操作');
    if (game.status === 'finished') return err('game.finished', '游戏已经结束');

    const result = this.applyPlayerCommand(game, command);
    if (!result.ok) return result;
    this.room.game = result.value;
    this.touch();
    return ok(result.value);
  }

  private applyPlayerCommand(game: GameState, command: PlayerCommand): DomainResult<GameState> {
    switch (command.type) {
      case 'PassPendingAction':
        return this.handlePass(game, command.playerId, command.pendingActionId as PendingActionId);
      case 'DeclareVictory':
        return this.handleDeclareVictory(game, command.playerId, command.faction, command.reason);
      case 'UseProbe':
        return this.handleProbe(game, command.playerId, command.targetPlayerId, command.declaredFaction);
      case 'DeclareTransfer':
        return this.handleDeclareTransfer(game, command.playerId, command.targetPlayerId, command.truth);
      case 'UseLock':
        return this.handleLock(game, command.playerId, command.transferId, command.targetPlayerId);
      case 'UseIntercept':
        return this.handleIntercept(game, command.playerId, command.transferId, command.targetPlayerId);
      case 'UseCharacterSkill':
        return this.handleCharacterSkill(game, command.playerId, command.skillId, command.targetPlayerId, command.secondaryTargetPlayerId, command.transfer);
      case 'ReceiveInfo':
        return this.handleReceiveInfo(game, command.playerId, command.transferId, command.decision);
    }
  }

  private handlePass(game: GameState, playerId: PlayerId, pendingActionId: PendingActionId): DomainResult<GameState> {
    const action = game.pendingActions[pendingActionId];
    if (!action || action.status !== 'open') return err('pending.notFound', '待响应操作不存在或已关闭');
    if (!action.eligiblePlayerIds.includes(playerId)) return err('pending.notEligible', '你不能响应此窗口');
    if (action.responses.some((response) => response.playerId === playerId)) return err('pending.alreadyResponded', '你已经响应过');

    action.responses.push({ playerId, responseType: 'pass', submittedAt: Date.now() });
    this.addLog(game, 'action.passed', { player: this.playerName(game, playerId), window: action.kind });

    if (action.kind === 'victoryDeclareWindow') {
      const activePlayerId = this.activePlayer(game).playerId;
      // 宣胜窗口面向所有存活玩家开放：非当前回合玩家可宣胜或跳过，
      // 但只有当前回合玩家跳过时才推进到技能阶段，避免旁观式“跳过”抢推进权。
      if (playerId !== activePlayerId) return ok(game);
      action.status = 'resolved';
      this.closeOpenActionsForCurrentPhase(game);
      const nextState = this.enterPhase(game, 'SkillWindow', { type: 'activeTurn', activePlayerId });
      this.openPendingAction(nextState, 'regularSkillWindow', [activePlayerId], { type: 'generic', data: { window: 'skill' } });
      return ok(nextState);
    }
    if (action.kind === 'regularSkillWindow') {
      if (game.phase.phase === 'SkillWindow') {
        action.status = 'resolved';
        return ok(this.enterPhase(game, 'TransferDeclare', { type: 'activeTurn', activePlayerId: this.activePlayer(game).playerId }));
      }
      if (this.allRequiredResponded(action)) {
        action.status = 'resolved';
        if (game.phase.phase === 'ReactionWindow') return ok(this.resolveReactionWindow(game));
      }
      return ok(game);
    }
    if (action.kind === 'receiveDecision') return err('pending.receiveRequired', '接收/拒收窗口必须选择操作');
    if (action.kind === 'dyingSkillWindow') return ok(this.resolveDyingDeath(game, action.context.type === 'dying' ? action.context.playerId : playerId));

    if (this.allRequiredResponded(action)) {
      action.status = 'resolved';
    }
    return ok(game);
  }

  private handleDeclareVictory(
    game: GameState,
    playerId: PlayerId,
    faction: Faction,
    reason: 'threeTrueInfo' | 'clearField' | 'secretMission',
  ): DomainResult<GameState> {
    if (game.phase.phase !== 'VictoryDeclareWindow') return err('victory.invalidPhase', '只能在宣胜窗口宣胜');
    const player = game.players[playerId];
    if (!player || player.aliveState !== 'alive') return err('victory.notAlive', '只有存活玩家可以宣胜');
    if (player.faction !== faction) return err('victory.wrongFaction', '只能宣告自己阵营的胜利');
    if (Object.values(game.players).some((item) => item.aliveState === 'dying')) return err('victory.deathFirst', '存在濒死玩家，必须先结算死亡');

    // 白方宣胜：检查机密任务
    if (faction === 'white') {
      if (reason !== 'secretMission') return err('victory.whiteNeedsMission', '白方只能通过完成机密任务宣胜');
      const mission = checkMission(game, playerId);
      if (!mission.met) return err('victory.missionNotMet', mission.reason);
      player.missionStatus = 'declared';
      this.addPrivateLog(game, playerId, 'mission.completed', { player: player.displayName, reason: mission.reason });
      game.winState = { finished: true, winner: { faction: 'white', declaredByPlayerId: playerId, reason: 'secretMission', missionPlayerId: playerId } };
      game.status = 'finished';
      this.room.status = 'finished';
      this.appendEvent(game, { type: 'VictoryDeclared', playerId, faction: 'white', reason: 'secretMission' });
      this.appendEvent(game, { type: 'GameFinished', faction: 'white' });
      this.addLog(game, 'victory.declared', { player: player.displayName, faction: 'white', reason: 'secretMission' });
      return ok(this.enterPhase(game, 'GameOver', { type: 'victory', candidates: [playerId] }));
    }

    // 红蓝方宣胜
    if (reason === 'threeTrueInfo' && this.infoCount(game, playerId, 'true') < 3) {
      return err('victory.noThreeTrue', '未满足三张真情报宣胜条件');
    }
    if (reason === 'clearField') {
      const aliveFactions = new Set(Object.values(game.players).filter((item) => item.aliveState === 'alive').map((item) => item.faction));
      if (aliveFactions.size !== 1 || !aliveFactions.has(faction)) return err('victory.noClearField', '未满足清场宣胜条件');
    }

    game.winState = { finished: true, winner: { faction, declaredByPlayerId: playerId, reason } };
    game.status = 'finished';
    this.room.status = 'finished';
    this.appendEvent(game, { type: 'VictoryDeclared', playerId, faction, reason });
    this.appendEvent(game, { type: 'GameFinished', faction });
    this.addLog(game, 'victory.declared', { player: player.displayName, faction, reason });
    return ok(this.enterPhase(game, 'GameOver', { type: 'victory', candidates: [playerId] }));
  }

  private handleProbe(game: GameState, playerId: PlayerId, targetPlayerId: PlayerId, declaredFaction: Faction): DomainResult<GameState> {
    if (game.phase.phase !== 'SkillWindow') return err('probe.invalidPhase', '只能在技能阶段试探');
    const player = game.players[playerId];
    const target = game.players[targetPlayerId];
    if (!player || !target) return err('probe.playerNotFound', '玩家不存在');
    if (player.aliveState !== 'alive' || target.aliveState !== 'alive') return err('probe.notAlive', '只能由存活玩家试探存活玩家');
    if (player.regularSkills.probeRemaining <= 0) return err('probe.noCount', '试探次数不足');

    player.regularSkills.probeRemaining -= 1;
    const effectiveFaction = this.hasSkill(target, 'cheng_fu') ? player.faction : target.faction;
    const success = effectiveFaction === declaredFaction;
    if (this.hasSkill(target, 'jiu_ji') || target.characterId === 'char_002_liu_jian_ming') {
      this.rememberIdentity(target, playerId, player.faction, 'skill');
      this.addPrivateLog(game, target.playerId, 'character.jiuJiKnown', { player: target.displayName, source: player.displayName });
    }
    if (success) {
      player.knownIdentities.push({ targetPlayerId, faction: effectiveFaction, source: 'probe' });
      if (player.faction === effectiveFaction && player.faction !== 'white' && !player.regularSkills.mutualKnownPlayerId) {
        player.regularSkills.mutualKnownPlayerId = targetPlayerId;
        target.regularSkills.mutualKnownPlayerId = playerId;
      }
    } else if (this.hasSkill(player, 'tan_jiu') && target.characterVisibility === 'hidden' && target.characterId) {
      player.knownIdentities.push({ targetPlayerId, characterId: target.characterId, source: 'skill' });
      this.addPrivateLog(game, player.playerId, 'character.tanJiu', { player: player.displayName, target: target.displayName });
    }
    this.appendEvent(game, { type: 'ProbeUsed', sourcePlayerId: playerId, targetPlayerId, declaredFaction });
    this.addLog(game, success ? 'probe.success' : 'probe.failed', {
      player: player.displayName,
      target: target.displayName,
      declaredFaction,
    });
    return ok(game);
  }

  private handleDeclareTransfer(game: GameState, playerId: PlayerId, targetPlayerId: PlayerId, truth: 'true' | 'false'): DomainResult<GameState> {
    if (game.phase.phase !== 'TransferDeclare') return err('transfer.invalidPhase', '只能在传递阶段声明传递');
    const player = game.players[playerId];
    const target = game.players[targetPlayerId];
    if (!player || !target) return err('transfer.playerNotFound', '玩家不存在');
    if (this.activePlayer(game).playerId !== playerId) return err('transfer.notActive', '只有当前回合玩家可以传递');
    if (playerId === targetPlayerId) return err('transfer.selfTarget', '不能传递给自己');
    if (player.aliveState !== 'alive' || target.aliveState !== 'alive') return err('transfer.notAlive', '传递双方必须存活');

    const transferId = `transfer_${crypto.randomUUID()}`;
    game.currentTransfer = {
      transferId,
      fromPlayerId: playerId,
      targetPlayerId,
      declaredTruth: truth,
      lockedByPlayerIds: [],
      forcedReceive: this.hasSkill(player, 'zhao_zhang') && target.gender === 'female',
      settled: false,
    };
    this.appendEvent(game, { type: 'TransferDeclared', transferId, fromPlayerId: playerId, targetPlayerId, declaredTruth: truth });
    this.addLog(game, 'transfer.declared', { from: player.displayName, target: target.displayName, truth });
    if (game.currentTransfer.forcedReceive) this.addLog(game, 'character.zhaoZhang', { player: player.displayName, target: target.displayName });

    const eligible = Object.values(game.players)
      .filter((item) => item.aliveState === 'alive' && item.playerId !== playerId && item.playerId !== targetPlayerId)
      .map((item) => item.playerId);
    eligible.push(playerId);
    this.openPendingAction(game, 'regularSkillWindow', eligible, { type: 'transfer', transferId });
    return ok(this.enterPhase(game, 'ReactionWindow', { type: 'transfer', transferId }));
  }

  private handleLock(game: GameState, playerId: PlayerId, transferId: string, targetPlayerId: PlayerId): DomainResult<GameState> {
    const transfer = this.requireTransfer(game, transferId);
    if (!transfer.ok) return transfer;
    if (game.phase.phase !== 'ReactionWindow') return err('lock.invalidPhase', '只能在响应窗口锁定');
    if (transfer.value.fromPlayerId !== playerId) return err('lock.onlySender', 'MVP 中只有传递者可以锁定接收者');
    if (transfer.value.targetPlayerId !== targetPlayerId) return err('lock.targetMismatch', '只能锁定本次传递的原接收者');
    const player = game.players[playerId];
    const target = game.players[targetPlayerId];
    if (!player || player.regularSkills.lockRemaining <= 0) return err('lock.noCount', '锁定次数不足');
    if (target && (this.hasSkill(target, 'bing_shan') || (this.hasSkill(player, 'zhao_zhang') && this.knowsIdentity(player, targetPlayerId)))) {
      player.regularSkills.lockRemaining -= 1;
      this.appendEvent(game, { type: 'LockUsed', sourcePlayerId: playerId, transferId, targetPlayerId });
      this.recordPendingAct(game, playerId);
      this.addLog(game, 'character.lockInvalidated', { player: player.displayName, target: target.displayName });
      return ok(this.maybeResolveReaction(game));
    }
    if (target && this.hasSkill(target, 'jiu_ji')) {
      this.rememberIdentity(target, playerId, player.faction, 'skill');
      this.addPrivateLog(game, target.playerId, 'character.jiuJiKnown', { player: target.displayName, source: player.displayName });
    }
    if (transfer.value.lockedByPlayerIds.length > 0) return err('lock.alreadyUsed', '本次传递已经有锁定');

    player.regularSkills.lockRemaining -= 1;
    transfer.value.lockedByPlayerIds.push(playerId);
    transfer.value.forcedReceive = true;
    this.appendEvent(game, { type: 'LockUsed', sourcePlayerId: playerId, transferId, targetPlayerId });
    this.recordPendingAct(game, playerId);
    this.addLog(game, 'lock.used', { player: player.displayName, target: this.playerName(game, targetPlayerId) });
    return ok(this.maybeResolveReaction(game));
  }

  private handleIntercept(game: GameState, playerId: PlayerId, transferId: string, targetPlayerId: PlayerId): DomainResult<GameState> {
    const transfer = this.requireTransfer(game, transferId);
    if (!transfer.ok) return transfer;
    if (game.phase.phase !== 'ReactionWindow') return err('intercept.invalidPhase', '只能在响应窗口截获');
    if (targetPlayerId !== transfer.value.fromPlayerId) return err('intercept.targetSender', '截获对象必须是传递者');
    if (playerId === transfer.value.fromPlayerId || playerId === transfer.value.targetPlayerId) {
      return err('intercept.notEligible', '传递者和原接收者不能截获');
    }
    const player = game.players[playerId];
    if (!player || player.regularSkills.interceptRemaining <= 0) return err('intercept.noCount', '截获次数不足');
    if (transfer.value.interceptedByPlayerId) return err('intercept.alreadyUsed', '本次传递已经被截获');

    player.regularSkills.interceptRemaining -= 1;
    transfer.value.interceptedByPlayerId = playerId;
    transfer.value.finalReceiverPlayerId = playerId;
    transfer.value.forcedReceive = false;
    this.appendEvent(game, { type: 'InterceptUsed', sourcePlayerId: playerId, transferId, targetPlayerId, success: true });
    this.applyAyanamiClone(game, playerId);
    this.recordPendingAct(game, playerId);
    this.addLog(game, 'intercept.used', { player: player.displayName, from: this.playerName(game, targetPlayerId) });
    return ok(this.maybeResolveReaction(game));
  }

  private handleReceiveInfo(game: GameState, playerId: PlayerId, transferId: string, decision: 'receive' | 'reject'): DomainResult<GameState> {
    const transfer = this.requireTransfer(game, transferId);
    if (!transfer.ok) return transfer;
    if (game.phase.phase !== 'ReceiveDecision') return err('receive.invalidPhase', '当前不是接收/拒收阶段');
    const receiver = transfer.value.finalReceiverPlayerId ?? transfer.value.targetPlayerId;
    if (receiver !== playerId) return err('receive.notReceiver', '只有最终接收者可以选择接收/拒收');
    if (transfer.value.forcedReceive && decision === 'reject') return err('receive.forced', '该情报已被锁定，不能拒收');

    transfer.value.receiveDecision = decision;
    this.appendEvent(game, { type: 'ReceiveDecisionMade', transferId, playerId, decision });
    this.addLog(game, 'receive.decision', { player: this.playerName(game, playerId), decision });
    return ok(this.settleTransfer(game));
  }

  private handleCharacterSkill(
    game: GameState,
    playerId: PlayerId,
    skillId: string,
    targetPlayerId?: PlayerId,
    secondaryTargetPlayerId?: PlayerId,
    transferInput?: { targetPlayerId: PlayerId; truth: 'true' | 'false' },
  ): DomainResult<GameState> {
    const player = game.players[playerId];
    if (!player || player.aliveState === 'dead') return err('character.notAvailable', '死亡玩家不能发动人物技能');
    if (!this.hasSkill(player, skillId)) return err('character.wrongSkill', '当前角色没有此技能或技能已失效');
    if (this.isCharacterSkillDisabled(game, player)) return err('character.disabled', '你本回合人物技能被禁止');

    switch (skillId) {
      case 'mie_ji':
        return this.useMieJi(game, player, targetPlayerId);
      case 'jie_lu':
        return this.useJieLu(game, player);
      case 'yi_yi':
        return this.useYiYi(game, player, targetPlayerId);
      case 'ni_zhuan':
        return this.useNiZhuan(game, player, targetPlayerId);
      case 'guan_fan':
        return this.useGuanFan(game, player, targetPlayerId);
      case 'du_bo':
        return this.useDuBo(game, player, targetPlayerId);
      case 'bian_hu':
        return this.useBianHu(game, player, targetPlayerId);
      case 'ling_mei':
        return this.useLingMei(game, player, targetPlayerId, secondaryTargetPlayerId, transferInput?.truth ?? 'true');
      case 'qi_yue':
        return this.useQiYue(game, player, targetPlayerId, secondaryTargetPlayerId, transferInput?.truth ?? 'true');
      case 'shou_hu':
        return this.useShouHu(game, player);
      case 'xin_sheng':
        return this.useXinSheng(game, player);
      case 'jiu_ji':
        return this.useJiuJi(game, player);
      case 'beng_huai':
        return this.useBengHuai(game, player, targetPlayerId);
      default:
        return err('character.notImplemented', '该人物技能暂未接入主动发动');
    }
  }

  private maybeResolveReaction(game: GameState): GameState {
    const action = this.openActionByKind(game, 'regularSkillWindow');
    if (!action) return game;
    if (this.allRequiredResponded(action)) {
      action.status = 'resolved';
      return this.resolveReactionWindow(game);
    }
    return game;
  }

  private resolveReactionWindow(game: GameState): GameState {
    const transfer = game.currentTransfer;
    if (!transfer) return game;
    transfer.finalReceiverPlayerId = transfer.interceptedByPlayerId ?? transfer.targetPlayerId;
    const finalReceiver = game.players[transfer.finalReceiverPlayerId];
    this.addLog(game, 'reaction.resolved', { receiver: finalReceiver?.displayName ?? transfer.finalReceiverPlayerId });
    return this.enterPhase(game, 'ReceiveDecision', { type: 'transfer', transferId: transfer.transferId });
  }

  private settleTransfer(game: GameState): GameState {
    const transfer = game.currentTransfer;
    if (!transfer || !transfer.receiveDecision) return game;
    const ownerPlayerId = transfer.receiveDecision === 'receive' ? transfer.finalReceiverPlayerId ?? transfer.targetPlayerId : transfer.fromPlayerId;
    const infoId = createInfoId();
    const info: InfoCard = {
      infoId,
      truth: transfer.declaredTruth,
      sourcePlayerId: transfer.fromPlayerId,
      ownerPlayerId,
      public: true,
      createdBy: 'transfer',
      tags: [],
    };
    game.infoCards[infoId] = info;
    game.players[ownerPlayerId]?.infoIds.push(infoId);
    transfer.infoId = infoId;
    transfer.settled = true;
    this.afterInfoGained(game, ownerPlayerId, transfer.declaredTruth, transfer.fromPlayerId, infoId);
    this.appendEvent(game, { type: 'TransferSettled', transferId: transfer.transferId, finalReceiverPlayerId: ownerPlayerId, infoId, decision: transfer.receiveDecision });
    this.addLog(game, 'transfer.settled', { owner: this.playerName(game, ownerPlayerId), truth: transfer.declaredTruth });
    const pendingDouble = game.players[transfer.fromPlayerId]?.flags.cc_pending_second_transfer;
    delete game.currentTransfer;
    const dying = this.firstDyingCandidate(game);
    if (dying) return this.startDying(game, dying, 'falseInfoLimit');
    if (typeof pendingDouble === 'string') return this.startQueuedTransfer(game, transfer.fromPlayerId, pendingDouble as PlayerId, transfer.declaredTruth);
    return this.advanceTurn(game);
  }

  private startDying(game: GameState, playerId: PlayerId, cause: string): GameState {
    const player = game.players[playerId];
    if (!player) return game;
    player.aliveState = 'dying';
    this.appendEvent(game, { type: 'DyingStarted', playerId, cause });
    this.addLog(game, 'dying.started', { player: player.displayName, cause });
    this.openPendingAction(game, 'dyingSkillWindow', [playerId], { type: 'dying', playerId });
    return this.enterPhase(game, 'DyingWindow', { type: 'dying', playerId, cause });
  }

  private resolveDyingDeath(game: GameState, playerId: PlayerId): GameState {
    const player = game.players[playerId];
    if (!player || player.aliveState !== 'dying') return game;
    player.aliveState = 'dead';
    player.identityRevealed = true;
    this.appendEvent(game, { type: 'PlayerDied', playerId, cause: 'falseInfoLimit' });
    this.appendEvent(game, { type: 'IdentityRevealedByDeath', playerId, faction: player.faction });
    const killerId = player.flags.last_false_info_source;
    if (typeof killerId === 'string') {
      const killer = game.players[killerId as PlayerId];
      if (killer) {
        killer.regularSkills.probeRemaining += 1;
        if (this.hasSkill(killer, 'guan_fan')) killer.flags.guan_fan_available = true;
        this.appendEvent(game, { type: 'KillRewardGranted', playerId: killer.playerId, reward: 'probe', amount: 1 });
        // 任务计数器：假情报致死
        killer.missionCounters['caused_death'] = ((killer.missionCounters['caused_death'] as number) ?? 0) + 1;
        // 任务计数器：亲手杀死女性角色（杰克）
        if (player.gender === 'female') {
          killer.missionCounters['killed_female'] = ((killer.missionCounters['killed_female'] as number) ?? 0) + 1;
        }
        // 任务计数器：克隆导致的死亡（绫波丽）
        if (killer.flags['ke_long_used']) {
          killer.missionCounters['clone_caused_death'] = ((killer.missionCounters['clone_caused_death'] as number) ?? 0) + 1;
        }
        // 任务计数器：被指定目标杀死（C.C）
        const ccTarget = killer.flags['cc_mission_target'];
        if (typeof ccTarget === 'string' && ccTarget === playerId) {
          const ccDead = game.players[playerId];
          if (ccDead) {
            ccDead.missionCounters['killed_by_target'] = ((ccDead.missionCounters['killed_by_target'] as number) ?? 0) + 1;
          }
        }
      }
    }
    this.addLog(game, 'player.died', { player: player.displayName, faction: player.faction });
    // 检查死亡延迟任务（秋濑或、绫里千寻等的※标记任务）
    markDeathDelayMissions(game, playerId);
    const nextDying = this.firstDyingCandidate(game);
    if (nextDying) return this.startDying(game, nextDying, 'falseInfoLimit');
    return this.advanceTurn(game);
  }

  private useMieJi(game: GameState, player: Player, targetPlayerId?: PlayerId): DomainResult<GameState> {
    if (!targetPlayerId || targetPlayerId === player.playerId) return err('mieJi.targetRequired', '灭迹需要选择另一名玩家');
    if (!['SkillWindow', 'ReactionWindow', 'DyingWindow'].includes(game.phase.phase)) return err('mieJi.invalidPhase', '灭迹只能在传递、技能、濒死阶段使用');
    if (player.flags.mie_ji_used) return err('mieJi.used', 'MVP 中灭迹每局限一次');
    const target = game.players[targetPlayerId];
    if (!target) return err('mieJi.targetNotFound', '目标不存在');
    this.revealCharacter(game, player);
    player.flags.mie_ji_used = true;
    const burned = this.burnInfos(game, targetPlayerId, 3, player.playerId, 'mie_ji');
    this.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'mie_ji', targetPlayerId });
    this.addLog(game, 'character.mieJi', { player: player.displayName, target: target.displayName, count: burned });
    return ok(this.afterInfoChanged(game));
  }

  private useJieLu(game: GameState, player: Player): DomainResult<GameState> {
    const transfer = game.currentTransfer;
    if (!transfer || transfer.fromPlayerId === player.playerId || game.phase.phase !== 'ReactionWindow') return err('jieLu.invalidPhase', '揭露只能在他人的传递响应窗口使用');
    if (player.flags.jie_lu_lost) return err('jieLu.lost', '揭露已经失去');
    this.revealCharacter(game, player);
    this.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'jie_lu' });
    this.recordPendingAct(game, player.playerId);
    player.missionCounters['jie_lu_used'] = ((player.missionCounters['jie_lu_used'] as number) ?? 0) + 1;
    if (transfer.declaredTruth === 'true') {
      player.flags.jie_lu_lost = true;
      const infoId = this.addInfo(game, player.playerId, 'true', player.playerId, 'jie_lu');
      this.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'jie_lu' });
      transfer.infoId = infoId;
      transfer.settled = true;
      this.addLog(game, 'character.jieLuTrue', { player: player.displayName });
      delete game.currentTransfer;
      const dying = this.firstDyingCandidate(game);
      if (dying) return ok(this.startDying(game, dying, 'falseInfoLimit'));
      return ok(this.advanceTurn(game));
    }
    this.addLog(game, 'character.jieLuFalse', { player: player.displayName });
    return ok(this.maybeResolveReaction(game));
  }

  private useYiYi(game: GameState, player: Player, targetPlayerId?: PlayerId): DomainResult<GameState> {
    if (game.phase.phase !== 'SkillWindow') return err('yiYi.invalidPhase', '异议只能在技能阶段使用');
    if (!targetPlayerId || targetPlayerId === player.playerId) return err('yiYi.targetRequired', '异议需要选择另一名玩家');
    const target = game.players[targetPlayerId];
    if (!target) return err('yiYi.targetNotFound', '目标不存在');
    const key = `yi_yi_target_${targetPlayerId}`;
    if (player.flags[key]) return err('yiYi.targetUsed', '异议对每名玩家限一次');
    player.flags[key] = true;
    target.flags.character_skill_disabled_until_turn_serial = game.turn.turnSerial + 1;
    this.appendEvent(game, { type: 'CharacterSkillDisabled', sourcePlayerId: player.playerId, targetPlayerId, skillId: 'yi_yi', untilTurnSerial: game.turn.turnSerial + 1 });
    this.addLog(game, 'character.yiYi', { player: player.displayName, target: target.displayName });
    return ok(game);
  }

  private useNiZhuan(game: GameState, player: Player, targetPlayerId?: PlayerId): DomainResult<GameState> {
    if (!['SkillWindow', 'TransferDeclare'].includes(game.phase.phase)) return err('niZhuan.invalidPhase', '逆转只能在传递或技能阶段使用');
    if (!targetPlayerId || targetPlayerId === player.playerId) return err('niZhuan.targetRequired', '逆转需要选择另一名玩家');
    const target = game.players[targetPlayerId];
    if (!target) return err('niZhuan.targetNotFound', '目标不存在');
    if (player.infoIds.length < 1 || target.infoIds.length < 1) return err('niZhuan.noInfo', '双方都至少需要一张情报');
    player.identityRevealed = true;
    const mine = [...player.infoIds];
    const theirs = [...target.infoIds];
    player.infoIds = theirs;
    target.infoIds = mine;
    for (const infoId of mine) game.infoCards[infoId]!.ownerPlayerId = target.playerId;
    for (const infoId of theirs) game.infoCards[infoId]!.ownerPlayerId = player.playerId;
    player.missionCounters['ni_zhuan_used'] = ((player.missionCounters['ni_zhuan_used'] as number) ?? 0) + 1;
    this.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'ni_zhuan', targetPlayerId });
    this.addLog(game, 'character.niZhuan', { player: player.displayName, target: target.displayName });
    return ok(this.afterInfoChanged(game));
  }

  private useGuanFan(game: GameState, player: Player, targetPlayerId?: PlayerId): DomainResult<GameState> {
    if (game.phase.phase !== 'SkillWindow') return err('guanFan.invalidPhase', '惯犯只能在技能阶段使用');
    if (!player.flags.guan_fan_available) return err('guanFan.notAvailable', '尚未满足惯犯触发条件');
    if (!targetPlayerId || targetPlayerId === player.playerId) return err('guanFan.targetRequired', '惯犯需要选择另一名玩家');
    const target = game.players[targetPlayerId];
    if (!target || target.aliveState !== 'alive') return err('guanFan.targetNotFound', '目标不存在或未存活');
    this.addInfo(game, targetPlayerId, 'false', player.playerId, 'guan_fan');
    this.addInfo(game, targetPlayerId, 'false', player.playerId, 'guan_fan');
    player.flags.guan_fan_available = false;
    player.flags.zhao_zhang_lost = true;
    this.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'zhao_zhang' });
    this.addLog(game, 'character.guanFan', { player: player.displayName, target: target.displayName });
    return ok(this.afterInfoChanged(game));
  }

  private useDuBo(game: GameState, player: Player, targetPlayerId?: PlayerId): DomainResult<GameState> {
    if (!['SkillWindow', 'DyingWindow'].includes(game.phase.phase)) return err('duBo.invalidPhase', '赌博只能在技能阶段或自己的濒死阶段使用');
    if (game.phase.phase === 'DyingWindow' && player.aliveState !== 'dying') return err('duBo.notDying', '只有自己的濒死阶段可以濒死赌博');
    if (player.flags.du_bo_round === game.turn.roundNumber) return err('duBo.roundUsed', '赌博每轮限一次');
    if (!targetPlayerId || targetPlayerId === player.playerId) return err('duBo.targetRequired', '赌博需要选择另一名玩家');
    const target = game.players[targetPlayerId];
    if (!target || target.aliveState === 'dead') return err('duBo.targetNotFound', '目标不存在或已死亡');
    const key = `du_bo_target_${targetPlayerId}`;
    if (player.flags[key]) return err('duBo.targetUsed', '赌博对每名玩家限一次');
    player.flags.du_bo_round = game.turn.roundNumber;
    player.flags[key] = true;
    const playerGetsTrue = Math.random() < 0.5;
    this.addInfo(game, player.playerId, playerGetsTrue ? 'true' : 'false', player.playerId, 'du_bo');
    this.addInfo(game, targetPlayerId, playerGetsTrue ? 'false' : 'true', player.playerId, 'du_bo');
    this.addLog(game, 'character.duBo', { player: player.displayName, target: target.displayName });
    return ok(this.afterInfoChanged(game));
  }

  private useBianHu(game: GameState, player: Player, targetPlayerId?: PlayerId): DomainResult<GameState> {
    if (game.phase.phase !== 'SkillWindow') return err('bianHu.invalidPhase', '辩护只能在技能阶段使用');
    if (!targetPlayerId || targetPlayerId === player.playerId) return err('bianHu.targetRequired', '辩护需要选择另一名玩家');
    const target = game.players[targetPlayerId];
    if (!target) return err('bianHu.targetNotFound', '目标不存在');
    const myTrue = this.infoIdsByTruth(game, player.playerId, 'true');
    const targetFalse = this.infoIdsByTruth(game, targetPlayerId, 'false');
    const count = Math.min(myTrue.length, targetFalse.length);
    if (count < 1) return err('bianHu.noInfo', '需要你的真情报和目标假情报');
    for (let index = 0; index < count; index += 1) {
      this.moveInfo(game, myTrue[index]!, targetPlayerId, 'bian_hu');
      this.moveInfo(game, targetFalse[index]!, player.playerId, 'bian_hu');
    }
    this.addLog(game, 'character.bianHu', { player: player.displayName, target: target.displayName, count });
    return ok(this.afterInfoChanged(game));
  }

  private useLingMei(game: GameState, player: Player, deadPlayerId?: PlayerId, targetPlayerId?: PlayerId, truth: 'true' | 'false' = 'true'): DomainResult<GameState> {
    if (game.phase.phase !== 'SkillWindow') return err('lingMei.invalidPhase', '灵媒借传只能在技能阶段使用');
    if (!deadPlayerId || !targetPlayerId) return err('lingMei.targetRequired', '灵媒需要选择死者和传递目标');
    const dead = game.players[deadPlayerId];
    const target = game.players[targetPlayerId];
    if (!dead || dead.aliveState !== 'dead') return err('lingMei.notDead', '灵媒来源必须是已死亡玩家');
    if (!target || target.aliveState !== 'alive') return err('lingMei.targetNotAlive', '灵媒目标必须存活');
    const key = `ling_mei_dead_${deadPlayerId}`;
    if (player.flags[key]) return err('lingMei.used', '每名死者限借传一次');
    player.flags[key] = true;
    this.addInfo(game, targetPlayerId, truth, deadPlayerId, 'ling_mei');
    this.addLog(game, 'character.lingMei', { player: player.displayName, dead: dead.displayName, target: target.displayName, truth });
    return ok(this.afterInfoChanged(game));
  }

  private useQiYue(game: GameState, player: Player, firstTargetId?: PlayerId, secondTargetId?: PlayerId, truth: 'true' | 'false' = 'true'): DomainResult<GameState> {
    if (game.phase.phase !== 'TransferDeclare') return err('qiYue.invalidPhase', '契约只能在自己的传递阶段使用');
    if (this.activePlayer(game).playerId !== player.playerId) return err('qiYue.notActive', '只有当前回合玩家可以发动契约');
    if (player.flags.qi_yue_lost) return err('qiYue.lost', '契约已经放弃');
    if (!firstTargetId || !secondTargetId || firstTargetId === secondTargetId || firstTargetId === player.playerId || secondTargetId === player.playerId) {
      return err('qiYue.targetRequired', '契约需要选择两名不同其他玩家');
    }
    player.flags.cc_pending_second_transfer = secondTargetId;
    this.appendEvent(game, { type: 'CharacterSkillUsed', sourcePlayerId: player.playerId, skillId: 'qi_yue', targetPlayerId: firstTargetId, secondaryTargetPlayerId: secondTargetId });
    return this.handleDeclareTransfer(game, player.playerId, firstTargetId, truth);
  }

  private useShouHu(game: GameState, player: Player): DomainResult<GameState> {
    if (game.phase.phase !== 'SkillWindow') return err('shouHu.invalidPhase', '守护只能在技能阶段使用');
    if (player.flags.qi_yue_lost) return err('shouHu.lost', '已经放弃契约');
    const targetId = player.flags.shou_hu_target;
    if (typeof targetId !== 'string') return err('shouHu.notAvailable', '没有可守护的真情报接收者');
    const target = game.players[targetId as PlayerId];
    if (!target) return err('shouHu.targetNotFound', '守护目标不存在');
    const burned = this.burnInfos(game, target.playerId, 1, player.playerId, 'shou_hu', 'false');
    if (burned < 1) return err('shouHu.noFalse', '目标没有假情报可烧毁');
    player.flags.qi_yue_lost = true;
    delete player.flags.shou_hu_target;
    this.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'qi_yue' });
    this.addLog(game, 'character.shouHu', { player: player.displayName, target: target.displayName });
    return ok(this.afterInfoChanged(game));
  }

  private useXinSheng(game: GameState, player: Player): DomainResult<GameState> {
    if (game.phase.phase !== 'DyingWindow' || player.aliveState !== 'dying') return err('xinSheng.invalidPhase', '新生只能在自己的濒死阶段使用');
    if (player.flags.beng_huai_lost) return err('xinSheng.used', '已经放弃崩坏');
    const burned = this.burnInfos(game, player.playerId, 1, player.playerId, 'xin_sheng', 'false');
    if (burned < 1) return err('xinSheng.noFalse', '没有假情报可烧毁');
    player.flags.beng_huai_lost = true;
    this.appendEvent(game, { type: 'CharacterSkillLost', playerId: player.playerId, skillId: 'beng_huai' });
    player.missionCounters['xin_sheng_used'] = ((player.missionCounters['xin_sheng_used'] as number) ?? 0) + 1;
    if (this.infoCount(game, player.playerId, 'false') < player.falseInfoLimit) {
      player.aliveState = 'alive';
      this.addLog(game, 'character.xinShengSaved', { player: player.displayName });
      return ok(this.advanceTurn(game));
    }
    return ok(game);
  }

  private useJiuJi(game: GameState, player: Player): DomainResult<GameState> {
    if (game.phase.phase !== 'DyingWindow' || player.aliveState !== 'dying') return err('jiuJi.invalidPhase', '就计返还只能在自己的濒死阶段使用');
    const sourceId = player.flags.jiu_ji_return_source;
    if (typeof sourceId !== 'string') return err('jiuJi.notAvailable', '没有可返还的传递假情报');
    const falseInfo = this.infoIdsByTruth(game, player.playerId, 'false')[0];
    if (!falseInfo) return err('jiuJi.noFalse', '没有假情报可返还');
    this.revealCharacter(game, player);
    this.moveInfo(game, falseInfo, sourceId as PlayerId, 'jiu_ji');
    delete player.flags.jiu_ji_return_source;
    this.addLog(game, 'character.jiuJiReturn', { player: player.displayName, target: this.playerName(game, sourceId as PlayerId) });
    if (this.infoCount(game, player.playerId, 'false') < player.falseInfoLimit) {
      player.aliveState = 'alive';
      return ok(this.advanceTurn(game));
    }
    return ok(game);
  }

  private useBengHuai(game: GameState, player: Player, targetPlayerId?: PlayerId): DomainResult<GameState> {
    if (game.phase.phase !== 'SkillWindow') return err('bengHuai.invalidPhase', '崩坏只能在技能阶段使用');
    if (player.flags.beng_huai_lost) return err('bengHuai.lost', '崩坏已放弃');
    if (!player.flags.beng_huai_available) return err('bengHuai.notAvailable', '尚未获得可触发的假情报');
    if (!targetPlayerId || targetPlayerId === player.playerId) return err('bengHuai.targetRequired', '崩坏需要选择另一名玩家');
    const target = game.players[targetPlayerId];
    if (!target || target.aliveState !== 'alive') return err('bengHuai.targetNotFound', '目标不存在或未存活');
    player.flags.beng_huai_available = false;
    this.addInfo(game, targetPlayerId, 'false', player.playerId, 'beng_huai');
    this.addLog(game, 'character.bengHuai', { player: player.displayName, target: target.displayName });
    return ok(this.afterInfoChanged(game));
  }

  private advanceTurn(game: GameState): GameState {
    const aliveSeats = Object.values(game.players).filter((player) => player.aliveState === 'alive').sort((a, b) => a.seatIndex - b.seatIndex);
    if (aliveSeats.length === 0) {
      game.status = 'finished';
      game.winState = { finished: true };
      this.room.status = 'finished';
      this.addLog(game, 'game.allDead', { playerCount: Object.keys(game.players).length });
      return this.enterPhase(game, 'GameOver', { type: 'none' });
    }
    const currentSeat = game.turn.activeSeatIndex;
    const next = aliveSeats.find((player) => player.seatIndex > currentSeat) ?? aliveSeats[0];
    if (!next) return this.enterPhase(game, 'GameOver', { type: 'none' });
    const wrapped = next.seatIndex <= currentSeat;
    game.turn = {
      roundNumber: game.turn.roundNumber + (wrapped ? 1 : 0),
      activeSeatIndex: next.seatIndex,
      turnSerial: game.turn.turnSerial + 1,
    };
    this.appendEvent(game, { type: 'TurnAdvanced', roundNumber: game.turn.roundNumber, activeSeatIndex: game.turn.activeSeatIndex });
    // 检查死亡延迟任务（※标记的死亡宣胜）
    const deathDelayed = checkDeathDelayVictories(game);
    if (deathDelayed.length > 0) {
      const winnerId = deathDelayed[0]!;
      const winner = game.players[winnerId];
      if (winner) {
        game.winState = { finished: true, winner: { faction: 'white', declaredByPlayerId: winnerId, reason: 'secretMission', missionPlayerId: winnerId } };
        game.status = 'finished';
        this.room.status = 'finished';
        this.appendEvent(game, { type: 'VictoryDeclared', playerId: winnerId, faction: 'white', reason: 'secretMission' });
        this.appendEvent(game, { type: 'GameFinished', faction: 'white' });
        this.addLog(game, 'victory.declared', { player: winner.displayName, faction: 'white', reason: 'secretMission' });
        return this.enterPhase(game, 'GameOver', { type: 'victory', candidates: [winnerId] });
      }
    }
    const allAliveIds = Object.values(game.players).filter((player) => player.aliveState === 'alive').map((player) => player.playerId);
    this.openPendingAction(game, 'victoryDeclareWindow', allAliveIds, { type: 'victory', candidates: this.victoryCandidateIds(game) });
    return this.enterPhase(game, 'VictoryDeclareWindow', { type: 'activeTurn', activePlayerId: next.playerId });
  }

  private createInitialGameState(): GameState {
    const playerCount = this.room.seats.length;
    if (!isSupportedPlayerCount(playerCount)) throw new Error('unsupported player count');

    const config = createDefaultGameConfig(playerCount);
    const factions = assignIdentities(playerCount);
    const sortedSeats = [...this.room.seats].sort((left, right) => left.seatIndex - right.seatIndex);
    const characters = assignMvpCharacters(
      playerCount,
      sortedSeats.map((seat) => seat.characterPreferenceId).filter((id): id is NonNullable<typeof id> => Boolean(id)),
    );
    const players = {} as GameState['players'];
    const now = Date.now();
    const events: EventEnvelope<GameEvent>[] = [];
    const publicLog: PublicLogEntry[] = [];

    const appendEvent = (payload: GameEvent, gameVersionBefore: number): void => {
      events.push({
        eventId: createEventId(),
        roomId: this.room.roomId,
        type: payload.type,
        payload,
        createdAt: now + events.length,
        gameVersionBefore,
      });
    };

    appendEvent({ type: 'GameStarted', config }, 0);

    sortedSeats.forEach((seat, index) => {
      const playerId = createPlayerId();
      const character = characters[index];
      if (!character) throw new Error('missing MVP character assignment');

      seat.playerId = playerId;
      const player: Player = {
        playerId,
        userId: seat.userId,
        displayName: seat.displayName,
        seatIndex: seat.seatIndex,
        faction: factions[index] ?? 'white',
        identityRevealed: false,
        characterId: character.characterId,
        characterName: character.name,
        characterImageUrl: character.imageUrl,
        characterVisibility: character.visibility,
        characterRevealed: character.visibility === 'public',
        gender: character.gender,
        aliveState: 'alive',
        falseInfoLimit: config.falseInfoLimitDefault,
        infoIds: [],
        regularSkills: {
          probeRemaining: config.initialRegularSkillCounts.probe,
          lockRemaining: config.initialRegularSkillCounts.lock,
          interceptRemaining: config.initialRegularSkillCounts.intercept,
        },
        knownPartners: [],
        knownIdentities: [],
        flags: {},
        tags: [],
        missionStatus: 'pending',
        missionCounters: {},
      };
      players[playerId] = player;
      appendEvent({ type: 'IdentityAssigned', playerId, faction: player.faction }, events.length);
      appendEvent(
        {
          type: 'CharacterAssigned',
          playerId,
          characterId: character.characterId,
          characterName: character.name,
          imageUrl: character.imageUrl,
          visibility: character.visibility,
          gender: character.gender,
        },
        events.length,
      );
    });

    const activePlayer = sortedSeats[0]?.playerId;
    appendEvent(
      {
        type: 'PhaseChanged',
        from: 'Setup',
        to: 'VictoryDeclareWindow',
        context: activePlayer ? { type: 'activeTurn', activePlayerId: activePlayer } : { type: 'none' },
      },
      events.length,
    );

    publicLog.push(
      { id: `log_${now}_started`, messageKey: 'game.started', params: { playerCount }, createdAt: now },
      { id: `log_${now}_characters`, messageKey: 'game.mvpCharactersAssigned', params: { characterCount: characters.length }, createdAt: now + 1 },
    );

    const pendingActions = {} as GameState['pendingActions'];
    const state: GameState = {
      roomId: this.room.roomId,
      config,
      status: 'running',
      players,
      turn: { roundNumber: 1, activeSeatIndex: 0, turnSerial: 1 },
      phase: { phase: 'VictoryDeclareWindow', enteredAtVersion: events.length - 1, context: activePlayer ? { type: 'activeTurn', activePlayerId: activePlayer } : { type: 'none' } },
      infoCards: {},
      eventQueue: events,
      pendingActions,
      publicLog,
      privateLogs: {},
      deathQueue: [],
      winState: { finished: false },
      version: events.length,
    };
    const initAliveIds = Object.values(state.players).filter((player) => player.aliveState === 'alive').map((player) => player.playerId);
    this.openPendingAction(state, 'victoryDeclareWindow', initAliveIds, { type: 'victory', candidates: [] });
    return state;
  }

  private openPendingAction(
    game: GameState,
    kind: PendingAction['kind'],
    eligiblePlayerIds: PlayerId[],
    context: PendingAction['context'],
  ): PendingAction {
    const id = createPendingActionId();
    const action: PendingAction = {
      pendingActionId: id,
      kind,
      phase: game.phase.phase,
      eligiblePlayerIds,
      requiredPlayerIds: eligiblePlayerIds,
      status: 'open',
      responses: [],
      priorityPolicy: game.config.responsePriorityPolicy,
      context,
    };
    game.pendingActions[id] = action;
    return action;
  }

  private enterPhase(game: GameState, phase: GamePhase, context: PhaseContext): GameState {
    const from = game.phase.phase;
    this.appendEvent(game, { type: 'PhaseChanged', from, to: phase, context });
    game.phase = { phase, enteredAtVersion: game.version, context };
    return game;
  }

  private appendEvent(game: GameState, payload: GameEvent): void {
    game.eventQueue.push({
      eventId: createEventId(),
      roomId: this.room.roomId,
      type: payload.type,
      payload,
      createdAt: Date.now(),
      gameVersionBefore: game.version,
    });
    game.version += 1;
  }

  private addLog(game: GameState, messageKey: string, params: Record<string, string | number | boolean>): void {
    game.publicLog.unshift({ id: `log_${Date.now()}_${game.publicLog.length}`, messageKey, params, createdAt: Date.now() });
    game.publicLog = game.publicLog.slice(0, 80);
  }

  private addPrivateLog(game: GameState, playerId: PlayerId, messageKey: string, params: Record<string, string | number | boolean>): void {
    const logs = game.privateLogs[playerId] ?? [];
    logs.unshift({ id: `prv_${Date.now()}_${logs.length}`, messageKey, params, createdAt: Date.now() });
    game.privateLogs[playerId] = logs.slice(0, 60);
  }

  private activePlayer(game: GameState): Player {
    const player = Object.values(game.players).find((item) => item.seatIndex === game.turn.activeSeatIndex && item.aliveState === 'alive');
    if (!player) throw new Error('active player not found');
    return player;
  }

  private playerByUser(userId: UserId): Player | undefined {
    return this.room.game ? Object.values(this.room.game.players).find((player) => player.userId === userId) : undefined;
  }

  private playerName(game: GameState, playerId: PlayerId): string {
    return game.players[playerId]?.displayName ?? playerId;
  }

  private infoCount(game: GameState, playerId: PlayerId, truth: 'true' | 'false'): number {
    return Object.values(game.infoCards).filter((info) => info.ownerPlayerId === playerId && info.truth === truth).length;
  }

  private infoIdsByTruth(game: GameState, playerId: PlayerId, truth: 'true' | 'false'): InfoId[] {
    return Object.values(game.infoCards)
      .filter((info) => info.ownerPlayerId === playerId && info.truth === truth)
      .map((info) => info.infoId);
  }

  private hasSkill(player: Player | undefined, skillId: string): boolean {
    if (!player) return false;
    if (skillId === 'zhao_zhang' && player.flags.zhao_zhang_lost) return false;
    if (skillId === 'qi_yue' && player.flags.qi_yue_lost) return false;
    if (skillId === 'beng_huai' && player.flags.beng_huai_lost) return false;
    return Boolean(player.characterId) && this.skillIdsFor(player).includes(skillId);
  }

  private skillIdsFor(player: Player): string[] {
    const map: Record<string, string[]> = {
      char_001_chen_yong_ren: ['cheng_fu', 'jiu_ji'],
      char_002_liu_jian_ming: ['cheng_fu', 'mie_ji'],
      char_004_holmes: ['zhen_xiang', 'jie_lu'],
      char_006_naruhodo: ['yi_yi', 'ni_zhuan'],
      char_008_jack_the_ripper: ['zhao_zhang', 'guan_fan'],
      char_009_akise_aru: ['tan_jiu', 'du_bo'],
      char_014_ayazato_chihiro: ['bian_hu', 'ling_mei'],
      char_016_cc: ['qi_yue', 'shou_hu'],
      char_017_ayanami_rei: ['bing_shan', 'ke_long'],
      char_020_gasai_yuno: ['beng_huai', 'xin_sheng'],
    };
    return map[player.characterId ?? ''] ?? [];
  }

  private isCharacterSkillDisabled(game: GameState, player: Player): boolean {
    const until = player.flags.character_skill_disabled_until_turn_serial;
    return typeof until === 'number' && until >= game.turn.turnSerial;
  }

  private rememberIdentity(player: Player, targetPlayerId: PlayerId, faction: Faction, source: 'probe' | 'skill' | 'system'): void {
    if (player.knownIdentities.some((known) => known.targetPlayerId === targetPlayerId && known.faction === faction)) return;
    player.knownIdentities.push({ targetPlayerId, faction, source });
  }

  private knowsIdentity(player: Player, targetPlayerId: PlayerId): boolean {
    return player.knownIdentities.some((known) => known.targetPlayerId === targetPlayerId && known.faction);
  }

  private revealCharacter(game: GameState, player: Player): void {
    if (player.characterRevealed || !player.characterId || !player.characterName) return;
    player.characterRevealed = true;
    this.appendEvent(game, { type: 'CharacterRevealed', playerId: player.playerId, characterId: player.characterId, characterName: player.characterName });
  }

  private addInfo(game: GameState, ownerPlayerId: PlayerId, truth: 'true' | 'false', sourcePlayerId: PlayerId | undefined, reason: string): InfoId {
    const infoId = createInfoId();
    game.infoCards[infoId] = { infoId, truth, ownerPlayerId, ...(sourcePlayerId ? { sourcePlayerId } : {}), public: true, createdBy: 'skill', tags: [reason] };
    game.players[ownerPlayerId]?.infoIds.push(infoId);
    this.appendEvent(game, { type: 'ExtraInfoAdded', infoId, ownerPlayerId, truth, ...(sourcePlayerId ? { sourcePlayerId } : {}), reason });
    this.afterInfoGained(game, ownerPlayerId, truth, sourcePlayerId, infoId);
    return infoId;
  }

  private moveInfo(game: GameState, infoId: InfoId, toPlayerId: PlayerId, reason: string): void {
    const info = game.infoCards[infoId];
    if (!info) return;
    const fromPlayerId = info.ownerPlayerId;
    game.players[fromPlayerId]!.infoIds = game.players[fromPlayerId]!.infoIds.filter((id) => id !== infoId);
    game.players[toPlayerId]?.infoIds.push(infoId);
    info.ownerPlayerId = toPlayerId;
    this.appendEvent(game, { type: 'InfoMoved', infoId, fromPlayerId, toPlayerId, reason });
    this.afterInfoGained(game, toPlayerId, info.truth, fromPlayerId, infoId);
  }

  private burnInfos(game: GameState, ownerPlayerId: PlayerId, count: number, sourcePlayerId: PlayerId | undefined, reason: string, truth?: 'true' | 'false'): number {
    const candidates = Object.values(game.infoCards)
      .filter((info) => info.ownerPlayerId === ownerPlayerId && (!truth || info.truth === truth))
      .sort((left, right) => (left.truth === 'false' && right.truth === 'true' ? -1 : left.truth === 'true' && right.truth === 'false' ? 1 : 0))
      .slice(0, count);
    for (const info of candidates) {
      delete game.infoCards[info.infoId];
      game.players[ownerPlayerId]!.infoIds = game.players[ownerPlayerId]!.infoIds.filter((id) => id !== info.infoId);
      this.appendEvent(game, { type: 'InfoBurned', infoId: info.infoId, ownerPlayerId, ...(sourcePlayerId ? { sourcePlayerId } : {}), reason });
    }
    return candidates.length;
  }

  private afterInfoGained(game: GameState, ownerPlayerId: PlayerId, truth: 'true' | 'false', sourcePlayerId: PlayerId | undefined, infoId: InfoId): void {
    const owner = game.players[ownerPlayerId];
    const source = sourcePlayerId ? game.players[sourcePlayerId] : undefined;
    if (!owner) return;
    if (truth === 'true' && this.hasSkill(owner, 'zhen_xiang')) {
      owner.regularSkills.probeRemaining += 1;
      this.addLog(game, 'character.zhenXiang', { player: owner.displayName });
    }
    if (truth === 'false' && sourcePlayerId) {
      owner.flags.last_false_info_source = sourcePlayerId;
    }
    if (truth === 'false' && this.hasSkill(owner, 'beng_huai')) {
      owner.flags.beng_huai_available = true;
    }
    if (truth === 'false' && this.hasSkill(owner, 'jiu_ji') && sourcePlayerId) {
      owner.flags.jiu_ji_return_source = sourcePlayerId;
      owner.flags.jiu_ji_return_info = infoId;
    }
    if (truth === 'true' && source && this.hasSkill(source, 'shou_hu')) {
      source.flags.shou_hu_target = ownerPlayerId;
    }
  }

  private afterInfoChanged(game: GameState): GameState {
    const dying = this.firstDyingCandidate(game);
    if (dying) return this.startDying(game, dying, 'falseInfoLimit');
    return game;
  }

  private applyAyanamiClone(game: GameState, interceptPlayerId: PlayerId): void {
    const rei = Object.values(game.players).find((player) => player.aliveState === 'alive' && this.hasSkill(player, 'ke_long'));
    const interceptor = game.players[interceptPlayerId];
    if (!rei || !interceptor || rei.playerId === interceptPlayerId) return;
    this.revealCharacter(game, rei);
    const trueCount = this.infoCount(game, rei.playerId, 'true');
    const falseCount = this.infoCount(game, rei.playerId, 'false');
    rei.missionCounters['ke_long_used'] = ((rei.missionCounters['ke_long_used'] as number) ?? 0) + 1;
    this.burnInfos(game, interceptPlayerId, interceptor.infoIds.length, rei.playerId, 'ke_long');
    for (let index = 0; index < trueCount; index += 1) this.addInfo(game, interceptPlayerId, 'true', rei.playerId, 'ke_long');
    for (let index = 0; index < falseCount; index += 1) this.addInfo(game, interceptPlayerId, 'false', rei.playerId, 'ke_long');
    this.addLog(game, 'character.keLong', { player: rei.displayName, target: interceptor.displayName });
  }

  private startQueuedTransfer(game: GameState, playerId: PlayerId, targetPlayerId: PlayerId, truth: 'true' | 'false'): GameState {
    const player = game.players[playerId];
    if (player) delete player.flags.cc_pending_second_transfer;
    const result = this.handleDeclareTransfer(game, playerId, targetPlayerId, truth);
    return result.ok ? result.value : this.advanceTurn(game);
  }

  private firstDyingCandidate(game: GameState): PlayerId | undefined {
    return Object.values(game.players).find((player) => player.aliveState === 'alive' && this.infoCount(game, player.playerId, 'false') >= player.falseInfoLimit)?.playerId;
  }

  private victoryCandidateIds(game: GameState): PlayerId[] {
    const redBlue = Object.values(game.players)
      .filter((player) => player.aliveState === 'alive' && player.faction !== 'white' && this.infoCount(game, player.playerId, 'true') >= 3)
      .map((player) => player.playerId);
    const white = Object.values(game.players)
      .filter((player) => player.aliveState === 'alive' && player.faction === 'white' && checkMission(game, player.playerId).met)
      .map((player) => player.playerId);
    return [...redBlue, ...white];
  }

  private requireTransfer(game: GameState, transferId: string): DomainResult<CurrentTransfer> {
    if (!game.currentTransfer || game.currentTransfer.transferId !== transferId) return err('transfer.notFound', '当前传递不存在');
    return ok(game.currentTransfer);
  }

  private openActionByKind(game: GameState, kind: PendingAction['kind']): PendingAction | undefined {
    return Object.values(game.pendingActions).find((action) => action.kind === kind && action.status === 'open' && action.phase === game.phase.phase);
  }

  private closeOpenActionsForCurrentPhase(game: GameState): void {
    for (const action of Object.values(game.pendingActions)) {
      if (action.status === 'open' && action.phase === game.phase.phase) {
        action.status = 'resolved';
      }
    }
  }

  private recordPendingAct(game: GameState, playerId: PlayerId): void {
    const action = this.openActionByKind(game, 'regularSkillWindow');
    if (!action || action.responses.some((response) => response.playerId === playerId)) return;
    action.responses.push({ playerId, responseType: 'act', submittedAt: Date.now() });
  }

  private allRequiredResponded(action: PendingAction): boolean {
    const required = action.requiredPlayerIds ?? action.eligiblePlayerIds;
    return required.every((playerId) => action.responses.some((response) => response.playerId === playerId));
  }

  /**
   * GM 强制推进阶段，用于处理卡住的游戏状态。
   * 关闭所有已打开的待响应窗口并尝试推进到下一个阶段。
   */
  forceAdvancePhase(userId: UserId): DomainResult<GameState> {
    const game = this.room.game;
    if (!game || this.room.status !== 'playing') return err('gm.gameNotRunning', '游戏尚未进行中');
    if (game.status === 'finished') return err('gm.gameFinished', '游戏已经结束');

    const fromPhase = game.phase.phase;

    // 关闭所有 open 的 pending actions
    for (const actionId of Object.keys(game.pendingActions)) {
      const action = game.pendingActions[actionId as keyof typeof game.pendingActions];
      if (action && action.status === 'open') {
        action.status = 'resolved';
      }
    }

    this.appendEvent(game, { type: 'GmPhaseForced', fromPhase, toPhase: fromPhase, triggeredBy: userId });
    this.addLog(game, 'gm.forceAdvance', { phase: fromPhase, user: userId });

    // 按当前阶段决定推进目标
    switch (fromPhase) {
      case 'VictoryDeclareWindow': {
        const active = this.activePlayer(game);
        return ok(this.enterPhase(game, 'SkillWindow', { type: 'activeTurn', activePlayerId: active.playerId }));
      }
      case 'SkillWindow': {
        const active = this.activePlayer(game);
        return ok(this.enterPhase(game, 'TransferDeclare', { type: 'activeTurn', activePlayerId: active.playerId }));
      }
      case 'ReactionWindow': {
        if (game.currentTransfer) {
          return ok(this.resolveReactionWindow(game));
        }
        return ok(this.advanceTurn(game));
      }
      case 'ReceiveDecision': {
        if (game.currentTransfer) {
          // 强制接收
          game.currentTransfer.receiveDecision = 'receive';
          this.addLog(game, 'gm.forceReceive', { receiver: this.playerName(game, game.currentTransfer.finalReceiverPlayerId ?? game.currentTransfer.targetPlayerId) });
          return ok(this.settleTransfer(game));
        }
        return ok(this.advanceTurn(game));
      }
      case 'DyingWindow': {
        const dyingId = game.phase.context.type === 'dying' ? game.phase.context.playerId : undefined;
        if (dyingId) {
          return ok(this.resolveDyingDeath(game, dyingId));
        }
        return ok(this.advanceTurn(game));
      }
      case 'TransferDeclare': {
        // 跳过当前玩家的传递回合
        const active = Object.values(game.players).find((p) => p.seatIndex === game.turn.activeSeatIndex);
        this.addLog(game, 'gm.skipTurn', { player: active?.displayName ?? 'unknown' });
        return ok(this.advanceTurn(game));
      }
      case 'GameOver':
        return err('gm.gameOver', '游戏已结束');
      default:
        return ok(this.advanceTurn(game));
    }
  }

  private createSeat(seatIndex: number, userId: UserId, displayName: string, ownerUserId = this.room.ownerUserId): RoomSeat {
    return { seatIndex, userId, displayName, ready: userId === ownerUserId, connected: true };
  }

  private nextSeatIndex(): number {
    const taken = new Set(this.room.seats.map((seat) => seat.seatIndex));
    for (let index = 0; index < 8; index += 1) {
      if (!taken.has(index)) return index;
    }
    return this.room.seats.length;
  }

  private touch(): void {
    this.room.updatedAt = Date.now();
  }
}
