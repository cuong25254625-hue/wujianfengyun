# 长期记忆

（项目初始化中，尚无记忆。）

## 2026-05-21
- 打开网页即提示“房间不存在”的根因：浏览器 localStorage 里保存了旧 roomId，页面初始化自动 requestSync 旧房间，服务端已清理/未恢复时返回 room.notFound；这是旧缓存恢复失败，不应作为红色错误打扰用户。
- 修复策略：App 用 currentRoomRef 区分当前是否真的处于房间中；页面刚打开且无当前房间时，room.notFound/sync.notInRoom 静默清理本机旧 roomId，不弹错误；reconnect.seatNotFound 仍提示座位不存在但避免重复弹窗。
- 创建/加入新房间时，如果本地有旧 roomId 导致 reconnectInFlight，必须把旧 reconnect/requestSync 队列清掉，并忽略短时间内迟到的旧 reconnect.seatNotFound，避免新房间创建成功后仍显示“正在重新连接”。
- 最新修复：所有玩家点击创建房间都会显示重连的根因是 `CreateRoom` 前先发送 `hello`，而 WebSocket open 时仍会按旧 localStorage 自动发送 `reconnect`，导致旧房间恢复和新建房间并发。修复为创建/加入房间不再预发 hello，并在 WsClient 中新增 `suppressReconnectOnNextOpen` 与 `cancelStaleReconnect()`，主动创建/加入时跳过下一次旧房间自动恢复、清除重连定时器并立即恢复 open 状态。
- 验证：npm run typecheck ✅；npm test ✅（71 测试）；npm run build ✅。
- 新增测试机器人：房主可在等待开局阶段添加机器人；机器人座位默认在线且已准备；游戏开始后机器人会自动选第一个候选角色、跳过宣胜/技能响应、默认传递真情报给第一名可选存活玩家、默认接收情报、濒死默认跳过，方便单人/少人流程测试。
