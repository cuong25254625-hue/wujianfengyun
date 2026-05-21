# 长期记忆

（项目初始化中，尚无记忆。）

## 2026-05-21
- 打开网页即提示“房间不存在”的根因：浏览器 localStorage 里保存了旧 roomId，页面初始化自动 requestSync 旧房间，服务端已清理/未恢复时返回 room.notFound；这是旧缓存恢复失败，不应作为红色错误打扰用户。
- 修复策略：App 用 currentRoomRef 区分当前是否真的处于房间中；页面刚打开且无当前房间时，room.notFound/sync.notInRoom 静默清理本机旧 roomId，不弹错误；reconnect.seatNotFound 仍提示座位不存在但避免重复弹窗。
- 创建/加入新房间时，如果本地有旧 roomId 导致 reconnectInFlight，必须把旧 reconnect/requestSync 队列清掉，并忽略短时间内迟到的旧 reconnect.seatNotFound，避免新房间创建成功后仍显示“正在重新连接”。
- 验证：npm run typecheck ✅；npm test ✅（71 测试）；npm run build ✅。
