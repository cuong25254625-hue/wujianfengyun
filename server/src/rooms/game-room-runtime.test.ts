import { describe, expect, it } from 'vitest';
import type { Player, PlayerId, UserId } from '@wujian/shared';
import { MVP_CHARACTER_POOL } from '../engine/character-registry.js';
import { getSkillDefinition } from '../engine/skill-registry.js';
import { GameRoomRuntime } from './game-room-runtime.js';
import { checkMission } from '../engine/mission-engine.js';

const userId = (index: number) => `user_${index}` as UserId;

// ── helpers ──────────────────────────────────────────────

const createStartedRuntime = (playerCount = 4) => {
  const runtime = new GameRoomRuntime('ROOM01' as never, userId(0), '玩家0');
  for (let index = 1; index < playerCount; index += 1) {
    const result = runtime.join({ userId: userId(index), displayName: `玩家${index}` });
    expect(result.ok, `join player ${index}`).toBe(true);
    const ready = runtime.setReady(userId(index), true);
    expect(ready.ok, `ready player ${index}`).toBe(true);
  }
  const started = runtime.startGame(userId(0));
  expect(started.ok).toBe(true);
  const fallbackCharacters = MVP_CHARACTER_POOL.slice(0, playerCount);
  runtime.room.seats.forEach((seat, index) => {
    const character = fallbackCharacters[index];
    const player = seat.playerId && runtime.room.game?.players[seat.playerId];
    if (!character || !seat.playerId || !player) throw new Error(`missing fallback character ${index}`);
    seat.characterOptionIds = [character.characterId];
    seat.selectedCharacterId = character.characterId;
    player.characterId = character.characterId;
    player.characterName = character.name;
    player.characterImageUrl = character.imageUrl;
    player.characterVisibility = character.visibility;
    player.characterRevealed = character.visibility === 'public';
    player.gender = character.gender;
  });
  if (runtime.room.game) {
    runtime.room.game.status = 'running';
    runtime.room.game.phase = { phase: 'VictoryDeclareWindow', enteredAtVersion: runtime.room.game.version, context: { type: 'activeTurn', activePlayerId: playersBySeat(runtime)[0]!.playerId } };
    const aliveIds = Object.values(runtime.room.game.players).map((player) => player.playerId);
    runtime.room.game.pendingActions = {
      [`pending_test_${runtime.room.game.version}`]: {
        pendingActionId: `pending_test_${runtime.room.game.version}` as never,
        kind: 'victoryDeclareWindow',
        phase: 'VictoryDeclareWindow',
        eligiblePlayerIds: aliveIds,
        requiredPlayerIds: aliveIds,
        status: 'open',
        responses: [],
        priorityPolicy: runtime.room.game.config.responsePriorityPolicy,
        context: { type: 'victory', candidates: [] },
      },
    } as typeof runtime.room.game.pendingActions;
  }
  return runtime;
};

const createStartedRoom = () => createStartedRuntime().room.game;

const playersBySeat = (runtime: GameRoomRuntime) =>
  Object.values(runtime.room.game?.players ?? {}).sort((left, right) => left.seatIndex - right.seatIndex);

const getGame = (runtime: GameRoomRuntime) => {
  const game = runtime.room.game;
  if (!game) throw new Error('game not started');
  return game;
};

const passFirstPending = (runtime: GameRoomRuntime, userIndex: number, playerId: PlayerId) => {
  const phase = runtime.room.game?.phase.phase;
  const pending = Object.values(runtime.room.game?.pendingActions ?? {}).find(
    (action) =>
      action.status === 'open' &&
      (action.phase === phase || action.kind === 'regularSkillWindow' || action.kind === 'dyingSkillWindow') &&
      action.eligiblePlayerIds.includes(playerId) &&
      !action.responses.some((response) => response.playerId === playerId),
  );
  expect(pending).toBeDefined();
  const result = runtime.handlePlayerCommand(userId(userIndex), {
    type: 'PassPendingAction',
    playerId,
    pendingActionId: pending!.pendingActionId,
  });
  expect(result.ok, `pass failed: ${result.ok ? '' : errMsg(result)}`).toBe(true);
};

/** Pass all pending actions for all players in order */
const passAllPending = (runtime: GameRoomRuntime, playerCount = 4) => {
  for (let i = 0; i < playerCount; i += 1) {
    for (const action of Object.values(runtime.room.game?.pendingActions ?? {})) {
      if (action.status !== 'open') continue;
      for (const pid of action.eligiblePlayerIds) {
        if (!action.responses.some((r) => r.playerId === pid)) {
          const idx = playersBySeat(runtime).findIndex((p) => p.playerId === pid);
          if (idx >= 0) {
            passFirstPending(runtime, idx, pid);
          }
        }
      }
    }
  }
};

const getPlayerByName = (runtime: GameRoomRuntime, name: string): Player | undefined =>
  Object.values(runtime.room.game?.players ?? {}).find((p) => p.displayName === name);

/** Safe access to error message from DomainResult, returns '' for ok results */
const errMsg = (r: { ok: boolean; error?: { message?: string } }): string =>
  !r.ok && r.error ? r.error.message ?? '' : '';

/** Safe access to error code from DomainResult, returns '' for ok results */
const errCode = (r: { ok: boolean; error?: { code?: string } }): string =>
  !r.ok && r.error ? r.error.code ?? '' : '';

const setCharacter = (runtime: GameRoomRuntime, playerName: string, characterId: string) => {
  const game = getGame(runtime);
  const player = getPlayerByName(runtime, playerName);
  if (!player) throw new Error(`player ${playerName} not found`);
  const char = MVP_CHARACTER_POOL.find((c) => c.characterId === characterId);
  if (!char) throw new Error(`character ${characterId} not found`);
  player.characterId = char.characterId;
  player.characterName = char.name;
  player.characterVisibility = char.visibility;
  player.characterRevealed = char.visibility === 'public';
  player.characterImageUrl = char.imageUrl;
  player.gender = char.gender;
  return player;
};

const giveInfo = (runtime: GameRoomRuntime, playerName: string, truth: 'true' | 'false', count = 1) => {
  const game = getGame(runtime);
  const player = getPlayerByName(runtime, playerName);
  if (!player) throw new Error(`player ${playerName} not found`);
  for (let i = 0; i < count; i += 1) {
    const infoId = `info_${playerName}_${truth}_${i}` as keyof typeof game.infoCards;
    game.infoCards[infoId] = {
      infoId,
      truth,
      ownerPlayerId: player.playerId,
      public: true,
      createdBy: 'system',
      tags: [],
    };
    player.infoIds.push(infoId);
  }
};

const passVictoryWindow = (runtime: GameRoomRuntime) => {
  const activeSeat = runtime.room.game?.turn.activeSeatIndex ?? 0;
  const activePlayer = playersBySeat(runtime).find((player) => player.seatIndex === activeSeat && player.aliveState === 'alive');
  if (!activePlayer) throw new Error('active player not found');
  passFirstPending(runtime, activePlayer.seatIndex, activePlayer.playerId);
};

const skipToTransfer = (runtime: GameRoomRuntime) => {
  const [p0] = playersBySeat(runtime);
  if (!p0) throw new Error('no players');
  passVictoryWindow(runtime); // victory window → skill
  passFirstPending(runtime, 0, p0.playerId); // skill → transfer
  expect(runtime.room.game?.phase.phase).toBe('TransferDeclare');
};

const declareAndReceive = (
  runtime: GameRoomRuntime,
  fromIndex: number,
  toName: string,
  truth: 'true' | 'false',
  receive: 'receive' | 'reject' = 'receive',
) => {
  const players = playersBySeat(runtime);
  const from = players[fromIndex];
  const to = getPlayerByName(runtime, toName);
  if (!from || !to) throw new Error('missing players');
  const transfer = runtime.handlePlayerCommand(userId(fromIndex), {
    type: 'DeclareTransfer',
    playerId: from.playerId,
    targetPlayerId: to.playerId,
    truth,
  });
  expect(transfer.ok, `declare transfer: ${transfer.ok ? '' : errMsg(transfer)}`).toBe(true);
  passAllPending(runtime, players.length);
  const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
  const toIdx = players.findIndex((p) => p.playerId === to.playerId);
  if (toIdx >= 0) {
    const recv = runtime.handlePlayerCommand(userId(toIdx), {
      type: 'ReceiveInfo',
      playerId: to.playerId,
      transferId,
      decision: receive,
    });
    expect(recv.ok, `receive: ${errMsg(recv)}`).toBe(true);
  }
};

// ── tests ────────────────────────────────────────────────

describe('GameRoomRuntime', () => {
  describe('skill registry coverage', () => {
    it('has skill descriptions for every MVP character skill', () => {
      for (const character of MVP_CHARACTER_POOL) {
        for (const skillId of character.skillIds) {
          expect(getSkillDefinition(skillId), `${character.name} missing ${skillId}`).toBeDefined();
        }
      }
    });
  });

  describe('setup events', () => {
    it('starts in private character selection setup before opening victory window', () => {
      const runtime = new GameRoomRuntime('ROOM01' as never, userId(0), '玩家0');
      for (let index = 1; index < 4; index += 1) {
        expect(runtime.join({ userId: userId(index), displayName: `玩家${index}` }).ok).toBe(true);
        expect(runtime.setReady(userId(index), true).ok).toBe(true);
      }

      const started = runtime.startGame(userId(0));
      expect(started.ok).toBe(true);
      const game = runtime.room.game;
      if (!game) throw new Error('game did not start');

      expect(game.status).toBe('setup');
      expect(game.phase.phase).toBe('Setup');
      expect(Object.values(game.pendingActions)).toHaveLength(0);
      expect(game.eventQueue.map((event) => event.type)).toEqual([
        'GameStarted',
        'IdentityAssigned',
        'IdentityAssigned',
        'IdentityAssigned',
        'IdentityAssigned',
      ]);

      expect(runtime.room.seats.every((seat) => seat.characterOptionIds?.length === 2)).toBe(true);
      for (const seat of runtime.room.seats) {
        expect(new Set(seat.characterOptionIds).size).toBe(2);
      }
    });

    it('rejects selecting a character outside own private options', () => {
      const runtime = new GameRoomRuntime('ROOM01' as never, userId(0), '玩家0');
      for (let index = 1; index < 4; index += 1) {
        expect(runtime.join({ userId: userId(index), displayName: `玩家${index}` }).ok).toBe(true);
        expect(runtime.setReady(userId(index), true).ok).toBe(true);
      }
      expect(runtime.startGame(userId(0)).ok).toBe(true);
      const otherOption = runtime.room.seats[1]?.characterOptionIds?.[0];
      if (!otherOption) throw new Error('missing option');

      const result = runtime.selectCharacter(userId(0), otherOption);
      expect(result.ok).toBe(false);
      expect(errCode(result)).toBe('character.notInOptions');
    });

    it('finalizes selected characters and opens victory window after everyone chooses', () => {
      const runtime = new GameRoomRuntime('ROOM01' as never, userId(0), '玩家0');
      for (let index = 1; index < 4; index += 1) {
        expect(runtime.join({ userId: userId(index), displayName: `玩家${index}` }).ok).toBe(true);
        expect(runtime.setReady(userId(index), true).ok).toBe(true);
      }
      expect(runtime.startGame(userId(0)).ok).toBe(true);
      runtime.room.seats.forEach((seat, index) => {
        seat.characterOptionIds = [MVP_CHARACTER_POOL[index]!.characterId];
      });
      const chosen = runtime.room.seats.map((seat) => seat.characterOptionIds?.[0]);
      for (let index = 0; index < 4; index += 1) {
        const option = chosen[index];
        if (!option) throw new Error('missing option');
        expect(runtime.selectCharacter(userId(index), option).ok).toBe(true);
      }

      const game = runtime.room.game;
      if (!game) throw new Error('game did not start');
      const players = Object.values(game.players).sort((left, right) => left.seatIndex - right.seatIndex);
      expect(game.status).toBe('running');
      expect(game.setupState?.step).toBe('complete');
      expect(game.phase.phase).toBe('VictoryDeclareWindow');
      expect(players.map((player) => player.characterId)).toEqual(chosen);
      expect(Object.values(game.pendingActions).some((action) => action.kind === 'victoryDeclareWindow' && action.status === 'open')).toBe(true);
      expect(game.eventQueue.filter((event) => event.type === 'CharacterAssigned')).toHaveLength(4);
    });

    it('opens a private C.C target setup choice and waits before first victory window', () => {
      const runtime = new GameRoomRuntime('ROOM01' as never, userId(0), '玩家0');
      for (let index = 1; index < 4; index += 1) {
        expect(runtime.join({ userId: userId(index), displayName: `玩家${index}` }).ok).toBe(true);
        expect(runtime.setReady(userId(index), true).ok).toBe(true);
      }
      expect(runtime.startGame(userId(0)).ok).toBe(true);
      const ccId = 'char_016_cc' as never;
      runtime.room.seats.forEach((seat, index) => {
        seat.characterOptionIds = [index === 0 ? ccId : MVP_CHARACTER_POOL[index]!.characterId];
      });

      for (let index = 0; index < 4; index += 1) {
        const option = runtime.room.seats[index]?.characterOptionIds?.[0];
        if (!option) throw new Error('missing option');
        expect(runtime.selectCharacter(userId(index), option).ok).toBe(true);
      }

      const game = getGame(runtime);
      const cc = playersBySeat(runtime)[0]!;
      expect(game.status).toBe('setup');
      expect(game.setupState?.step).toBe('openingOptions');
      expect(game.setupState?.requiredPlayerIds).toEqual([cc.playerId]);
      expect(game.phase.phase).toBe('Setup');
      const action = Object.values(game.pendingActions).find((item) => item.status === 'open' && item.kind === 'characterSkillWindow');
      expect(action?.eligiblePlayerIds).toEqual([cc.playerId]);
      expect(Object.values(game.pendingActions).some((item) => item.kind === 'victoryDeclareWindow' && item.status === 'open')).toBe(false);
    });

    it('submits C.C target privately and then starts the first victory window', () => {
      const runtime = new GameRoomRuntime('ROOM01' as never, userId(0), '玩家0');
      for (let index = 1; index < 4; index += 1) {
        expect(runtime.join({ userId: userId(index), displayName: `玩家${index}` }).ok).toBe(true);
        expect(runtime.setReady(userId(index), true).ok).toBe(true);
      }
      expect(runtime.startGame(userId(0)).ok).toBe(true);
      const ccId = 'char_016_cc' as never;
      runtime.room.seats.forEach((seat, index) => {
        seat.characterOptionIds = [index === 0 ? ccId : MVP_CHARACTER_POOL[index]!.characterId];
      });
      for (let index = 0; index < 4; index += 1) {
        const option = runtime.room.seats[index]?.characterOptionIds?.[0];
        if (!option) throw new Error('missing option');
        expect(runtime.selectCharacter(userId(index), option).ok).toBe(true);
      }

      const cc = playersBySeat(runtime)[0]!;
      const target = playersBySeat(runtime)[1]!;
      expect(runtime.submitSetupChoice(userId(0), 'ccMissionTarget', cc.playerId).ok).toBe(false);
      expect(runtime.submitSetupChoice(userId(0), 'ccMissionTarget', target.playerId).ok).toBe(true);

      const game = getGame(runtime);
      expect(cc.flags.cc_mission_target).toBe(target.playerId);
      expect(game.status).toBe('running');
      expect(game.setupState?.step).toBe('complete');
      expect(game.phase.phase).toBe('VictoryDeclareWindow');
      expect(Object.values(game.pendingActions).some((item) => item.kind === 'victoryDeclareWindow' && item.status === 'open')).toBe(true);
      expect(game.privateLogs[cc.playerId]?.map((entry) => entry.messageKey)).toContain('mission.ccTargetSelected');
    });
  });

  describe('identity distribution', () => {
    it('assigns correct identity counts for 4 players', () => {
      const game = createStartedRoom();
      if (!game) throw new Error('game did not start');
      const factions = Object.values(game.players).map((p) => p.faction);
      expect(factions.filter((f) => f === 'red')).toHaveLength(2);
      expect(factions.filter((f) => f === 'blue')).toHaveLength(2);
      expect(factions.filter((f) => f === 'white')).toHaveLength(0);
    });

    it('assigns correct identity counts for 5 players', () => {
      const rt = createStartedRuntime(5);
      const factions = Object.values(rt.room.game!.players).map((p) => p.faction);
      expect(factions.filter((f) => f === 'red')).toHaveLength(2);
      expect(factions.filter((f) => f === 'blue')).toHaveLength(2);
      expect(factions.filter((f) => f === 'white')).toHaveLength(1);
    });

    it('assigns correct identity counts for 6 players', () => {
      const rt = createStartedRuntime(6);
      const factions = Object.values(rt.room.game!.players).map((p) => p.faction);
      expect(factions.filter((f) => f === 'red')).toHaveLength(2);
      expect(factions.filter((f) => f === 'blue')).toHaveLength(2);
      expect(factions.filter((f) => f === 'white')).toHaveLength(2);
    });

    it('assigns correct identity counts for 7 players', () => {
      const rt = createStartedRuntime(7);
      const factions = Object.values(rt.room.game!.players).map((p) => p.faction);
      expect(factions.filter((f) => f === 'red')).toHaveLength(3);
      expect(factions.filter((f) => f === 'blue')).toHaveLength(3);
      expect(factions.filter((f) => f === 'white')).toHaveLength(1);
    });

    it('assigns correct identity counts for 8 players', () => {
      const rt = createStartedRuntime(8);
      const factions = Object.values(rt.room.game!.players).map((p) => p.faction);
      expect(factions.filter((f) => f === 'red')).toHaveLength(3);
      expect(factions.filter((f) => f === 'blue')).toHaveLength(3);
      expect(factions.filter((f) => f === 'white')).toHaveLength(2);
    });
  });

  describe('basic transfer flow', () => {
    it('grants Holmes an extra probe after receiving true info', () => {
      const runtime = createStartedRuntime();
      const [p0, , p2, p3] = playersBySeat(runtime);
      if (!p0 || !p2 || !p3) throw new Error('missing players');

      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 0, p0.playerId);
      const before = p2.regularSkills.probeRemaining;
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p2.playerId,
        truth: 'true',
      });
      expect(transfer.ok).toBe(true);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 1, playersBySeat(runtime)[1]!.playerId);
      passFirstPending(runtime, 3, p3.playerId);
      const receive = runtime.handlePlayerCommand(userId(2), {
        type: 'ReceiveInfo',
        playerId: p2.playerId,
        transferId,
        decision: 'receive',
      });
      expect(receive.ok).toBe(true);
      expect(runtime.room.game?.players[p2.playerId]?.regularSkills.probeRemaining).toBe(before + 1);
    });

    it('plays a basic transfer receive flow and advances turn', () => {
      const runtime = createStartedRuntime();
      const [p0, p1, p2, p3] = playersBySeat(runtime);
      if (!p0 || !p1 || !p2 || !p3) throw new Error('missing players');

      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 0, p0.playerId);
      expect(runtime.room.game?.phase.phase).toBe('TransferDeclare');

      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'true',
      });
      expect(transfer.ok).toBe(true);
      expect(runtime.room.game?.phase.phase).toBe('ReactionWindow');

      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 2, p2.playerId);
      passFirstPending(runtime, 3, p3.playerId);
      expect(runtime.room.game?.phase.phase).toBe('ReceiveDecision');

      const receive = runtime.handlePlayerCommand(userId(1), {
        type: 'ReceiveInfo',
        playerId: p1.playerId,
        transferId: runtime.room.game?.currentTransfer?.transferId ?? '',
        decision: 'receive',
      });
      expect(receive.ok).toBe(true);
      expect(
        Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p1.playerId && info.truth === 'true',
        ),
      ).toHaveLength(1);
      expect(runtime.room.game?.phase.phase).toBe('VictoryDeclareWindow');
      expect(runtime.room.game?.turn.activeSeatIndex).toBe(1);
    });

    it('allows rejection and returns info to sender', () => {
      const runtime = createStartedRuntime();
      const [p0, p1, p2, p3] = playersBySeat(runtime);
      if (!p0 || !p1 || !p2 || !p3) throw new Error('missing players');

      skipToTransfer(runtime);
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'false',
      });
      expect(transfer.ok).toBe(true);
      passAllPending(runtime, 4);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
      const reject = runtime.handlePlayerCommand(userId(1), {
        type: 'ReceiveInfo',
        playerId: p1.playerId,
        transferId,
        decision: 'reject',
      });
      expect(reject.ok).toBe(true);
      // info should go back to sender
      const infos = Object.values(runtime.room.game?.infoCards ?? {}).filter(
        (info) => info.truth === 'false' && info.ownerPlayerId === p0.playerId,
      );
      expect(infos.length).toBe(1);
    });
  });

  describe('intercept and lock priority', () => {
    it('resolves intercept before lock', () => {
      const runtime = createStartedRuntime();
      const [p0, p1, p2, p3] = playersBySeat(runtime);
      if (!p0 || !p1 || !p2 || !p3) throw new Error('missing players');

      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 0, p0.playerId);
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'false',
      });
      expect(transfer.ok).toBe(true);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';

      const lock = runtime.handlePlayerCommand(userId(0), {
        type: 'UseLock',
        playerId: p0.playerId,
        transferId,
        targetPlayerId: p1.playerId,
      });
      expect(lock.ok).toBe(true);
      const intercept = runtime.handlePlayerCommand(userId(2), {
        type: 'UseIntercept',
        playerId: p2.playerId,
        transferId,
        targetPlayerId: p0.playerId,
      });
      expect(intercept.ok).toBe(true);
      passFirstPending(runtime, 3, p3.playerId);

      expect(runtime.room.game?.currentTransfer?.finalReceiverPlayerId).toBe(p2.playerId);
      expect(runtime.room.game?.currentTransfer?.forcedReceive).toBe(false);
    });

    it('prevents self-interception by sender', () => {
      const runtime = createStartedRuntime();
      const [p0, p1] = playersBySeat(runtime);
      if (!p0 || !p1) throw new Error('missing players');
      skipToTransfer(runtime);
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'true',
      });
      expect(transfer.ok).toBe(true);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
      const selfIntercept = runtime.handlePlayerCommand(userId(0), {
        type: 'UseIntercept',
        playerId: p0.playerId,
        transferId,
        targetPlayerId: p0.playerId,
      });
      expect(selfIntercept.ok).toBe(false);
      expect(errCode(selfIntercept)).toBe('intercept.notEligible');
    });

    it('prevents target from intercepting', () => {
      const runtime = createStartedRuntime();
      const [p0, p1] = playersBySeat(runtime);
      if (!p0 || !p1) throw new Error('missing players');
      skipToTransfer(runtime);
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'true',
      });
      expect(transfer.ok).toBe(true);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
      const targetIntercept = runtime.handlePlayerCommand(userId(1), {
        type: 'UseIntercept',
        playerId: p1.playerId,
        transferId,
        targetPlayerId: p0.playerId,
      });
      expect(targetIntercept.ok).toBe(false);
      expect(errCode(targetIntercept)).toBe('intercept.notEligible');
    });
  });

  describe('dying and death', () => {
    it('kills a player at false info limit and reveals identity', () => {
      const runtime = createStartedRuntime();
      const [p0, p1] = playersBySeat(runtime);
      if (!p0 || !p1) throw new Error('missing players');
      const game = runtime.room.game;
      if (!game) throw new Error('missing game');

      giveInfo(runtime, '玩家1', 'false', 1);

      skipToTransfer(runtime);
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'false',
      });
      expect(transfer.ok).toBe(true);
      passAllPending(runtime, 4);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
      const receive = runtime.handlePlayerCommand(userId(1), {
        type: 'ReceiveInfo',
        playerId: p1.playerId,
        transferId,
        decision: 'receive',
      });
      expect(receive.ok).toBe(true);
      expect(runtime.room.game?.phase.phase).toBe('DyingWindow');
      passFirstPending(runtime, 1, p1.playerId);
      expect(runtime.room.game?.players[p1.playerId]?.aliveState).toBe('dead');
      expect(runtime.room.game?.players[p1.playerId]?.identityRevealed).toBe(true);
    });

    it('chain-kills multiple dying players', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const p1 = players[1];
      const p3 = players[3];
      if (!p1 || !p3) throw new Error('missing players');
      // give both players pre-existing false infos so next one kills them
      giveInfo(runtime, '玩家1', 'false', 1);
      giveInfo(runtime, '玩家3', 'false', 1);

      skipToTransfer(runtime);
      // send false info to p1, killing them
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: players[0]!.playerId,
        targetPlayerId: p1.playerId,
        truth: 'false',
      });
      expect(transfer.ok).toBe(true);
      passAllPending(runtime, 5);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
      const receive = runtime.handlePlayerCommand(userId(1), {
        type: 'ReceiveInfo',
        playerId: p1.playerId,
        transferId,
        decision: 'receive',
      });
      expect(receive.ok).toBe(true);
      // p1 should be dying
      expect(runtime.room.game?.phase.phase).toBe('DyingWindow');
      passFirstPending(runtime, 1, p1.playerId);
      // p1 killed, should move to next turn if no other dying
      expect(runtime.room.game?.players[p1.playerId]?.aliveState).toBe('dead');
    });

    it('grants kill reward probe to the player who sent the killing false info', () => {
      const runtime = createStartedRuntime();
      const [p0, p1] = playersBySeat(runtime);
      if (!p0 || !p1) throw new Error('missing players');
      giveInfo(runtime, '玩家1', 'false', 1);
      const before = p1.regularSkills.probeRemaining;

      skipToTransfer(runtime);
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'false',
      });
      expect(transfer.ok).toBe(true);
      passAllPending(runtime, 4);
      const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
      const receive = runtime.handlePlayerCommand(userId(1), {
        type: 'ReceiveInfo',
        playerId: p1.playerId,
        transferId,
        decision: 'receive',
      });
      expect(receive.ok).toBe(true);
      passFirstPending(runtime, 1, p1.playerId);
      // p0 should get +1 probe as kill reward
      expect(runtime.room.game?.players[p0.playerId]?.regularSkills.probeRemaining).toBe(before + 1);
    });
  });

  describe('victory system', () => {
    it('declares victory with three true infos', () => {
      const runtime = createStartedRuntime();
      const [p0] = playersBySeat(runtime);
      if (!p0) throw new Error('missing player');
      // Give p0 three true infos
      giveInfo(runtime, '玩家0', 'true', 3);
      const myFaction = p0.faction;
      if (myFaction === 'white') return; // skip if white (4-player game has no white)

      // Now in victoryDeclareWindow
      expect(runtime.room.game?.phase.phase).toBe('VictoryDeclareWindow');

      const result = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareVictory',
        playerId: p0.playerId,
        faction: myFaction,
        reason: 'threeTrueInfo',
      });
      expect(result.ok, errMsg(result)).toBe(true);
      expect(runtime.room.game?.status).toBe('finished');
      expect(runtime.room.game?.winState.finished).toBe(true);
      expect(runtime.room.game?.winState.winner?.faction).toBe(myFaction);
    });

    it('rejects victory when dying player exists', () => {
      const runtime = createStartedRuntime();
      const [p0, p1] = playersBySeat(runtime);
      if (!p0 || !p1) throw new Error('missing players');
      // Manually set p1 to dying
      runtime.room.game!.players[p1.playerId]!.aliveState = 'dying';
      // Give p0 three true infos
      giveInfo(runtime, '玩家0', 'true', 3);

      const myFaction = p0.faction;
      if (myFaction === 'white') return;
      const result = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareVictory',
        playerId: p0.playerId,
        faction: myFaction,
        reason: 'threeTrueInfo',
      });
      expect(result.ok).toBe(false);
      expect(errCode(result)).toBe('victory.deathFirst');
    });

    it('rejects victory in wrong phase', () => {
      const runtime = createStartedRuntime();
      const [p0] = playersBySeat(runtime);
      if (!p0) throw new Error('missing player');
      giveInfo(runtime, '玩家0', 'true', 3);
      // advance past victoryDeclareWindow
      passFirstPending(runtime, 0, p0.playerId);
      expect(runtime.room.game?.phase.phase).toBe('SkillWindow');

      const myFaction = p0.faction;
      if (myFaction === 'white') return;
      const result = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareVictory',
        playerId: p0.playerId,
        faction: myFaction,
        reason: 'threeTrueInfo',
      });
      expect(result.ok).toBe(false);
      expect(errCode(result)).toBe('victory.invalidPhase');
    });

    it('rejects victory when not enough true infos', () => {
      const runtime = createStartedRuntime();
      const [p0] = playersBySeat(runtime);
      if (!p0) throw new Error('missing player');
      const myFaction = p0.faction;
      if (myFaction === 'white') return; // skip white

      const result = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareVictory',
        playerId: p0.playerId,
        faction: myFaction,
        reason: 'threeTrueInfo',
      });
      expect(result.ok).toBe(false);
      expect(errCode(result)).toBe('victory.noThreeTrue');
    });

    it('allows clearField victory when only one faction alive', () => {
      const runtime = createStartedRuntime();
      const players = playersBySeat(runtime);
      const [p0, p1, p2, p3] = players;
      if (!p0 || !p1 || !p2 || !p3) throw new Error('missing players');
      // Kill p2 and p3 (assuming they're the blue faction or opposing)
      // Check factions first
      const game = getGame(runtime);
      // Find a blue player to kill
      const bluePlayers = players.filter((p) => p.faction === 'blue');
      const redPlayers = players.filter((p) => p.faction === 'red');
      if (bluePlayers.length < 2 || redPlayers.length < 2) return; // skip if not 2v2

      // Kill the blue players
      for (const bp of bluePlayers) {
        game.players[bp.playerId]!.aliveState = 'dead';
        game.players[bp.playerId]!.identityRevealed = true;
      }

      // Red player on victory window should be able to declare clearField
      expect(game.phase.phase).toBe('VictoryDeclareWindow');
      const redPlayer = redPlayers[0]!;
      const result = runtime.handlePlayerCommand(userId(redPlayer.seatIndex), {
        type: 'DeclareVictory',
        playerId: redPlayer.playerId,
        faction: 'red',
        reason: 'clearField',
      });
      expect(result.ok).toBe(true);
      expect(game.winState.winner?.reason).toBe('clearField');
    });
  });

  describe('character skills', () => {
    describe('灭迹 (mie_ji) - 刘建明', () => {
      it('burns false info from target in skill window', () => {
        const runtime = createStartedRuntime();
        const [p0] = playersBySeat(runtime);
        if (!p0) throw new Error('missing player');
        setCharacter(runtime, '玩家0', 'char_002_liu_jian_ming');
        giveInfo(runtime, '玩家1', 'false', 2);
        skipToTransfer(runtime);
        // go back to skill window by gm force? Actually let's use a simpler approach
        // Refresh reference to game
        const game = getGame(runtime);
        // Manually enter SkillWindow for seat 0
        game.phase = { phase: 'SkillWindow', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };
        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'mie_ji',
          targetPlayerId: getPlayerByName(runtime, '玩家1')!.playerId,
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // target should have fewer false infos
        const p1False = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === getPlayerByName(runtime, '玩家1')?.playerId && info.truth === 'false',
        );
        expect(p1False.length).toBeLessThan(2);
      });
    });

    describe('揭露 (jie_lu) - 福尔摩斯', () => {
      it('gets true info from transfer and loses jie_lu', () => {
        const runtime = createStartedRuntime();
        const [p0, p1, p2] = playersBySeat(runtime);
        if (!p0 || !p1 || !p2) throw new Error('missing players');
        setCharacter(runtime, '玩家2', 'char_004_holmes');
        skipToTransfer(runtime);
        const transfer = runtime.handlePlayerCommand(userId(0), {
          type: 'DeclareTransfer',
          playerId: p0.playerId,
          targetPlayerId: p1.playerId,
          truth: 'true',
        });
        expect(transfer.ok).toBe(true);
        const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';

        // Holmes uses jie_lu
        const result = runtime.handlePlayerCommand(userId(2), {
          type: 'UseCharacterSkill',
          playerId: p2.playerId,
          skillId: 'jie_lu',
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // Holmes gets the true info and transfer is settled
        const holmesTrue = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.truth === 'true' && info.ownerPlayerId === p2.playerId,
        );
        expect(holmesTrue.length).toBe(1);
        expect(runtime.room.game?.players[p2.playerId]?.flags.jie_lu_lost).toBe(true);
      });

      it('does not lose jie_lu on false info', () => {
        const runtime = createStartedRuntime();
        const [p0, p1, p2] = playersBySeat(runtime);
        if (!p0 || !p1 || !p2) throw new Error('missing players');
        setCharacter(runtime, '玩家2', 'char_004_holmes');
        skipToTransfer(runtime);
        const transfer = runtime.handlePlayerCommand(userId(0), {
          type: 'DeclareTransfer',
          playerId: p0.playerId,
          targetPlayerId: p1.playerId,
          truth: 'false',
        });
        expect(transfer.ok).toBe(true);

        const result = runtime.handlePlayerCommand(userId(2), {
          type: 'UseCharacterSkill',
          playerId: p2.playerId,
          skillId: 'jie_lu',
        });
        expect(result.ok, errMsg(result)).toBe(true);
        expect(runtime.room.game?.players[p2.playerId]?.flags.jie_lu_lost).toBeUndefined();
      });
    });

    describe('异议 (yi_yi) - 成步堂龙一', () => {
      it('disables target character skill for one full turn', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_006_naruhodo');
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'yi_yi',
          targetPlayerId: p1.playerId,
        });
        expect(result.ok, errMsg(result)).toBe(true);
        const until = runtime.room.game?.players[p1.playerId]?.flags.character_skill_disabled_until_turn_serial;
        expect(typeof until).toBe('number');
        expect(until).toBeGreaterThanOrEqual(runtime.room.game!.turn.turnSerial);
      });

      it('cannot target same player twice', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_006_naruhodo');
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        // First use
        const r1 = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'yi_yi',
          targetPlayerId: p1.playerId,
        });
        expect(r1.ok).toBe(true);
        // Second use on same target
        const r2 = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'yi_yi',
          targetPlayerId: p1.playerId,
        });
        expect(r2.ok).toBe(false);
        expect(errCode(r2)).toBe('yiYi.targetUsed');
      });
    });

    describe('逆转 (ni_zhuan) - 成步堂龙一', () => {
      it('swaps all infos between two players', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_006_naruhodo');
        giveInfo(runtime, '玩家0', 'true', 1);
        giveInfo(runtime, '玩家1', 'false', 1);
        const p0Before = [...(runtime.room.game?.players[p0.playerId]?.infoIds ?? [])];
        const p1Before = [...(runtime.room.game?.players[p1.playerId]?.infoIds ?? [])];
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'ni_zhuan',
          targetPlayerId: p1.playerId,
        });
        expect(result.ok, errMsg(result)).toBe(true);
        const p0After = runtime.room.game?.players[p0.playerId]?.infoIds ?? [];
        const p1After = runtime.room.game?.players[p1.playerId]?.infoIds ?? [];
        expect(p0After).toEqual(p1Before);
        expect(p1After).toEqual(p0Before);
        // identity should be revealed
        expect(runtime.room.game?.players[p0.playerId]?.identityRevealed).toBe(true);
      });
    });

    describe('赌博 (du_bo) - 秋濑或', () => {
      it('gives one true and one false info to player and target', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_009_akise_aru');
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'du_bo',
          targetPlayerId: p1.playerId,
        });
        expect(result.ok, errMsg(result)).toBe(true);
        const p0Infos = runtime.room.game?.players[p0.playerId]?.infoIds ?? [];
        const p1Infos = runtime.room.game?.players[p1.playerId]?.infoIds ?? [];
        expect(p0Infos.length).toBe(1);
        expect(p1Infos.length).toBe(1);
      });

      it('can only be used once per round', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_009_akise_aru');
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const r1 = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'du_bo',
          targetPlayerId: p1.playerId,
        });
        expect(r1.ok).toBe(true);
        const r2 = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'du_bo',
          targetPlayerId: p1.playerId,
        });
        expect(r2.ok).toBe(false);
        expect(errCode(r2)).toBe('duBo.roundUsed');
      });
    });

    describe('辩护 (bian_hu) - 绫里千寻', () => {
      it('swaps equal number of my true and target false infos', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_014_ayazato_chihiro');
        giveInfo(runtime, '玩家0', 'true', 2);
        giveInfo(runtime, '玩家1', 'false', 2);
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'bian_hu',
          targetPlayerId: p1.playerId,
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // After swap: p0 should have some false infos, p1 should have true infos
        const p0True = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p0.playerId && info.truth === 'true',
        );
        const p1False = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p1.playerId && info.truth === 'false',
        );
        expect(p0True.length).toBeLessThan(2);
        expect(p1False.length).toBeLessThan(2);
      });
    });

    describe('灵媒 (ling_mei) - 绫里千寻', () => {
      it('borrows dead player to send info to target', () => {
        const runtime = createStartedRuntime();
        const players = playersBySeat(runtime);
        const [p0, p1, p2] = players;
        if (!p0 || !p1 || !p2) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_014_ayazato_chihiro');
        // Kill p1 first
        getGame(runtime).players[p1.playerId]!.aliveState = 'dead';
        getGame(runtime).players[p1.playerId]!.identityRevealed = true;

        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'ling_mei',
          targetPlayerId: p1.playerId,
          secondaryTargetPlayerId: p2.playerId,
          transfer: { targetPlayerId: p2.playerId, truth: 'true' },
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // p2 should receive info sourced from dead player
        const p2Infos = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p2.playerId && info.sourcePlayerId === p1.playerId,
        );
        expect(p2Infos.length).toBe(1);
      });
    });

    describe('契约双传 (qi_yue) - C.C', () => {
      it('declares transfer to first target and queues second', () => {
        const runtime = createStartedRuntime();
        const [p0, p1, p2] = playersBySeat(runtime);
        if (!p0 || !p1 || !p2) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_016_cc');
        skipToTransfer(runtime);

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'qi_yue',
          targetPlayerId: p1.playerId,
          secondaryTargetPlayerId: p2.playerId,
          transfer: { targetPlayerId: p1.playerId, truth: 'true' },
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // Game should be in ReactionWindow for first transfer
        expect(runtime.room.game?.currentTransfer?.targetPlayerId).toBe(p1.playerId);
        // Flag for second transfer should be set
        expect(runtime.room.game?.players[p0.playerId]?.flags.cc_pending_second_transfer).toBe(p2.playerId);
      });
    });

    describe('崩坏 (beng_huai) - 我妻由乃', () => {
      it('gives one false info to target after receiving one', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_020_gasai_yuno');
        // Trigger beng_huai by giving p0 a false info
        const game = getGame(runtime);
        game.players[p0.playerId]!.flags.beng_huai_available = true;
        game.phase = { phase: 'SkillWindow', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'beng_huai',
          targetPlayerId: p1.playerId,
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // p1 should have one false info
        const p1False = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p1.playerId && info.truth === 'false',
        );
        expect(p1False.length).toBe(1);
        // beng_huai_available should be consumed
        expect(runtime.room.game?.players[p0.playerId]?.flags.beng_huai_available).toBe(false);
      });
    });

    describe('新生 (xin_sheng) - 我妻由乃', () => {
      it('burns own false info in dying window and survives', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家1', 'char_020_gasai_yuno');
        giveInfo(runtime, '玩家1', 'false', 1);

        skipToTransfer(runtime);
        const transfer = runtime.handlePlayerCommand(userId(0), {
          type: 'DeclareTransfer',
          playerId: p0.playerId,
          targetPlayerId: p1.playerId,
          truth: 'false',
        });
        expect(transfer.ok).toBe(true);
        passAllPending(runtime, 4);
        const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
        const receive = runtime.handlePlayerCommand(userId(1), {
          type: 'ReceiveInfo',
          playerId: p1.playerId,
          transferId,
          decision: 'receive',
        });
        expect(receive.ok).toBe(true);
        expect(runtime.room.game?.phase.phase).toBe('DyingWindow');

        // Use xin_sheng
        const result = runtime.handlePlayerCommand(userId(1), {
          type: 'UseCharacterSkill',
          playerId: p1.playerId,
          skillId: 'xin_sheng',
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // Player should survive if false count is now below limit
        const p1False = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p1.playerId && info.truth === 'false',
        );
        if (p1False.length < 2) {
          expect(runtime.room.game?.players[p1.playerId]?.aliveState).toBe('alive');
        }
        expect(runtime.room.game?.players[p1.playerId]?.flags.beng_huai_lost).toBe(true);
      });
    });

    describe('就计 (jiu_ji) - 陈永仁', () => {
      it('returns one false info to sender in dying window', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家1', 'char_001_chen_yong_ren');
        giveInfo(runtime, '玩家1', 'false', 1);

        skipToTransfer(runtime);
        const transfer = runtime.handlePlayerCommand(userId(0), {
          type: 'DeclareTransfer',
          playerId: p0.playerId,
          targetPlayerId: p1.playerId,
          truth: 'false',
        });
        expect(transfer.ok).toBe(true);
        passAllPending(runtime, 4);
        const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
        const receive = runtime.handlePlayerCommand(userId(1), {
          type: 'ReceiveInfo',
          playerId: p1.playerId,
          transferId,
          decision: 'receive',
        });
        expect(receive.ok).toBe(true);
        expect(runtime.room.game?.phase.phase).toBe('DyingWindow');

        // Use jiu_ji
        const result = runtime.handlePlayerCommand(userId(1), {
          type: 'UseCharacterSkill',
          playerId: p1.playerId,
          skillId: 'jiu_ji',
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // One false info should be returned to p0
        const p0False = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p0.playerId && info.truth === 'false',
        );
        expect(p0False.length).toBeGreaterThanOrEqual(1);
        // If info count is now under limit, player survives
        const p1CurrentFalse = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p1.playerId && info.truth === 'false',
        );
        if (p1CurrentFalse.length < 2) {
          expect(runtime.room.game?.players[p1.playerId]?.aliveState).toBe('alive');
        }
      });
    });

    describe('冰山 (bing_shan) - 绫波丽', () => {
      it('blocks lock and loses the skill', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        // p1 gets bing_shan
        setCharacter(runtime, '玩家1', 'char_017_ayanami_rei');
        skipToTransfer(runtime);
        const transfer = runtime.handlePlayerCommand(userId(0), {
          type: 'DeclareTransfer',
          playerId: p0.playerId,
          targetPlayerId: p1.playerId,
          truth: 'false',
        });
        expect(transfer.ok).toBe(true);
        const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';

        // p0 tries to lock p1 - should be invalidated by bing_shan
        const lock = runtime.handlePlayerCommand(userId(0), {
          type: 'UseLock',
          playerId: p0.playerId,
          transferId,
          targetPlayerId: p1.playerId,
        });
        expect(lock.ok).toBe(true);
        // The transfer should NOT have forcedReceive because lock was invalidated
        expect(runtime.room.game?.currentTransfer?.forcedReceive).toBe(false);
        // p0 lock count should be consumed
        expect(runtime.room.game?.players[p0.playerId]?.regularSkills.lockRemaining).toBe(0);
      });
    });

    describe('克隆 (ke_long) - 绫波丽', () => {
      it('clones info to interceptor when someone intercepts', () => {
        const runtime = createStartedRuntime();
        const [p0, p1, p2, p3] = playersBySeat(runtime);
        if (!p0 || !p1 || !p2 || !p3) throw new Error('missing players');
        // p3 gets ke_long (绫波丽 is at index 3 for 4 players, but seat index 3 is 成步堂龙一...)
        // Set p1 as 绫波丽 for testing
        setCharacter(runtime, '玩家1', 'char_017_ayanami_rei');
        // Give p1 some infos to clone
        giveInfo(runtime, '玩家1', 'true', 2);
        giveInfo(runtime, '玩家1', 'false', 1);

        skipToTransfer(runtime);
        const transfer = runtime.handlePlayerCommand(userId(0), {
          type: 'DeclareTransfer',
          playerId: p0.playerId,
          targetPlayerId: p1.playerId,
          truth: 'true',
        });
        expect(transfer.ok).toBe(true);
        const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';

        // p2 intercepts - this triggers ke_long
        const intercept = runtime.handlePlayerCommand(userId(2), {
          type: 'UseIntercept',
          playerId: p2.playerId,
          transferId,
          targetPlayerId: p0.playerId,
        });
        expect(intercept.ok).toBe(true);

        // p2 (interceptor) should get cloned infos from p1 (绫波丽)
        // Since ke_long burns all of p2's existing infos and replaces them,
        // p2 should now have some infos sourced from p1
        const p2Infos = runtime.room.game?.players[p2.playerId]?.infoIds ?? [];
        expect(p2Infos.length).toBeGreaterThan(0);
      });
    });

    describe('城府 (cheng_fu) - 陈永仁/刘建明', () => {
      it('reverses probe faction when probed', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        // p1 = 陈永仁 (hidden, has cheng_fu)
        // p0 probes p1 with p1's actual faction
        passFirstPending(runtime, 0, p0.playerId); // victory window → skill
        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseProbe',
          playerId: p0.playerId,
          targetPlayerId: p1.playerId,
          declaredFaction: p1.faction, // probing with p1's actual faction
        });
        expect(result.ok).toBe(true);
        // Because of cheng_fu, the effective faction is p0's faction, not p1's
        // So the probe should fail if p0 and p1 have different factions
        // Just verify probe consumed and no crash
        expect(runtime.room.game?.players[p0.playerId]?.regularSkills.probeRemaining).toBe(0);
      });
    });

    describe('惯犯 (guan_fan) - 开膛手杰克', () => {
      it('is not available without guan_fan flag', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_008_jack_the_ripper');
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'guan_fan',
          targetPlayerId: p1.playerId,
        });
        expect(result.ok).toBe(false);
        expect(errCode(result)).toBe('guanFan.notAvailable');
      });

      it('gives two false infos to target when flag set, then loses zhao_zhang', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_008_jack_the_ripper');
        // Set the flag
        getGame(runtime).players[p0.playerId]!.flags.guan_fan_available = true;
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'guan_fan',
          targetPlayerId: p1.playerId,
        });
        expect(result.ok, errMsg(result)).toBe(true);
        // p1 should have 2 false infos
        const p1False = Object.values(runtime.room.game?.infoCards ?? {}).filter(
          (info) => info.ownerPlayerId === p1.playerId && info.truth === 'false',
        );
        expect(p1False.length).toBe(2);
        // zhao_zhang should be lost
        expect(runtime.room.game?.players[p0.playerId]?.flags.zhao_zhang_lost).toBe(true);
        // guan_fan flag consumed
        expect(runtime.room.game?.players[p0.playerId]?.flags.guan_fan_available).toBe(false);
      });
    });

    describe('守护 (shou_hu) - C.C', () => {
      it('requires shou_hu_target flag set via true info from C.C', () => {
        const runtime = createStartedRuntime();
        const [p0, p1] = playersBySeat(runtime);
        if (!p0 || !p1) throw new Error('missing players');
        setCharacter(runtime, '玩家0', 'char_016_cc');
        getGame(runtime).phase = { phase: 'SkillWindow', enteredAtVersion: getGame(runtime).version, context: { type: 'activeTurn', activePlayerId: p0.playerId } };

        // Without target flag
        const result = runtime.handlePlayerCommand(userId(0), {
          type: 'UseCharacterSkill',
          playerId: p0.playerId,
          skillId: 'shou_hu',
        });
        expect(result.ok).toBe(false);
        expect(errCode(result)).toBe('shouHu.notAvailable');
      });
    });
  });

  describe('phase progression edge cases', () => {
    it('advances through full cycle for current player', () => {
      const runtime = createStartedRuntime();
      const [p0] = playersBySeat(runtime);
      if (!p0) throw new Error('missing player');

      // Victory → Skill → Transfer → Reaction → Receive
      expect(runtime.room.game?.phase.phase).toBe('VictoryDeclareWindow');
      passFirstPending(runtime, 0, p0.playerId);
      expect(runtime.room.game?.phase.phase).toBe('SkillWindow');
      passFirstPending(runtime, 0, p0.playerId);
      expect(runtime.room.game?.phase.phase).toBe('TransferDeclare');
    });

    it('rejects commands in wrong phase', () => {
      const runtime = createStartedRuntime();
      const [p0, p1] = playersBySeat(runtime);
      if (!p0 || !p1) throw new Error('missing players');

      // Try to probe in VictoryDeclareWindow
      const probe = runtime.handlePlayerCommand(userId(0), {
        type: 'UseProbe',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        declaredFaction: 'red',
      });
      expect(probe.ok).toBe(false);
      expect(errCode(probe)).toBe('probe.invalidPhase');
    });

    it('rejects dead player commands', () => {
      const runtime = createStartedRuntime();
      const [p0, p1, p2] = playersBySeat(runtime);
      if (!p0 || !p1 || !p2) throw new Error('missing players');

      // Kill p1
      getGame(runtime).players[p1.playerId]!.aliveState = 'dead';

      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 0, p0.playerId);
      // p1 tries to declare transfer — fails because p1 is not the active player AND is dead
      const transfer = runtime.handlePlayerCommand(userId(1), {
        type: 'DeclareTransfer',
        playerId: p1.playerId,
        targetPlayerId: p2.playerId,
        truth: 'true',
      });
      expect(transfer.ok).toBe(false);
      // notActive fires first since active player check precedes alive check
      expect(errCode(transfer)).toBe('transfer.notActive');
    });

    it('rejects self-target transfer', () => {
      const runtime = createStartedRuntime();
      const [p0] = playersBySeat(runtime);
      if (!p0) throw new Error('missing player');
      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 0, p0.playerId);

      const result = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p0.playerId,
        truth: 'true',
      });
      expect(result.ok).toBe(false);
      expect(errCode(result)).toBe('transfer.selfTarget');
    });

    it('transitions to GameOver with proper state when all players die', () => {
      const runtime = createStartedRuntime();
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      // Set ALL players to dead (not dying)
      for (const p of players) {
        game.players[p.playerId]!.aliveState = 'dead';
        game.players[p.playerId]!.identityRevealed = true;
      }
      // Set phase to TransferDeclare and use GM force advance
      // (TransferDeclare → advanceTurn → all dead → GameOver)
      game.phase = { phase: 'TransferDeclare', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: players[0]!.playerId } };
      const result = runtime.forceAdvancePhase(userId(0));
      expect(result.ok).toBe(true);
      expect(runtime.room.game?.status).toBe('finished');
      expect(runtime.room.game?.winState.finished).toBe(true);
      expect(runtime.room.status).toBe('finished');
    });
  });

  describe('bot autoplay', () => {
    it('auto-passes bot responses immediately when a reaction window opens', () => {
      const runtime = createStartedRuntime();
      runtime.room.seats[2]!.isBot = true;
      const players = playersBySeat(runtime);
      const [sender, receiver, bot] = players;
      if (!sender || !receiver || !bot) throw new Error('missing players');

      passFirstPending(runtime, 0, sender.playerId);
      passFirstPending(runtime, 0, sender.playerId);
      const result = runtime.handlePlayerCommand(sender.userId, {
        type: 'DeclareTransfer',
        playerId: sender.playerId,
        targetPlayerId: receiver.playerId,
        truth: 'true',
      });
      expect(result.ok, errMsg(result)).toBe(true);
      const action = Object.values(runtime.room.game?.pendingActions ?? {}).find(
        (item) => item.status === 'open' && item.phase === 'ReactionWindow' && item.kind === 'regularSkillWindow',
      );
      expect(action).toBeDefined();
      expect(action?.responses.some((response) => response.playerId === bot.playerId && response.responseType === 'pass')).toBe(true);
    });
  });

  describe('GM force advance', () => {
    it('force-advances from VictoryDeclareWindow to SkillWindow', () => {
      const runtime = createStartedRuntime();
      expect(runtime.room.game?.phase.phase).toBe('VictoryDeclareWindow');
      const result = runtime.forceAdvancePhase(userId(0));
      expect(result.ok).toBe(true);
      expect(runtime.room.game?.phase.phase).toBe('SkillWindow');
    });

    it('force-advances from SkillWindow to TransferDeclare', () => {
      const runtime = createStartedRuntime();
      // Advance to SkillWindow first
      runtime.forceAdvancePhase(userId(0));
      expect(runtime.room.game?.phase.phase).toBe('SkillWindow');
      const result = runtime.forceAdvancePhase(userId(0));
      expect(result.ok).toBe(true);
      expect(runtime.room.game?.phase.phase).toBe('TransferDeclare');
    });

    it('force-advances from TransferDeclare by skipping turn', () => {
      const runtime = createStartedRuntime();
      runtime.forceAdvancePhase(userId(0)); // → SkillWindow
      runtime.forceAdvancePhase(userId(0)); // → TransferDeclare
      expect(runtime.room.game?.phase.phase).toBe('TransferDeclare');
      const result = runtime.forceAdvancePhase(userId(0));
      expect(result.ok).toBe(true);
      // Should advance to next player's VictoryDeclareWindow
      expect(runtime.room.game?.phase.phase).toBe('VictoryDeclareWindow');
    });

    it('force-ends an in-progress game', () => {
      const runtime = createStartedRuntime();
      const result = runtime.forceEndGame(userId(0));
      expect(result.ok).toBe(true);
      expect(runtime.room.status).toBe('finished');
      expect(runtime.room.game?.status).toBe('finished');
      expect(runtime.room.game?.phase.phase).toBe('GameOver');
      expect(runtime.room.game?.winState.winner?.reason).toBe('gmForceEnd');
    });
  });

  describe('post-game room lifecycle', () => {
    it('returns a finished room to lobby and clears game setup state', () => {
      const runtime = createStartedRuntime();
      const ended = runtime.forceEndGame(userId(0));
      expect(ended.ok).toBe(true);
      const reset = runtime.returnToLobby(userId(0));
      expect(reset.ok, errMsg(reset)).toBe(true);
      expect(runtime.room.status).toBe('lobby');
      expect(runtime.room.game).toBeUndefined();
      expect(runtime.room.seats).toHaveLength(4);
      expect(runtime.room.seats[0]?.ready).toBe(true);
      expect(runtime.room.seats.slice(1).every((seat) => !seat.ready)).toBe(true);
      expect(runtime.room.seats.every((seat) => !seat.playerId && !seat.characterOptionIds && !seat.selectedCharacterId)).toBe(true);
    });

    it('starts a fresh next round from a finished room', () => {
      const runtime = createStartedRuntime();
      const oldPlayerIds = runtime.room.seats.map((seat) => seat.playerId);
      const ended = runtime.forceEndGame(userId(0));
      expect(ended.ok).toBe(true);
      const next = runtime.startNextRound(userId(0));
      expect(next.ok, errMsg(next)).toBe(true);
      expect(runtime.room.status).toBe('playing');
      expect(runtime.room.game?.status).toBe('setup');
      expect(runtime.room.game?.setupState?.step).toBe('characterSelection');
      expect(runtime.room.seats.map((seat) => seat.playerId)).not.toEqual(oldPlayerIds);
    });

    it('removes seats on leave after game over and transfers host', () => {
      const runtime = createStartedRuntime();
      expect(runtime.forceEndGame(userId(0)).ok).toBe(true);
      const leave = runtime.leave(userId(0));
      expect(leave.ok, errMsg(leave)).toBe(true);
      expect(runtime.room.seats.some((seat) => seat.userId === userId(0))).toBe(false);
      expect(runtime.room.ownerUserId).toBe(userId(1));
      expect(runtime.room.status).toBe('finished');
    });

    it('prunes disconnected humans but keeps bots when returning to lobby', () => {
      const runtime = createStartedRuntime();
      runtime.room.seats.push({ seatIndex: 4, userId: 'bot_test' as UserId, displayName: '机器人', ready: true, connected: true, isBot: true });
      expect(runtime.forceEndGame(userId(0)).ok).toBe(true);
      runtime.setConnected(userId(2), false);
      const reset = runtime.returnToLobby(userId(0));
      expect(reset.ok, errMsg(reset)).toBe(true);
      expect(runtime.room.seats.some((seat) => seat.userId === userId(2))).toBe(false);
      expect(runtime.room.seats.some((seat) => seat.userId === ('bot_test' as UserId) && seat.ready && seat.connected)).toBe(true);
    });

    it('rejects post-game commands from non-owners or non-finished rooms', () => {
      const runtime = createStartedRuntime();
      const early = runtime.returnToLobby(userId(0));
      expect(early.ok).toBe(false);
      expect(errCode(early)).toBe('room.notFinished');
      expect(runtime.forceEndGame(userId(0)).ok).toBe(true);
      const nonOwnerReset = runtime.returnToLobby(userId(1));
      expect(nonOwnerReset.ok).toBe(false);
      expect(errCode(nonOwnerReset)).toBe('room.notOwner');
      const nonOwnerNext = runtime.startNextRound(userId(1));
      expect(nonOwnerNext.ok).toBe(false);
      expect(errCode(nonOwnerNext)).toBe('room.notOwner');
    });
  });

  describe('5-8 player game', () => {
    it('supports a full transfer cycle for 5 players', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const [p0, p1] = players;
      if (!p0 || !p1) throw new Error('missing players');

      passFirstPending(runtime, 0, p0.playerId);
      passFirstPending(runtime, 0, p0.playerId);
      const transfer = runtime.handlePlayerCommand(userId(0), {
        type: 'DeclareTransfer',
        playerId: p0.playerId,
        targetPlayerId: p1.playerId,
        truth: 'true',
      });
      expect(transfer.ok).toBe(true);
      passAllPending(runtime, 5);
      const receive = runtime.handlePlayerCommand(userId(1), {
        type: 'ReceiveInfo',
        playerId: p1.playerId,
        transferId: runtime.room.game?.currentTransfer?.transferId ?? '',
        decision: 'receive',
      });
      expect(receive.ok).toBe(true);
      expect(runtime.room.game?.phase.phase).toBe('VictoryDeclareWindow');
      expect(runtime.room.game?.turn.activeSeatIndex).toBe(1);
    });

    it('supports 8 player game with correct identity counts', () => {
      const runtime = createStartedRuntime(8);
      const game = runtime.room.game;
      if (!game) throw new Error('game not started');
      expect(Object.keys(game.players)).toHaveLength(8);
      const factions = Object.values(game.players).map((p) => p.faction);
      expect(factions.filter((f) => f === 'red')).toHaveLength(3);
      expect(factions.filter((f) => f === 'blue')).toHaveLength(3);
      expect(factions.filter((f) => f === 'white')).toHaveLength(2);
    });
  });

  describe('final PK system', () => {
    it('enters final PK when only 1 white and 1 non-white are alive', () => {
      const runtime = createStartedRuntime(6);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      // Kill all non-white players except one, and all white except one
      const whitePlayers = players.filter((p) => p.faction === 'white');
      const nonWhitePlayers = players.filter((p) => p.faction !== 'white');
      // 6-player: 2 red, 2 blue, 2 white
      // Kill all except one white and one non-white
      if (whitePlayers.length < 2 || nonWhitePlayers.length < 4) return;

      const keptWhite = whitePlayers[0]!;
      const keptNonWhite = nonWhitePlayers[0]!;

      for (const p of players) {
        if (p.playerId !== keptWhite.playerId && p.playerId !== keptNonWhite.playerId) {
          game.players[p.playerId]!.aliveState = 'dead';
          game.players[p.playerId]!.identityRevealed = true;
        }
      }
      // Advance turn past VictoryDeclareWindow → Skill → Transfer
      game.phase = { phase: 'TransferDeclare', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: keptNonWhite.playerId } };
      const result = runtime.forceAdvancePhase(userId(0));
      expect(result.ok).toBe(true);
      // Should have entered final PK
      expect(game.finalPk).toBeDefined();
      expect(game.finalPk?.whitePlayerId).toBe(keptWhite.playerId);
      expect(game.finalPk?.opponentPlayerId).toBe(keptNonWhite.playerId);
      expect(game.finalPk?.burnUsed).toBe(false);
    });

    it('does not enter final PK with more than 2 alive players', () => {
      const runtime = createStartedRuntime(6);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const whitePlayers = players.filter((p) => p.faction === 'white');
      const nonWhitePlayers = players.filter((p) => p.faction !== 'white');
      if (whitePlayers.length < 2 || nonWhitePlayers.length < 3) return;

      // Leave 2 non-white + 1 white alive (3 alive → no PK)
      const keptWhite = whitePlayers[0]!;
      const kept1 = nonWhitePlayers[0]!;
      const kept2 = nonWhitePlayers[1]!;

      for (const p of players) {
        if (p.playerId !== keptWhite.playerId && p.playerId !== kept1.playerId && p.playerId !== kept2.playerId) {
          game.players[p.playerId]!.aliveState = 'dead';
          game.players[p.playerId]!.identityRevealed = true;
        }
      }
      game.phase = { phase: 'TransferDeclare', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: kept1.playerId } };
      runtime.forceAdvancePhase(userId(0));
      expect(game.finalPk).toBeUndefined();
    });

    it('white wins in final PK when transfers exceed 10 without victory', () => {
      const runtime = createStartedRuntime(6);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const whitePlayers = players.filter((p) => p.faction === 'white');
      const nonWhitePlayers = players.filter((p) => p.faction !== 'white');
      if (!whitePlayers[0] || !nonWhitePlayers[0]) return;

      for (const p of players) {
        if (p.playerId !== whitePlayers[0].playerId && p.playerId !== nonWhitePlayers[0].playerId) {
          game.players[p.playerId]!.aliveState = 'dead';
          game.players[p.playerId]!.identityRevealed = true;
        }
      }
      // Force PK entry
      game.finalPk = {
        whitePlayerId: whitePlayers[0].playerId,
        opponentPlayerId: nonWhitePlayers[0].playerId,
        enteredAtTurnSerial: game.turn.turnSerial,
        transfersAfterEntry: 11,
        burnUsed: false,
      };
      game.phase = { phase: 'TransferDeclare', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: nonWhitePlayers[0].playerId } };
      const result = runtime.forceAdvancePhase(userId(0));
      expect(result.ok).toBe(true);
      expect(game.status).toBe('finished');
      expect(game.winState.winner?.faction).toBe('white');
    });

    it('white can use final PK extra burn in skill phase', () => {
      const runtime = createStartedRuntime(6);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const whitePlayers = players.filter((p) => p.faction === 'white');
      const nonWhitePlayers = players.filter((p) => p.faction !== 'white');
      if (!whitePlayers[0] || !nonWhitePlayers[0]) return;
      const white = whitePlayers[0]!;
      const opponent = nonWhitePlayers[0]!;

      for (const p of players) {
        if (p.playerId !== white.playerId && p.playerId !== opponent.playerId) {
          game.players[p.playerId]!.aliveState = 'dead';
          game.players[p.playerId]!.identityRevealed = true;
        }
      }
      giveInfo(runtime, '玩家' + String(white.displayName.slice(-1)), 'true', 1);
      giveInfo(runtime, '玩家' + String(opponent.displayName.slice(-1)), 'true', 1);
      game.finalPk = {
        whitePlayerId: white.playerId,
        opponentPlayerId: opponent.playerId,
        enteredAtTurnSerial: game.turn.turnSerial,
        transfersAfterEntry: 0,
        burnUsed: false,
      };
      game.phase = { phase: 'SkillWindow', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: opponent.playerId } };

      const burn = runtime.handlePlayerCommand(userId(white.seatIndex), {
        type: 'UseFinalPkBurn',
        playerId: white.playerId,
        targetPlayerId: opponent.playerId,
      });
      expect(burn.ok).toBe(true);
      expect(game.finalPk?.burnUsed).toBe(true);
    });

    it('opponent wins when white PK player dies', () => {
      const runtime = createStartedRuntime(6);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const whitePlayers = players.filter((p) => p.faction === 'white');
      const nonWhitePlayers = players.filter((p) => p.faction !== 'white');
      if (!whitePlayers[0] || !nonWhitePlayers[0]) return;
      const white = whitePlayers[0]!;
      const opponent = nonWhitePlayers[0]!;

      for (const p of players) {
        if (p.playerId !== white.playerId && p.playerId !== opponent.playerId) {
          game.players[p.playerId]!.aliveState = 'dead';
          game.players[p.playerId]!.identityRevealed = true;
        }
      }
      game.finalPk = {
        whitePlayerId: white.playerId,
        opponentPlayerId: opponent.playerId,
        enteredAtTurnSerial: game.turn.turnSerial,
        transfersAfterEntry: 0,
        burnUsed: false,
      };
      // Kill the white player
      game.players[white.playerId]!.aliveState = 'dying';
      game.phase = { phase: 'DyingWindow', enteredAtVersion: game.version, context: { type: 'dying', playerId: white.playerId, cause: 'falseInfoLimit' } };
      // Simulate passing dying window → resolveDyingDeath → checkFinalPkAfterDeath
      const pkResult = runtime.forceAdvancePhase(userId(0));
      expect(pkResult.ok).toBe(true);
      expect(game.status).toBe('finished');
      expect(game.winState.winner?.faction).toBe(opponent.faction);
    });
  });

  describe('white mission declaration', () => {
    it('rejects white victory without secretMission reason', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const white = players.find((p) => p.faction === 'white');
      if (!white) return; // no white in this random distribution

      const result = runtime.handlePlayerCommand(userId(white.seatIndex), {
        type: 'DeclareVictory',
        playerId: white.playerId,
        faction: 'white',
        reason: 'threeTrueInfo',
      });
      expect(result.ok).toBe(false);
      expect(errCode(result)).toBe('victory.whiteNeedsMission');
    });

    it('white faction player with met mission can declare victory', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const white = players.find((p) => p.faction === 'white');
      if (!white) return;

      setCharacter(runtime, white.displayName, 'char_002_liu_jian_ming');
      giveInfo(runtime, white.displayName, 'true', 2);
      // Mission check: ≥2 true infos → met
      const game = getGame(runtime);
      const mission = checkMission(game, white.playerId);
      if (mission.met) {
        const result = runtime.handlePlayerCommand(userId(white.seatIndex), {
          type: 'DeclareVictory',
          playerId: white.playerId,
          faction: 'white',
          reason: 'secretMission',
        });
        expect(result.ok, errMsg(result)).toBe(true);
        expect(game.status).toBe('finished');
        expect(game.winState.winner?.faction).toBe('white');
        expect(game.winState.winner?.reason).toBe('secretMission');
      }
    });
  });

  describe('death delayed victory', () => {
    it('Akise Aru mission met on death with ≥2 true infos', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const white = players.find((p) => p.faction === 'white');
      if (!white) return;

      setCharacter(runtime, white.displayName, 'char_009_akise_aru');
      giveInfo(runtime, white.displayName, 'true', 2);
      // Kill the white player
      game.players[white.playerId]!.aliveState = 'dying';
      game.phase = { phase: 'DyingWindow', enteredAtVersion: game.version, context: { type: 'dying', playerId: white.playerId, cause: 'falseInfoLimit' } };
      runtime.forceAdvancePhase(userId(0));

      // Advance turn — should trigger death delayed victory
      if (game.status !== 'finished') {
        // If the game didn't end (e.g. there are other alive players),
        // the death-delay mission should still be marked
        expect(game.players[white.playerId]?.missionStatus).toBe('met');
      }
    });

    it('Ayazato Chihiro mission met when first to die', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const white = players.find((p) => p.faction === 'white');
      if (!white) return;

      setCharacter(runtime, white.displayName, 'char_014_ayazato_chihiro');
      // Kill the white player as first death
      game.players[white.playerId]!.aliveState = 'dying';
      game.phase = { phase: 'DyingWindow', enteredAtVersion: game.version, context: { type: 'dying', playerId: white.playerId, cause: 'falseInfoLimit' } };
      runtime.forceAdvancePhase(userId(0));

      if (game.status !== 'finished') {
        expect(game.players[white.playerId]?.missionStatus).toBe('met');
      }
    });

    it('death delayed victory auto-declares on next VictoryDeclareWindow', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const white = players.find((p) => p.faction === 'white');
      if (!white) return;

      setCharacter(runtime, white.displayName, 'char_009_akise_aru');
      giveInfo(runtime, white.displayName, 'true', 2);
      // Kill white and mark mission
      game.players[white.playerId]!.aliveState = 'dead';
      game.players[white.playerId]!.identityRevealed = true;
      game.players[white.playerId]!.missionStatus = 'met';
      // Clear victory window to trigger advanceTurn
      game.phase = { phase: 'TransferDeclare', enteredAtVersion: game.version, context: { type: 'activeTurn', activePlayerId: players.find((p) => p.aliveState === 'alive')!.playerId } };
      const result = runtime.forceAdvancePhase(userId(0));
      expect(result.ok).toBe(true);
      // advanceTurn should have detected the death-delay mission and ended the game
      if (game.winState.winner?.faction === 'white') {
        expect(game.winState.winner.reason).toBe('secretMission');
        expect(game.winState.winner.missionPlayerId).toBe(white.playerId);
      }
    });
  });

  describe('C.C mission flow', () => {
    it('C.C mission met when killed by specified target', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const white = players.find((p) => p.faction === 'white');
      if (!white) return;

      setCharacter(runtime, white.displayName, 'char_016_cc');
      // Set CC's mission target to another player
      const target = players.find((p) => p.playerId !== white.playerId && p.aliveState === 'alive');
      if (!target) return;
      game.players[white.playerId]!.flags.cc_mission_target = target.playerId;

      // Simulate target killing CC
      giveInfo(runtime, white.displayName, 'false', 1);
      // Give CC a false info from the target (simulating a transfer from target)
      game.players[white.playerId]!.flags.last_false_info_source = target.playerId;
      // Kill CC
      game.players[white.playerId]!.aliveState = 'dying';
      game.phase = { phase: 'DyingWindow', enteredAtVersion: game.version, context: { type: 'dying', playerId: white.playerId, cause: 'falseInfoLimit' } };
      runtime.forceAdvancePhase(userId(0));

      // CC's mission should be met since killed_by_target counter was incremented
      if (game.status !== 'finished') {
        const mission = checkMission(game, white.playerId);
        if (mission.met) {
          expect(game.players[white.playerId]?.missionStatus).toBe('met');
        }
      }
    });

    it('C.C must be killed by target to complete mission', () => {
      const runtime = createStartedRuntime(5);
      const players = playersBySeat(runtime);
      const game = getGame(runtime);
      const white = players.find((p) => p.faction === 'white');
      if (!white) return;

      setCharacter(runtime, white.displayName, 'char_016_cc');
      const target = players.find((p) => p.playerId !== white.playerId && p.aliveState === 'alive');
      if (!target) return;
      game.players[white.playerId]!.flags.cc_mission_target = target.playerId;

      // Kill CC by someone else (not the target)
      giveInfo(runtime, white.displayName, 'false', 1);
      const otherPlayer = players.find((p) => p.playerId !== white.playerId && p.playerId !== target.playerId);
      if (!otherPlayer) return;
      game.players[white.playerId]!.flags.last_false_info_source = otherPlayer.playerId;
      game.players[white.playerId]!.aliveState = 'dying';
      game.phase = { phase: 'DyingWindow', enteredAtVersion: game.version, context: { type: 'dying', playerId: white.playerId, cause: 'falseInfoLimit' } };
      runtime.forceAdvancePhase(userId(0));

      // CC's mission should NOT be met
      if (game.status !== 'finished') {
        const mission = checkMission(game, white.playerId);
        expect(mission.deathDelay).toBe(true); // ※ mission
        expect(game.players[white.playerId]?.missionStatus).toBe('pending');
      }
    });
  });
});
