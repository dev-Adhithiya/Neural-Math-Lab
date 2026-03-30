import React, { useEffect, useMemo, useState } from 'react';
import { getMistakes, markMistakeCorrected } from '../store/localVault.js';
import { TOPICS } from '../agents/KnowledgeGraph.js';
import { renderMathInText } from './StreamingText.jsx';

function formatMcqOption(optionLabel, optionText) {
  const label = String(optionLabel || '').trim();
  const text = String(optionText || '').trim();
  if (label && text) return `${label}. ${text}`;
  if (label) return label;
  return text;
}

export default function MistakesPanel({ topicId = null, onAskAI = null }) {
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
    const base = TOPICS.find((t) => t.id === topicId)?.label || topicId;
    return String(base).toUpperCase();
  }, [topicId]);

  const handleAskAI = (mistake) => {
    if (onAskAI) {
      onAskAI({
        problem: mistake.problem,
        description: mistake.description,
        type: mistake.type || 'mcq',
        difficulty: mistake.difficulty,
        topic: topicId || mistake.topicId,
        wrongOption: mistake.wrongOption,
        correctOption: mistake.correctOption,
        wrongOptionText: mistake.wrongOptionText,
        correctOptionText: mistake.correctOptionText,
        whyCorrect: mistake.whyCorrect,
        howToFind: mistake.howToFind,
        studentWork: mistake.studentWork,
        studentAnswer: mistake.studentAnswer,
        expectedAnswer: mistake.expectedAnswer,
      });
    }
  };

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
                <div className="mistake-desc">{m.description || 'Mistake'}</div>

                {m.problem && (
                  <div
                    className="mistake-question"
                    dangerouslySetInnerHTML={{ __html: `<strong>Question:</strong> ${renderMathInText(m.problem)}` }}
                  />
                )}

                {m.type === 'mcq' && (m.wrongOption || m.wrongOptionText || m.correctOption || m.correctOptionText) && (
                  <div className="mistake-breakdown">
                    <div
                      className="mistake-line mistake-wrong"
                      dangerouslySetInnerHTML={{
                        __html: `<strong>Wrong option:</strong> ${renderMathInText(
                          formatMcqOption(m.wrongOption, m.wrongOptionText)
                        )}`,
                      }}
                    />
                    <div
                      className="mistake-line mistake-right"
                      dangerouslySetInnerHTML={{
                        __html: `<strong>Right option:</strong> ${renderMathInText(
                          formatMcqOption(m.correctOption, m.correctOptionText)
                        )}`,
                      }}
                    />
                    {(m.whyCorrect || m.howToFind) && (
                      <div
                        className="mistake-how"
                        dangerouslySetInnerHTML={{
                          __html: `<strong>Why ${String(m.correctOption || 'the correct option')} is correct:</strong> ${renderMathInText(m.whyCorrect || m.howToFind)}`,
                        }}
                      />
                    )}
                  </div>
                )}

                {m.type === 'solve' && (m.whatWentWrong || m.whereLostMarks || m.studentAnswer || m.studentWork || m.expectedAnswer) && (
                  <div className="mistake-breakdown">
                    {m.studentAnswer && (
                      <div
                        className="mistake-line mistake-wrong"
                        dangerouslySetInnerHTML={{
                          __html: `<strong>Detected answer:</strong> ${renderMathInText(String(m.studentAnswer || ''))}`,
                        }}
                      />
                    )}
                    {m.studentWork && (
                      <div
                        className="mistake-how"
                        dangerouslySetInnerHTML={{
                          __html: `<strong>Your uploaded answer (OCR):</strong> ${renderMathInText(String(m.studentWork || ''))}`,
                        }}
                      />
                    )}
                    {m.expectedAnswer && (
                      <div
                        className="mistake-line mistake-right"
                        dangerouslySetInnerHTML={{
                          __html: `<strong>Expected answer:</strong> ${renderMathInText(String(m.expectedAnswer || ''))}`,
                        }}
                      />
                    )}
                    {m.whatWentWrong && (
                      <div
                        className="mistake-line"
                        dangerouslySetInnerHTML={{
                          __html: `<strong>What went wrong:</strong> ${renderMathInText(String(m.whatWentWrong || ''))}`,
                        }}
                      />
                    )}
                    {m.whereLostMarks && (
                      <div
                        className="mistake-how"
                        dangerouslySetInnerHTML={{
                          __html: `<strong>Where marks were lost:</strong> ${renderMathInText(String(m.whereLostMarks || ''))}`,
                        }}
                      />
                    )}
                  </div>
                )}

                <div className="mistake-meta">
                  <span className="pill">{String(m.topicId || '').toUpperCase()}</span>
                  <span className="pill">{(m.date || '').split('T')[0]}</span>
                  {m.type && <span className="pill">{m.type.toUpperCase()}</span>}
                  {m.difficulty && <span className="pill difficulty">{String(m.difficulty).toUpperCase()}</span>}
                  {m.corrected && <span className="pill">Fixed</span>}
                </div>
              </div>
              <div className="mistake-actions">
                {!m.corrected && onAskAI && (
                  <button
                    className="panel-btn small"
                    onClick={() => handleAskAI(m)}
                    title="Ask AI how to solve this mistake"
                  >
                    💡 Ask AI
                  </button>
                )}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

