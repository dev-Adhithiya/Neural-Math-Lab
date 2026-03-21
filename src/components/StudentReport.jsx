import React from 'react';

/**
 * StudentReport — Renders the full student report with mastery heatmap.
 *
 * @param {Object} props
 * @param {Object} props.report - From StudentReportGenerator.generateReport()
 * @param {Function} props.onClose
 */
export default function StudentReport({ report, onClose }) {
  if (!report) return null;

  const getMasteryColor = (level) => {
    const colors = {
      mastered: '#10b981',
      proficient: '#22d3ee',
      developing: '#f59e0b',
      emerging: '#f97316',
      needs_work: '#ef4444',
      not_attempted: '#334155',
      locked: '#1e293b',
    };
    return colors[level] || '#334155';
  };

  const getMasteryLabel = (level) => {
    const labels = {
      mastered: '🏆 Mastered',
      proficient: '⭐ Proficient',
      developing: '📈 Developing',
      emerging: '🌱 Emerging',
      needs_work: '🔧 Needs Work',
      not_attempted: '⬜ Not Started',
      locked: '🔒 Locked',
    };
    return labels[level] || level;
  };

  return (
    <div className="student-report-overlay">
      <div className="student-report">
        <div className="report-header">
          <h2>📊 Student Progress Report</h2>
          <button className="report-close" onClick={onClose}>✕</button>
        </div>

        {/* Student Info */}
        <div className="report-section student-info-section">
          <div className="student-avatar-large">🎓</div>
          <div>
            <h3>{report.student.name}</h3>
            <p>Level {report.student.level} — {report.student.title}</p>
            <p className="xp-total">⭐ {report.student.totalXP} XP</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="report-section">
          <h3>📈 Overview</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-value">{report.stats.totalProblemsSolved}</span>
              <span className="stat-label">Problems Solved</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{report.stats.overallAccuracy}%</span>
              <span className="stat-label">Accuracy</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{report.stats.topicsMastered}/{report.stats.topicsTotal}</span>
              <span className="stat-label">Topics Mastered</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{report.stats.streakDays}</span>
              <span className="stat-label">Day Streak 🔥</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{report.stats.correctedMistakes}</span>
              <span className="stat-label">Mistakes Fixed</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{report.stats.topicsAttempted}</span>
              <span className="stat-label">Topics Attempted</span>
            </div>
          </div>
        </div>

        {/* Mastery Heatmap */}
        <div className="report-section">
          <h3>🗺️ Mastery Heatmap</h3>
          <div className="mastery-heatmap">
            {report.masteryHeatmap.map((topic) => (
              <div
                key={topic.topicId}
                className="heatmap-cell"
                style={{ backgroundColor: getMasteryColor(topic.masteryLevel) }}
                title={`${topic.label}: ${topic.accuracy !== null ? topic.accuracy + '%' : 'Not attempted'}`}
              >
                <span className="heatmap-label">{topic.label}</span>
                <span className="heatmap-status">{getMasteryLabel(topic.masteryLevel)}</span>
              </div>
            ))}
          </div>
          <div className="heatmap-legend">
            {['mastered', 'proficient', 'developing', 'emerging', 'needs_work', 'not_attempted', 'locked'].map((level) => (
              <span key={level} className="legend-item">
                <span className="legend-color" style={{ backgroundColor: getMasteryColor(level) }} />
                {getMasteryLabel(level)}
              </span>
            ))}
          </div>
        </div>

        {/* Forensic Summary */}
        <div className="report-section">
          <h3>🔬 Forensic Analysis</h3>
          <p className="forensic-narrative">{report.forensicSummary.narrative}</p>
          {report.forensicSummary.strongestArea && (
            <p className="forensic-strong">
              💪 Strongest: <strong>{report.forensicSummary.strongestArea.label}</strong> ({report.forensicSummary.strongestArea.accuracy}%)
            </p>
          )}
          {report.forensicSummary.weakestArea && (
            <p className="forensic-weak">
              📝 Needs Work: <strong>{report.forensicSummary.weakestArea.label}</strong> ({report.forensicSummary.weakestArea.accuracy}%)
            </p>
          )}
        </div>

        {/* Print Button */}
        <div className="report-actions">
          <button className="btn-print" onClick={() => window.print()}>
            🖨️ Print Report
          </button>
        </div>
      </div>
    </div>
  );
}
