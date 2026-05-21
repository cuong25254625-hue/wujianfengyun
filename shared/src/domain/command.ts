import type { CharacterId, Faction, InfoId, InfoTruth, PlayerId, ReceiveDecision, RoomId } from './types.js';

export type PlayerCommand =
  | DeclareTransferCommand
  | ReceiveInfoCommand
  | UseProbeCommand
  | UseLockCommand
  | UseInterceptCommand
  | UseCharacterSkillCommand
  | UseFinalPkBurnCommand
  | DeclareVictoryCommand
  | PassPendingActionCommand;

export interface DeclareTransferCommand {
  type: 'DeclareTransfer';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  truth: InfoTruth;
}

export interface ReceiveInfoCommand {
  type: 'ReceiveInfo';
  playerId: PlayerId;
  transferId: string;
  decision: ReceiveDecision;
}

export interface UseProbeCommand {
  type: 'UseProbe';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  declaredFaction: Faction;
}

export interface UseLockCommand {
  type: 'UseLock';
  playerId: PlayerId;
  transferId: string;
  targetPlayerId: PlayerId;
}

export interface UseInterceptCommand {
  type: 'UseIntercept';
  playerId: PlayerId;
  transferId: string;
  targetPlayerId: PlayerId;
}

export interface UseCharacterSkillCommand {
  type: 'UseCharacterSkill';
  playerId: PlayerId;
  skillId: string;
  targetPlayerId?: PlayerId;
  secondaryTargetPlayerId?: PlayerId;
  infoIds?: InfoId[];
  choice?: string;
  transfer?: {
    targetPlayerId: PlayerId;
    truth: InfoTruth;
  };
}

export interface UseFinalPkBurnCommand {
  type: 'UseFinalPkBurn';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
}

export interface DeclareVictoryCommand {
  type: 'DeclareVictory';
  playerId: PlayerId;
  faction: Faction;
  reason: 'threeTrueInfo' | 'clearField' | 'secretMission';
}

export interface PassPendingActionCommand {
  type: 'PassPendingAction';
  playerId: PlayerId;
  pendingActionId: string;
}

export type RoomClientCommand =
  | { type: 'CreateRoom'; displayName: string }
  | { type: 'JoinRoom'; roomId: RoomId; displayName: string }
  | { type: 'LeaveRoom'; roomId: RoomId }
  | { type: 'UpdateDisplayName'; roomId: RoomId; displayName: string }
  | { type: 'SelectCharacter'; roomId: RoomId; characterId: CharacterId }
  | { type: 'SubmitSetupChoice'; roomId: RoomId; choiceKey: 'ccMissionTarget'; targetPlayerId: PlayerId }
  | { type: 'SetReady'; roomId: RoomId; ready: boolean }
  | { type: 'StartGame'; roomId: RoomId }
  | { type: 'GmForceAdvance'; roomId: RoomId };
