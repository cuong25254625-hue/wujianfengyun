# 长期记忆

## 2026-05-21
- 打开网页即提示"房间不存在"的根因：浏览器 localStorage 里保存了旧 roomId，页面初始化自动 requestSync 旧房间，服务端已清理/未恢复时返回 room.notFound；这是旧缓存恢复失败，不应作为红色错误打扰用户。
- 修复策略：App 用 currentRoomRef 区分当前是否真的处于房间中；页面刚打开且无当前房间时，room.notFound/sync.notInRoom 静默清理本机旧 roomId，不弹错误；reconnect.seatNotFound 仍提示座位不存在但避免重复弹窗。
- 创建/加入新房间时，如果本地有旧 roomId 导致 reconnectInFlight，必须把旧 reconnect/requestSync 队列清掉，并忽略短时间内迟到的旧 reconnect.seatNotFound，避免新房间创建成功后仍显示"正在重新连接"。
- 最新修复：所有玩家点击创建房间都会显示重连的根因是 `CreateRoom` 前先发送 `hello`，而 WebSocket open 时仍会按旧 localStorage 自动发送 `reconnect`，导致旧房间恢复和新建房间并发。修复为创建/加入房间不再预发 hello，并在 WsClient 中新增 `suppressReconnectOnNextOpen` 与 `cancelStaleReconnect()`，主动创建/加入时跳过下一次旧房间自动恢复、清除重连定时器并立即恢复 open 状态。
- 验证：npm run typecheck ✅；npm test ✅（90 测试）；npm run build ✅。
- 新增测试机器人：房主可在等待开局阶段添加机器人；机器人座位默认在线且已准备；游戏开始后机器人会自动选第一个候选角色、跳过宣胜/技能响应、默认传递真情报给第一名可选存活玩家、默认接收情报、濒死默认跳过，方便单人/少人流程测试。
- 机器人响应窗口卡住修复：创建待响应窗口时先进入正确 phase，再创建 pending action；`openPendingAction` 会立即让机器人自动 pass，`maybeResolveReaction` 兜底处理机器人 pass。房主新增 GM 工具条，可强制推进阶段或强制结束游戏。
- 游戏结束后继续游戏流程：新增 `ReturnToLobby` 和 `StartNextRound`。GameOver 页面中所有人可返回大厅；房主可返回房间等待区或直接再来一局。`finished` 状态下 LeaveRoom 会移除座位并转移房主；返回等待区/再来一局会移除断线真人、保留机器人、清理旧 playerId/选角信息。

## 2026-05-21 (续)
- 断线重连三次修复历程：
  1. 最初所有玩家创建房间就显示重连，随后房间不存在。根因是服务端持久化目录 `EACCES` 导致进程崩溃，systemd 重启后内存房间丢失。
  2. 修复持久化立即落盘后，刚创建房间、离开/刷新仍显示房间不存在。根因是旧 roomId 导致重复同步。
  3. 最终根因：`createRoom()` 预发 `hello`，WebSocket open 时自动 reconnect 旧房间，形成并发。修复为主动创建/加入时 suppress reconnect 并直接发送命令。
- 游戏大厅功能：新增大厅页面显示等待中房间列表；`LeaveRoom` 指令；房间全空时自动关闭。
- 隐私规则：试探结果默认只有试探者知道；传递情报真假只有发送者知道；接收后公屏才宣布真假；拒收时真情报告知传递者本人但不公屏。
- 技能引擎重构：handler 注册式，13 个技能独立处理器。新增 `server/src/engine/skill-handlers.ts`。
- 房间状态持久化：`server/src/engine/persistence.ts`，30s 自动保存，优雅关机保存，重启恢复。
- 房主转移：断线/退出时自动转移给在线玩家（优先在线 > 已准备 > 任意）。
- 公/私日志分离：敏感操作（试探结果、传递真假、探究、就计获知等）只进入 privateLogs。
- 任意回合宣胜：VictoryDeclareWindow 面向所有存活玩家开放，不再限制当前回合玩家。
- 角色选择改为开局后私密选角：每人 2 个候选互不重复，自己才能看到角色选项，其他人只看进度。
- 手机端适配：Toast 通知、action-pulse 动画、sticky 操作区、移动端网格降级。
- **白方任务系统 Phase 1**：10 个 MVP 角色各有简化版任务；任务计数器（caused_death、killed_female、jie_lu_used、ni_zhuan_used、xin_sheng_used、ke_long_used 等）；死亡延迟宣胜（秋濑或、绫里千寻）；C.C 开局目标选择；宣胜窗口支持 white + secretMission。
- **白方任务系统 Phase 2**：最终 PK 增强（死亡后检查 PK 结束、系统提示）、拦截型任务计数器完善、C.C 完整流程、死亡延迟宣胜增强（advanceTurn 自动检查）、新增 16 个 Phase 2 测试。当前测试 90 个。
- 项目部署域名仓库：https://github.com/tianyu9527/wujianfengyun.git
- 一键部署脚本：deploy/install.sh、deploy/update.sh、deploy/status.sh
