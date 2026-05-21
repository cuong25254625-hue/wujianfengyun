/**
 * 房间状态持久化 MVP
 *
 * 将 GameRoom 序列化到磁盘，支持：
 * 1. 定期自动保存（每 30 秒）
 * 2. 服务重启后恢复房间
 * 3. 基本错误恢复
 *
 * 生产环境建议替换为 Redis / SQLite，本实现仅用于 MVP。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GameRoom } from '@wujian/shared';

const DATA_DIR = process.env.PERSISTENCE_DIR ?? path.resolve(process.cwd(), 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const SAVE_INTERVAL_MS = 30_000;

let saveTimer: ReturnType<typeof setInterval> | undefined;

/**
 * 初始化持久化目录。
 */
export function initPersistence(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 从磁盘加载房间状态。
 */
export function loadRooms(): Map<string, GameRoom> {
  initPersistence();

  try {
    if (!fs.existsSync(ROOMS_FILE)) return new Map();
    const raw = fs.readFileSync(ROOMS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return new Map();

    const rooms = new Map<string, GameRoom>();
    for (const room of data) {
      if (room?.roomId && room.status !== 'closed') {
        rooms.set(room.roomId, room);
      }
    }
    return rooms;
  } catch (err) {
    console.error('[persistence] 加载房间失败，将使用空白状态:', (err as Error).message);
    return new Map();
  }
}

/**
 * 将房间状态写入磁盘。
 */
export function saveRooms(rooms: Map<string, GameRoom>): void {
  initPersistence();

  try {
    const data = [...rooms.values()].filter((room) => room.status !== 'closed');
    // 原子写入：先写临时文件再重命名
    const tmp = `${ROOMS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, replacer), 'utf-8');
    fs.renameSync(tmp, ROOMS_FILE);
  } catch (err) {
    console.error('[persistence] 保存房间失败:', (err as Error).message);
  }
}

/**
 * 启动定期自动保存。
 */
export function startAutoSave(getRooms: () => Map<string, GameRoom>): void {
  if (saveTimer) return;
  saveTimer = setInterval(() => {
    const rooms = getRooms();
    if (rooms.size > 0) {
      saveRooms(rooms);
    }
  }, SAVE_INTERVAL_MS);
  console.log(`[persistence] 自动保存已启动（间隔 ${SAVE_INTERVAL_MS / 1000}s）`);
}

/**
 * 停止自动保存并执行一次最终保存。
 */
export function stopAutoSave(getRooms: () => Map<string, GameRoom>): void {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = undefined;
    const rooms = getRooms();
    if (rooms.size > 0) saveRooms(rooms);
    console.log('[persistence] 自动保存已停止，已完成最终保存');
  }
}

/**
 * JSON 序列化处理器：忽略不可序列化的运行时引用。
 */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'function') return undefined;
  if (value instanceof Map || value instanceof Set) return [...value];
  return value;
}
