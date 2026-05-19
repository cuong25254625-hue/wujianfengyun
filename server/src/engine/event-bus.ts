import type { EventEnvelope, GameEvent, GameState } from '@wujian/shared';

export interface EventBusDispatchResult {
  state: GameState;
  generatedEvents: GameEvent[];
}

export const dispatchEvent = (state: GameState, _event: EventEnvelope<GameEvent>): EventBusDispatchResult => ({
  state,
  generatedEvents: [],
});
