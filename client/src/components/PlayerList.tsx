import type { RoomView } from '@wujian/shared';

interface PlayerListProps {
  room: RoomView | undefined;
}

export function PlayerList({ room }: PlayerListProps) {
  if (!room) return <p className="muted">尚未加入房间</p>;

  return (
    <section className="card">
      <h2>座位</h2>
      <div className="player-list">
        {room.seats.map((seat) => {
          const gamePlayer = room.game?.players.find((player) => player.userId === seat.userId);
          return (
            <div className="player-row" key={seat.userId}>
              <span>#{seat.seatIndex + 1}</span>
              <strong>{seat.displayName}</strong>
              {seat.isOwner && <span className="badge">房主</span>}
              <span className={seat.ready ? 'ok' : 'muted'}>{seat.ready ? '已准备' : '未准备'}</span>
              {gamePlayer && (
                <span className="player-character">
                  {gamePlayer.characterImageUrl ? <img src={gamePlayer.characterImageUrl} alt={gamePlayer.characterName ?? '角色'} /> : <span className="card-back">盖伏</span>}
                  {gamePlayer.aliveState} / 身份：{gamePlayer.revealedFaction ?? '暗置'} / 角色：{gamePlayer.characterRevealed ? gamePlayer.characterName : '盖伏'} / 真{gamePlayer.trueInfoCount} 假{gamePlayer.falseInfoCount}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
