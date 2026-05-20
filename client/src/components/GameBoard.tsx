import { useMemo, useState } from 'react';
import type { Faction, GamePhase, PlayerCommand, PlayerId, PrivatePlayerView, RoomView, SessionView } from '@wujian/shared';
import { phaseLabel } from '@wujian/shared';

interface GameBoardProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
  onPlayerCommand: (command: PlayerCommand) => void;
  mode?: 'panel' | 'table';
}

const factionLabel: Record<Faction, string> = {
  red: '红方',
  blue: '蓝方',
  white: '白方',
};

const victoryReasonLabel: Record<'threeTrueInfo' | 'clearField', string> = {
  threeTrueInfo: '三张真情报',
  clearField: '清场',
};

const hasPrivateInfo = (player: unknown): player is PrivatePlayerView =>
  typeof player === 'object' && player !== null && 'regularSkills' in player && 'faction' in player;

export function GameBoard({ room, session, onPlayerCommand, mode = 'panel' }: GameBoardProps) {
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
      <section className="card game-card">
        <h2>对局操作</h2>
        <p className="muted">等待房主开始游戏。开局后这里会显示流程提示和可操作按钮。</p>
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

  const hasProminentAction = pending || (game.phase.phase === 'TransferDeclare' && isMyTurn);
  const isTableMode = mode === 'table';

  return (
    <section className={`card game-card highlight ${isTableMode ? 'table-control-card' : ''}`}>
      <div className="game-card-header">
        <div>
          <h2>{isTableMode ? `第 ${game.roundNumber} 轮` : '当前进程'}</h2>
          <p className="muted">{isTableMode ? '在牌桌中央完成当前操作。' : '跟随高亮流程完成本回合操作。'}</p>
        </div>
        <div className="status-strip">
          <span>阶段：<strong>{phaseLabel[game.phase.phase]}</strong></span>
          <span>当前：<strong>{activePlayer?.displayName ?? `座位 #${game.activeSeatIndex + 1}`}</strong></span>
          <span>我的身份：<strong>{me.revealedFaction ? factionLabel[me.revealedFaction] : '未知'}</strong></span>
        </div>
      </div>

      {!isTableMode && <PhaseProgress phase={game.phase.phase} />}
      <SystemHints hints={game.systemHints} compact={isTableMode} />

      {game.winner && (
        <p className="ok win-banner">
          游戏结束：{factionLabel[game.winner.faction]}胜利（{victoryReasonLabel[game.winner.reason] ?? '达成胜利条件'}）
        </p>
      )}

      {currentTransfer && (
        <div className="subcard transfer-summary">
          <strong>当前传递</strong>
          <p>
            {nameOf(game, currentTransfer.fromPlayerId)} → {nameOf(game, currentTransfer.targetPlayerId)}，情报：{currentTransfer.declaredTruth === 'true' ? '真情报' : '假情报'}
            {currentTransfer.finalReceiverPlayerId ? `，最终接收者：${nameOf(game, currentTransfer.finalReceiverPlayerId)}` : ''}
            {currentTransfer.forcedReceive ? '，已锁定必须接收' : ''}
          </p>
        </div>
      )}

      {!isTableMode && (
        <div className="my-dashboard compact-dashboard">
          <div className="my-character">
            {me.characterImageUrl && <img src={me.characterImageUrl} alt={me.characterName ?? '角色'} />}
            <p>我的角色：<strong>{me.characterName ?? '未分配'}</strong>{me.characterVisibility ? `（${me.characterVisibility === 'hidden' ? '隐藏' : '公开'}）` : ''}</p>
          </div>
          {hasPrivateInfo(me) && <SkillBook skills={me.ownSkills} />}
        </div>
      )}

      <div className="actions-panel">
        {game.phase.phase === 'VictoryDeclareWindow' && pending && (
          <div className="subcard action-focus">
            <h3>宣胜窗口</h3>
            <p className="muted">如果已经满足胜利条件，可以在技能阶段开始前宣胜；否则跳过。</p>
            <div className="actions">
              <button onClick={() => declareVictory('threeTrueInfo')}>三真宣胜</button>
              <button onClick={() => declareVictory('clearField')}>清场宣胜</button>
              <button onClick={pass}>暂不宣胜</button>
            </div>
          </div>
        )}

        {game.phase.phase === 'SkillWindow' && pending && isMyTurn && (
          <div className="subcard action-focus">
            <h3>技能阶段</h3>
            <p className="muted">可以使用试探或合适的人物技能；完成后进入传递阶段。</p>
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
          <div className="subcard action-focus">
            <h3>传递阶段</h3>
            <p className="muted">选择一名存活玩家，并声明这张情报是真还是假。</p>
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
          <div className="subcard action-focus">
            <h3>响应窗口</h3>
            <p className="muted">符合条件的玩家可以锁定或截获；不响应则等待其他玩家。</p>
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
          <div className="subcard action-focus">
            <h3>接收/拒收</h3>
            <p className="muted">接收则情报归你；拒收则退回传递者。被锁定时不能拒收。</p>
            <div className="actions">
              <button onClick={() => onPlayerCommand({ type: 'ReceiveInfo', playerId: me.playerId, transferId: currentTransfer.transferId, decision: 'receive' })}>接收</button>
              <button disabled={currentTransfer.forcedReceive} onClick={() => onPlayerCommand({ type: 'ReceiveInfo', playerId: me.playerId, transferId: currentTransfer.transferId, decision: 'reject' })}>拒收</button>
            </div>
          </div>
        )}

        {game.phase.phase === 'DyingWindow' && pending && (
          <div className="subcard danger action-focus">
            <h3>濒死阶段</h3>
            <p>可先尝试濒死人物技能；若无法解除濒死，再点击结算死亡。</p>
            <div className="actions">
              {me.characterId === 'char_001_chen_yong_ren' && <button onClick={() => useCharacterSkill('jiu_ji')}>就计返还</button>}
              {me.characterId === 'char_020_gasai_yuno' && <button onClick={() => useCharacterSkill('xin_sheng')}>新生</button>}
              <button onClick={pass}>结算死亡</button>
            </div>
          </div>
        )}

        {!hasProminentAction && !game.winner && <p className="muted wait-tip">当前无需你操作，请观察牌桌和日志。</p>}

        <details className="subcard compact-details">
          <summary>人物技能操作</summary>
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
        </details>
      </div>
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

function SystemHints({ hints, compact = false }: { hints: NonNullable<RoomView['game']>['systemHints']; compact?: boolean }) {
  if (hints.length === 0) return null;
  const visibleHints = compact ? hints.slice(0, 1) : hints;
  return (
    <div className={`system-hints ${compact ? 'compact-system-hints' : ''}`}>
      {visibleHints.map((hint, index) => (
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
    <details className="skill-book compact-details">
      <summary>我的技能（{skills.length}）</summary>
      <div className="skill-list compact-skill-list">
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
    </details>
  );
}

const phaseSteps: Array<{ key: string; label: string; phases: GamePhase[] }> = [
  { key: 'victory', label: '宣胜', phases: ['VictoryDeclareWindow'] },
  { key: 'skill', label: '技能', phases: ['SkillWindow'] },
  { key: 'transfer', label: '传递', phases: ['TransferDeclare'] },
  { key: 'reaction', label: '响应', phases: ['ReactionWindow'] },
  { key: 'receive', label: '接收', phases: ['ReceiveDecision'] },
  { key: 'settle', label: '结算', phases: ['InfoSettle'] },
  { key: 'dying', label: '生死', phases: ['DyingWindow', 'DeathSettle'] },
  { key: 'end', label: '下一回合', phases: ['TurnEnd', 'GameOver'] },
];

function PhaseProgress({ phase }: { phase: GamePhase }) {
  const activeIndex = phaseSteps.findIndex((step) => step.phases.includes(phase));
  return (
    <div className="phase-track" aria-label="对局流程">
      {phaseSteps.map((step, index) => (
        <div
          className={`phase-step ${index === activeIndex ? 'active' : ''} ${activeIndex > index ? 'done' : ''}`}
          key={step.key}
        >
          <span>{index + 1}</span>
          <strong>{step.label}</strong>
        </div>
      ))}
    </div>
  );
}

function nameOf(game: NonNullable<RoomView['game']>, playerId: PlayerId): string {
  return game.players.find((player) => player.playerId === playerId)?.displayName ?? playerId;
}
