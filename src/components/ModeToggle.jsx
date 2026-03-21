import React from 'react';

/**
 * ModeToggle — Switch between Teaching/Solver and Online/Offline.
 *
 * @param {Object} props
 * @param {'TEACHING'|'SOLVER'} props.tutorMode
 * @param {Function} props.onTutorModeChange
 * @param {'online'|'offline'} props.aiMode
 * @param {Function} props.onAIModeChange
 */
export default function ModeToggle({
  tutorMode = 'TEACHING',
  onTutorModeChange,
  aiMode = 'online',
  onAIModeChange,
}) {
  return (
    <div className="mode-toggle">
      {/* Tutor Mode */}
      <div className="toggle-group">
        <label className="toggle-label">Mode</label>
        <div className="toggle-switch">
          <button
            className={`toggle-btn ${tutorMode === 'TEACHING' ? 'active' : ''}`}
            onClick={() => onTutorModeChange('TEACHING')}
            title="Socratic hints, guided learning"
          >
            🎓 Teach
          </button>
          <button
            className={`toggle-btn ${tutorMode === 'SOLVER' ? 'active' : ''}`}
            onClick={() => onTutorModeChange('SOLVER')}
            title="Direct solutions with steps"
          >
            ⚡ Solve
          </button>
        </div>
      </div>

      {/* AI Mode */}
      <div className="toggle-group">
        <label className="toggle-label">AI</label>
        <div className="toggle-switch">
          <button
            className={`toggle-btn ${aiMode === 'online' ? 'active' : ''}`}
            onClick={() => onAIModeChange('online')}
            title="Cloud AI (faster, more capable)"
          >
            ☁️ Online
          </button>
          <button
            className={`toggle-btn ${aiMode === 'offline' ? 'active' : ''}`}
            onClick={() => onAIModeChange('offline')}
            title="Local AI (private, works offline)"
          >
            💻 Offline
          </button>
        </div>
      </div>
    </div>
  );
}
