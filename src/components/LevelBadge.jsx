import React from 'react';

/**
 * LevelBadge — Displays user level, XP, and progress bar.
 *
 * @param {Object} props
 * @param {Object} props.levelInfo - From GamificationEngine.calculateLevel()
 */
export default function LevelBadge({ levelInfo }) {
  if (!levelInfo) return null;

  const { level, title, currentXP, xpForNext, progress, totalXP } = levelInfo;

  return (
    <div className="level-badge">
      <div className="level-icon">
        <span className="level-number">{level}</span>
      </div>
      <div className="level-info">
        <span className="level-title">{title}</span>
        <div className="xp-bar">
          <div
            className="xp-fill"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <span className="xp-text">
          {currentXP} / {xpForNext} XP
        </span>
      </div>
      <div className="total-xp">
        ⭐ {totalXP} XP
      </div>
    </div>
  );
}
