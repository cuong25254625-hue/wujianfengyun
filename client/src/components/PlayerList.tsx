import { useState, type CSSProperties, type ReactNode } from 'react';
import type { RoomView, SessionView, SkillView } from '@wujian/shared';

interface PlayerListProps {
  room: RoomView | undefined;
  session: SessionView | undefined;
  children?: ReactNode;
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

export function PlayerList({ room, session, children }: PlayerListProps) {
  if (!room) return <p className="muted">尚未加入房间</p>;

  const total = room.game?.players.length ?? room.seats.length;
  const activeSeatIndex = room.game?.activeSeatIndex;
  const [skillViewer, setSkillViewer] = useState<{ name: string; characterName: string; skills: SkillView[] }>();

  return (
    <section className="table-arena card">
      <div className="table-center">
        {children ?? (
          <>
            <h2>{room.game ? `第 ${room.game.roundNumber} 轮` : '等待开局'}</h2>
            <p>{room.roomId}</p>
            <p className="muted">发光座位正在行动</p>
          </>
        )}
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
              <button
                className="seat-card-image"
                type="button"
                onClick={() => {
                  const skills = gamePlayer?.characterSkills ?? [];
                  if (gamePlayer && skills.length > 0) {
                    setSkillViewer({ name: gamePlayer.displayName, characterName: gamePlayer.characterName ?? '盖伏角色', skills });
                  }
                }}
                disabled={!gamePlayer?.characterSkills?.length}
                title={gamePlayer?.characterSkills?.length ? '点击查看角色技能' : '角色盖伏或暂无可公开技能'}
              >
                {gamePlayer?.characterImageUrl ? <img src={gamePlayer.characterImageUrl} alt={gamePlayer.characterName ?? '角色'} /> : <span className="card-back large">盖伏</span>}
              </button>
              <div className="seat-card-body">
                <div className="seat-title">
                  <span>#{seat.seatIndex + 1}</span>
                  <strong>{gamePlayer?.displayName ?? seat.displayName}</strong>
                </div>
                <div className="seat-badges">
                  {seat.isOwner && <span className="badge">房主</span>}
                  {seat.isBot && <span className="badge">机器人</span>}
                  {isMe && <span className="badge blue">我</span>}
                  {!seat.connected && !seat.isBot && <span className="badge danger">断线</span>}
                  <span className={seat.ready ? 'ok' : 'muted'}>{seat.ready ? '已准备' : '未准备'}</span>
                </div>
                {!gamePlayer && seat.characterSelected !== undefined && <p>{seat.characterSelected ? '已选择角色' : '等待选角'}</p>}
                {gamePlayer && room.game?.status === 'setup' && (
                  <>
                    <p>{seat.characterSelected ? '已选择角色' : '等待选角'}</p>
                    <p className="muted">角色暂不公开</p>
                  </>
                )}
                {gamePlayer && room.game?.status !== 'setup' && (
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
      {skillViewer && (
        <div className="skill-popover" role="dialog" aria-label="角色技能">
          <div className="skill-popover-card">
            <button className="close-button" type="button" onClick={() => setSkillViewer(undefined)}>×</button>
            <h3>{skillViewer.name}｜{skillViewer.characterName}</h3>
            <div className="skill-popover-list">
              {skillViewer.skills.map((skill) => (
                <article className="skill-card" key={skill.skillId}>
                  <header>
                    <strong>{skill.name}</strong>
                    <span>{skill.timing}</span>
                  </header>
                  <p>{skill.description}</p>
                  {skill.hint && <p className="muted">{skill.hint}</p>}
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
