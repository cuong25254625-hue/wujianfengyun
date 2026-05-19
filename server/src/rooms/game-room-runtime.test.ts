import { describe, expect, it } from 'vitest';
import type { PlayerId, UserId } from '@wujian/shared';
import { GameRoomRuntime } from './game-room-runtime.js';

const userId = (index: number) => `user_${index}` as UserId;

const createStartedRuntime = () => {
  const runtime = new GameRoomRuntime('ROOM01' as never, userId(0), '玩家0');
  for (let index = 1; index < 4; index += 1) {
    const result = runtime.join({ userId: userId(index), displayName: `玩家${index}` });
    expect(result.ok).toBe(true);
    const ready = runtime.setReady(userId(index), true);
    expect(ready.ok).toBe(true);
  }
  const started = runtime.startGame(userId(0));
  expect(started.ok).toBe(true);
  return runtime;
};

const createStartedRoom = () => createStartedRuntime().room.game;

const playersBySeat = (runtime: GameRoomRuntime) =>
  Object.values(runtime.room.game?.players ?? {}).sort((left, right) => left.seatIndex - right.seatIndex);

const passFirstPending = (runtime: GameRoomRuntime, userIndex: number, playerId: PlayerId) => {
  const pending = Object.values(runtime.room.game?.pendingActions ?? {}).find((action) => action.status === 'open' && action.eligiblePlayerIds.includes(playerId));
  expect(pending).toBeDefined();
  const result = runtime.handlePlayerCommand(userId(userIndex), { type: 'PassPendingAction', playerId, pendingActionId: pending!.pendingActionId });
  expect(result.ok).toBe(true);
};

describe('GameRoomRuntime', () => {
  it('records setup events when starting a game', () => {
    const game = createStartedRoom();
    if (!game) throw new Error('game did not start');

    expect(game.eventQueue.map((event) => event.type)).toEqual([
      'GameStarted',
      'IdentityAssigned',
      'CharacterAssigned',
      'IdentityAssigned',
      'CharacterAssigned',
      'IdentityAssigned',
      'CharacterAssigned',
      'IdentityAssigned',
      'CharacterAssigned',
      'PhaseChanged',
    ]);
    expect(game.version).toBe(game.eventQueue.length);
  });

  it('assigns MVP character placeholders in seat order', () => {
    const game = createStartedRoom();
    if (!game) throw new Error('game did not start');

    const players = Object.values(game.players).sort((left, right) => left.seatIndex - right.seatIndex);
    expect(players.map((player) => player.characterName)).toEqual(['陈永仁', '刘建明', '福尔摩斯', '成步堂龙一']);
    expect(players[0]?.characterVisibility).toBe('hidden');
    expect(players[0]?.characterRevealed).toBe(false);
    expect(players[2]?.characterVisibility).toBe('public');
    expect(players[2]?.characterRevealed).toBe(true);
    expect(players[0]?.characterImageUrl).toBe('/characters/陈永仁.png');
    expect(players[2]?.characterImageUrl).toBe('/characters/福尔摩斯.png');
  });

  it('grants Holmes an extra probe after receiving true info', () => {
    const runtime = createStartedRuntime();
    const [p0, , p2, p3] = playersBySeat(runtime);
    if (!p0 || !p2 || !p3) throw new Error('missing players');

    passFirstPending(runtime, 0, p0.playerId);
    passFirstPending(runtime, 0, p0.playerId);
    const before = p2.regularSkills.probeRemaining;
    const transfer = runtime.handlePlayerCommand(userId(0), { type: 'DeclareTransfer', playerId: p0.playerId, targetPlayerId: p2.playerId, truth: 'true' });
    expect(transfer.ok).toBe(true);
    const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
    passFirstPending(runtime, 0, p0.playerId);
    passFirstPending(runtime, 1, playersBySeat(runtime)[1]!.playerId);
    passFirstPending(runtime, 3, p3.playerId);
    const receive = runtime.handlePlayerCommand(userId(2), { type: 'ReceiveInfo', playerId: p2.playerId, transferId, decision: 'receive' });
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
    expect(Object.values(runtime.room.game?.infoCards ?? {}).filter((info) => info.ownerPlayerId === p1.playerId && info.truth === 'true')).toHaveLength(1);
    expect(runtime.room.game?.phase.phase).toBe('VictoryDeclareWindow');
    expect(runtime.room.game?.turn.activeSeatIndex).toBe(1);
  });

  it('resolves intercept before lock', () => {
    const runtime = createStartedRuntime();
    const [p0, p1, p2, p3] = playersBySeat(runtime);
    if (!p0 || !p1 || !p2 || !p3) throw new Error('missing players');

    passFirstPending(runtime, 0, p0.playerId);
    passFirstPending(runtime, 0, p0.playerId);
    const transfer = runtime.handlePlayerCommand(userId(0), { type: 'DeclareTransfer', playerId: p0.playerId, targetPlayerId: p1.playerId, truth: 'false' });
    expect(transfer.ok).toBe(true);
    const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';

    const lock = runtime.handlePlayerCommand(userId(0), { type: 'UseLock', playerId: p0.playerId, transferId, targetPlayerId: p1.playerId });
    expect(lock.ok).toBe(true);
    const intercept = runtime.handlePlayerCommand(userId(2), { type: 'UseIntercept', playerId: p2.playerId, transferId, targetPlayerId: p0.playerId });
    expect(intercept.ok).toBe(true);
    passFirstPending(runtime, 3, p3.playerId);

    expect(runtime.room.game?.currentTransfer?.finalReceiverPlayerId).toBe(p2.playerId);
    expect(runtime.room.game?.currentTransfer?.forcedReceive).toBe(false);
  });

  it('kills a player at false info limit and reveals identity', () => {
    const runtime = createStartedRuntime();
    const [p0, p1] = playersBySeat(runtime);
    if (!p0 || !p1) throw new Error('missing players');
    const game = runtime.room.game;
    if (!game) throw new Error('missing game');

    const existingFalseInfoId = 'info_a' as keyof typeof game.infoCards;
    game.infoCards[existingFalseInfoId] = { infoId: existingFalseInfoId, truth: 'false', ownerPlayerId: p1.playerId, public: true, createdBy: 'system', tags: [] };
    game.players[p1.playerId]?.infoIds.push(existingFalseInfoId);

    passFirstPending(runtime, 0, p0.playerId);
    passFirstPending(runtime, 0, p0.playerId);
    const transfer = runtime.handlePlayerCommand(userId(0), { type: 'DeclareTransfer', playerId: p0.playerId, targetPlayerId: p1.playerId, truth: 'false' });
    expect(transfer.ok).toBe(true);
    const transferId = runtime.room.game?.currentTransfer?.transferId ?? '';
    Object.values(runtime.room.game?.pendingActions ?? {}).find((action) => action.eligiblePlayerIds.includes(p0.playerId));
    for (const action of Object.values(runtime.room.game?.pendingActions ?? {})) {
      for (const pid of action.eligiblePlayerIds) {
        if (!action.responses.some((response) => response.playerId === pid)) {
          const userIndex = playersBySeat(runtime).findIndex((player) => player.playerId === pid);
          passFirstPending(runtime, userIndex, pid);
        }
      }
    }
    const receive = runtime.handlePlayerCommand(userId(1), { type: 'ReceiveInfo', playerId: p1.playerId, transferId, decision: 'receive' });
    expect(receive.ok).toBe(true);
    expect(runtime.room.game?.phase.phase).toBe('DyingWindow');
    passFirstPending(runtime, 1, p1.playerId);
    expect(runtime.room.game?.players[p1.playerId]?.aliveState).toBe('dead');
    expect(runtime.room.game?.players[p1.playerId]?.identityRevealed).toBe(true);
  });
});
