import React, { useEffect, useMemo, useState } from 'react';
import { getMistakes, markMistakeCorrected } from '../store/localVault.js';
import { TOPICS } from '../agents/KnowledgeGraph.js';

export default function MistakesPanel({ topicId = null }) {
  const [rows, setRows] = useState([]);

  const load = async () => {
    const data = await getMistakes(topicId || undefined);
    setRows((data || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  const topicLabel = useMemo(() => {
    if (!topicId) return null;
    return TOPICS.find((t) => t.id === topicId)?.label || topicId;
  }, [topicId]);

  return (
    <div className="mistakes-panel">
      <div className="mistakes-header">
        <h4>🧾 Mistakes {topicLabel ? `— ${topicLabel}` : ''}</h4>
        <button className="panel-btn" onClick={load}>Refresh</button>
      </div>

      {rows.length === 0 ? (
        <div className="chat-sessions-empty">No mistakes saved yet.</div>
      ) : (
        <div className="mistakes-list">
          {rows.slice(0, 20).map((m) => (
            <div key={m.id} className={`mistake-row ${m.corrected ? 'corrected' : ''}`}>
              <div className="mistake-main">
                <div className="mistake-desc">{m.description || m.problem || 'Mistake'}</div>
                <div className="mistake-meta">
                  <span className="pill">{m.topicId}</span>
                  <span className="pill">{(m.date || '').split('T')[0]}</span>
                  {m.corrected && <span className="pill">Fixed</span>}
                </div>
              </div>
              {!m.corrected && (
                <button
                  className="mistake-fix"
                  onClick={async () => {
                    await markMistakeCorrected(m.id);
                    await load();
                  }}
                  title="Mark as fixed"
                >
                  ✓
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

