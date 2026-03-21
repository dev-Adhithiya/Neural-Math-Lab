import React from 'react';

/**
 * MarksDashboard — Displays grading results and step-by-step breakdown.
 *
 * @param {Object} props
 * @param {Object} [props.gradingResult] - From GraderAgent
 * @param {Array}  [props.examHistory]   - Past exam results
 */
export default function MarksDashboard({ gradingResult, examHistory = [] }) {
  if (!gradingResult && examHistory.length === 0) {
    return (
      <div className="marks-dashboard empty">
        <div className="dashboard-icon">📝</div>
        <p>Complete a problem to see your marks here!</p>
      </div>
    );
  }

  const getStatusColor = (status) => {
    const colors = {
      correct: '#10b981',
      arithmetic_error: '#f59e0b',
      carry_forward: '#3b82f6',
      partial: '#a855f7',
      incorrect: '#ef4444',
    };
    return colors[status] || '#64748b';
  };

  const getStatusIcon = (status) => {
    const icons = {
      correct: '✅',
      arithmetic_error: '⚠️',
      carry_forward: '🔄',
      partial: '🟡',
      incorrect: '❌',
    };
    return icons[status] || '•';
  };

  return (
    <div className="marks-dashboard">
      {gradingResult && (
        <>
          {/* Score Circle */}
          <div className="score-circle-container">
            <svg className="score-circle" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" className="score-bg" />
              <circle
                cx="60" cy="60" r="52"
                className="score-fill"
                style={{
                  strokeDasharray: `${2 * Math.PI * 52}`,
                  strokeDashoffset: `${2 * Math.PI * 52 * (1 - gradingResult.percentage / 100)}`,
                  stroke: gradingResult.percentage >= 70 ? '#10b981' : gradingResult.percentage >= 50 ? '#f59e0b' : '#ef4444',
                }}
              />
            </svg>
            <div className="score-text">
              <span className="score-number">{gradingResult.percentage}%</span>
              <span className="score-label">{gradingResult.score}/{gradingResult.maxScore}</span>
              <span className="score-grade">{gradingResult.grade}</span>
            </div>
          </div>

          {/* Step Results */}
          <div className="step-results">
            <h4>Step-by-Step Breakdown</h4>
            {gradingResult.stepResults.map((step) => (
              <div
                key={step.stepNumber}
                className="step-result-item"
                style={{ borderLeftColor: getStatusColor(step.status) }}
              >
                <div className="step-header">
                  <span className="step-icon">{getStatusIcon(step.status)}</span>
                  <span className="step-name">Step {step.stepNumber}</span>
                  <span className="step-marks">
                    {Math.round(step.marksAwarded * 10) / 10}/{Math.round(step.maxMarks * 10) / 10}
                  </span>
                </div>
                <p className="step-feedback">{step.feedback}</p>
              </div>
            ))}
          </div>

          {/* Overall Feedback */}
          <div className="overall-feedback">
            <p>{gradingResult.feedback}</p>
          </div>
        </>
      )}

      {/* Recent History */}
      {examHistory.length > 0 && (
        <div className="exam-history">
          <h4>Recent Results</h4>
          <div className="history-list">
            {examHistory.slice(0, 5).map((exam, i) => (
              <div key={i} className="history-item">
                <span className="history-topic">{exam.topicId}</span>
                <span className="history-score">{exam.score}/{exam.maxScore}</span>
                <div className="history-bar">
                  <div
                    className="history-fill"
                    style={{
                      width: `${(exam.score / exam.maxScore) * 100}%`,
                      backgroundColor: exam.score / exam.maxScore >= 0.7 ? '#10b981' : '#f59e0b',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
