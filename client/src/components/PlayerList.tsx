import type { CSSProperties } from 'react';
import type { RoomView, SessionView } from '@wujian/shared';

interface PlayerListProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
}

const factionText = (faction: string | undefined) => {
  if (faction === 'red') return '红方';
  if (faction === 'blue') return '蓝方';
  if (faction === 'white') return '白方';
  return '暗置';
};

const aliveText = (state: string | undefined) => {
  if (state === 'alive') return '存活';
  if (state === 'dying') return '濒死';
  if (state === 'dead') return '死亡';
  return '等待';
};

export function PlayerList({ room, session }: PlayerListProps) {
  if (!room) return <p className="muted">尚未加入房间</p>;

  const total = room.game?.players.length ?? room.seats.length;
  const activeSeatIndex = room.game?.activeSeatIndex;

  return (
    <section className="table-arena card">
      <div className="table-center">
        <h2>牌桌</h2>
        <p>{room.game ? `第 ${room.game.roundNumber} 轮` : '等待开局'}</p>
        <p className="muted">角色牌按座位围成一圈，发光的是当前行动玩家。</p>
      </div>
      <div className="seat-ring" style={{ '--seat-count': total } as CSSProperties}>
        {room.seats.map((seat, index) => {
          const gamePlayer = room.game?.players.find((player) => player.userId === seat.userId);
          const angle = total > 0 ? (360 / total) * index - 90 : -90;
          const isActive = activeSeatIndex === seat.seatIndex;
          const isMe = seat.userId === session?.userId;
          const skillNames = gamePlayer?.characterSkills?.map((skill) => skill.name).join(' / ');
          return (
            <article
              className={`seat-card ${isActive ? 'active-seat' : ''} ${isMe ? 'my-seat' : ''} ${gamePlayer?.aliveState === 'dead' ? 'dead-seat' : ''} ${gamePlayer?.aliveState === 'dying' ? 'dying-seat' : ''}`}
              key={seat.userId}
              style={{ '--seat-angle': `${angle}deg` } as CSSProperties}
            >
              <div className="seat-card-image">
                {gamePlayer?.characterImageUrl ? <img src={gamePlayer.characterImageUrl} alt={gamePlayer.characterName ?? '角色'} /> : <span className="card-back large">盖伏</span>}
              </div>
              <div className="seat-card-body">
                <div className="seat-title">
                  <span>#{seat.seatIndex + 1}</span>
                  <strong>{seat.displayName}</strong>
                </div>
                <div className="seat-badges">
                  {seat.isOwner && <span className="badge">房主</span>}
                  {isMe && <span className="badge blue">我</span>}
                  <span className={seat.ready ? 'ok' : 'muted'}>{seat.ready ? '已准备' : '未准备'}</span>
                </div>
                {gamePlayer && (
                  <>
                    <p>{aliveText(gamePlayer.aliveState)} / {factionText(gamePlayer.revealedFaction)}</p>
                    <p>角色：{gamePlayer.characterName ?? '盖伏'}</p>
                    <p>真 {gamePlayer.trueInfoCount} / 假 {gamePlayer.falseInfoCount}</p>
                    {skillNames && <p className="seat-skills">{skillNames}</p>}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
