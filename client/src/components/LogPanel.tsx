import type { RoomView } from '@wujian/shared';

interface LogPanelProps {
  room: RoomView | undefined;
  messages: string[];
}

export function LogPanel({ room, messages }: LogPanelProps) {
  return (
    <section className="card">
      <h2>日志</h2>
      <div className="log-list">
        {messages.map((message, index) => (
          <div key={`${message}-${index}`}>{message}</div>
        ))}
        {room?.game?.publicLog.map((entry) => (
          <div key={entry.id}>{entry.messageKey} {JSON.stringify(entry.params)}</div>
        ))}
      </div>
    </section>
  );
}
