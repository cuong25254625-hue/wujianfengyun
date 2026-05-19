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