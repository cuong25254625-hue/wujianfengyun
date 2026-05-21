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

  /** 获取所有房间的 GameRoom 快照用于持久化。 */
  getAllRoomStates(): Map<string, import('@wujian/shared').GameRoom> {
    const states = new Map<string, import('@wujian/shared').GameRoom>();
    for (const [id, runtime] of this.rooms) {
      states.set(id, runtime.room);
    }
    return states;
  }

  /** 从持久化数据恢复房间。仅恢复状态非 'closed' 且有座位的房间。 */
  restoreFromPersistence(rooms: Map<string, import('@wujian/shared').GameRoom>): void {
    for (const [roomId, room] of rooms) {
      if (room.status === 'closed') continue;
      if (room.seats.length === 0) continue;
      // 根据保存的 room 数据重建 runtime（服务器重启后所有座位标记为断线）
      const runtime = GameRoomRuntime.fromSaved(room);
      this.rooms.set(roomId as RoomId, runtime);
      console.log(`[persistence] 恢复房间 ${roomId}（${room.seats.length} 名玩家，状态 ${room.status}）`);
    }
  }

  /** 清理所有 closed 状态的房间。 */
  cleanClosed(): void {
    for (const [roomId, runtime] of this.rooms) {
      if (runtime.room.status === 'closed') {
        this.rooms.delete(roomId);
      }
    }
  }
}
