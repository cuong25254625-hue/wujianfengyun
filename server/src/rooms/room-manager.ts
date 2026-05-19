import type { DomainResult, GameRoom, RoomId, UserId } from '@wujian/shared';
import { err, ok } from '@wujian/shared';
import { createRoomId } from '../util/id.js';
import { GameRoomRuntime } from './game-room-runtime.js';

export class RoomManager {
  private readonly rooms = new Map<RoomId, GameRoomRuntime>();

  createRoom(ownerUserId: UserId, ownerName: string): GameRoomRuntime {
    let roomId = createRoomId();
    while (this.rooms.has(roomId)) roomId = createRoomId();

    const runtime = new GameRoomRuntime(roomId, ownerUserId, ownerName);
    this.rooms.set(roomId, runtime);
    return runtime;
  }

  getRuntime(roomId: RoomId): DomainResult<GameRoomRuntime> {
    const runtime = this.rooms.get(roomId);
    if (!runtime) return err('room.notFound', '房间不存在');
    return ok(runtime);
  }

  getRoom(roomId: RoomId): GameRoom | undefined {
    return this.rooms.get(roomId)?.room;
  }

  findRoomByUser(userId: UserId): GameRoomRuntime | undefined {
    return Array.from(this.rooms.values()).find((runtime) => runtime.room.seats.some((seat) => seat.userId === userId));
  }
}
