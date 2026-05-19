import type { RoomView, SessionView } from '@wujian/shared';

interface RoomPanelProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
  connectionStatus: string;
  displayName: string;
  roomIdInput: string;
  onDisplayNameChange: (value: string) => void;
  onRoomIdInputChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: () => void;
}

export function RoomPanel(props: RoomPanelProps) {
  const { room, session } = props;
  const mySeat = room?.seats.find((seat) => seat.userId === session?.userId);
  const isOwner = room?.ownerUserId === session?.userId;

  return (
    <section className="card">
      <h2>房间</h2>
      <p className={`connection-status ${props.connectionStatus}`}>连接状态：{props.connectionStatus}</p>
      {props.connectionStatus !== 'open' && <p className="hint">如果创建房间无响应，请确认后端 WebSocket 服务正在监听 8787 端口。</p>}
      <label>
        昵称
        <input value={props.displayName} onChange={(event) => props.onDisplayNameChange(event.target.value)} />
      </label>
      <div className="actions">
        <button onClick={props.onCreateRoom}>创建房间</button>
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
          <p>状态：{room.status}</p>
          <div className="actions">
            <button onClick={() => props.onSetReady(!mySeat?.ready)}>{mySeat?.ready ? '取消准备' : '准备'}</button>
            {isOwner && <button onClick={props.onStartGame}>开始游戏</button>}
          </div>
        </div>
      )}
    </section>
  );
}
