import type { GamePhase } from './phase.js';
import type { PlayerId } from './types.js';
import type { ResponsePriorityPolicy } from './config.js';

export type PendingActionKind =
  | 'regularSkillWindow'
  | 'receiveDecision'
  | 'dyingSkillWindow'
  | 'victoryDeclareWindow'
  | 'characterSkillWindow';

export type PendingActionStatus = 'open' | 'resolved' | 'cancelled';

export interface PendingAction {
  pendingActionId: string;
  kind: PendingActionKind;
  phase: GamePhase;
  eligiblePlayerIds: PlayerId[];
  requiredPlayerIds?: PlayerId[];
  status: PendingActionStatus;
  responses: PendingActionResponse[];
  priorityPolicy: ResponsePriorityPolicy;
  expiresAt?: number;
  context: PendingActionContext;
}

export interface PendingActionResponse {
  playerId: PlayerId;
  commandId?: string;
  responseType: 'act' | 'pass';
  submittedAt: number;
}

export type PendingActionContext =
  | { type: 'transfer'; transferId: string }
  | { type: 'dying'; playerId: PlayerId }
  | { type: 'victory'; candidates: PlayerId[] }
  | { type: 'generic'; data?: Record<string, unknown> };
