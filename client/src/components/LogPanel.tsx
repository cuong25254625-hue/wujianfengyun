import type { PrivatePlayerView, RoomView, SessionView } from '@wujian/shared';

interface LogPanelProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
  messages: string[];
}

type LogParams = Record<string, string | number | boolean>;
type PublicLogEntry = NonNullable<RoomView['game']>['publicLog'][number];
type PrivateLogEntry = { id: string; messageKey: string; params: Record<string, string | number | boolean>; createdAt: number };

const factionText: Record<string, string> = {
  red: '红方',
  blue: '蓝方',
  white: '白方',
};

const truthText: Record<string, string> = {
  true: '真情报',
  false: '假情报',
};

const decisionText: Record<string, string> = {
  receive: '接收',
  reject: '拒收',
};

const reasonText: Record<string, string> = {
  threeTrueInfo: '三张真情报',
  clearField: '清场',
  secretMission: '完成机密任务',
  gmForceEnd: 'GM 强制结束',
  falseInfoLimit: '假情报达到上限',
};

const windowText: Record<string, string> = {
  victoryDeclareWindow: '宣胜窗口',
  regularSkillWindow: '技能/响应窗口',
  receiveDecision: '接收窗口',
  dyingSkillWindow: '濒死窗口',
};

const valueText = (value: string | number | boolean | undefined): string => {
  if (value === undefined) return '未知';
  const text = String(value);
  return factionText[text] ?? truthText[text] ?? decisionText[text] ?? reasonText[text] ?? windowText[text] ?? text;
};

const template = (text: string, params: LogParams): string =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => valueText(params[key]));

const logTemplates: Record<string, string> = {
  'game.started': '游戏开始，{playerCount} 名玩家入局。',
  'game.characterSelectionStarted': '进入私密选角阶段，每人可查 {optionsPerPlayer} 个角色选项。',
  'game.mvpCharactersAssigned': '系统已分配 {characterCount} 名基础人物。',
  'game.allDead': '所有玩家均已死亡，游戏结束。',
  'action.passed': '{player} 在{window}选择跳过。',
  'victory.declared': '{player} 宣告{faction}胜利，原因：{reason}。',
  'probe.used': '{player} 试探了 {target}。',
  'probe.success': '你试探 {target} 成功，对方阵营为{declaredFaction}。',
  'probe.failed': '你试探 {target} 失败，猜测的阵营{declaredFaction}不正确。',
  'transfer.declared': '{from} 向 {target} 声明传递情报。',
  'transfer.declaredTruth': '你向 {target} 声明传递{truth}。',
  'transfer.settled': '情报结算完成，{owner} 获得{truth}。',
  'transfer.rejected': '{from} 向 {target} 传递的情报被拒收。',
  'transfer.rejectedTruth': '你向 {target} 传递的{truth}被拒收退回。',
  'lock.used': '{player} 锁定 {target}，该情报必须接收。',
  'intercept.used': '{player} 截获来自 {from} 的传递。',
  'receive.decision': '{player} 选择{decision}情报。',
  'reaction.resolved': '响应结算完成，最终接收者为 {receiver}。',
  'dying.started': '{player} 因{cause}进入濒死。',
  'player.died': '{player} 死亡并翻开身份：{faction}。',
  'character.jiuJiKnown': '{player} 因城府/就计获知 {source} 的阵营线索。',
  'character.tanJiu': '{player} 发动探究，查看了 {target} 的隐藏角色线索。',
  'character.zhaoZhang': '{player} 的昭彰生效，{target} 被迫接收。',
  'character.lockInvalidated': '{target} 使 {player} 的锁定无效。',
  'character.mieJi': '{player} 发动灭迹，烧毁 {target} 面前 {count} 张情报。',
  'character.jieLuTrue': '{player} 发动揭露，揭出真情报并直接获得。',
  'character.jieLuFalse': '{player} 发动揭露，发现这是一张假情报。',
  'character.yiYi': '{player} 发动异议，暂时禁止 {target} 的人物技能。',
  'character.niZhuan': '{player} 发动逆转，与 {target} 交换面前情报。',
  'character.guanFan': '{player} 发动惯犯，令 {target} 获得两张假情报。',
  'character.duBo': '{player} 发动赌博，与 {target} 分别获得一张情报。',
  'character.bianHu': '{player} 发动辩护，与 {target} 等量交换 {count} 组真/假情报。',
  'character.lingMei': '{player} 发动灵媒，借 {dead} 之名向 {target} 传递{truth}。',
  'character.shouHu': '{player} 发动守护，烧毁 {target} 面前一张假情报。',
  'character.xinShengSaved': '{player} 发动新生，脱离濒死。',
  'character.jiuJiReturn': '{player} 发动就计，将假情报返还给 {target}。',
  'character.bengHuai': '{player} 发动崩坏，令 {target} 获得一张假情报。',
  'character.zhenXiang': '{player} 因真相获得一次额外试探。',
  'character.keLong': '{player} 发动克隆，同步 {target} 的情报数量。',
  'character.caiJue': '{player} 发动裁决，令 {target} 获得一张假情报。',
  'character.baZhen': '{player} 发动八阵，烧毁 {target} 面前 {count} 张假情报。',
  'character.souCha': '你发动搜查，获知 {target} 的阵营线索：{faction}。',
  'character.souChaPublic': '{player} 对 {target} 发动搜查。',
  'character.shuJu': '{player} 发动竖锯，令 {target} 获得假情报，并获得一张真情报。',
  'character.qiZhaPeek': '你发动欺诈看破当前传递：{truth}。',
  'character.qiZhaDisable': '{player} 发动欺诈，暂时禁止 {target} 的人物技能。',
  'character.kaiYan': '你发动开眼，获知 {target} 的角色/阵营线索：{character} / {faction}。',
  'character.kaiYanPublic': '{player} 对 {target} 发动开眼。',
  'character.jiuShu': '{player} 发动救赎，烧毁 {target} 面前 {count} 张假情报。',
  'character.baoMi': '你发动保密，获知 {target} 的阵营线索：{faction}。',
  'character.baoMiPublic': '{player} 对 {target} 发动保密。',
  'character.jiaoJi': '你发动交际，获知 {target} 的阵营线索：{faction}。',
  'character.jiaoJiPublic': '{player} 对 {target} 发动交际。',
  'character.jueQing': '{player} 发动绝情，令 {target} 获得一张假情报。',
  'character.changWei': '{player} 发动厂卫，烧毁 {target} 面前 {count} 张假情报。',
  'character.dieZhan': '{player} 发动谍战，与 {target} 交换各一张情报。',
  'character.fuFu': '{player} 发动夫妇，烧毁 {target} 面前 {count} 张情报。',
  'mission.completed': '机密任务条件确认：{reason}。',
  'mission.deathDelayMet.public': '{player} 机密任务※条件满足，死亡后可在后续宣胜窗口宣告。',
  'mission.deathDelayMet.private': '{player} 的机密任务（※）已确认：{reason}',
  'finalPk.started': '场上仅剩 {white}（白方）和 {opponent}，进入最终 PK！',
  'finalPk.burnUsed': '最终 PK：{player} 烧毁 {target} 面前 {count} 张情报。',
  'finalPk.whiteWinByTransfers': '最终 PK：{player} 因累计传递超过 {count} 张无人胜利，白方获胜！',
  'finalPk.whiteWinByOpponentDeath': '最终 PK：对手死亡，{player}（白方）获胜。',
  'finalPk.endedByDeath': '最终 PK：{player}（{faction}）因白方死亡而获胜。',
  'character.selectionReady': '{player} 已选好角色。',
  'setup.choiceSubmitted': '{player} 已提交{choice}选项。',
  'mission.ccTargetSelected': '你已指定 {target} 为机密任务目标。',
  'bot.characterSelected': '{player} 自动选择角色。',
  'bot.setupChoiceSubmitted': '{player} 自动提交开局选项。',
  'setup.ccTargetRequired': '{player} 需要开局指定一名其他玩家作为机密任务目标。',
  'bot.autoPass': '{player} 自动选择不响应。',
  'gm.forceAdvance': 'GM 强制推进当前阶段。',
  'gm.forceEnd': 'GM 强制结束了当前对局。',
  'gm.forceReceive': 'GM 强制令 {receiver} 接收情报。',
  'gm.skipTurn': 'GM 跳过了 {player} 的传递阶段。',
};

const importantKeys = new Set([
  'victory.declared',
  'dying.started',
  'player.died',
  'character.guanFan',
  'character.xinShengSaved',
  'character.jiuJiReturn',
  'character.bengHuai',
  'mission.completed',
  'mission.deathDelayMet.public',
  'finalPk.started',
  'finalPk.whiteWinByTransfers',
  'finalPk.whiteWinByOpponentDeath',
  'finalPk.endedByDeath',
]);

function formatPublicLog(entry: PublicLogEntry): string {
  const pattern = logTemplates[entry.messageKey];
  if (pattern) return template(pattern, entry.params);
  const readableParams = Object.entries(entry.params)
    .map(([key, value]) => `${key}=${valueText(value)}`)
    .join('，');
  return readableParams ? `系统记录：${readableParams}` : '系统记录已更新。';
}

function formatClientMessage(message: string): string {
  if (message.startsWith('info:')) return message.replace(/^info:\s*/, '提示：');
  if (message.startsWith('warn:')) return message.replace(/^warn:\s*/, '警告：');
  if (message.startsWith('error:')) return message.replace(/^error:\s*/, '错误：');
  return message;
}

const hasPrivateInfo = (player: unknown): player is PrivatePlayerView =>
  typeof player === 'object' && player !== null && 'privateLog' in player;

export function LogPanel({ room, session, messages }: LogPanelProps) {
  const isInGame = Boolean(room?.game);
  const publicLogs = room?.game?.publicLog.slice(0, 30) ?? [];
  const mobilePublicLogs = room?.game?.publicLog.filter((entry) => importantKeys.has(entry.messageKey)).slice(0, 8) ?? [];
  const me = room?.game?.players.find((player) => player.userId === session?.userId);
  const privateLog = (me && hasPrivateInfo(me) ? me.privateLog : []) as PrivateLogEntry[];
  const clientMessages = messages.slice(0, 12).map(formatClientMessage);

  return (
    <section className="card log-card">
      <details className="mobile-log-details" open={!isInGame}>
        <summary>
          <span>记录</span>
          {isInGame && <small>点击展开 / 收起</small>}
        </summary>
        <div className="log-list">
          {clientMessages.length > 0 && (
            <section className="log-section">
              <h3>连接提示</h3>
              {clientMessages.map((message, index) => (
                <div className="log-entry client-log" key={`${message}-${index}`}>{message}</div>
              ))}
            </section>
          )}
          {privateLog.length > 0 && (
            <section className="log-section">
              <h3>私人记录</h3>
              {privateLog.map((entry) => (
                <div className="log-entry private-log" key={entry.id}>
                  {formatPublicLog(entry)}
                </div>
              ))}
            </section>
          )}
          <section className="log-section mobile-important-log">
            <h3>重点记录</h3>
            {mobilePublicLogs.length === 0 && <p className="muted">暂无重点记录。</p>}
            {mobilePublicLogs.map((entry) => (
              <div className="log-entry important" key={`mobile-${entry.id}`}>
                {formatPublicLog(entry)}
              </div>
            ))}
          </section>
          <section className="log-section full-log-section">
            <h3>对局记录</h3>
            {publicLogs.length === 0 && <p className="muted">开局后会在这里显示关键记录。</p>}
            {publicLogs.map((entry) => (
              <div className={`log-entry ${importantKeys.has(entry.messageKey) ? 'important' : ''}`} key={entry.id}>
                {formatPublicLog(entry)}
              </div>
            ))}
          </section>
        </div>
      </details>
    </section>
  );
}
