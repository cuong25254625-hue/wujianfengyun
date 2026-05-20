import type { CharacterId, RoomView, SessionView } from '@wujian/shared';

interface RoomPanelProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
  connectionStatus: string;
  displayName: string;
  roomIdInput: string;
  onDisplayNameChange: (value: string) => void;
  onRoomIdInputChange: (value: string) => void;
  onUpdateDisplayName: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onSelectCharacter: (characterId: CharacterId) => void;
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
      <label>
        房间号
        <input value={props.roomIdInput} onChange={(event) => props.onRoomIdInputChange(event.target.value)} placeholder="例如 ABC123" />
      </label>
      <div className="actions">
        <button onClick={props.onJoinRoom}>加入房间</button>
      </div>
      {room && (
        <div className="room-meta">
          <p>当前房间：<strong>{room.roomId}</strong></p>
          <p>状态：{roomStatusLabel[room.status] ?? room.status}</p>
          {room.status === 'lobby' && (
            <p className="muted">角色将在房主开始游戏后由系统私密发放：每名玩家随机获得 2 个互不重复的候选角色。</p>
          )}
          {room.status === 'playing' && room.game?.status === 'setup' && (
            <div className="character-picker">
              <h3>选择角色</h3>
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
            </div>
          )}
          <div className="actions">
            <button onClick={() => props.onSetReady(!mySeat?.ready)}>{mySeat?.ready ? '取消准备' : '准备'}</button>
            {isOwner && <button onClick={props.onStartGame}>开始游戏</button>}
          </div>
        </div>
      )}
    </section>
  );
}
