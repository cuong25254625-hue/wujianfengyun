import type { RoomId, SessionId, SessionView, UserId } from '@wujian/shared';
import { createSessionId, createUserId } from '../util/id.js';

export class ClientSession {
  readonly sessionId: SessionId;
  userId: UserId;
  displayName: string | undefined;
  roomId: RoomId | undefined;

  constructor(displayName?: string) {
    this.sessionId = createSessionId();
    this.userId = createUserId();
    this.displayName = displayName;
  }

  toView(): SessionView {
    return {
      userId: this.userId,
      displayName: this.displayName,
      roomId: this.roomId,
    };
  }
}
