import { describe, expect, it } from 'vitest';
import type { GameState, Player } from '@wujian/shared';
import { createDefaultGameConfig } from '@wujian/shared';
import { toPublicGameView } from './public-view.js';

const makePlayer = (overrides: Partial<Player>): Player => ({
  playerId: overrides.playerId ?? ('player_a' as Player['playerId']),
  userId: overrides.userId ?? ('user_a' as Player['userId']),
  displayName: overrides.displayName ?? 'A',
  seatIndex: overrides.seatIndex ?? 0,
  faction: overrides.faction ?? 'red',
  identityRevealed: overrides.identityRevealed ?? false,
  characterVisibility: 'public',
  characterRevealed: false,
  gender: 'unknown',
  aliveState: 'alive',
  falseInfoLimit: 2,
  infoIds: [],
  regularSkills: { probeRemaining: 1, lockRemaining: 1, interceptRemaining: 1 },
  knownPartners: [],
  knownIdentities: [],
  flags: {},
  tags: [],
  ...overrides,
});

const createState = (): GameState => {
  const playerA = makePlayer({ playerId: 'player_a' as Player['playerId'], userId: 'user_a' as Player['userId'], faction: 'red', displayName: 'A' });
  const playerB = makePlayer({ playerId: 'player_b' as Player['playerId'], userId: 'user_b' as Player['userId'], faction: 'blue', displayName: 'B', seatIndex: 1 });

  return {
    roomId: 'ROOM01' as GameState['roomId'],
    config: createDefaultGameConfig(4),
    status: 'running',
    players: {
      [playerA.playerId]: playerA,
      [playerB.playerId]: playerB,
    },
    turn: { roundNumber: 1, activeSeatIndex: 0, turnSerial: 1 },
    phase: { phase: 'VictoryDeclareWindow', enteredAtVersion: 0, context: { type: 'activeTurn', activePlayerId: playerA.playerId } },
    infoCards: {},
    eventQueue: [],
    pendingActions: {},
    publicLog: [],
    deathQueue: [],
    winState: { finished: false },
    version: 1,
  };
};

describe('public-view', () => {
  it('shows own identity but hides unrevealed identities from others', () => {
    const view = toPublicGameView(createState(), 'user_a' as Player['userId']);
    const me = view.players.find((player) => player.userId === 'user_a');
    const other = view.players.find((player) => player.userId === 'user_b');

    expect(me?.revealedFaction).toBe('red');
    expect(other?.revealedFaction).toBeUndefined();
  });

  it('shows identity after death reveal flag is set', () => {
    const state = createState();
    const playerB = state.players['player_b' as Player['playerId']];
    if (!playerB) throw new Error('missing player B');
    playerB.identityRevealed = true;
    playerB.aliveState = 'dead';

    const view = toPublicGameView(state, 'user_a' as Player['userId']);
    const other = view.players.find((player) => player.userId === 'user_b');

    expect(other?.revealedFaction).toBe('blue');
  });
});
