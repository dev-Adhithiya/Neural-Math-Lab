import React, { useMemo, useState } from 'react';
import { TOPICS } from '../agents/KnowledgeGraph.js';
import { generateSessionPlan } from '../agents/ProactivePlanner.js';

function minutes(n) {
  return `${n} min`;
}

function computeRecommendedMinutes(topicCount) {
  if (topicCount <= 0) return 20;
  return Math.min(120, Math.max(20, topicCount * 25));
}

function buildTable({ topics, totalMinutes }) {
  const blocks = [
    { label: 'Warm-up', pct: 0.15 },
    { label: 'Core learning', pct: 0.45 },
    { label: 'Practice', pct: 0.30 },
    { label: 'Review', pct: 0.10 },
  ];

  const rows = blocks.map((b) => ({
    block: b.label,
    minutes: Math.max(5, Math.round(totalMinutes * b.pct)),
    focus: topics.length ? topics.join(', ') : 'Foundations',
  }));

  // Normalize rounding drift
  const sum = rows.reduce((s, r) => s + r.minutes, 0);
  const drift = totalMinutes - sum;
  if (drift !== 0) rows[1].minutes += drift;

  return rows;
}

export default function PlanView({ onSendToChat }) {
  const [focusMode, setFocusMode] = useState('custom'); // custom | weak | next
  const [selectedTopics, setSelectedTopics] = useState(['polynomials']);
  const [duration, setDuration] = useState(45);
  const [loading, setLoading] = useState(false);
  const [table, setTable] = useState(null);
  const [note, setNote] = useState('');

  const topicOptions = useMemo(() => TOPICS.map((t) => ({ id: t.id, label: t.label })), []);
  const recommended = useMemo(() => computeRecommendedMinutes(selectedTopics.length), [selectedTopics.length]);

  const handleGenerate = async () => {
    setLoading(true);
    setNote('');
    try {
      const plan = await generateSessionPlan();

      let topics = selectedTopics;
      if (focusMode === 'weak') topics = (plan.weakTopics || []).slice(0, 3).map((t) => t.topicId);
      if (focusMode === 'next') topics = (plan.nextLessons || []).slice(0, 3).map((t) => t.topicId);

      const topicLabels = topics.map((id) => topicOptions.find((t) => t.id === id)?.label || id);
      const rows = buildTable({ topics: topicLabels, totalMinutes: duration });
      setTable(rows);
      setNote(`Recommended duration for ${topics.length || 1} topic(s): ${minutes(recommended)}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="plan-view">
      <div className="panel-header">
        <h3>🗓️ Plan My Session</h3>
        <p>Pick what you want to learn and how long you have. Then generate a session plan table.</p>
      </div>

      <div className="quiz-section">
        <h4>Focus</h4>
        <div className="settings-row">
          <label className="settings-radio">
            <input type="radio" name="focus" value="custom" checked={focusMode === 'custom'} onChange={() => setFocusMode('custom')} />
            <span>Custom topics</span>
          </label>
          <label className="settings-radio">
            <input type="radio" name="focus" value="weak" checked={focusMode === 'weak'} onChange={() => setFocusMode('weak')} />
            <span>My weak topics</span>
          </label>
          <label className="settings-radio">
            <input type="radio" name="focus" value="next" checked={focusMode === 'next'} onChange={() => setFocusMode('next')} />
            <span>Recommended next lessons</span>
          </label>
        </div>
      </div>

      <div className="quiz-section">
        <h4>Topics</h4>
        <select
          className="quiz-input"
          multiple
          value={selectedTopics}
          disabled={focusMode !== 'custom'}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
            setSelectedTopics(opts.length ? opts : []);
          }}
          style={{ minHeight: 160 }}
        >
          {topicOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <div className="quiz-subtitle">Tip: Ctrl/Shift-click to select multiple topics.</div>
      </div>

      <div className="quiz-section">
        <h4>Duration</h4>
        <div className="settings-row">
          {[20, 30, 45, 60, 90].map((m) => (
            <label key={m} className="settings-radio">
              <input type="radio" name="duration" value={m} checked={duration === m} onChange={() => setDuration(m)} />
              <span>{minutes(m)}</span>
            </label>
          ))}
        </div>
        <div className="quiz-subtitle">Recommended: {minutes(recommended)}.</div>
      </div>

      <div className="panel-actions">
        <button className="panel-btn primary" onClick={handleGenerate} disabled={loading}>
          {loading ? 'Generating…' : 'Generate plan'}
        </button>
        {table && (
          <button
            className="panel-btn"
            onClick={() => {
              const lines = table.map((r) => `- **${r.block}**: ${r.minutes} min — ${r.focus}`).join('\n');
              onSendToChat?.(`### 🗓️ Session Plan\n${lines}\n\n_One task_: pick the first block and tell me what you’ll do.`);
            }}
          >
            Send to chat
          </button>
        )}
      </div>

      {note && <div className="quiz-result-note" style={{ marginTop: 10 }}>{note}</div>}

      {table && (
        <div className="quiz-section">
          <h4>Plan table</h4>
          <div className="plan-table">
            <div className="plan-row header">
              <div>Block</div>
              <div>Minutes</div>
              <div>Focus</div>
            </div>
            {table.map((r, idx) => (
              <div key={idx} className="plan-row">
                <div>{r.block}</div>
                <div>{r.minutes}</div>
                <div>{r.focus}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

