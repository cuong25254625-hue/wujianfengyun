import type { PlayerId } from './types.js';

export type GamePhase =
  | 'Lobby'
  | 'Setup'
  | 'VictoryDeclareWindow'
  | 'SkillWindow'
  | 'TransferDeclare'
  | 'ReactionWindow'
  | 'ReceiveDecision'
  | 'InfoSettle'
  | 'DyingWindow'
  | 'DeathSettle'
  | 'TurnEnd'
  | 'GameOver';

export type PhaseContext =
  | { type: 'none' }
  | { type: 'activeTurn'; activePlayerId: PlayerId }
  | { type: 'transfer'; transferId: string }
  | { type: 'pendingAction'; pendingActionIds: string[] }
  | { type: 'dying'; playerId: PlayerId; cause: string }
  | { type: 'death'; candidates: string[] }
  | { type: 'victory'; candidates: string[] };

export interface PhaseState {
  phase: GamePhase;
  enteredAtVersion: number;
  context: PhaseContext;
}

export const createLobbyPhase = (): PhaseState => ({
  phase: 'Lobby',
  enteredAtVersion: 0,
  context: { type: 'none' },
});
