import type { GamePhase, GameState, PhaseContext, PhaseState } from '@wujian/shared';

export const enterPhase = (state: GameState, phase: GamePhase, context: PhaseContext): GameState => ({
  ...state,
  phase: {
    phase,
    enteredAtVersion: state.version,
    context,
  },
  version: state.version + 1,
});

export const createPhaseState = (phase: GamePhase, context: PhaseContext, version = 0): PhaseState => ({
  phase,
  enteredAtVersion: version,
  context,
});
