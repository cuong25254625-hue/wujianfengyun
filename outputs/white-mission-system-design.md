# 白方机密任务系统设计

## 概述

白方在《无间风云》中不是统一阵营，而是各自为营。每个白方角色有自己的机密任务，完成任务后可宣告胜利。白方的宣胜时间点与其他阵营一致：所有技能阶段开始前的结算点。

## 核心概念

### 机密任务 (SecretMission)

每个白方角色携带一个机密任务。任务由以下要素组成：

```ts
interface SecretMission {
  missionId: string;
  characterId: CharacterId;
  description: string;        // 任务描述文本
  trigger: MissionTrigger;    // 触发检查的时机
  condition: MissionCondition; // 完成条件
  winType: MissionWinType;    // 单独获胜 / 共同获胜 / 导致他人失败
  deathDelay?: boolean;       // 死亡后是否允许延迟宣胜（※标记）
}
```

### 任务触发时机 (MissionTrigger)

```ts
type MissionTrigger =
  | 'onSkillPhaseStart'       // 每个技能阶段开始前检查
  | 'onPlayerDeath'           // 有玩家死亡时检查
  | 'onSelfDeath'             // 自身死亡时检查
  | 'onVictoryDeclared'       // 其他玩家宣胜时检查（拦截型任务）
  | 'onTurnEnd'               // 回合结束时检查
  | 'onInfoReceived'          // 收到情报时检查
  | 'onFinalPK'               // 进入最终 PK 时检查
  | 'onGameStart';            // 游戏开始时设置
```

### 任务完成条件 (MissionCondition)

条件采用组合模式，支持 AND / OR / NOT：

```ts
type MissionCondition =
  | CountCondition
  | StateCondition
  | FactionCondition
  | CompositeCondition;

interface CountCondition {
  type: 'count';
  counter: string;          // 计数器名称
  operator: 'gte' | 'lte' | 'eq';
  value: number;
}

interface StateCondition {
  type: 'state';
  target: 'self' | 'other' | 'field';
  property: string;         // 如 'aliveCount', 'deadCount', 'infoCount'
  params?: Record<string, unknown>;
}

interface CompositeCondition {
  type: 'and' | 'or' | 'not';
  conditions: MissionCondition[];
}
```

### 任务胜利类型

```ts
type MissionWinType = 
  | 'solo'           // 单独获胜
  | 'joint'          // 与他人共同获胜（指定对象）
  | 'intercept'      // 拦截型：导致他人宣胜失败，自己获胜
  | 'conditional';   // 条件满足时选择对象
```

## 首批 10 个 MVP 角色中的白方任务

当前 4-8 人 MVP 中，白方可能出现的角色及其机密任务：

### 001 陈永仁（任务：场上人数非4，红/蓝方首先有角色死亡的阵营因你传出的情报宣告胜利）

```
Trigger: onVictoryDeclared
Condition: 宣告胜利的阵营是因死亡触发的（关联因果关系）
简化: 你传出的假情报导致某人死亡，且该阵营后续宣告胜利
```

### 002 刘建明（任务：一位玩家因你传出的情报宣告胜利时，你的胜利会导致他的宣告失败）

```
Trigger: onVictoryDeclared
Condition: 有人因你传出的情报而宣告胜利
WinType: intercept
```

### 004 福尔摩斯（任务：使用揭露获得第三张真情报）

```
Trigger: onSkillPhaseStart
Condition: 第三张真情报来自揭露技能
简化: 使用揭露获得真情报，且你面前有3张真情报
```

### 006 成步堂龙一（任务：使用逆转造成的情报数差大于等于2，且没有其他人宣告胜利）

```
Trigger: onSkillPhaseStart
Condition: 逆转使用过，信息数差≥2，无他人宣胜
```

### 008 开膛手杰克（任务：亲手让一名女性角色死亡）

```
Trigger: onPlayerDeath
Condition: 死者为女性且杀人为你
```

### 009 秋濑或（任务：※你死亡时拥有不少于2张真情报，且红蓝都有玩家存活）

```
Trigger: onSelfDeath (deathDelay)
Condition: 死亡时 ≥2 真情报，红蓝阵营都有存活
```

### 014 绫里千寻（任务：※你第一个死亡，发动灵媒后无人死亡或宣胜）

```
Trigger: onSelfDeath + onTurnEnd (deathDelay)
Condition: 第一个死亡 + 发动灵媒 + N 回合无死无宣胜
```

### 016 C.C（任务：※开场指定一名其他角色，该角色亲手使你死亡，且没有其他人宣告胜利）

```
Trigger: onGameStart + onSelfDeath + onTurnEnd (deathDelay)
Condition: 被指定角色杀你 + 无他人宣胜
```

### 017 绫波丽（任务：克隆造成其他角色的死亡，或每个存活玩家都有不少于两张情报）

```
Trigger: onSkillPhaseStart
Condition: (克隆杀人) OR (所有存活玩家 ≥2 情报)
```

### 020 我妻由乃（任务：发动新生后获得第三张真情报）

```
Trigger: onSkillPhaseStart
Condition: 新生已发动 + 真情报 ≥3
```

## 基础架构设计

### 1. 任务状态机

```
              ┌─────────┐
    开局 ──→ │ pending  │ ← 任务未触发
              └────┬────┘
                   │ 条件事件发生
              ┌────▼────┐
              │ active   │ ← 任务可检查
              └────┬────┘
                   │ 检查通过
              ┌────▼────┐
              │ met      │ ← 任务完成
              └────┬────┘
                   │ 宣胜窗口
              ┌────▼────┐
              │ declared │ ← 已宣胜
              └─────────┘
```

### 2. 与宣胜窗口集成

当前的 `VictoryDeclareWindow` 阶段需要扩展：

```ts
// 当前 handleDeclareVictory 白方限制
if (player.faction === 'white') return err('victory.whiteDisabled', 'MVP 暂未开放白方宣胜');

// 改为：
if (player.faction === 'white') {
  if (!game.config.enableWhiteSecretMission) return err('victory.whiteDisabled', ...);
  // 检查白方任务状态
  if (!isMissionMet(game, player.playerId)) return err('victory.missionNotMet', ...);
}
```

### 3. 白方自动宣胜检查

在每个技能阶段开始前（`VictoryDeclareWindow`），除了检查红蓝宣胜候选，还要检查白方：

```ts
private whiteMissionCandidates(game: GameState): PlayerId[] {
  return Object.values(game.players).filter(p => 
    p.aliveState === 'alive' && 
    p.faction === 'white' &&
    this.isMissionMet(game, p.playerId)
  ).map(p => p.playerId);
}
```

### 4. 死亡延迟宣胜（※标记任务）

部分白方任务标记为 `※`，表示死亡后仍可宣胜。需要：

```ts
// 在 player 上新增字段
interface Player {
  // ...existing fields
  missionDeathDelay?: boolean;  // 死亡后是否仍可宣胜
  missionDeclaredAt?: number;   // 任务完成的时刻
}
```

### 5. 拦截型任务

部分白方任务需要在其他阵营宣胜时触发，导致对方宣胜失败：

```ts
// 在 handleDeclareVictory 中
for (const whitePlayer of whiteMissionPlayers) {
  if (mission.winType === 'intercept' && conditionMet(mission, victoryContext)) {
    // 白方拦截宣胜
    game.winState = {
      finished: true,
      winner: { faction: 'white', playerId: whitePlayer.playerId, reason: 'intercept' }
    };
    return ok(game);
  }
}
```

## 最终 PK 系统

当场上只剩 1 白方 + 1 红/蓝存活时触发：

```ts
interface FinalPKState {
  active: boolean;
  whitePlayerId: PlayerId;
  opponentPlayerId: PlayerId;
  transferCount: number;        // PK 阶段累计传递次数
  bonusBurnGranted: boolean;    // 白方是否已获得额外烧毁
}
```

### PK 规则
1. 白方获得一次额外烧毁（传递、技能、濒死阶段可烧毁任意情报）
2. PK 后累计传递超过 10 张情报仍无人胜利 → 白方获胜
3. 红/蓝方仍可按正常条件宣胜

## 实现路线

### Phase 1: 任务框架（MVP 简化版）

1. 在 `GameConfig` 中启用 `enableWhiteSecretMission`
2. 在 `Player` 上添加 `missionStatus` 字段
3. 实现简单任务条件检查器（不依赖复杂 DSL）
4. 为每个首批 10 角色定义简化版任务检查逻辑
5. 扩展宣胜窗口接受白方宣胜
6. 添加白方宣胜候选提示

### Phase 2: 完整任务系统

1. 实现完整 `MissionCondition` DSL
2. 添加任务触发器系统（集成事件总线）
3. 实现拦截型任务
4. 实现死亡延迟宣胜
5. 实现最终 PK 机制

### Phase 3: 补全

1. 对接完整 25 角色白方任务
2. 添加白方任务状态 UI
3. 添加任务完成通知
4. 添加最终 PK UI

## 数据结构扩展

### GameConfig 扩展
```ts
interface GameConfig {
  // ...existing
  enableWhiteSecretMission: boolean;  // 改为 true
  enableFinalPK: boolean;
  pkMaxTransfers: number;  // 10
}
```

### Player 扩展
```ts
interface Player {
  // ...existing
  missionStatus: 'pending' | 'active' | 'met' | 'declared';
  missionCounters: Record<string, number>;  // 任务计数器
  missionTargetPlayerId?: PlayerId;  // C.C 等需要指定目标
  deathDelayedMission?: boolean;
}
```

### GameState 扩展
```ts
interface GameState {
  // ...existing
  finalPK?: FinalPKState;
  whiteMissionStates: Record<PlayerId, WhiteMissionState>;
}
```

## 事件扩展

```ts
type MissionEvent =
  | { type: 'MissionProgressed'; playerId: PlayerId; mission: string; detail: string }
  | { type: 'MissionCompleted'; playerId: PlayerId; mission: string }
  | { type: 'FinalPKStarted'; whitePlayerId: PlayerId; opponentPlayerId: PlayerId };
```

## 与现有技能引擎的集成

白方机密任务不直接修改技能引擎。任务检查作为一个独立的检查层，在以下节点执行：

1. **VictoryDeclareWindow 进入时**：检查所有存活白方任务
2. **handleDeclareVictory 调用时**：验证白方宣胜合法性
3. **PlayerDied 处理后**：检查死亡延迟任务
4. **TurnEnd 时**：检查回合触发型任务
5. **事件总线未来版本**：订阅特定事件触发任务检查

## MVP 第一期白方任务简化定义建议

| 角色 | 简化任务 |
|---|---|
| 001 陈永仁 | 你传出的假情报导致死亡，其阵营随后宣胜 |
| 002 刘建明 | 你传出的情报导致他人宣告胜利（拦截） |
| 004 福尔摩斯 | 使用揭露获得真情报且拥有3真 |
| 006 成步堂 | 使用逆转，信息差≥2，使用后回合无人宣胜 |
| 008 杰克 | 亲手杀女性角色 |
| 009 秋濑或 | ※死亡时拥有≥2真情报 |
| 014 绫里千寻 | ※第一个死亡 |
| 016 C.C | ※被指定目标亲手杀死 |
| 017 绫波丽 | 克隆导致死亡或每人≥2情报 |
| 020 我妻由乃 | 使用新生后获得第三真 |
