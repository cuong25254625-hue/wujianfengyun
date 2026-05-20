# 《无间风云》公屏/私密文本可见规则表

基于 `outputs/7.2_converted.txt` 整理。

## 可见性层级


| 层级       | 说明        | 数据存储                                    |
| -------- | --------- | --------------------------------------- |
| **公屏**   | 所有玩家可见    | `GameState.publicLog`                   |
| **私人**   | 仅指定玩家本人可见 | `GameState.privateLogs[playerId]`       |
| **目标可见** | 仅目标玩家可见   | `GameState.privateLogs[targetPlayerId]` |


## 完整的日志键可见性表

### 游戏进程类


| 日志键                              | 可见性    | 理由            |
| -------------------------------- | ------ | ------------- |
| `game.started`                   | 公屏     | 游戏开始，所有玩家可见   |
| `game.mvpCharactersAssigned`     | 公屏     | 角色分配完成，进度公开   |
| `game.characterSelectionStarted` | 公屏     | 选角开始，进度公开     |
| `game.allDead`                   | 公屏     | 全员死亡，公开       |
| `character.selectionReady`       | 公屏     | 某玩家已选择角色，进度公开 |
| `setup.choiceSubmitted`          | 公屏     | 开局选项提交，进度公开   |
| `setup.ccTargetRequired`         | 私人(目标) | C.C 目标选择仅本人可见 |
| `action.passed`                  | 公屏     | 阶段推进，公开       |


### 宣胜类


| 日志键                             | 可见性    | 理由            |
| ------------------------------- | ------ | ------------- |
| `victory.declared`              | 公屏     | 宣胜结果公开        |
| `mission.completed`             | 私人(本人) | 任务完成条件确认仅本人可见 |
| `mission.deathDelayMet.public`  | 公屏     | 死亡延迟任务触发公开    |
| `mission.deathDelayMet.private` | 私人(死者) | 死亡延迟任务详情仅本人   |


### 试探类（7.2 规则：试探结果只有试探者本人知道）


| 日志键             | 可见性     | 理由        |
| --------------- | ------- | --------- |
| `probe.used`    | 公屏      | 谁试探了谁，公开  |
| `probe.success` | 私人(试探者) | 试探结果仅本人知道 |
| `probe.failed`  | 私人(试探者) | 试探结果仅本人知道 |


### 传递类（7.2 规则：真假只有传递者知道，接收后才公开）


| 日志键                      | 可见性     | 理由              |
| ------------------------ | ------- | --------------- |
| `transfer.declared`      | 公屏      | 谁向谁传递，公开（不显示真假） |
| `transfer.declaredTruth` | 私人(传递者) | 自己传递的真假仅本人知道    |
| `transfer.settled`       | 公屏      | 接收后公开真假         |
| `transfer.rejected`      | 公屏      | 拒收公开            |
| `transfer.rejectedTruth` | 私人(传递者) | 拒收时真假仅传递者知道     |


### 常规技能类


| 日志键                 | 可见性 | 理由        |
| ------------------- | --- | --------- |
| `lock.used`         | 公屏  | 锁定使用公开    |
| `intercept.used`    | 公屏  | 截获使用公开    |
| `receive.decision`  | 公屏  | 接收/拒收决策公开 |
| `reaction.resolved` | 公屏  | 响应结算公开    |


### 人物技能类


| 日志键                         | 可见性     | 理由              |
| --------------------------- | ------- | --------------- |
| `character.jiuJiKnown`      | 私人(目标)  | 获知阵营线索仅本人知道     |
| `character.tanJiu`          | 私人(试探者) | 查看隐藏角色仅本人知道     |
| `character.zhaoZhang`       | 公屏      | 昭彰强制接收公开        |
| `character.lockInvalidated` | 公屏      | 锁定无效公开          |
| `character.mieJi`           | 公屏      | 灭迹使用公开          |
| `character.jieLuTrue`       | 公屏      | 揭露真情报公开         |
| `character.jieLuFalse`      | 公屏      | 揭露假情报公开         |
| `character.yiYi`            | 公屏      | 异议使用公开          |
| `character.niZhuan`         | 公屏      | 逆转使用公开          |
| `character.guanFan`         | 公屏      | 惯犯使用公开          |
| `character.duBo`            | 公屏      | 赌博使用公开（不透露谁得真假） |
| `character.bianHu`          | 公屏      | 辩护使用公开          |
| `character.lingMei`         | 公屏      | 灵媒使用公开          |
| `character.shouHu`          | 公屏      | 守护使用公开          |
| `character.xinShengSaved`   | 公屏      | 新生脱濒死公开         |
| `character.jiuJiReturn`     | 公屏      | 就计返还公开          |
| `character.bengHuai`        | 公屏      | 崩坏使用公开          |
| `character.zhenXiang`       | 公屏      | 真相触发公开          |
| `character.keLong`          | 公屏      | 克隆使用公开          |


### 生死类


| 日志键             | 可见性 | 理由      |
| --------------- | --- | ------- |
| `dying.started` | 公屏  | 濒死公开    |
| `player.died`   | 公屏  | 死亡翻身份公开 |


### 最终 PK 类


| 日志键                           | 可见性 | 理由         |
| ----------------------------- | --- | ---------- |
| `finalPk.started`             | 公屏  | 进入最终 PK 公开 |
| `finalPk.burnUsed`            | 公屏  | 额外烧毁使用公开   |
| `finalPk.whiteWinByTransfers` | 公屏  | PK 胜利公开    |


### GM 类


| 日志键                        | 可见性    | 理由            |
| -------------------------- | ------ | ------------- |
| `gm.forceAdvance`          | 公屏     | GM 推进公开       |
| `gm.forceReceive`          | 公屏     | GM 强制接收公开     |
| `gm.skipTurn`              | 公屏     | GM 跳过公开       |
| `mission.ccTargetSelected` | 私人(本人) | C.C 目标选择仅本人知道 |


## 实现要点

1. **试探结果**已改为私人可见（`probe.success`/`probe.failed` → `addPrivateLog`）
2. **传递真假**在声明时不公开（`transfer.declared` 不含 truth），接收后才公开
3. **拒收时的真假**不公开，仅传递者本人通过私人记录知晓
4. **就计/探究**等涉及身份线索的技能结果走私人记录
5. 服务端通过 `visibility-policy.ts` 的 `privateLogKeys` 集合过滤公屏日志

