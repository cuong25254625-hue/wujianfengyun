import { useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterId, ClientMessage, PlayerCommand, RoomId, RoomView, ServerMessage, SessionView } from '@wujian/shared';
import { WsClient } from './api/ws-client';
import { GameBoard } from './components/GameBoard';
import { LogPanel } from './components/LogPanel';
import { PlayerList } from './components/PlayerList';
import { RoomPanel } from './components/RoomPanel';

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
}

const toastKindText: Record<ToastKind, string> = {
  success: '成功',
  error: '错误',
  info: '提示',
  warning: '注意',
};

const commandLabel = (message: ClientMessage): string => {
  if (message.type === 'roomCommand') {
    const labels: Record<string, string> = {
      CreateRoom: '创建房间',
      JoinRoom: '加入房间',
      UpdateDisplayName: '同步昵称',
      SelectCharacter: '选择角色',
      SubmitSetupChoice: '提交开局选项',
      SetReady: '准备状态',
      StartGame: '开始游戏',
      GmForceAdvance: '强制推进',
    };
    return labels[message.command.type] ?? '房间操作';
  }
  if (message.type === 'playerCommand') {
    const labels: Record<string, string> = {
      DeclareTransfer: '声明传递',
      ReceiveInfo: '接收/拒收',
      UseProbe: '试探',
      UseLock: '锁定',
      UseIntercept: '截获',
      UseCharacterSkill: '人物技能',
      UseFinalPkBurn: '最终PK烧毁',
      DeclareVictory: '宣胜',
      PassPendingAction: '跳过窗口',
    };
    return labels[message.command.type] ?? '对局操作';
  }
  if (message.type === 'requestSync') return '同步状态';
  if (message.type === 'reconnect') return '恢复座位';
  return '连接操作';
};

export default function App() {
  const client = useMemo(() => new WsClient(), []);
  const persistedSession = client.persistedSession;
  const [session, setSession] = useState<SessionView>();
  const [room, setRoom] = useState<RoomView>();
  const [displayName, setDisplayName] = useState(persistedSession.displayName ?? `玩家${Math.floor(Math.random() * 1000)}`);
  const [roomIdInput, setRoomIdInput] = useState(persistedSession.roomId ?? '');
  const [messages, setMessages] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [reconnectMax, setReconnectMax] = useState(12);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pendingLabelsRef = useRef<Record<string, string>>({});
  const wasReconnecting = useRef(false);
  const previousOwnerUserId = useRef<string | undefined>();
  const activeRoomIdRef = useRef<string | undefined>(persistedSession.roomId);
  const currentRoomRef = useRef<RoomView | undefined>();
  const lastRejectedCodeRef = useRef<string | undefined>();
  const suppressStaleReconnectRejectUntilRef = useRef(0);

  const pushToast = (kind: ToastKind, message: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((items) => [{ id, kind, message }, ...items].slice(0, 4));
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 2400);
  };

  const sendWithFeedback = (message: ClientMessage, feedback = true) => {
    const clientCommandId = `cmd_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const withId = { ...message, clientCommandId } as ClientMessage;
    if (feedback) {
      const label = commandLabel(message);
      pendingLabelsRef.current = { ...pendingLabelsRef.current, [clientCommandId]: label };
      pushToast('info', `${label}已提交`);
    }
    client.send(withId);
  };

  useEffect(() => {
    client.connect();
    const offMessage = client.onMessage((message: ServerMessage) => {
      if (message.type === 'hello') setSession(message.session);
      if (message.type === 'roomView') {
        // 检测房主变更并通知
        if (previousOwnerUserId.current && previousOwnerUserId.current !== message.room.ownerUserId) {
          const newHost = message.room.seats.find(s => s.userId === message.room.ownerUserId);
          if (newHost) pushToast('info', `房主已转移：${newHost.displayName}`);
        }
        previousOwnerUserId.current = message.room.ownerUserId;
        activeRoomIdRef.current = message.room.roomId;
        currentRoomRef.current = message.room;
        setRoom(message.room);
        setSession(message.session);
      }
      if (message.type === 'roomCreated') {
        activeRoomIdRef.current = message.roomId;
        // 创建成功后短时间内可能收到旧 localStorage 座位恢复失败的迟到响应，忽略它，避免误显示“重连/房间不存在”。
        suppressStaleReconnectRejectUntilRef.current = Date.now() + 3000;
        setRoomIdInput(message.roomId);
      }
      if (message.type === 'joinedRoom') {
        activeRoomIdRef.current = message.roomId;
        suppressStaleReconnectRejectUntilRef.current = Date.now() + 3000;
        setRoomIdInput(message.roomId);
      }
      if (message.type === 'commandAck') {
        const label = pendingLabelsRef.current[message.clientCommandId] ?? '操作';
        const next = { ...pendingLabelsRef.current };
        delete next[message.clientCommandId];
        pendingLabelsRef.current = next;
        pushToast('success', `${label}成功`);
      }
      if (message.type === 'commandRejected') {
        lastRejectedCodeRef.current = message.error.code;
        const rejectedCommandId = message.clientCommandId;
        const label = rejectedCommandId ? pendingLabelsRef.current[rejectedCommandId] : '操作';
        if (rejectedCommandId) {
          const next = { ...pendingLabelsRef.current };
          delete next[rejectedCommandId];
          pendingLabelsRef.current = next;
        }
        if (message.error.code === 'reconnect.seatNotFound') {
          if (Date.now() < suppressStaleReconnectRejectUntilRef.current || currentRoomRef.current) {
            // 创建/加入新房间后，旧房间的 reconnect 失败响应可能迟到；当前已有房间时不能清掉新房间。
            return;
          }
          client.forgetRoom();
          activeRoomIdRef.current = undefined;
          currentRoomRef.current = undefined;
          setRoom(undefined);
          setRoomIdInput('');
          previousOwnerUserId.current = undefined;
          pushToast('warning', '未找到你的座位，已清除本机保存的房间记录');
          setMessages((items) => ['提示：原房间座位不存在，已清除本机保存的房间记录', ...items].slice(0, 20));
          return;
        }
        pushToast('error', `${label}失败：${message.error.message}`);
        setMessages((items) => [`错误：${message.error.message}`, ...items].slice(0, 20));
      }
      if (message.type === 'error') {
        const code = message.error.code;
        const isDuplicateRejectError = lastRejectedCodeRef.current === code;
        lastRejectedCodeRef.current = undefined;

        if (code === 'reconnect.seatNotFound') {
          if (Date.now() < suppressStaleReconnectRejectUntilRef.current || currentRoomRef.current) {
            // 旧房间恢复失败的 error 可能晚于新房间创建/加入成功到达，不能因此显示错误或清掉新房间。
            return;
          }
          client.forgetRoom();
          activeRoomIdRef.current = undefined;
          currentRoomRef.current = undefined;
          setRoom(undefined);
          setRoomIdInput('');
          previousOwnerUserId.current = undefined;
          if (!isDuplicateRejectError) {
            pushToast('warning', '原房间已不存在，已清除本机保存的房间记录');
            setMessages((items) => ['提示：原房间已不存在，已清除本机保存的房间记录', ...items].slice(0, 20));
          }
          return;
        }

        if ((code === 'room.notFound' || code === 'sync.notInRoom') && !currentRoomRef.current) {
          // 页面刚打开时，本机 localStorage 里可能残留旧 roomId。静默清理，避免一进页面就弹“房间不存在”。
          client.forgetRoom();
          activeRoomIdRef.current = undefined;
          setRoomIdInput('');
          return;
        }

        pushToast('error', message.error.message);
        setMessages((items) => [`错误：${message.error.message}`, ...items].slice(0, 20));
      }
      if (message.type === 'log') setMessages((items) => [`${message.level}: ${message.message}`, ...items].slice(0, 20));
    });
    const offStatus = client.onStatus((status) => {
      setConnectionStatus(status);
      const info = client.reconnectInfo;
      setReconnectAttempt(info.attempt);
      setReconnectMax(info.max);
      if (status === 'open') {
        if (wasReconnecting.current) {
          wasReconnecting.current = false;
          pushToast('success', '连接已恢复，同步房间状态...');
        }
        // open 后总是检查是否有待恢复的房间（覆盖页面刷新/断线重连两种场景）
        const sessionData = client.persistedSession;
        const targetRoomId = activeRoomIdRef.current ?? sessionData.roomId;
        if (targetRoomId) {
          client.requestSync(targetRoomId as RoomId);
        }
      }
      if (status === 'error') {
        pushToast('error', '无法连接后端服务');
        setMessages((items) => ['错误：无法连接 WebSocket 服务，请确认 8787 端口的后端已启动', ...items].slice(0, 20));
      }
      if (status === 'closed') {
        pushToast('warning', 'WebSocket 连接已关闭');
        setMessages((items) => ['提示：WebSocket 连接已关闭，请刷新页面或重启后端', ...items].slice(0, 20));
      }
      if (status === 'reconnecting') {
        wasReconnecting.current = true;
        pushToast('warning', `正在重连（第 ${info.attempt}/${info.max} 次）`);
        setMessages((items) => [`提示：正在重连...（第 ${info.attempt}/${info.max} 次）`, ...items].slice(0, 20));
      }
    });
    return () => {
      offMessage();
      offStatus();
    };
  }, [client]);

  const sendHello = () => sendWithFeedback({ type: 'hello', displayName }, false);

  const syncDisplayName = () => {
    const nextName = displayName.trim();
    if (!room || !nextName) return;
    sendWithFeedback({ type: 'roomCommand', command: { type: 'UpdateDisplayName', roomId: room.roomId, displayName: nextName } });
  };

  const createRoom = () => {
    sendHello();
    sendWithFeedback({ type: 'roomCommand', command: { type: 'CreateRoom', displayName } });
  };

  const joinRoom = () => {
    sendHello();
    sendWithFeedback({ type: 'roomCommand', command: { type: 'JoinRoom', roomId: roomIdInput.trim() as RoomId, displayName } });
  };

  const selectCharacter = (characterId: CharacterId) => {
    if (!room) return;
    sendWithFeedback({ type: 'roomCommand', command: { type: 'SelectCharacter', roomId: room.roomId, characterId } });
  };

  const submitSetupChoice = (choiceKey: 'ccMissionTarget', targetPlayerId: PlayerCommand['playerId']) => {
    if (!room) return;
    sendWithFeedback({ type: 'roomCommand', command: { type: 'SubmitSetupChoice', roomId: room.roomId, choiceKey, targetPlayerId } });
  };

  const setReady = (ready: boolean) => {
    if (!room) return;
    syncDisplayName();
    sendWithFeedback({ type: 'roomCommand', command: { type: 'SetReady', roomId: room.roomId, ready } });
  };

  const startGame = () => {
    if (!room) return;
    sendWithFeedback({ type: 'roomCommand', command: { type: 'StartGame', roomId: room.roomId } });
  };

  const sendPlayerCommand = (command: PlayerCommand) => {
    if (!room) return;
    sendWithFeedback({ type: 'playerCommand', roomId: room.roomId, command });
  };

  const inGame = Boolean(room?.game && room.game.status !== 'setup');

  return (
    <main className={inGame ? 'in-game-main' : ''}>
      <header className={inGame ? 'compact-header' : ''}>
        <h1>无间风云 MVP</h1>
        <p>多人在线身份情报对局</p>
      </header>
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            <strong>{toastKindText[toast.kind]}：</strong>{toast.message}
          </div>
        ))}
      </div>
      {(connectionStatus === 'reconnecting' || (connectionStatus === 'closed' && reconnectAttempt >= reconnectMax)) && (
        <div className={`reconnect-banner ${connectionStatus === 'reconnecting' ? 'reconnecting' : 'failed'}`}>
          {connectionStatus === 'reconnecting'
            ? `正在重连...（第 ${reconnectAttempt}/${reconnectMax} 次）`
            : `重连失败（已尝试 ${reconnectAttempt} 次），请刷新页面或确认后端已启动。`}
          {connectionStatus === 'reconnecting' && (
            <button className="reconnect-now-button" onClick={() => client.forceReconnect()}>立即重连</button>
          )}
          {room && <button className="reconnect-now-button" onClick={() => client.requestSync(room.roomId)}>同步状态</button>}
        </div>
      )}
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
              onUpdateDisplayName={syncDisplayName}
              onCreateRoom={createRoom}
              onJoinRoom={joinRoom}
              onSelectCharacter={selectCharacter}
              onSubmitSetupChoice={submitSetupChoice}
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
          <LogPanel room={room} session={session} messages={messages} />
        </aside>
      </div>
    </main>
  );
}
