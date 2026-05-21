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
  type CharacterId,
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
import { characterDefinitionById, dealCharacterOptions } from '../engine/character-registry.js';
import { assignIdentities } from '../engine/identity-engine.js';
import { createEventId, createInfoId, createPendingActionId, createPlayerId } from '../util/id.js';
import { checkMission, markDeathDelayMissions, checkDeathDelayVictories } from '../engine/mission-engine.js';
import { getSkillHandler, type SkillRuntimeAccess } from '../engine/skill-handlers.js';

export interface JoinRoomInput {
  userId: UserId;
  displayName: string;
}

export class GameRoomRuntime {
  readonly room: GameRoom;

  /** 从持久化保存的 GameRoom 重建 runtime（服务器重启恢复）。 */
  static fromSaved(room: GameRoom): GameRoomRuntime {
    // 服务器重启后所有座位标记为断线，等待玩家重新连接
    for (const seat of room.seats) seat.connected = false;
    const instance = Object.create(GameRoomRuntime.prototype) as GameRoomRuntime;
    (instance as { room: GameRoom }).room = room;
    return instance;
  }

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

  addBot(requestUserId: UserId): DomainResult<RoomSeat> {
    if (requestUserId !== this.room.ownerUserId) return err('room.notOwner', '只有房主可以添加机器人');
    if (this.room.status !== 'lobby') return err('room.alreadyStarted', '游戏开始后不能添加机器人');
    if (this.room.seats.length >= 8) return err('room.full', '房间已满，MVP 最多支持 8 人');

    const botNumber = this.room.seats.filter((seat) => seat.isBot).length + 1;
    const userId = `bot_${this.room.roomId}_${botNumber}` as UserId;
    const seat = this.createSeat(this.nextSeatIndex(), userId, `机器人${botNumber}`);
    seat.ready = true;
    seat.connected = true;
    seat.isBot = true;
    this.room.seats.push(seat);
    this.touch();
    return ok(seat);
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

  leave(userId: UserId): DomainResult<void> {
    const seatIndex = this.room.seats.findIndex((s) => s.userId === userId);
    if (seatIndex === -1) return err('room.notJoined', '你不在该房间中');

    if (this.room.status === 'lobby') {
      // 游戏未开始，彻底移除该座位
      this.room.seats.splice(seatIndex, 1);

      // 如果是房主退出了
      if (this.room.ownerUserId === userId) {
        if (this.room.seats.length > 0) {
          // 转移给下一个人
          const nextHost = this.room.seats[0];
          if (nextHost) {
            this.room.ownerUserId = nextHost.userId;
            nextHost.ready = true;
          }
        } else {
          // 房间空了，标记为 closed
          this.room.status = 'closed';
        }
      }
    } else {
      // 游戏中途退出，保留座位和玩家，仅标记为断线（相当于托管放弃操作）
      const seat = this.room.seats[seatIndex];
      if (seat) seat.connected = false;

      const player = this.playerByUser(userId);
      if (player) player.flags.leftGame = true; // leftGame 属性可以预留
    }

    this.touch();
    return ok(undefined);
  }

  setReady(userId: UserId, ready: boolean): DomainResult<void> {
    const seat = this.room.seats.find((item) => item.userId === userId);
    if (!seat) return err('room.notJoined', '你还未加入房间');
    seat.ready = ready;
    this.touch();
    return ok(undefined);
  }

  selectCharacter(userId: UserId, characterId: string): DomainResult<void> {
    const game = this.room.game;
    if (this.room.status !== 'playing' || !game || game.status !== 'setup' || game.setupState?.step !== 'characterSelection') {
      return err('character.invalidPhase', '只能在开局选角阶段选择角色');
    }

    const seat = this.room.seats.find((item) => item.userId === userId);
    if (!seat) return err('room.notJoined', '你还未加入房间');
    if (seat.selectedCharacterId) return err('character.alreadySelected', '你已经选择过角色');
    if (!seat.characterOptionIds?.includes(characterId as CharacterId)) return err('character.notInOptions', '只能选择系统发给你的候选角色');

    const character = characterDefinitionById(characterId as CharacterId);
    if (!character) return err('character.notFound', '角色不存在');

    seat.selectedCharacterId = character.characterId;
    this.addLog(game, 'character.selectionReady', { player: seat.displayName });

    this.autoSelectBotCharacters(game);
    const allSelected = this.room.seats.every((item) => Boolean(item.selectedCharacterId));
    if (allSelected) this.finalizeCharacterSelection(game);

    this.touch();
    return ok(undefined);
  }

  submitSetupChoice(userId: UserId, choiceKey: 'ccMissionTarget', targetPlayerId: PlayerId): DomainResult<void> {
    const game = this.room.game;
    if (this.room.status !== 'playing' || !game || game.status !== 'setup' || game.setupState?.step !== 'openingOptions') {
      return err('setup.invalidPhase', '当前不能提交开局选项');
    }

    const player = this.playerByUser(userId);
    if (!player) return err('game.playerNotFound', '你不在本局游戏中');
    if (choiceKey !== 'ccMissionTarget' || player.characterId !== 'char_016_cc') return err('setup.invalidChoice', '没有可提交的开局选项');
    if (!game.setupState.requiredPlayerIds.includes(player.playerId)) return err('setup.notRequired', '你当前不需要提交开局选项');
    if (game.setupState.completedPlayerIds.includes(player.playerId)) return err('setup.alreadySubmitted', '你已经提交过开局选项');
    if (targetPlayerId === player.playerId) return err('setup.selfTarget', 'C.C 的机密任务目标不能选择自己');
    const target = game.players[targetPlayerId];
    if (!target) return err('setup.targetNotFound', '目标玩家不存在');

    player.flags.cc_mission_target = targetPlayerId;
    game.setupState.completedPlayerIds.push(player.playerId);
    this.addPrivateLog(game, player.playerId, 'mission.ccTargetSelected', { player: player.displayName, target: target.displayName });
    this.addLog(game, 'setup.choiceSubmitted', { player: player.displayName, choice: 'ccMissionTarget' });
    this.resolveSetupChoiceAction(game, player.playerId, targetPlayerId);

    if (game.setupState.requiredPlayerIds.every((id) => game.setupState?.completedPlayerIds.includes(id))) {
      this.startFirstTurnAfterSetup(game);
    }

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
    if (seat.isBot) {
      seat.connected = true;
    } else {
      seat.connected = connected;
    }
    this.touch();
  }

  /**
   * 将房主转移到其他已连接玩家。
   * 当房主断线时调用，保证房间始终有人可以开始游戏或推进。
   */
  transferHost(fromUserId: UserId): DomainResult<UserId> {
    if (this.room.ownerUserId !== fromUserId) return err('room.notOwner', '你不是房主');
    if (this.room.status !== 'lobby') {
      // 游戏中房主断线不转移：游戏中不需要房主权限（GM forceAdvance 不依赖 owner）
      return ok(fromUserId);
    }

    // 优先选择已连接的玩家，其次选择已准备的玩家
    const candidates = this.room.seats.filter((s) => s.userId !== fromUserId);
    if (candidates.length === 0) {
      // 只剩房主一人断线 — 房主不变，等房主重连
      return ok(fromUserId);
    }

    const nextHost = candidates.find((s) => s.connected) ?? candidates.find((s) => s.ready) ?? candidates[0];
    if (!nextHost) return ok(fromUserId);
    this.room.ownerUserId = nextHost.userId;
    nextHost.ready = true; // 新房主默认准备
    this.touch();
    console.log(`[host] 房主从 ${fromUserId} 转移到 ${nextHost.userId}（${nextHost.displayName}）`);
    return ok(nextHost.userId);
  }

  /** 是否有连接的玩家。用于判断空房间清理。 */
  hasConnectedPlayers(): boolean {
    return this.room.seats.some((s) => s.connected);
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
      case 'UseFinalPkBurn':
        return this.handleFinalPkBurn(game, command.playerId, command.targetPlayerId);
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
    // 7.2 规则：试探结果默认只有试探者本人知道，不在公屏显示。
    this.addLog(game, 'probe.used', { player: player.displayName, target: target.displayName });
    this.addPrivateLog(game, playerId, success ? 'probe.success' : 'probe.failed', {
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
    // 7.2 规则：传递情报的真假只有传递者知道，公屏只显示谁向谁传递。
    this.addLog(game, 'transfer.declared', { from: player.displayName, target: target.displayName });
    this.addPrivateLog(game, playerId, 'transfer.declaredTruth', { from: player.displayName, target: target.displayName, truth });
    if (game.currentTransfer.forcedReceive) this.addLog(game, 'character.zhaoZhang', { player: player.displayName, target: target.displayName });

    const eligible = Object.values(game.players)
      .filter((item) => item.aliveState === 'alive' && item.playerId !== playerId && item.playerId !== targetPlayerId)
      .map((item) => item.playerId);
    eligible.push(playerId);
    this.enterPhase(game, 'ReactionWindow', { type: 'transfer', transferId });
    this.openPendingAction(game, 'regularSkillWindow', eligible, { type: 'transfer', transferId });
    return ok(this.maybeResolveReaction(game));
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
    player.missionCounters['intercept_used'] = ((player.missionCounters['intercept_used'] as number) ?? 0) + 1;
    player.missionCounters['successful_intercept'] = ((player.missionCounters['successful_intercept'] as number) ?? 0) + 1;
    const sender = game.players[transfer.value.fromPlayerId];
    const originalReceiver = game.players[transfer.value.targetPlayerId];
    if (sender) sender.missionCounters['own_transfer_intercepted'] = ((sender.missionCounters['own_transfer_intercepted'] as number) ?? 0) + 1;
    if (originalReceiver) originalReceiver.missionCounters['incoming_transfer_intercepted'] = ((originalReceiver.missionCounters['incoming_transfer_intercepted'] as number) ?? 0) + 1;
    transfer.value.interceptedByPlayerId = playerId;
    transfer.value.finalReceiverPlayerId = playerId;
    transfer.value.forcedReceive = false;
    this.appendEvent(game, { type: 'InterceptUsed', sourcePlayerId: playerId, transferId, targetPlayerId, success: true });
    this.applyAyanamiClone(game, playerId);
    this.recordPendingAct(game, playerId);
    this.addLog(game, 'intercept.used', { player: player.displayName, from: this.playerName(game, targetPlayerId) });
    return ok(this.maybeResolveReaction(game));
  }

  private handleFinalPkBurn(game: GameState, playerId: PlayerId, targetPlayerId: PlayerId): DomainResult<GameState> {
    if (!game.finalPk) return err('finalPk.notActive', '当前没有进入最终 PK');
    if (game.finalPk.whitePlayerId !== playerId) return err('finalPk.notWhite', '只有最终 PK 的白方玩家可以使用额外烧毁');
    if (game.finalPk.burnUsed) return err('finalPk.burnUsed', '最终 PK 额外烧毁已经使用过');
    if (!['SkillWindow', 'TransferDeclare', 'DyingWindow'].includes(game.phase.phase)) return err('finalPk.invalidPhase', '最终 PK 额外烧毁只能在技能、传递或濒死阶段使用');
    const player = game.players[playerId];
    const target = game.players[targetPlayerId];
    if (!player || player.aliveState !== 'alive') return err('finalPk.notAlive', '白方玩家必须存活');
    if (!target) return err('finalPk.targetNotFound', '目标不存在');
    const burned = this.burnInfos(game, targetPlayerId, 1, playerId, 'final_pk');
    if (burned < 1) return err('finalPk.noInfo', '目标没有可烧毁的情报');
    game.finalPk.burnUsed = true;
    this.addLog(game, 'finalPk.burnUsed', { player: player.displayName, target: target.displayName, count: burned });
    return ok(this.afterInfoChanged(game));
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

    const handler = getSkillHandler(skillId, this.createSkillAccess());
    if (!handler) return err('character.notImplemented', '该人物技能暂未接入主动发动');

    const input = { targetPlayerId, secondaryTargetPlayerId, transfer: transferInput };
    const canUse = handler.canUse(this.createSkillAccess(), game, player, input);
    if (!canUse.ok) return canUse;
    return handler.resolve(this.createSkillAccess(), game, player, input);
  }

  /** 创建技能处理器所需的运行时访问适配器。 */
  private createSkillAccess(): SkillRuntimeAccess {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rt = this;
    return {
      addLog: (game, key, params) => rt.addLog(game, key, params),
      addPrivateLog: (game, pid, key, params) => rt.addPrivateLog(game, pid, key, params),
      addInfo: (game, oid, truth, sid, reason) => rt.addInfo(game, oid, truth, sid, reason),
      burnInfos: (game, oid, cnt, sid, reason, truthFilter) => rt.burnInfos(game, oid, cnt, sid, reason, truthFilter),
      moveInfo: (game, iid, toPid, reason) => rt.moveInfo(game, iid, toPid, reason),
      revealCharacter: (game, p) => rt.revealCharacter(game, p),
      appendEvent: (game, payload) => rt.appendEvent(game, payload),
      recordPendingAct: (game, pid) => rt.recordPendingAct(game, pid),
      hasSkill: (p, sid) => rt.hasSkill(p, sid),
      infoCount: (game, pid, truth) => rt.infoCount(game, pid, truth),
      infoIdsByTruth: (game, pid, truth) => rt.infoIdsByTruth(game, pid, truth),
      playerName: (game, pid) => rt.playerName(game, pid),
      activePlayer: (game) => rt.activePlayer(game),
      afterInfoChanged: (game) => rt.afterInfoChanged(game),
      maybeResolveReaction: (game) => rt.maybeResolveReaction(game),
      advanceTurn: (game) => rt.advanceTurn(game),
      handleDeclareTransfer: (game, pid, tid, truth) => rt.handleDeclareTransfer(game, pid, tid, truth),
      isCharacterSkillDisabled: (game, p) => rt.isCharacterSkillDisabled(game, p),
      settleTransfer: (game) => rt.settleTransfer(game),
      firstDyingCandidate: (game) => rt.firstDyingCandidate(game),
      startDying: (game, pid, cause) => rt.startDying(game, pid, cause),
      openPendingAction: (game, kind, ids, ctx) => rt.openPendingAction(game, kind as never, ids, ctx as never),
      enterPhase: (game, phase, ctx) => rt.enterPhase(game, phase as never, ctx as never),
    };
  }

  private maybeResolveReaction(game: GameState): GameState {
    const action = this.openActionByKind(game, 'regularSkillWindow');
    if (!action) return game;
    this.autoPassBotResponses(game, action);
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
    if (game.finalPk) game.finalPk.transfersAfterEntry += 1;
    // 7.2 规则：情报的真假只在接收后才在公屏宣布；拒收时只有传递者本人知道。
    if (transfer.receiveDecision === 'receive') {
      this.addLog(game, 'transfer.settled', { owner: this.playerName(game, ownerPlayerId), truth: transfer.declaredTruth });
    } else {
      this.addLog(game, 'transfer.rejected', { from: this.playerName(game, transfer.fromPlayerId), target: this.playerName(game, transfer.targetPlayerId) });
      this.addPrivateLog(game, transfer.fromPlayerId, 'transfer.rejectedTruth', { from: this.playerName(game, transfer.fromPlayerId), target: this.playerName(game, transfer.targetPlayerId), truth: transfer.declaredTruth });
    }
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
        // 任务计数器：C.C 被自己开局指定的目标杀死。
        const ccTarget = player.flags['cc_mission_target'];
        if (player.characterId === 'char_016_cc' && typeof ccTarget === 'string' && ccTarget === killer.playerId) {
          player.missionCounters['killed_by_target'] = ((player.missionCounters['killed_by_target'] as number) ?? 0) + 1;
        }
      }
    }
    this.addLog(game, 'player.died', { player: player.displayName, faction: player.faction });
    // 检查死亡延迟任务（秋濑或、绫里千寻等的※标记任务）
    const deathDelayMarked = markDeathDelayMissions(game, playerId);
    if (deathDelayMarked > 0) {
      this.addLog(game, 'mission.deathDelayMet.public', { player: player.displayName });
      this.addPrivateLog(game, playerId, 'mission.deathDelayMet.private', { player: player.displayName, reason: checkMission(game, playerId).reason });
    }
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
    const pkResult = this.checkFinalPk(game);
    if (pkResult) return pkResult;

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

  private checkFinalPk(game: GameState): GameState | undefined {
    const alive = Object.values(game.players).filter((player) => player.aliveState === 'alive');
    const aliveWhite = alive.filter((player) => player.faction === 'white');
    const aliveRedBlue = alive.filter((player) => player.faction !== 'white');
    if (game.finalPk) {
      const whiteAlive = alive.some((player) => player.playerId === game.finalPk?.whitePlayerId);
      const opponentAlive = alive.some((player) => player.playerId === game.finalPk?.opponentPlayerId);
      if (!whiteAlive || !opponentAlive) return undefined;
      if (game.finalPk.transfersAfterEntry > 10) {
        const white = game.players[game.finalPk.whitePlayerId];
        if (!white) return undefined;
        game.winState = { finished: true, winner: { faction: 'white', declaredByPlayerId: white.playerId, reason: 'secretMission', missionPlayerId: white.playerId } };
        game.status = 'finished';
        this.room.status = 'finished';
        this.appendEvent(game, { type: 'VictoryDeclared', playerId: white.playerId, faction: 'white', reason: 'secretMission' });
        this.appendEvent(game, { type: 'GameFinished', faction: 'white' });
        this.addLog(game, 'finalPk.whiteWinByTransfers', { player: white.displayName, count: game.finalPk.transfersAfterEntry });
        return this.enterPhase(game, 'GameOver', { type: 'victory', candidates: [white.playerId] });
      }
      return undefined;
    }
    if (alive.length === 2 && aliveWhite.length === 1 && aliveRedBlue.length === 1) {
      const white = aliveWhite[0]!;
      const opponent = aliveRedBlue[0]!;
      game.finalPk = {
        whitePlayerId: white.playerId,
        opponentPlayerId: opponent.playerId,
        enteredAtTurnSerial: game.turn.turnSerial,
        transfersAfterEntry: 0,
        burnUsed: false,
      };
      this.addLog(game, 'finalPk.started', { white: white.displayName, opponent: opponent.displayName });
    }
    return undefined;
  }

  private createInitialGameState(): GameState {
    const playerCount = this.room.seats.length;
    if (!isSupportedPlayerCount(playerCount)) throw new Error('unsupported player count');

    const config = createDefaultGameConfig(playerCount);
    const factions = assignIdentities(playerCount);
    const sortedSeats = [...this.room.seats].sort((left, right) => left.seatIndex - right.seatIndex);
    const optionsPerPlayer = Math.min(2, Math.floor(10 / playerCount));
    const characterOptions = dealCharacterOptions(playerCount, optionsPerPlayer);
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
      seat.playerId = playerId;
      seat.characterOptionIds = characterOptions[index] ?? [];
      delete seat.selectedCharacterId;
      delete seat.characterPreferenceId;

      const player: Player = {
        playerId,
        userId: seat.userId,
        displayName: seat.displayName,
        seatIndex: seat.seatIndex,
        faction: factions[index] ?? 'white',
        identityRevealed: false,
        characterVisibility: 'public',
        characterRevealed: false,
        gender: 'unknown',
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
    });

    publicLog.push(
      { id: `log_${now}_started`, messageKey: 'game.started', params: { playerCount }, createdAt: now },
      { id: `log_${now}_select`, messageKey: 'game.characterSelectionStarted', params: { optionsPerPlayer }, createdAt: now + 1 },
    );

    const pendingActions = {} as GameState['pendingActions'];
    const state: GameState = {
      roomId: this.room.roomId,
      config,
      status: 'setup',
      players,
      turn: { roundNumber: 1, activeSeatIndex: 0, turnSerial: 1 },
      phase: { phase: 'Setup', enteredAtVersion: events.length - 1, context: { type: 'none' } },
      infoCards: {},
      eventQueue: events,
      pendingActions,
      publicLog,
      privateLogs: {},
      setupState: { step: 'characterSelection', requiredPlayerIds: Object.keys(players) as PlayerId[], completedPlayerIds: [] },
      deathQueue: [],
      winState: { finished: false },
      version: events.length,
    };
    this.autoSelectBotCharacters(state);
    if (this.room.seats.every((item) => Boolean(item.selectedCharacterId))) this.finalizeCharacterSelection(state);
    return state;
  }

  private autoSelectBotCharacters(game: GameState): void {
    for (const seat of this.room.seats) {
      if (!seat.isBot || seat.selectedCharacterId) continue;
      const firstOption = seat.characterOptionIds?.[0];
      if (!firstOption) continue;
      seat.selectedCharacterId = firstOption;
      if (seat.playerId) {
        const player = game.players[seat.playerId];
        if (player) this.addLog(game, 'bot.characterSelected', { player: player.displayName });
      }
    }
  }

  private finalizeCharacterSelection(game: GameState): void {
    const sortedSeats = [...this.room.seats].sort((left, right) => left.seatIndex - right.seatIndex);
    for (const seat of sortedSeats) {
      if (!seat.playerId || !seat.selectedCharacterId) continue;
      const player = game.players[seat.playerId];
      const character = characterDefinitionById(seat.selectedCharacterId);
      if (!player || !character) continue;

      player.characterId = character.characterId;
      player.characterName = character.name;
      player.characterImageUrl = character.imageUrl;
      player.characterVisibility = character.visibility;
      player.characterRevealed = character.visibility === 'public';
      player.gender = character.gender;
      this.appendEvent(game, {
        type: 'CharacterAssigned',
        playerId: player.playerId,
        characterId: character.characterId,
        characterName: character.name,
        imageUrl: character.imageUrl,
        visibility: character.visibility,
        gender: character.gender,
      });
    }

    this.addLog(game, 'game.mvpCharactersAssigned', { characterCount: sortedSeats.length });
    const setupRequired = Object.values(game.players)
      .filter((player) => player.characterId === 'char_016_cc')
      .map((player) => player.playerId);
    if (setupRequired.length > 0) {
      game.setupState = { step: 'openingOptions', requiredPlayerIds: setupRequired, completedPlayerIds: [] };
      for (const playerId of setupRequired) {
        const player = game.players[playerId];
        if (!player) continue;
        this.openPendingAction(game, 'characterSkillWindow', [playerId], {
          type: 'generic',
          data: {
            choiceKey: 'ccMissionTarget',
            publicText: 'C.C 需要开局指定一名其他玩家作为机密任务目标。',
          },
        });
        this.addPrivateLog(game, playerId, 'setup.ccTargetRequired', { player: player.displayName });
      }
      this.enterPhase(game, 'Setup', { type: 'none' });
      return;
    }

    this.startFirstTurnAfterSetup(game);
  }

  private startFirstTurnAfterSetup(game: GameState): void {
    const activePlayer = [...this.room.seats].sort((left, right) => left.seatIndex - right.seatIndex)[0]?.playerId;
    game.setupState = { step: 'complete', requiredPlayerIds: [], completedPlayerIds: [] };
    game.status = 'running';
    this.closeAllOpenActions(game);
    const initAliveIds = Object.values(game.players).filter((player) => player.aliveState === 'alive').map((player) => player.playerId);
    this.openPendingAction(game, 'victoryDeclareWindow', initAliveIds, { type: 'victory', candidates: this.victoryCandidateIds(game) });
    this.enterPhase(game, 'VictoryDeclareWindow', activePlayer ? { type: 'activeTurn', activePlayerId: activePlayer } : { type: 'none' });
  }

  private resolveSetupChoiceAction(game: GameState, playerId: PlayerId, targetPlayerId: PlayerId): void {
    for (const action of Object.values(game.pendingActions)) {
      if (action.status === 'open' && action.kind === 'characterSkillWindow' && action.phase === 'Setup' && action.eligiblePlayerIds.includes(playerId)) {
        action.responses.push({ playerId, responseType: 'act', submittedAt: Date.now() });
        action.context = { type: 'generic', data: { ...(action.context.type === 'generic' ? action.context.data : {}), selectedTargetPlayerId: targetPlayerId } };
        action.status = 'resolved';
      }
    }
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
    this.autoPassBotResponses(game, action);
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

  private closeAllOpenActions(game: GameState): void {
    for (const action of Object.values(game.pendingActions)) {
      if (action.status === 'open') {
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

  private isBotPlayer(playerId: PlayerId): boolean {
    const player = this.room.game?.players[playerId];
    if (!player) return false;
    return Boolean(this.room.seats.find((seat) => seat.userId === player.userId)?.isBot);
  }

  private autoPassBotResponses(game: GameState, action: PendingAction): void {
    for (const playerId of action.eligiblePlayerIds) {
      if (!this.isBotPlayer(playerId)) continue;
      if (action.responses.some((response) => response.playerId === playerId)) continue;
      action.responses.push({ playerId, responseType: 'pass', submittedAt: Date.now() });
      this.addLog(game, 'bot.autoPass', { player: this.playerName(game, playerId) });
    }
  }

  /**
   * 让机器人执行当前阶段的默认操作。
   * 机器人策略先保持极简：自动选第一个角色、跳过宣胜/技能响应、默认传真情报、默认接收。
   * 返回值表示是否对房间状态产生了变更，便于网关决定是否再次广播。
   */
  autoPlayBots(): boolean {
    const game = this.room.game;
    if (!game || this.room.status !== 'playing' || game.status === 'finished') return false;

    let changed = false;
    for (let guard = 0; guard < 80; guard += 1) {
      const beforeVersion = game.version;
      const beforePhase = game.phase.phase;
      const beforeTurnSerial = game.turn.turnSerial;

      if (game.status === 'setup') {
        if (game.setupState?.step === 'characterSelection') {
          this.autoSelectBotCharacters(game);
          if (this.room.seats.every((item) => Boolean(item.selectedCharacterId))) this.finalizeCharacterSelection(game);
        } else if (game.setupState?.step === 'openingOptions') {
          for (const playerId of [...game.setupState.requiredPlayerIds]) {
            if (game.setupState.completedPlayerIds.includes(playerId)) continue;
            const player = game.players[playerId];
            const seat = player ? this.room.seats.find((item) => item.userId === player.userId) : undefined;
            if (!player || !seat?.isBot) continue;
            const target = Object.values(game.players).find((item) => item.aliveState === 'alive' && item.playerId !== playerId);
            if (!target) continue;
            player.flags.cc_mission_target = target.playerId;
            game.setupState.completedPlayerIds.push(playerId);
            this.addPrivateLog(game, playerId, 'mission.ccTargetSelected', { player: player.displayName, target: target.displayName });
            this.addLog(game, 'bot.setupChoiceSubmitted', { player: player.displayName });
            this.resolveSetupChoiceAction(game, playerId, target.playerId);
          }
          if (game.setupState.requiredPlayerIds.every((id) => game.setupState?.completedPlayerIds.includes(id))) {
            this.startFirstTurnAfterSetup(game);
          }
        }
      } else if (game.status === 'running') {
        const active = (() => {
          try { return this.activePlayer(game); } catch { return undefined; }
        })();
        const activeSeat = active ? this.room.seats.find((item) => item.userId === active.userId) : undefined;

        if (game.phase.phase === 'VictoryDeclareWindow') {
          const action = this.openActionByKind(game, 'victoryDeclareWindow');
          if (action) {
            const botIds = action.eligiblePlayerIds.filter((id) => {
              const player = game.players[id];
              const seat = player ? this.room.seats.find((item) => item.userId === player.userId) : undefined;
              return Boolean(seat?.isBot) && !action.responses.some((response) => response.playerId === id);
            });
            for (const botId of botIds) this.handlePass(game, botId, action.pendingActionId as PendingActionId);
          }
        } else if (game.phase.phase === 'SkillWindow') {
          const action = this.openActionByKind(game, 'regularSkillWindow');
          if (action && activeSeat?.isBot && active && action.eligiblePlayerIds.includes(active.playerId)) {
            this.handlePass(game, active.playerId, action.pendingActionId as PendingActionId);
          }
        } else if (game.phase.phase === 'TransferDeclare') {
          if (activeSeat?.isBot && active) {
            const target = Object.values(game.players).find((item) => item.aliveState === 'alive' && item.playerId !== active.playerId);
            if (target) this.handleDeclareTransfer(game, active.playerId, target.playerId, 'true');
            else this.advanceTurn(game);
          }
        } else if (game.phase.phase === 'ReactionWindow') {
          const action = this.openActionByKind(game, 'regularSkillWindow');
          if (action) {
            const botIds = action.eligiblePlayerIds.filter((id) => {
              const player = game.players[id];
              const seat = player ? this.room.seats.find((item) => item.userId === player.userId) : undefined;
              return Boolean(seat?.isBot) && !action.responses.some((response) => response.playerId === id);
            });
            for (const botId of botIds) this.handlePass(game, botId, action.pendingActionId as PendingActionId);
          }
        } else if (game.phase.phase === 'ReceiveDecision') {
          const transfer = game.currentTransfer;
          const receiverId = transfer?.finalReceiverPlayerId ?? transfer?.targetPlayerId;
          const receiver = receiverId ? game.players[receiverId] : undefined;
          const receiverSeat = receiver ? this.room.seats.find((item) => item.userId === receiver.userId) : undefined;
          if (transfer && receiver && receiverSeat?.isBot) this.handleReceiveInfo(game, receiver.playerId, transfer.transferId, 'receive');
        } else if (game.phase.phase === 'DyingWindow') {
          const dyingId = game.phase.context.type === 'dying' ? game.phase.context.playerId : undefined;
          const dying = dyingId ? game.players[dyingId] : undefined;
          const dyingSeat = dying ? this.room.seats.find((item) => item.userId === dying.userId) : undefined;
          const action = this.openActionByKind(game, 'dyingSkillWindow');
          if (dying && dyingSeat?.isBot && action) this.handlePass(game, dying.playerId, action.pendingActionId as PendingActionId);
        }
      }

      const didChange = beforeVersion !== game.version || beforePhase !== game.phase.phase || beforeTurnSerial !== game.turn.turnSerial;
      changed = changed || didChange;
      if (!didChange) break;
    }

    if (changed) this.touch();
    return changed;
  }

  forceEndGame(userId: UserId): DomainResult<GameState> {
    const game = this.room.game;
    if (!game || this.room.status !== 'playing') return err('gm.gameNotRunning', '游戏尚未进行中');
    if (game.status === 'finished') return err('gm.gameFinished', '游戏已经结束');

    const declaredBy = Object.values(game.players).find((player) => player.userId === userId)?.playerId
      ?? Object.values(game.players)[0]?.playerId;
    if (!declaredBy) return err('gm.noPlayers', '房间内没有玩家');

    this.closeAllOpenActions(game);
    game.status = 'finished';
    this.room.status = 'finished';
    game.winState.finished = true;
    game.winState.winner = { faction: 'none', declaredByPlayerId: declaredBy, reason: 'gmForceEnd' };
    this.appendEvent(game, { type: 'GmGameForcedEnd', triggeredBy: userId });
    this.appendEvent(game, { type: 'GameFinished', faction: 'none' });
    this.addLog(game, 'gm.forceEnd', { user: userId });
    this.enterPhase(game, 'GameOver', { type: 'none' });
    this.touch();
    return ok(game);
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
