import { useMemo, useState } from 'react';
import type { Faction, PlayerCommand, PlayerId, PrivatePlayerView, RoomView, SessionView } from '@wujian/shared';
import { phaseLabel } from '@wujian/shared';

interface GameBoardProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
  onPlayerCommand: (command: PlayerCommand) => void;
}

const factionLabel: Record<Faction, string> = {
  red: '红方',
  blue: '蓝方',
  white: '白方',
};

const hasPrivateInfo = (player: unknown): player is PrivatePlayerView =>
  typeof player === 'object' && player !== null && 'regularSkills' in player && 'faction' in player;

export function GameBoard({ room, session, onPlayerCommand }: GameBoardProps) {
  const game = room?.game;
  const me = game?.players.find((player) => player.userId === session?.userId);
  const aliveTargets = useMemo(() => game?.players.filter((player) => player.aliveState === 'alive' && player.playerId !== me?.playerId) ?? [], [game, me]);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferTruth, setTransferTruth] = useState<'true' | 'false'>('true');
  const [probeTarget, setProbeTarget] = useState('');
  const [probeFaction, setProbeFaction] = useState<Faction>('red');
  const [skillTarget, setSkillTarget] = useState('');
  const [skillSecondTarget, setSkillSecondTarget] = useState('');
  const [skillTruth, setSkillTruth] = useState<'true' | 'false'>('true');

  if (!game || !me) {
    return (
      <section className="card">
        <h2>对局</h2>
        <p className="muted">等待房主开始游戏。开局后这里会显示可操作按钮。</p>
      </section>
    );
  }

  const activePlayer = game.players.find((player) => player.seatIndex === game.activeSeatIndex);
  const pending = game.pendingActionsForMe[0];
  const activeTarget = aliveTargets[0]?.playerId ?? '';
  const selectedTransferTarget = transferTarget || activeTarget;
  const selectedProbeTarget = probeTarget || activeTarget;
  const selectedSkillTarget = skillTarget || activeTarget;
  const selectedSkillSecondTarget = skillSecondTarget || (aliveTargets.find((player) => player.playerId !== selectedSkillTarget)?.playerId ?? '');
  const deadTargets = game.players.filter((player) => player.aliveState === 'dead');
  const currentTransfer = game.currentTransfer;
  const isMyTurn = activePlayer?.playerId === me.playerId;

  const pass = () => {
    if (pending) onPlayerCommand({ type: 'PassPendingAction', playerId: me.playerId, pendingActionId: pending.pendingActionId });
  };

  const declareVictory = (reason: 'threeTrueInfo' | 'clearField') => {
    if (me.revealedFaction === 'red' || me.revealedFaction === 'blue') {
      onPlayerCommand({ type: 'DeclareVictory', playerId: me.playerId, faction: me.revealedFaction, reason });
    }
  };

  const useCharacterSkill = (skillId: string, targetPlayerId?: string, secondaryTargetPlayerId?: string) => {
    onPlayerCommand({
      type: 'UseCharacterSkill',
      playerId: me.playerId,
      skillId,
      ...(targetPlayerId ? { targetPlayerId: targetPlayerId as PlayerId } : {}),
      ...(secondaryTargetPlayerId ? { secondaryTargetPlayerId: secondaryTargetPlayerId as PlayerId } : {}),
      transfer: { targetPlayerId: (targetPlayerId || selectedSkillTarget) as PlayerId, truth: skillTruth },
    });
  };

  return (
    <section className="card highlight">
      <h2>对局</h2>
      <div className="table-status">
        <p>阶段：{phaseLabel[game.phase.phase]}（{game.phase.phase}）</p>
        <p>第 {game.roundNumber} 轮，当前玩家：<strong>{activePlayer?.displayName ?? `座位 #${game.activeSeatIndex + 1}`}</strong></p>
        <p>我的身份：<strong>{me.revealedFaction ? factionLabel[me.revealedFaction] : '未知'}</strong></p>
      </div>
      <SystemHints hints={game.systemHints} />
      <div className="my-dashboard">
        <div className="my-character">
          {me.characterImageUrl && <img src={me.characterImageUrl} alt={me.characterName ?? '角色'} />}
          <p>我的角色：<strong>{me.characterName ?? '未分配'}</strong>{me.characterVisibility ? `（${me.characterVisibility === 'hidden' ? '隐藏' : '公开'}）` : ''}</p>
        </div>
        {hasPrivateInfo(me) && <SkillBook skills={me.ownSkills} />}
      </div>
      {game.winner && <p className="ok">游戏结束：{factionLabel[game.winner.faction]}胜利（{game.winner.reason}）</p>}

      {currentTransfer && (
        <div className="subcard">
          <strong>当前传递</strong>
          <p>
            {nameOf(game, currentTransfer.fromPlayerId)} → {nameOf(game, currentTransfer.targetPlayerId)}，情报：{currentTransfer.declaredTruth === 'true' ? '真' : '假'}
            {currentTransfer.finalReceiverPlayerId ? `，最终接收者：${nameOf(game, currentTransfer.finalReceiverPlayerId)}` : ''}
            {currentTransfer.forcedReceive ? '，已锁定' : ''}
          </p>
        </div>
      )}

      <div className="actions-panel">
        {game.phase.phase === 'VictoryDeclareWindow' && pending && (
          <div className="subcard">
            <h3>宣胜窗口</h3>
            <div className="actions">
              <button onClick={() => declareVictory('threeTrueInfo')}>三真宣胜</button>
              <button onClick={() => declareVictory('clearField')}>清场宣胜</button>
              <button onClick={pass}>暂不宣胜</button>
            </div>
          </div>
        )}

        {game.phase.phase === 'SkillWindow' && pending && isMyTurn && (
          <div className="subcard">
            <h3>技能阶段</h3>
            <label>
              试探目标
              <select value={selectedProbeTarget} onChange={(event) => setProbeTarget(event.target.value)}>
                {aliveTargets.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
              </select>
            </label>
            <label>
              猜测阵营
              <select value={probeFaction} onChange={(event) => setProbeFaction(event.target.value as Faction)}>
                <option value="red">红方</option>
                <option value="blue">蓝方</option>
                <option value="white">白方</option>
              </select>
            </label>
            <div className="actions">
              <button disabled={!selectedProbeTarget} onClick={() => onPlayerCommand({ type: 'UseProbe', playerId: me.playerId, targetPlayerId: selectedProbeTarget as PlayerId, declaredFaction: probeFaction })}>使用试探</button>
              <button onClick={pass}>进入传递阶段</button>
            </div>
          </div>
        )}

        {game.phase.phase === 'TransferDeclare' && isMyTurn && (
          <div className="subcard">
            <h3>传递阶段</h3>
            <label>
              接收目标
              <select value={selectedTransferTarget} onChange={(event) => setTransferTarget(event.target.value)}>
                {aliveTargets.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
              </select>
            </label>
            <label>
              情报类型
              <select value={transferTruth} onChange={(event) => setTransferTruth(event.target.value as 'true' | 'false')}>
                <option value="true">真情报</option>
                <option value="false">假情报</option>
              </select>
            </label>
            <button disabled={!selectedTransferTarget} onClick={() => onPlayerCommand({ type: 'DeclareTransfer', playerId: me.playerId, targetPlayerId: selectedTransferTarget as PlayerId, truth: transferTruth })}>声明传递</button>
          </div>
        )}

        {game.phase.phase === 'ReactionWindow' && pending && currentTransfer && (
          <div className="subcard">
            <h3>响应窗口</h3>
            <div className="actions">
              {currentTransfer.fromPlayerId === me.playerId && (
                <button onClick={() => onPlayerCommand({ type: 'UseLock', playerId: me.playerId, transferId: currentTransfer.transferId, targetPlayerId: currentTransfer.targetPlayerId })}>锁定原接收者</button>
              )}
              {currentTransfer.fromPlayerId !== me.playerId && currentTransfer.targetPlayerId !== me.playerId && (
                <button onClick={() => onPlayerCommand({ type: 'UseIntercept', playerId: me.playerId, transferId: currentTransfer.transferId, targetPlayerId: currentTransfer.fromPlayerId })}>截获</button>
              )}
              <button onClick={pass}>不响应</button>
            </div>
          </div>
        )}

        {game.phase.phase === 'ReceiveDecision' && currentTransfer && (currentTransfer.finalReceiverPlayerId ?? currentTransfer.targetPlayerId) === me.playerId && (
          <div className="subcard">
            <h3>接收/拒收</h3>
            <div className="actions">
              <button onClick={() => onPlayerCommand({ type: 'ReceiveInfo', playerId: me.playerId, transferId: currentTransfer.transferId, decision: 'receive' })}>接收</button>
              <button disabled={currentTransfer.forcedReceive} onClick={() => onPlayerCommand({ type: 'ReceiveInfo', playerId: me.playerId, transferId: currentTransfer.transferId, decision: 'reject' })}>拒收</button>
            </div>
          </div>
        )}

        <div className="subcard">
          <h3>人物技能</h3>
          <SkillSelectors
            aliveTargets={aliveTargets}
            deadTargets={deadTargets}
            selectedSkillTarget={selectedSkillTarget}
            selectedSkillSecondTarget={selectedSkillSecondTarget}
            skillTruth={skillTruth}
            onTargetChange={setSkillTarget}
            onSecondTargetChange={setSkillSecondTarget}
            onTruthChange={setSkillTruth}
          />
          <div className="actions">
            {me.characterId === 'char_002_liu_jian_ming' && <button onClick={() => useCharacterSkill('mie_ji', selectedSkillTarget)}>灭迹</button>}
            {me.characterId === 'char_004_holmes' && currentTransfer && currentTransfer.fromPlayerId !== me.playerId && <button onClick={() => useCharacterSkill('jie_lu')}>揭露</button>}
            {me.characterId === 'char_006_naruhodo' && game.phase.phase === 'SkillWindow' && <button onClick={() => useCharacterSkill('yi_yi', selectedSkillTarget)}>异议</button>}
            {me.characterId === 'char_006_naruhodo' && ['SkillWindow', 'TransferDeclare'].includes(game.phase.phase) && <button onClick={() => useCharacterSkill('ni_zhuan', selectedSkillTarget)}>逆转</button>}
            {me.characterId === 'char_008_jack_the_ripper' && game.phase.phase === 'SkillWindow' && <button onClick={() => useCharacterSkill('guan_fan', selectedSkillTarget)}>惯犯</button>}
            {me.characterId === 'char_009_akise_aru' && ['SkillWindow', 'DyingWindow'].includes(game.phase.phase) && <button onClick={() => useCharacterSkill('du_bo', selectedSkillTarget)}>赌博</button>}
            {me.characterId === 'char_014_ayazato_chihiro' && game.phase.phase === 'SkillWindow' && <button onClick={() => useCharacterSkill('bian_hu', selectedSkillTarget)}>辩护</button>}
            {me.characterId === 'char_014_ayazato_chihiro' && game.phase.phase === 'SkillWindow' && deadTargets.length > 0 && <button onClick={() => useCharacterSkill('ling_mei', deadTargets[0]?.playerId, selectedSkillTarget)}>灵媒借传</button>}
            {me.characterId === 'char_016_cc' && game.phase.phase === 'TransferDeclare' && <button onClick={() => useCharacterSkill('qi_yue', selectedSkillTarget, selectedSkillSecondTarget)}>契约双传</button>}
            {me.characterId === 'char_016_cc' && game.phase.phase === 'SkillWindow' && <button onClick={() => useCharacterSkill('shou_hu')}>守护</button>}
            {me.characterId === 'char_020_gasai_yuno' && game.phase.phase === 'SkillWindow' && <button onClick={() => useCharacterSkill('beng_huai', selectedSkillTarget)}>崩坏</button>}
          </div>
        </div>

        {game.phase.phase === 'DyingWindow' && pending && (
          <div className="subcard danger">
            <h3>濒死阶段</h3>
            <p>可先尝试濒死人物技能；若无法解除濒死，再点击结算死亡。</p>
            <div className="actions">
              {me.characterId === 'char_001_chen_yong_ren' && <button onClick={() => useCharacterSkill('jiu_ji')}>就计返还</button>}
              {me.characterId === 'char_020_gasai_yuno' && <button onClick={() => useCharacterSkill('xin_sheng')}>新生</button>}
              <button onClick={pass}>结算死亡</button>
            </div>
          </div>
        )}
      </div>

      {!pending && !isMyTurn && <p className="muted">等待其他玩家操作。</p>}
    </section>
  );
}

interface SkillSelectorsProps {
  aliveTargets: NonNullable<RoomView['game']>['players'];
  deadTargets: NonNullable<RoomView['game']>['players'];
  selectedSkillTarget: string;
  selectedSkillSecondTarget: string;
  skillTruth: 'true' | 'false';
  onTargetChange: (value: string) => void;
  onSecondTargetChange: (value: string) => void;
  onTruthChange: (value: 'true' | 'false') => void;
}

function SkillSelectors({
  aliveTargets,
  deadTargets,
  selectedSkillTarget,
  selectedSkillSecondTarget,
  skillTruth,
  onTargetChange,
  onSecondTargetChange,
  onTruthChange,
}: SkillSelectorsProps) {
  return (
    <div className="skill-selectors">
      <label>
        技能目标
        <select value={selectedSkillTarget} onChange={(event) => onTargetChange(event.target.value)}>
          {aliveTargets.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
        </select>
      </label>
      <label>
        第二目标
        <select value={selectedSkillSecondTarget} onChange={(event) => onSecondTargetChange(event.target.value)}>
          {aliveTargets.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
        </select>
      </label>
      <label>
        技能情报
        <select value={skillTruth} onChange={(event) => onTruthChange(event.target.value as 'true' | 'false')}>
          <option value="true">真情报</option>
          <option value="false">假情报</option>
        </select>
      </label>
      {deadTargets.length > 0 && <p className="muted">灵媒默认使用第一名死者：{deadTargets[0]?.displayName}</p>}
    </div>
  );
}

function SystemHints({ hints }: { hints: NonNullable<RoomView['game']>['systemHints'] }) {
  if (hints.length === 0) return null;
  return (
    <div className="system-hints">
      {hints.map((hint, index) => (
        <article className={`system-hint ${hint.level}`} key={`${hint.title}-${index}`}>
          <strong>{hint.title}</strong>
          <p>{hint.message}</p>
          {hint.actionText && <span className="badge">{hint.actionText}</span>}
        </article>
      ))}
    </div>
  );
}

function SkillBook({ skills }: { skills: PrivatePlayerView['ownSkills'] }) {
  if (skills.length === 0) return <p className="muted">暂无技能说明。</p>;
  return (
    <section className="skill-book">
      <h3>我的技能</h3>
      <div className="skill-list">
        {skills.map((skill) => (
          <article className={`skill-card ${skill.usable ? 'usable' : ''}`} key={skill.skillId}>
            <header>
              <strong>{skill.name}</strong>
              <span>{skill.type === 'regular' ? '常规' : '角色'} / {skill.timing}</span>
            </header>
            <p>{skill.description}</p>
            {skill.hint && <p className="muted">{skill.hint}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function nameOf(game: NonNullable<RoomView['game']>, playerId: PlayerId): string {
  return game.players.find((player) => player.playerId === playerId)?.displayName ?? playerId;
}
