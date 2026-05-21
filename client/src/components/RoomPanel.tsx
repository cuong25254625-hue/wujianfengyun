import { useMemo, useState } from 'react';
import type { CharacterId, PlayerId, RoomView, SessionView } from '@wujian/shared';

interface RoomPanelProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
  lobbyRooms: import('@wujian/shared').RoomSummary[];
  connectionStatus: string;
  displayName: string;
  roomIdInput: string;
  onDisplayNameChange: (value: string) => void;
  onRoomIdInputChange: (value: string) => void;
  onUpdateDisplayName: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onJoinLobbyRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
  onSelectCharacter: (characterId: CharacterId) => void;
  onSubmitSetupChoice: (choiceKey: 'ccMissionTarget', targetPlayerId: PlayerId) => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: () => void;
}

const connectionLabel: Record<string, string> = {
  connecting: '连接中',
  open: '已连接',
  reconnecting: '重连中',
  closed: '已断开',
  error: '连接异常',
};

const roomStatusLabel: Record<string, string> = {
  lobby: '等待开局',
  playing: '游戏中',
  finished: '已结束',
};

export function RoomPanel(props: RoomPanelProps) {
  const { room, session } = props;
  const mySeat = room?.seats.find((seat) => seat.userId === session?.userId);
  const isOwner = room?.ownerUserId === session?.userId;
  const hostSeat = room?.seats.find((seat) => seat.userId === room?.ownerUserId);
  const game = room?.game;
  const me = game?.players.find((player) => player.userId === session?.userId);
  const ccSetupAction = game?.pendingActionsForMe.find((action) => action.kind === 'characterSkillWindow' && action.context.type === 'generic' && action.context.data?.choiceKey === 'ccMissionTarget');
  const setupTargets = useMemo(
    () => game?.players.filter((player) => player.aliveState === 'alive' && player.playerId !== me?.playerId) ?? [],
    [game, me],
  );
  const [ccTarget, setCcTarget] = useState('');
  const selectedCcTarget = ccTarget || setupTargets[0]?.playerId || '';

  return (
    <section className="card">
      <h2>房间</h2>
      <p className={`connection-status ${props.connectionStatus}`}>连接状态：{connectionLabel[props.connectionStatus] ?? props.connectionStatus}</p>
      {props.connectionStatus !== 'open' && <p className="hint">如果创建房间无响应，请确认后端 WebSocket 服务正在监听 8787 端口。</p>}
      <label>
        昵称
        <input value={props.displayName} onChange={(event) => props.onDisplayNameChange(event.target.value)} />
      </label>
      <div className="actions">
        <button onClick={props.onCreateRoom}>创建房间</button>
        {room && <button onClick={props.onUpdateDisplayName}>同步昵称</button>}
      </div>
      {!room && (
        <>
          <label>
            房间号
            <input value={props.roomIdInput} onChange={(event) => props.onRoomIdInputChange(event.target.value)} placeholder="例如 ABC123" />
          </label>
          <div className="actions">
            <button onClick={props.onJoinRoom}>加入房间</button>
          </div>
          {props.lobbyRooms.length > 0 && (
            <div className="lobby-rooms">
              <h3>游戏大厅</h3>
              <ul className="lobby-list">
                {props.lobbyRooms.map((r) => (
                  <li key={r.roomId} className="lobby-item">
                    <span className="lobby-id">{r.roomId.slice(0, 4)}</span>
                    <span className="lobby-host">{r.ownerName}</span>
                    <span className="lobby-count">{r.playerCount}/{r.maxPlayers}</span>
                    <button
                      onClick={() => props.onJoinLobbyRoom(r.roomId)}
                      disabled={r.status !== 'lobby' || r.playerCount >= r.maxPlayers}
                    >
                      {r.status === 'lobby' ? (r.playerCount >= r.maxPlayers ? '已满' : '加入') : roomStatusLabel[r.status] ?? r.status}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {room && (
        <div className="room-meta">
          <p>当前房间：<strong>{room.roomId}</strong></p>
          <p>状态：{roomStatusLabel[room.status] ?? room.status}　|　房主：<strong>{hostSeat?.displayName ?? '—'}</strong>{isOwner ? '（你）' : ''}{!hostSeat?.connected ? ' [离线]' : ''}</p>
          {room.status === 'lobby' && (
            <p className="muted">角色将在房主开始游戏后由系统私密发放：每名玩家随机获得 2 个互不重复的候选角色。</p>
          )}
          {room.status === 'playing' && room.game?.status === 'setup' && (
            <div className="character-picker">
              <h3>{game?.setupState?.step === 'openingOptions' ? '开局选项' : '选择角色'}</h3>
              {game?.setupState?.step === 'openingOptions' ? (
                <>
                  <p className="muted">选角已完成，正在处理开局指定目标等私密选项。其他玩家只能看到进度，看不到目标。</p>
                  <div className="selection-progress">
                    {room.seats.map((seat) => {
                      const playerId = seat.playerId;
                      const required = Boolean(playerId && game.setupState?.requiredPlayerIds.includes(playerId));
                      const done = Boolean(playerId && game.setupState?.completedPlayerIds.includes(playerId));
                      return (
                        <span className={`selection-chip ${!required || done ? 'done' : ''}`} key={seat.userId}>
                          {seat.displayName}：{required ? (done ? '已提交开局选项' : '等待开局选项') : '无需开局选项'}
                        </span>
                      );
                    })}
                  </div>
                  {ccSetupAction && (
                    <div className="subcard action-focus">
                      <h4>C.C 机密任务目标</h4>
                      <p className="muted">请选择一名其他玩家。该目标只会显示在你的私人记录中。</p>
                      <label>
                        指定目标
                        <select value={selectedCcTarget} onChange={(event) => setCcTarget(event.target.value)}>
                          {setupTargets.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
                        </select>
                      </label>
                      <button className="action-pulse" disabled={!selectedCcTarget} onClick={() => props.onSubmitSetupChoice('ccMissionTarget', selectedCcTarget as PlayerId)}>提交目标</button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="muted">请选择系统发给你的 2 个候选之一；其他玩家只能看到你是否已选择，看不到具体角色。</p>
                  <div className="selection-progress">
                    {room.seats.map((seat) => (
                      <span className={`selection-chip ${seat.characterSelected ? 'done' : ''}`} key={seat.userId}>
                        {seat.displayName}：{seat.characterSelected ? '已选择' : '等待选择'}
                      </span>
                    ))}
                  </div>
                  <div className="character-choice-grid">
                    {(mySeat?.characterOptions ?? []).map((character) => (
                      <button
                        className={`character-choice ${mySeat?.characterSelected ? 'locked' : ''}`}
                        disabled={Boolean(mySeat?.characterSelected)}
                        key={character.characterId}
                        onClick={() => props.onSelectCharacter(character.characterId)}
                        type="button"
                      >
                        <img src={character.imageUrl} alt={character.name} />
                        <span>{character.name}</span>
                        <small>{mySeat?.characterSelected ? '已提交选择' : character.visibility === 'hidden' ? '隐藏角色' : '公开角色'}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="actions">
            <button onClick={() => props.onSetReady(!mySeat?.ready)}>{mySeat?.ready ? '取消准备' : '准备'}</button>
            {isOwner && room.seats.every(s => s.ready || s.userId === session?.userId) && <button onClick={props.onStartGame} className="action-pulse">开始游戏</button>}
            {isOwner && !room.seats.every(s => s.ready || s.userId === session?.userId) && <button disabled>等待玩家准备</button>}
            <button onClick={props.onLeaveRoom} className="leave-button">退出房间</button>
            {!isOwner && room.status === 'lobby' && <span className="muted">等待房主开始游戏{hostSeat?.connected ? '' : '（房主离线，将在断线后自动转移给在线玩家）'}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
