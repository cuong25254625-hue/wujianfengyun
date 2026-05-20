import type { RoomView } from '@wujian/shared';

interface LogPanelProps {
  room: RoomView | undefined;
  messages: string[];
}

type LogParams = Record<string, string | number | boolean>;
type PublicLogEntry = NonNullable<RoomView['game']>['publicLog'][number];

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
  'game.mvpCharactersAssigned': '系统已分配 {characterCount} 名基础人物。',
  'action.passed': '{player} 在{window}选择跳过。',
  'victory.declared': '{player} 宣告{faction}胜利，原因：{reason}。',
  'probe.success': '{player} 试探 {target} 成功，猜测阵营：{declaredFaction}。',
  'probe.failed': '{player} 试探 {target} 失败，猜测阵营：{declaredFaction}。',
  'transfer.declared': '{from} 向 {target} 声明传递{truth}。',
  'lock.used': '{player} 锁定 {target}，该情报必须接收。',
  'intercept.used': '{player} 截获来自 {from} 的传递。',
  'receive.decision': '{player} 选择{decision}情报。',
  'reaction.resolved': '响应结算完成，最终接收者为 {receiver}。',
  'transfer.settled': '情报结算完成，{owner} 获得{truth}。',
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
};

const importantKeys = new Set([
  'victory.declared',
  'dying.started',
  'player.died',
  'character.guanFan',
  'character.xinShengSaved',
  'character.jiuJiReturn',
  'character.bengHuai',
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

export function LogPanel({ room, messages }: LogPanelProps) {
  const publicLogs = room?.game?.publicLog.slice(0, 30) ?? [];
  const clientMessages = messages.slice(0, 12).map(formatClientMessage);

  return (
    <section className="card log-card">
      <h2>记录</h2>
      <div className="log-list">
        {clientMessages.length > 0 && (
          <section className="log-section">
            <h3>连接提示</h3>
            {clientMessages.map((message, index) => (
              <div className="log-entry client-log" key={`${message}-${index}`}>{message}</div>
            ))}
          </section>
        )}
        <section className="log-section">
          <h3>对局记录</h3>
          {publicLogs.length === 0 && <p className="muted">开局后会在这里显示关键记录。</p>}
          {publicLogs.map((entry) => (
            <div className={`log-entry ${importantKeys.has(entry.messageKey) ? 'important' : ''}`} key={entry.id}>
              {formatPublicLog(entry)}
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}
