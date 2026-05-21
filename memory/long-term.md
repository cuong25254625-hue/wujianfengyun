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
- **手机端深度适配**（2026-05-21）：4 级自适应断点（1180/900/640/480px）；牌桌中心从 sticky 改为文档流相对定位避免遮挡座位；座位环在手机端降级为网格布局（640px 双列、480px 单列）；操作按钮全宽；safe-area-inset 适配刘海屏；`touch-action: manipulation` 禁双击缩放；`-webkit-tap-highlight-color: transparent` 去 iOS 点击高亮；viewport-fit=cover + apple-mobile-web-app-capable；按钮最小触摸区域 42-44px；CSS 增量约 200 行。
- **手机端操作可见性修复**（2026-05-21）：手机对局操作看不到的根因是 `.table-arena` 的 `overflow: hidden` 裁剪了游戏控件，且 `.table-center` 内的控件在透明背景下不可见。修复为：所有移动端断点显式设置 `overflow: visible`；控件卡片加可见边框；≤640px/480px 添加浮动底部操作栏（`position: fixed; bottom: 0`），当前待处理操作始终显示在屏幕底部，含 safe-area-inset 适配。
- **手机端 UI/排版专项优化**（2026-05-21）：进一步按手机优先优化信息层级。对局中央状态头在移动端 sticky、系统提示更紧凑；当前操作底部浮层增加拖拽把手视觉、横屏小高度专项断点；玩家座位卡压缩并隐藏低优先级信息，≤390px 小屏进一步收缩头像和文本；日志面板改为 details 折叠结构，手机端默认展示重点记录，完整记录隐藏以降低信息噪音；横屏 ≤520px 高度使用 4 列紧凑座位网格。
- **基础人物第二批接入**：按用户确认，012/013/018/019 继续暂缓；本轮新增 003/005/007/010/011/015/021/022/023/024/025 共 11 个中等复杂基础人物进入可玩池，角色池扩展到 21 个，8 人局每人可获得 2 个私密候选。新增角色均为 MVP 简化技能与简化白方任务，完整复杂规则后续逐步还原。

## 2026-05-21 第二批角色原规则还原
- **诸葛亮八阵星标记**（重大改动）：
  - 新增 GameState 级全局 `starMarks: Set<PlayerId>`，房间恢复时保留
  - 新增命令 `ZhuGeStarMark`，可在 SkillWindow/ReactionWindow/DyingWindow 中使用
  - 每个 SkillWindowReactWindow 最多 1 标记；全场最多 3 标记
  - 新增事件 `StarMarked/StarMarkFailed`；新增日志 `skill.zhuGeStarMark/tooMany`
  - 八阵技能重写：星标记≥3时可弃全体星标记使本回合下家不能宣告胜利
  - 七星技能已就绪
- **御剑怜侍牢狱**：
  - 搜查技能：查看一名玩家隐藏角色+将其情报全部盖伏
  - 牢狱机制：被搜查/被御剑造成死亡的玩家获得一个 `prison` 标记
  - 有 `prison` 标记者技能阶段禁止使用技能
  - 牢狱在推进到下一位玩家时清除
  - 新增事件 `PrisonMarked/SkillPhaseBlocked`
- **约翰克莱默竖锯轮**（较大改动）：
  - 新增 `jigsawRoundActive/jigsawMark` 到 GameState；新增 `PHASE_JigsawRound`
  - 添加 `enterJigsawRound/advanceJigsawRound/checkJigsawDeathAfterPass` 方法
  - 竖锯轮内所有人禁止人物技能+禁止宣胜
  - 传递情报时额外烧毁竖锯标记情报
  - 死于竖锯的玩家给竖锯+1额外假情报
  - 支持两轮竖锯（全存活玩家各执行一轮，非仅当前回合玩家）
- **秋山深一欺诈交换**：在 ReactionWindow 中可交换传递中的情报与手牌（MVP简化为交换双方已有情报），新增 `SwapTransferInfo` 命令
- **魏忠贤性别切换**：宦党技能可在 SkillWindow 中切换性别，同回合可立即使用厂卫；添加 `switchGender`/`canUseGenderSkill` 方法
- **其他还原**：
  - 弥海砂开眼：新增主动查看隐藏角色能力
  - 贝尔摩德保密：被锁定时仅对贝尔摩德有效果（锁定目标无效但不扩展）
  - 史密斯夫妇谍战：可在 ReactionWindow 中改传递方（MVP简化为redirect transfer）
  - 川岛芳子交际+绝情增强
- Git 分支策略：main；npm run typecheck ✅；npm test ✅（92 测试）；npm run build ✅

## 2026-05-21 Worktree 提交丢失与恢复
- 原始「第二批角色原规则还原」commit (7a94cfb) 在 `.claude/worktrees/` 临时目录中创建，worktree 清理后丢失
- 整个实现从头重新编写（约 660 行 diff，14 个文件）
- 最终 commit a938d54 已成功推送到 https://github.com/tianyu9527/wujianfengyun
- 12 个 source files + 3 个 memory/docs files，661 insertions / 20 deletions

## 2026-05-21 自动提取
- 用户优先要求优化手机端适配问题
- 游戏开发目标：将基础人物补完至 25 个（当前已实现 21 个）
- 暂缓实现的 4 个角色：基德、狛枝凪斗、江之岛盾子、顾晓梦，原因是涉及替身、死后多窗口、绝望状态、遗志多回合判定等复杂机制，容易大改现有系统
