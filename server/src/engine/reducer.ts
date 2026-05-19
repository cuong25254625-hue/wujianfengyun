import type { EventEnvelope, GameEvent, GameState } from '@wujian/shared';

export const applyEvent = (state: GameState, envelope: EventEnvelope<GameEvent>): GameState => {
  const event = envelope.payload;

  switch (event.type) {
    case 'PhaseChanged':
      return {
        ...state,
        phase: {
          phase: event.to,
          enteredAtVersion: state.version,
          context: event.context,
        },
        version: state.version + 1,
      };
    case 'TurnAdvanced':
      return {
        ...state,
        turn: {
          ...state.turn,
          roundNumber: event.roundNumber,
          activeSeatIndex: event.activeSeatIndex,
          turnSerial: state.turn.turnSerial + 1,
        },
        version: state.version + 1,
      };
    default:
      return {
        ...state,
        eventQueue: [...state.eventQueue, envelope],
        version: state.version + 1,
      };
  }
};
