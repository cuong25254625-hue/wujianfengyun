# 长期记忆

（项目初始化中，尚无记忆。）

## 2026-05-19
- 规则梳理决策：MVP 第一版聚焦 4-8 人核心对局、身份、情报传递、试探/锁定/截获、濒死死亡、红蓝宣胜；白方完整任务、最终 PK、战功、复杂标记、全角色暂缓。
- 重要开放问题：原规则未完全明确红蓝具体配比；线上化需要确定多人同时响应的优先级（座位顺序/提交时间/响应队列）。
- 服务端核心领域模型决策：采用 GameState 权威状态 + PlayerCommand 客户端意图 + GameEvent 事实日志 + PendingAction 响应窗口 + SkillDefinition 技能定义；常规技能与人物技能统一接入技能引擎；死亡与胜利分离为 DeathEngine/WinEngine，并强制死亡优先于胜利。
- 架构约束决策：红蓝配比、多响应优先级、技能窗口结束方式等未决规则必须集中放入 GameConfig，不应硬编码在流程中。
- FSM 与事件队列决策：采用 `命令 -> 事件 -> reducer -> EventBus -> settlementQueue -> PendingAction` 的服务端主循环；`commandQueue/eventQueue/settlementQueue` 三层分离，`eventQueue` 作为唯一可持久化事实来源。
- 阶段流转决策：每个回合进入技能阶段前必须先进入 `VictoryDeclareWindow`；WinEngine 只生成宣胜候选，游戏结束必须由玩家在宣胜窗口提交有效 `DeclareVictoryCommand`。
- 结算优先级决策：截获优先于锁定；死亡/濒死永远优先于胜利；进入 `GameOver` 前必须确认 deathQueue 为空、无人处于 dying、无打开的 dyingSkillWindow。
- MVP 默认流程策略：多人响应优先级暂定 `seatOrderFromActivePlayer`，技能/宣胜/濒死窗口暂定所有 eligible 玩家 act/pass 后关闭；这些策略后续仍保留在 GameConfig 中可切换。
- 代码工程决策：已采用 npm workspaces monorepo：`shared/` 放共享领域类型与 WebSocket JSON 协议，`server/` 放 Node.js + TypeScript + ws 服务端，`client/` 放 React + Vite 调试客户端。
- 当前启动/验证命令：`npm install`、`npm run dev`、`npm run dev:server`、`npm run dev:client`、`npm run typecheck`、`npm test`、`npm run build`。
- 当前代码骨架已支持：WebSocket 连接、创建房间、加入房间、准备/取消准备、房主开始游戏、4-8 人身份分配、身份暗置视图、最小 React 房间/对局调试界面。
- 房间与身份分配原型补强：开局时 `GameState.eventQueue` 现在记录 `GameStarted`、每名玩家的 `IdentityAssigned`、`CharacterAssigned` 与进入 `VictoryDeclareWindow` 的 `PhaseChanged`；`server/src/engine/character-registry.ts` 提供首批 10 个 MVP 角色占位。
- 角色占位策略：开局按座位顺序从首批角色池分配角色；陈永仁、刘建明为隐藏角色且初始盖伏，其余首批角色为公开角色且初始明置；技能实现仍为后续 Milestone 2 任务。
- 多人可玩 MVP 补强：协议新增 `playerCommand`，`GameRoomRuntime.handlePlayerCommand` 已能处理宣胜/pass、技能阶段试探、传递、响应锁定/截获、接收/拒收、情报落点、假情报濒死死亡、红蓝三真/清场宣胜；React `GameBoard` 已提供对应最小操作 UI。
- 当前可玩阶段循环：`VictoryDeclareWindow -> SkillWindow -> TransferDeclare -> ReactionWindow -> ReceiveDecision -> DyingWindow(如触发) -> VictoryDeclareWindow(下一存活玩家)`；MVP 中濒死无自救时由玩家点击结算死亡，人物技能和白方任务仍后置。
- 当前验证结果：`npm run typecheck`、`npm test`、`npm run build` 均通过；测试数更新为 3 个测试文件、14 个测试。
- 本地测试部署记录：已将客户端默认 WebSocket 地址从固定 `ws://localhost:8787` 调整为 `ws://${window.location.hostname}:8787`，便于局域网其他设备通过 Vite Network 地址访问时连接同一台服务器。
- 本地开发服务状态：端口 8787 和 5173 已有 Node 进程监听，推测此前 `npm run dev` 已在运行；可用 `http://localhost:5173/` 本机测试，也可用 Vite 输出的局域网地址（如 `http://172.30.114.228:5173/`）给同网段玩家测试，后端端口为 8787。
- 首批 10 个角色技能接入决策：用户要求尽量完整实现，并允许把 `D:\wujian\wujian\projects\角色图` 中图片复制到项目内；已复制到 `client/public/characters/` 并通过 `characterImageUrl` 下发。
- 首批人物技能当前实现：陈永仁/刘建明城府与就计/灭迹，福尔摩斯真相/揭露，成步堂异议/逆转，开膛手杰克昭彰/惯犯，秋濑或探究/赌博，绫里千寻辩护/灵媒借传，C.C 契约/守护，绫波丽冰山/克隆，我妻由乃崩坏/新生均已有 MVP 接入。
- 首批人物技能 MVP 简化点：灭迹每局一次并自动优先烧假；赌博用系统随机替代左右选择；灵媒先做死者借传，濒死遗言控制下次传递后续补；C.C 契约用待传标记串联两次传递。
- 当前验证结果更新：接入角色技能后 `npm run typecheck && npm test && npm run build` 全部通过；测试数更新为 3 个测试文件、15 个测试。
- 前端开发端口调整：因 5173、5174 均被占用，已将 `client/vite.config.ts` 和 `client/package.json` 的 Vite dev 端口改为 5180，并保留 `host: 0.0.0.0`/`--strictPort` 便于局域网测试；当前客户端测试入口为 `http://localhost:5180/` 或局域网 IP 的 5180 端口，后端 WebSocket 仍为 8787。
- 创建房间无响应修复：问题原因是前端 5180 在运行但后端 WebSocket 8787 未监听；已启动 `npm run dev:server` 恢复 8787，并在 `WsClient` 增加连接状态、错误提示和连接中消息队列，避免 WebSocket 未 open 时点击创建房间被静默丢弃。
- GitHub 同步记录：已初始化 Git 仓库并推送到 `https://github.com/cuong25254625-hue/wujianfengyun` 的 `main` 分支，提交 `8e13a31`；新增 `README.md`，包含项目说明、本地开发命令、Ubuntu 22.04 x64 部署、systemd、Nginx、WebSocket 反代和防火墙说明。

## 2026-05-20
- 对局完整性优化：新增系统提醒、技能说明和牌桌 UI；服务端通过 `PublicGameView.systemHints` 下发当前阶段下一步提示，通过 `PrivatePlayerView.ownSkills` 展示本人常规/角色技能说明。
- 技能说明数据源：新增 `server/src/engine/skill-registry.ts`，集中维护常规技能与首批 10 个角色技能的 MVP 说明，避免前端硬编码规则文案。
- 隐私修复：隐藏且未揭示角色对他人不再下发角色名、角色图、技能说明；本人仍可看到自己的隐藏角色和技能。
- 前端 UI 决策：采用左侧房间信息、中间环形牌桌与操作区、右侧日志的页游式布局；`PlayerList` 负责环形座位牌，`GameBoard` 负责系统提醒、我的技能书和操作按钮。
- 验证结果更新：`npm run typecheck`、`npm test`、`npm run build` 均通过；测试数更新为 3 个测试文件、19 个测试。
- 部署排障决策：Ubuntu 服务器 systemd 后端若 `Active: activating (auto-restart)` 且 `status=1/FAILURE`，先看完整日志 `journalctl -u wujianfengyun-server -n 100 --no-pager -l`，再确认 `/opt/wujianfengyun/server/dist/index.js` 是否存在；若存在，直接运行 `PORT=8787 NODE_ENV=production node server/dist/index.js` 以暴露真实 Node 异常。
- 部署故障根因：生产环境 Node 运行 `server/dist/index.js` 时仍通过 `@wujian/shared` 解析到 `shared/src/index.ts`，导致 `ERR_UNKNOWN_FILE_EXTENSION .ts`；已将 `shared/package.json` 的 exports 从 `./src/index.ts` 改为 `./dist/index.js`/`./dist/index.d.ts`，服务器需拉取最新代码后重新 `npm ci && npm run build`。
- 部署优化决策：用户认为手工部署太麻烦，已选择"一键脚本"方案，并要求预留 HTTPS；部署入口统一改为 Nginx `/ws` 反代，前端生产配置写入 `client/.env.production`，后续域名证书用 Certbot 升级到 HTTPS/WSS。
- 一键部署工具新增：`deploy/install.sh` 用于首次部署，`deploy/update.sh` 用于后续拉取更新，`deploy/status.sh` 用于诊断 OS/Node/Git/构建产物/systemd/Nginx/端口/日志，`deploy/README.md` 记录脚本用法和常见问题。
- 部署脚本默认行为：项目目录 `/opt/wujianfengyun`、服务名 `wujianfengyun-server`、后端端口 `8787`、Nginx 托管 `client/dist` 并代理 `/ws -> 127.0.0.1:8787`；IP 测试使用 `--https off`，域名默认预留 `wss://域名/ws`。
- 一键部署 typecheck 修复：服务器新拉取仓库后 `client` typecheck 可能先于 `shared` 构建，导致 `@wujian/shared` 无可用 `dist/*.d.ts` 而退化成 any，出现 RoomPanel/GameBoard 等 26 个隐式 any 类型错误；已将根 `npm run typecheck` 调整为先执行 `npm --workspace @wujian/shared run build`，再执行全 workspaces typecheck。
- GitHub 同步记录：部署 typecheck 顺序修复已提交并推送到 `main`，提交 `aca8972 Fix deployment typecheck ordering`。
- UI 第二轮优化决策：用户反馈页面元素太多、日志英文多、系统推进不明显；改为以 `GameBoard` 中文流程条 + 系统提示作为主视觉，降低人物技能和技能说明的常驻展示密度。
- 日志策略决策：不改服务端 publicLog 协议，先在 `client/src/components/LogPanel.tsx` 用客户端字典把 messageKey/params 转为中文自然句，避免显示 `transfer.declared` 和原始 JSON。
- 本轮 UI 改动：新增流程条、状态条、当前操作高亮卡片、折叠人物技能操作、折叠我的技能、中文连接/房间状态、中文胜利原因和中文日志格式化；验证 `npm run typecheck`、`npm test`、`npm run build` 通过。
- 部署问题记录：用户反馈前端提示"WebSocket 连接已关闭，请刷新页面或重启后端"。优先排查后端 systemd 是否运行、8787 是否监听、Nginx `/ws` 是否正确代理，以及前端构建时 `VITE_WS_URL` 是否与 IP/域名/HTTPS 访问方式一致。
- WebSocket 排障进展：用户已确认 `wujianfengyun-server` 为 `active (running)`，后端监听 `*:8787`，因此问题不在 Node 后端；下一步重点检查生产前端 `client/.env.production` 的 `VITE_WS_URL` 和 Nginx `location /ws` 反代配置。
- UI 第三轮优化：进入游戏后自动隐藏左侧房间卡片，布局改为"牌桌主区 + 右侧日志"，牌桌使用接近整屏高度；座位卡半径/尺寸/图片/文字改为随视口压缩，减少环形牌桌玩家显示不全的问题。
- 本轮 UI 验证：`npm run typecheck`、`npm test`（3 个测试文件、19 个测试）、`npm run build` 全部通过。
- UI 第四轮优化：用户要求当前进程应在桌面画布中操作，并且加入房间等待阶段桌面更大；已将游戏中 `GameBoard` 作为 `PlayerList` 的桌面中心内容渲染，操作按钮/系统提示/当前阶段状态进入牌桌中央，外部不再单独占据牌桌下方空间。
- 等待/加入房间桌面优化：默认 `table-arena` 高度提升为 `clamp(720px, 76vh, 900px)`，让开局前座位信息也有更大展示区域；游戏内中心操作卡改为 `table-control-card` 紧凑样式，座位半径扩大到 `min(37vw, 43vh, 470px)` 并缩小卡宽，进一步缓解玩家显示不全。
- 本轮 UI 验证：`npm run typecheck`、`npm test`（3 个测试文件、19 个测试）、`npm run build` 全部通过。
- UI 第五轮优化：修复玩家改名后目标下拉列表仍显示旧名的问题，新增 `UpdateDisplayName` 房间命令并在准备/同步昵称时更新 seat 与 game player 的 displayName；目标下拉列表现在会跟随服务端广播的新名称更新。
- 牌桌座位卡优化：座位卡改为"左侧角色头像 + 右侧玩家信息"的横向布局，降低上下座位卡高度；游戏内牌桌改回裁切边界并收缩座位半径，避免上下角色高出桌面画布。
- 技能查看优化：所有玩家可以点击桌面上的已公开/自己可见角色头像，弹出角色技能说明；隐藏且未揭示角色仍不公开技能，避免泄露。
- 本轮验证：`npm run typecheck`、`npm test`（3 个测试文件、19 个测试）、`npm run build` 全部通过。
- 规则差距梳理：当前可玩版已覆盖房间、4-8 人身份、基础情报传递、试探/锁定/截获、濒死死亡、红蓝胜利、首批 10 人物的 MVP 技能和牌桌 UI；主要待补规则包括完整白方机密任务/最终 PK、9-10 人局、角色选择与开局选项、真实开放式技能追加窗口、完整人物技能细节、情报牌堆/每轮公开、断线重连/录像/GM/机器人、全 25/100 角色与战功系统。
- 用户优先级更新：用户明确要求优先完成断线重连，其后继续处理公私文本、手机端操作反馈、任意回合宣胜、白方任务系统、角色选择与开局选项。
- 断线重连基础完成：客户端 `WsClient` 已支持保存 `userId/roomId`、断线自动重连、指数退避、手动立即重连；服务端新增 `reconnect` 协议处理，重连后恢复 session、房间归属和座位 connected 状态，UI 显示重连横幅与玩家断线标记。
- 公私日志基础完成：`GameState.privateLogs`、`PrivatePlayerView.privateLog`、`addPrivateLog` 已接入；城府/就计获知阵营、探究查看隐藏角色等敏感结果改为私人记录；公屏保留传递、锁定、截获、死亡、胜利等公共事件。后续仍需继续按 `outputs/7.2_converted.txt` 完整整理每个技能/事件的公开范围。
- 手机端适配阶段优化：增加按钮按压反馈、关键操作按钮脉冲、移动端桌面中心操作区 sticky、触摸尺寸加大和重连 banner；锁定/截获等操作已有更明显反馈，但后续仍可补充 toast 成功提示。
- 任意回合宣胜基础完成：每轮 `VictoryDeclareWindow` 面向所有存活玩家开放；非当前回合玩家可宣胜或跳过但不推进流程，当前回合玩家跳过才进入技能阶段，避免旁观跳过抢推进权。
- 白方任务系统 Phase 1 完成：新增 `server/src/engine/mission-engine.ts`，接入 10 个 MVP 角色的简化任务检查、`secretMission` 白方宣胜、任务计数器、死亡延迟任务框架和任务完成私人提示；最终 PK、完整任务还原、C.C 指定目标 UI、拦截型任务仍待做。
- 角色选择基础完成：大厅新增角色预选，`RoomSeat.characterPreferenceId`、`SelectCharacter` 命令、`RoomView.availableCharacters` 与预选名展示已接入；开局时按预选优先分配，未选者自动补位。正式选角阶段和开局选项仍待完善。
- 当前验证结果更新：最近一轮综合改动后 `npm run typecheck`、`npm test`、`npm run build` 均通过；测试覆盖为 3 个测试文件、64 个测试。
- 角色选择流程修正决策：用户明确要求角色选择应发生在"开始游戏后"，系统从角色池随机给每名玩家候选角色，选择完成前其他玩家不能看到自己选了谁；因此废弃大厅公开预选，改为开局后私密选角阶段。
- 选角实现细节：`RoomSeat.characterOptionIds/selectedCharacterId` 为服务端权威状态，`RoomSeatView.characterOptions` 只下发给本人，`characterSelected` 公开显示选角进度；全员选择后才填充 `Player.character*` 并进入 `VictoryDeclareWindow`。
- 角色池限制说明：MVP 角色池当前只有 10 个；4-5 人局可满足每人 2 个全局互不重复候选，6-8 人局暂自动降级为每人 1 个候选，以维持 4-8 人局可开。扩充到 16+ 角色后应恢复 6-8 人每人 2 选。
- 当前验证结果更新：私密选角改动后 `npm run typecheck`、`npm test`（3 个测试文件、66 个测试）、`npm run build` 均通过。

## 2026-05-20 第二阶段综合开发
- 用户要求完成近期待办 1（隐私修复）、2（公屏/私密规则表）、3（角色选择重做）、4（手机端反馈优化）、6（技能引擎重构）、9（断线重连持久化）。
- 试探隐私修复：`probe.success`/`probe.failed` 改为 `addPrivateLog` 私人记录，公屏仅保留 `probe.used`。
- 传递隐私修复：`transfer.declared` 不再包含 truth，仅 from→target；truth 通过 `transfer.declaredTruth` 私人告知传递者。
- 拒收隐私修复：`transfer.rejected` 公开拒收但不含 truth；`transfer.rejectedTruth` 仅告知传递者。
- 可见规则表产出：`outputs/visibility-rules-table.md` 完整梳理所有 addLog/addPrivateLog 的可见层级（公屏/私人/目标可见）。
- 技能引擎重构：新增 `server/src/engine/skill-handlers.ts`，定义 SkillHandler 接口 + SkillRuntimeAccess，每个技能独立注册为 handler，game-room-runtime.ts 的 switch/case 替换为 `getSkillHandler` 查找。
- 手机端 UX：Toast 通知系统（提交→成功/失败）、.action-pulse 脉冲动画、:active 反馈、移动端 sticky + toast 置顶、≥44px 触控尺寸。
- 房间持久化：`server/src/engine/persistence.ts` 支持 load/save/autoSave（每 30s 原子写入）；GameRoomRuntime.fromSaved 静态方法；RoomManager.restoreFromPersistence 启动时恢复房间。
- 全部验证通过：`npm run typecheck` ✅ `npm test` ✅（3 测试文件、71 测试）`npm run build` ✅。

## 2026-05-20 自动提取
- 用户要求试探的信息和结果默认只有试探者本人知道，不应在公屏显示。
- 用户要求传递的情报的真假只有传递者知道，只有当对方接收后才能在公屏宣布真假。

## 2026-05-20 仓库迁移
- 本地仓库的 origin 已更新为 https://github.com/tianyu9527/wujianfengyun.git（原旧地址为 cuong25254625-hue/wujianfengyun）
- 后续所有代码推送都需使用此新仓库地址

## 2026-05-20 断线重连竞态修复
- 根因：服务器 WebSocket `connection` 中立即发送带临时 userId 的 `hello`，客户端收到后覆盖 localStorage 保存的正确 userId → 重连用错 ID 找不到座位。
- 服务端修复：延迟 200ms 发送 hello；客户端先发 `reconnect`/`hello` 则取消延迟 hello。
- 客户端修复：新增 `reconnectInFlight` 标志，重连进行中不从 `hello` 覆盖 `reconnectUserId`；`open` 始终发送 hello/reconnect。
- App 修复：`wasReconnecting` ref 避免闭包陈旧值；重连成功后自动 `requestSync`。
- 验证：`typecheck` ✅ `test` ✅（71 测试） `build` ✅。提交 `7e5c2c0`。

## 2026-05-20 断线重连二次修复（本轮）
- 根因分析：房间未开始时房主断线后房间消失。排查出 3 个问题：
  1. **旧 socket close 竞态**：`handleReconnect` 关闭旧连接后，旧 socket close 事件异步创建新的 5 秒断开计时器，将刚重连用户标为断开。
  2. **缺少 findRoomByUser 回退**：`handleReconnect` 只用 roomId 查找，roomId 丢失/错误时无回退。
  3. **页面刷新不主动同步**：App.tsx `wasReconnecting` ref 初始为 false，页面刷新后 `onStatus('open')` 不调用 `requestSync`。
- 修复 1：关闭旧连接前清空 `other.session.roomId = undefined`，使旧 socket 的 close handler 跳过 disconnect timer。
- 修复 2：`handleReconnect` 增加 `findRoomByUser` 回退；回退成功也取消对应 room 的延迟断开计时器。
- 修复 3：`onStatus('open')` 不再依赖 `wasReconnecting`，只要 persisted session 有 roomId 就调用 `requestSync`。
- 额外改进：回退场景下用 `effectiveRoomId` 替换原 `roomId`，确保后续 broadcast/close-old-connection 用正确 roomId。
- 验证：`typecheck` ✅ `test` ✅（71 测试） `build` ✅。

## 2026-05-20 断线重连第三次增强（房主转移 + 空房间清理 + 跨进程重启恢复）

### 房主转移机制
- 新增 `GameRoomRuntime.transferHost(fromUserId)` 方法：
  - 大厅中断线时自动转移给已连接玩家（优先在线 > 已准备 > 任意其他玩家）
  - 游戏中不转移房主（GM forceAdvance 不依赖 owner）
  - 只剩房主一人时保留原房主身份等待重连
- 客户端 `RoomPanel` 显示当前房主名称和在线/离线状态
- `App.tsx` 收到 `roomView` 时检测房主变更并 Toast 通知

### 空房间自动清理
- 大厅房间最后一人断开后，等待 5 分钟无人连接则标记为 `closed`
- `RoomManager.cleanClosed()` 可清理 closed 房间

### 跨进程重启持久化增强
- `GameRoomRuntime.fromSaved` 现在将所有座位标记为 `connected: false`
- 重启后玩家重连时通过 `handleReconnect` 恢复连接状态
- `restoreFromPersistence` 跳过空座位房间

### 客户端房主状态优化
- 房间信息面板现在显示房主名称和在线状态
- 房主离线时显示"将在断线后自动转移给在线玩家"
- 开始游戏按钮仅在全员准备后可见

### 验证
- `npm run typecheck` ✅
- `npm test` ✅（3 个测试文件、71 个测试）
- `npm run build` ✅

## 2026-05-20 自动提取
- 断线重连问题有三个根因：旧 socket 关闭时的竞态条件触发额外断开计时器；handleReconnect 缺少 findRoomByUser 回退；页面刷新后不主动同步房间状态。
- 修复方案：关闭旧连接前清除 roomId 防止旧 close 事件误判；添加 findRoomByUser 容错查找；App 不再依赖 wasReconnecting 标记，始终在连接打开且 session 有 roomId 时 requestSync。
- 修改文件为 server/src/ws/server.ts 和 client/src/App.tsx，全部测试通过，类型检查与构建成功。

## 本地仓库 remote
- origin: https://github.com/tianyu9527/wujianfengyun.git


## 2026-05-20 自动提取
- 完成了断线重连跨进程重启持久化增强：从保存状态恢复时将座位标记为断开，支持重启后玩家重连恢复。
- 实现了房主自动转移：房主断线 5 秒后将房主身份转移给已连接玩家（优先在线、已准备、任意其他人），游戏中不转移，仅剩房主一人时保留等重连。
- 实现了空房间自动清理：最后一人断开后 5 分钟无新连接则标记房间关闭。
- 客户端添加房主显示与变更通知，RoomPanel 显示当前房主及在线状态，App 收到房主变更事件时弹出 Toast 通知。

## 2026-05-21 重连找不到房间修复
- 根因：房间持久化原先每 30 秒才保存一次，若创建房间后立刻刷新/离开导致 systemd 更新重启或进程重启，刚创建的房间可能尚未落盘，重启后 `git pull/update` 或服务重启会出现“房间不存在”。
- 服务端修复：`GameWebSocketServer.broadcastRoom()` 后立即 `saveRooms()`，创建/加入/准备/房主转移/断线状态等房间变更会立即落盘，消除 30 秒丢房窗口。
- 客户端修复：新增 `WsClient.forgetRoom()`，当收到 `room.notFound`、`reconnect.seatNotFound`、`sync.notInRoom` 时清除本机保存的旧 roomId 和相关待发同步/重连消息，避免反复重连一个已经不存在的旧房间。
- 验证：`npm run typecheck` ✅；`npm test` ✅（71 测试）；`npm run build` ✅。