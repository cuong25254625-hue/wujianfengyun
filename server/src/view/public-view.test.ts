import { describe, expect, it } from 'vitest';
import type { GameRoom, GameState, Player } from '@wujian/shared';
import { createDefaultGameConfig } from '@wujian/shared';
import { toPublicGameView, toRoomView } from './public-view.js';

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
  missionStatus: 'pending',
  missionCounters: {},
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
    privateLogs: {},
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

  it('shows own skills while hiding unrevealed hidden character from others', () => {
    const state = createState();
    const playerA = state.players['player_a' as Player['playerId']];
    if (!playerA) throw new Error('missing player A');
    playerA.characterId = 'char_001_chen_yong_ren' as NonNullable<Player['characterId']>;
    playerA.characterName = '陈永仁';
    playerA.characterImageUrl = '/characters/陈永仁.png';
    playerA.characterVisibility = 'hidden';
    playerA.characterRevealed = false;

    const ownView = toPublicGameView(state, 'user_a' as Player['userId']);
    const ownPlayer = ownView.players.find((player) => player.userId === 'user_a');
    expect(ownPlayer?.characterName).toBe('陈永仁');
    expect(ownPlayer?.characterImageUrl).toBe('/characters/陈永仁.png');
    expect('ownSkills' in (ownPlayer ?? {})).toBe(true);
    expect((ownPlayer as { ownSkills?: unknown[] }).ownSkills?.length).toBeGreaterThan(0);

    const otherView = toPublicGameView(state, 'user_b' as Player['userId']);
    const hiddenPlayer = otherView.players.find((player) => player.userId === 'user_a');
    expect(hiddenPlayer?.characterName).toBeUndefined();
    expect(hiddenPlayer?.characterImageUrl).toBeUndefined();
    expect(hiddenPlayer?.characterSkills).toBeUndefined();
  });

  it('shows public character skills to other players', () => {
    const state = createState();
    const playerB = state.players['player_b' as Player['playerId']];
    if (!playerB) throw new Error('missing player B');
    playerB.characterId = 'char_004_holmes' as NonNullable<Player['characterId']>;
    playerB.characterName = '福尔摩斯';
    playerB.characterImageUrl = '/characters/福尔摩斯.png';
    playerB.characterVisibility = 'public';
    playerB.characterRevealed = true;

    const view = toPublicGameView(state, 'user_a' as Player['userId']);
    const publicPlayer = view.players.find((player) => player.userId === 'user_b');

    expect(publicPlayer?.characterName).toBe('福尔摩斯');
    expect(publicPlayer?.characterSkills?.map((skill) => skill.name)).toContain('真相');
  });

  it('builds system hints for the viewer without leaking hidden character names', () => {
    const state = createState();
    const playerA = state.players['player_a' as Player['playerId']];
    if (!playerA) throw new Error('missing player A');
    playerA.characterId = 'char_001_chen_yong_ren' as NonNullable<Player['characterId']>;
    playerA.characterName = '陈永仁';
    playerA.characterVisibility = 'hidden';

    const view = toPublicGameView(state, 'user_b' as Player['userId']);
    expect(view.systemHints.length).toBeGreaterThan(0);
    expect(view.systemHints.map((hint) => `${hint.title} ${hint.message}`).join('\n')).not.toContain('陈永仁');
  });

  it('only exposes private character options to the owning user during setup selection', () => {
    const state = createState();
    state.status = 'setup';
    state.phase = { phase: 'Setup', enteredAtVersion: 0, context: { type: 'none' } };
    const room: GameRoom = {
      roomId: 'ROOM01' as GameRoom['roomId'],
      status: 'playing',
      ownerUserId: 'user_a' as Player['userId'],
      createdAt: 1,
      updatedAt: 1,
      game: state,
      seats: [
        {
          seatIndex: 0,
          userId: 'user_a' as Player['userId'],
          playerId: 'player_a' as Player['playerId'],
          displayName: 'A',
          ready: true,
          connected: true,
          characterOptionIds: ['char_001_chen_yong_ren', 'char_004_holmes'] as never,
          selectedCharacterId: 'char_004_holmes' as never,
        },
        {
          seatIndex: 1,
          userId: 'user_b' as Player['userId'],
          playerId: 'player_b' as Player['playerId'],
          displayName: 'B',
          ready: true,
          connected: true,
          characterOptionIds: ['char_006_naruhodo', 'char_008_jack_the_ripper'] as never,
        },
      ],
    };

    const ownView = toRoomView(room, 'user_a' as Player['userId']);
    const ownSeat = ownView.seats.find((seat) => seat.userId === 'user_a');
    const otherSeatForA = ownView.seats.find((seat) => seat.userId === 'user_b');
    expect(ownSeat?.characterOptions?.map((character) => character.name)).toEqual(['陈永仁', '福尔摩斯']);
    expect(ownSeat?.characterSelected).toBe(true);
    expect(otherSeatForA?.characterOptions).toBeUndefined();
    expect(otherSeatForA?.characterSelected).toBe(false);

    const otherView = toRoomView(room, 'user_b' as Player['userId']);
    const seatAForB = otherView.seats.find((seat) => seat.userId === 'user_a');
    const seatBForB = otherView.seats.find((seat) => seat.userId === 'user_b');
    expect(seatAForB?.characterOptions).toBeUndefined();
    expect(seatAForB?.characterSelected).toBe(true);
    expect(JSON.stringify(seatAForB)).not.toContain('福尔摩斯');
    expect(seatBForB?.characterOptions?.map((character) => character.name)).toEqual(['成步堂龙一', '开膛手杰克']);
  });
});
