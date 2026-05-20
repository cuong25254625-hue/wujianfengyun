import { useEffect, useMemo, useState } from 'react';
import type { PlayerCommand, RoomId, RoomView, ServerMessage, SessionView } from '@wujian/shared';
import { WsClient } from './api/ws-client';
import { GameBoard } from './components/GameBoard';
import { LogPanel } from './components/LogPanel';
import { PlayerList } from './components/PlayerList';
import { RoomPanel } from './components/RoomPanel';

export default function App() {
  const client = useMemo(() => new WsClient(), []);
  const [session, setSession] = useState<SessionView>();
  const [room, setRoom] = useState<RoomView>();
  const [displayName, setDisplayName] = useState(`玩家${Math.floor(Math.random() * 1000)}`);
  const [roomIdInput, setRoomIdInput] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  useEffect(() => {
    client.connect();
    const offMessage = client.onMessage((message: ServerMessage) => {
      if (message.type === 'hello') setSession(message.session);
      if (message.type === 'roomView') {
        setRoom(message.room);
        setSession(message.session);
      }
      if (message.type === 'roomCreated') setRoomIdInput(message.roomId);
      if (message.type === 'joinedRoom') setRoomIdInput(message.roomId);
      if (message.type === 'error') setMessages((items) => [`错误：${message.error.message}`, ...items].slice(0, 20));
      if (message.type === 'log') setMessages((items) => [`${message.level}: ${message.message}`, ...items].slice(0, 20));
    });
    const offStatus = client.onStatus((status) => {
      setConnectionStatus(status);
      if (status === 'error') setMessages((items) => ['错误：无法连接 WebSocket 服务，请确认 8787 端口的后端已启动', ...items].slice(0, 20));
      if (status === 'closed') setMessages((items) => ['提示：WebSocket 连接已关闭，请刷新页面或重启后端', ...items].slice(0, 20));
    });
    return () => {
      offMessage();
      offStatus();
    };
  }, [client]);

  const sendHello = () => client.send({ type: 'hello', displayName });

  const createRoom = () => {
    sendHello();
    client.send({ type: 'roomCommand', command: { type: 'CreateRoom', displayName } });
  };

  const joinRoom = () => {
    sendHello();
    client.send({ type: 'roomCommand', command: { type: 'JoinRoom', roomId: roomIdInput.trim() as RoomId, displayName } });
  };

  const setReady = (ready: boolean) => {
    if (!room) return;
    client.send({ type: 'roomCommand', command: { type: 'SetReady', roomId: room.roomId, ready } });
  };

  const startGame = () => {
    if (!room) return;
    client.send({ type: 'roomCommand', command: { type: 'StartGame', roomId: room.roomId } });
  };

  const sendPlayerCommand = (command: PlayerCommand) => {
    if (!room) return;
    client.send({ type: 'playerCommand', roomId: room.roomId, command });
  };

  const inGame = Boolean(room?.game);

  return (
    <main className={inGame ? 'in-game-main' : ''}>
      <header className={inGame ? 'compact-header' : ''}>
        <h1>无间风云 MVP</h1>
        <p>多人在线身份情报对局</p>
      </header>
      <div className={`game-shell ${inGame ? 'in-game-shell' : ''}`}>
        {!inGame && (
          <aside className="left-panel">
            <RoomPanel
              room={room}
              session={session}
              connectionStatus={connectionStatus}
              displayName={displayName}
              roomIdInput={roomIdInput}
              onDisplayNameChange={setDisplayName}
              onRoomIdInputChange={setRoomIdInput}
              onCreateRoom={createRoom}
              onJoinRoom={joinRoom}
              onSetReady={setReady}
              onStartGame={startGame}
            />
          </aside>
        )}
        <section className="table-panel">
          <PlayerList room={room} session={session}>
            {inGame && <GameBoard room={room} session={session} onPlayerCommand={sendPlayerCommand} mode="table" />}
          </PlayerList>
          {!inGame && <GameBoard room={room} session={session} onPlayerCommand={sendPlayerCommand} />}
        </section>
        <aside className="right-panel">
          <LogPanel room={room} messages={messages} />
        </aside>
      </div>
    </main>
  );
}
