import React, { useMemo, useState, useEffect } from 'react';
import { renderMathInText } from './StreamingText.jsx';
import { TOPICS } from '../agents/KnowledgeGraph.js';
import { getMistakes, saveMistake } from '../store/localVault.js';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

const QUIZ_MODES = [
  { id: 'both', label: 'Both (MCQ + Long)' },
  { id: 'mcq', label: 'MCQ only' },
  { id: 'long', label: 'Long answer only' },
];

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeAnswer(answer) {
  return String(answer || '')
    .toLowerCase()
    .trim()
    .replace(/\$+/g, '')
    .replace(/\s+/g, '');
}

function generatePolynomialQuiz() {
  const allMCQQuestions = [
    {
      id: 'mcq_poly1',
      prompt: 'Which expression is a polynomial in $x$?',
      options: [
        { id: 'a', text: '$3x^2 - 2x + 1$' },
        { id: 'b', text: '$\\frac{1}{x} + 2$' },
        { id: 'c', text: '$\\sqrt{x} + 1$' },
        { id: 'd', text: '$\\sin(x)$' },
      ],
      answer: 'a',
    },
    {
      id: 'mcq_poly2',
      prompt: 'What is the degree of $7x^4 + x - 9$?',
      options: [
        { id: 'a', text: '$1$' },
        { id: 'b', text: '$4$' },
        { id: 'c', text: '$5$' },
        { id: 'd', text: '$9$' },
      ],
      answer: 'b',
    },
    {
      id: 'mcq_poly3',
      prompt: 'Which is the leading term of $5x^3 - 2x + 7$?',
      options: [
        { id: 'a', text: '$7$' },
        { id: 'b', text: '$-2x$' },
        { id: 'c', text: '$5x^3$' },
        { id: 'd', text: '$x^3$' },
      ],
      answer: 'c',
    },
    {
      id: 'mcq_poly4',
      prompt: 'Simplify: $x^2 + 3x^2$',
      options: [
        { id: 'a', text: '$4x^2$' },
        { id: 'b', text: '$3x^4$' },
        { id: 'c', text: '$x^4$' },
        { id: 'd', text: '$4x$' },
      ],
      answer: 'a',
    },
    {
      id: 'mcq_poly5',
      prompt: 'Which expression is NOT a polynomial?',
      options: [
        { id: 'a', text: '$2x^2 - 1$' },
        { id: 'b', text: '$x^{-1} + 3$' },
        { id: 'c', text: '$9$' },
        { id: 'd', text: '$x^5$' },
      ],
      answer: 'b',
    },
    {
      id: 'mcq_poly6',
      prompt: 'If $p(x)=x^3$, what is $p(2)$?',
      options: [
        { id: 'a', text: '$6$' },
        { id: 'b', text: '$8$' },
        { id: 'c', text: '$9$' },
        { id: 'd', text: '$12$' },
      ],
      answer: 'b',
    },
    {
      id: 'mcq_poly7',
      prompt: 'Expand: $(x+2)(x-3)$',
      options: [
        { id: 'a', text: '$x^2 - x + 6$' },
        { id: 'b', text: '$x^2 - x - 6$' },
        { id: 'c', text: '$x^2 + 5x - 6$' },
        { id: 'd', text: '$x^2 - 5x - 6$' },
      ],
      answer: 'b',
    },
    {
      id: 'mcq_poly8',
      prompt: 'Which is the coefficient of $x^2$ in $4x^2 - x + 1$?',
      options: [
        { id: 'a', text: '$1$' },
        { id: 'b', text: '$-1$' },
        { id: 'c', text: '$4$' },
        { id: 'd', text: '$-x$' },
      ],
      answer: 'c',
    },
    {
      id: 'mcq_poly9',
      prompt: 'Factor: $x^2 - 5x + 6$',
      options: [
        { id: 'a', text: '$(x+2)(x+3)$' },
        { id: 'b', text: '$(x-2)(x-3)$' },
        { id: 'c', text: '$(x-2)(x+3)$' },
        { id: 'd', text: '$(x+2)(x-3)$' },
      ],
      answer: 'b',
    },
    {
      id: 'mcq_poly10',
      prompt: 'Simplify: $3x^2 + 2x - x^2 + 4x$',
      options: [
        { id: 'a', text: '$2x^2 + 6x$' },
        { id: 'b', text: '$4x^2 + 6x$' },
        { id: 'c', text: '$3x^2 + 6x$' },
        { id: 'd', text: '$2x^2 + 5x$' },
      ],
      answer: 'a',
    },
    {
      id: 'mcq_poly11',
      prompt: 'Find the product: $(2x - 1)(3x + 4)$',
      options: [
        { id: 'a', text: '$6x^2 + 8x - 3x - 4$' },
        { id: 'b', text: '$6x^2 + 5x - 4$' },
        { id: 'c', text: '$5x^2 + 5x - 4$' },
        { id: 'd', text: '$6x^2 - 5x - 4$' },
      ],
      answer: 'b',
    },
  ];

  const selectedMCQ = shuffleArray(allMCQQuestions).slice(0, 6).map((q, i) => ({ ...q, id: `mcq_${i + 1}` }));

  const solveQuestions = [
    { id: 'solve1', prompt: 'Expand: $(x + 2)(x + 3)$', expected: 'x^2 + 5x + 6', difficulty: 'easy' },
    { id: 'solve2', prompt: 'Expand and simplify: $(2x - 3)(x + 4) - 5$', expected: '2x^2 + 5x - 17', difficulty: 'medium' },
    { id: 'solve3', prompt: 'Factor: $x^2 + 7x + 12$', expected: '(x + 3)(x + 4)', difficulty: 'medium' },
    { id: 'solve4', prompt: 'Solve: $2x^2 - 8x = 0$', expected: 'x = 0 or x = 4', difficulty: 'hard' },
    { id: 'solve5', prompt: 'Simplify and expand: $(3x - 2)^2$', expected: '9x^2 - 12x + 4', difficulty: 'hard' },
  ];

  return { title: 'Polynomials Quiz', mcq: selectedMCQ, solveQuestions };
}

function defaultQuiz(topicId) {
  const topic = (topicId || 'polynomials').toLowerCase();
  if (topic.includes('polynomial')) return generatePolynomialQuiz();

  return {
    title: 'Quick Quiz',
    mcq: [
      {
        id: 'mcq1',
        prompt: 'Which is true for all real numbers $a$ and $b$?',
        options: [
          { id: 'a', text: '$(a+b)^2 = a^2 + b^2$' },
          { id: 'b', text: '$(a+b)^2 = a^2 + 2ab + b^2$' },
          { id: 'c', text: '$a^2 - b^2 = (a-b)^2$' },
          { id: 'd', text: '$a^2 + b^2 = (a+b)(a-b)$' },
        ],
        answer: 'b',
      },
      {
        id: 'mcq2',
        prompt: 'Simplify: $6 + 2\\cdot 3$',
        options: [
          { id: 'a', text: '$12$' },
          { id: 'b', text: '$6$' },
          { id: 'c', text: '$9$' },
          { id: 'd', text: '$8$' },
        ],
        answer: 'a',
      },
      {
        id: 'mcq3',
        prompt: 'Solve: $x + 5 = 9$',
        options: [
          { id: 'a', text: '$x=14$' },
          { id: 'b', text: '$x=4$' },
          { id: 'c', text: '$x=-4$' },
          { id: 'd', text: '$x=0$' },
        ],
        answer: 'b',
      },
      {
        id: 'mcq4',
        prompt: 'Which is equal to $\\frac{1}{2}$?',
        options: [
          { id: 'a', text: '$0.2$' },
          { id: 'b', text: '$0.5$' },
          { id: 'c', text: '$2$' },
          { id: 'd', text: '$1.5$' },
        ],
        answer: 'b',
      },
      {
        id: 'mcq5',
        prompt: 'Compute: $3^2$',
        options: [
          { id: 'a', text: '$6$' },
          { id: 'b', text: '$9$' },
          { id: 'c', text: '$8$' },
          { id: 'd', text: '$12$' },
        ],
        answer: 'b',
      },
      {
        id: 'mcq6',
        prompt: 'Simplify: $\\frac{8}{4}$',
        options: [
          { id: 'a', text: '$2$' },
          { id: 'b', text: '$4$' },
          { id: 'c', text: '$8$' },
          { id: 'd', text: '$1$' },
        ],
        answer: 'a',
      },
    ],
    solveQuestions: [
      { id: 'solve1', prompt: 'Compute: $8 \\times 7$', expected: '56', difficulty: 'easy' },
      { id: 'solve2', prompt: 'Solve: $2x + 5 = 15$', expected: 'x = 5', difficulty: 'easy' },
      { id: 'solve3', prompt: 'Compute: $15 \\div 3 + 2$', expected: '7', difficulty: 'medium' },
      { id: 'solve4', prompt: 'Solve: $3x - 7 = 20$', expected: 'x = 9', difficulty: 'medium' },
      { id: 'solve5', prompt: 'Simplify: $\\frac{12x}{4}$', expected: '3x', difficulty: 'hard' },
    ],
  };
}

export default function QuizView({
  topicId,
  onRequirePhotoProof = true,
  onSubmit,
  onAskAI,
  onExtractAnswerFromPhoto,
}) {
  const [chosenTopicId, setChosenTopicId] = useState(topicId || 'polynomials');
  const [quizMode, setQuizMode] = useState('both');
  const [started, setStarted] = useState(false);
  const [mistakes, setMistakes] = useState([]);
  const [answers, setAnswers] = useState({});
  const [solveAnswers, setSolveAnswers] = useState({});
  const [proofFiles, setProofFiles] = useState({});
  const [extractingMap, setExtractingMap] = useState({});
  const [currentSolveQuestion, setCurrentSolveQuestion] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    setChosenTopicId(topicId || 'polynomials');
  }, [topicId]);

  useEffect(() => {
    (async () => {
      const rows = await getMistakes(chosenTopicId);
      setMistakes((rows || []).slice(-5).reverse());
    })();
  }, [chosenTopicId]);

  const quiz = useMemo(() => defaultQuiz(chosenTopicId), [chosenTopicId]);
  const solveQuestions = quiz.solveQuestions || [];
  const currentQuestion = solveQuestions[currentSolveQuestion] || null;
  const showMCQ = quizMode === 'both' || quizMode === 'mcq';
  const showLong = quizMode === 'both' || quizMode === 'long';

  const handlePickProof = async (e, question) => {
    setError('');
    const file = e.target.files?.[0] || null;
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setProofFiles((p) => ({ ...p, [question.id]: null }));
      setError('Photo proof must be an image file (PNG/JPG/WebP/GIF/BMP).');
      return;
    }

    setProofFiles((p) => ({ ...p, [question.id]: file }));

    if (!onExtractAnswerFromPhoto) return;

    setExtractingMap((p) => ({ ...p, [question.id]: true }));
    try {
      const extracted = await onExtractAnswerFromPhoto(file, question.prompt);
      const nextValue = String(extracted || '').trim();
      if (nextValue && nextValue.toUpperCase() !== 'UNCLEAR') {
        setSolveAnswers((p) => ({ ...p, [question.id]: nextValue }));
      }
    } catch {
      setError('Could not read answer from this photo. You can still type the answer manually.');
    } finally {
      setExtractingMap((p) => ({ ...p, [question.id]: false }));
    }
  };

  const handleSubmit = async () => {
    setError('');

    if (showMCQ) {
      for (const q of quiz.mcq) {
        if (!answers[q.id]) {
          setError('Please answer all MCQ questions.');
          return;
        }
      }
    }

    if (showLong) {
      for (const q of solveQuestions) {
        if (!solveAnswers[q.id]?.trim()) {
          setError(`Please add answers for all long questions. Missing: Question ${solveQuestions.indexOf(q) + 1}`);
          return;
        }
      }
      if (onRequirePhotoProof) {
        for (const q of solveQuestions) {
          if (!proofFiles[q.id]) {
            setError(`Please upload photo proof for all long questions. Missing: Question ${solveQuestions.indexOf(q) + 1}`);
            return;
          }
        }
      }
    }

    const mcqScore = showMCQ
      ? quiz.mcq.reduce((acc, q) => acc + (answers[q.id] === q.answer ? 1 : 0), 0)
      : 0;
    const mcqTotal = showMCQ ? quiz.mcq.length : 0;

    let solveScore = 0;
    const solveMax = showLong ? solveQuestions.length * 5 : 0;
    const solveDetails = [];

    if (showLong) {
      for (const q of solveQuestions) {
        const studentAnswer = String(solveAnswers[q.id] || '').trim();
        const isCorrect = normalizeAnswer(studentAnswer) === normalizeAnswer(q.expected);
        const score = isCorrect ? 5 : 2;
        solveScore += score;
        solveDetails.push({
          questionId: q.id,
          prompt: q.prompt,
          expected: q.expected,
          answer: studentAnswer,
          correct: isCorrect,
          score,
          difficulty: q.difficulty,
        });
      }
    }

    const totalScore = mcqScore + solveScore;
    const totalMax = mcqTotal + solveMax;
    const percentage = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

    if (showMCQ) {
      for (const q of quiz.mcq) {
        const picked = answers[q.id];
        if (picked && picked !== q.answer) {
          await saveMistake({
            topicId: chosenTopicId,
            problem: q.prompt,
            description: `MCQ mistake: chose ${picked.toUpperCase()} instead of ${q.answer.toUpperCase()}`,
            type: 'mcq',
          });
        }
      }
    }

    if (showLong) {
      for (const detail of solveDetails) {
        if (!detail.correct) {
          await saveMistake({
            topicId: chosenTopicId,
            problem: detail.prompt,
            description: `Long-answer mistake (${detail.difficulty}): got "${detail.answer}" but expected "${detail.expected}"`,
            type: 'solve',
            difficulty: detail.difficulty,
          });
        }
      }
    }

    const payload = {
      topicId: chosenTopicId,
      quizMode,
      answers,
      solveAnswers,
      solveDetails,
      proofFiles,
      mcqScore,
      mcqTotal,
      solveScore,
      solveMax,
      totalScore,
      totalMax,
      percentage,
    };

    const submissionResult = await onSubmit?.(payload);
    if (submissionResult) {
      setResult({
        mcqScore,
        mcqTotal,
        solveScore,
        solveMax,
        totalScore: submissionResult.score,
        totalMax: submissionResult.maxScore,
        percentage: submissionResult.percentage,
        solveDetails,
        note: `Submitted. Final score: ${submissionResult.score}/${submissionResult.maxScore} (${submissionResult.percentage}%).`,
      });
      return;
    }

    setResult({
      mcqScore,
      mcqTotal,
      solveScore,
      solveMax,
      totalScore,
      totalMax,
      percentage,
      solveDetails,
      note: 'Submitted. You can now open AI chat for any doubts.',
    });
  };

  const handleAskAI = (detail) => {
    onAskAI?.({
      type: 'solve',
      topic: chosenTopicId,
      question: detail.prompt,
      expected: detail.expected,
      difficulty: detail.difficulty,
    });
  };

  const resetAttempt = () => {
    setStarted(false);
    setResult(null);
    setCurrentSolveQuestion(0);
    setAnswers({});
    setSolveAnswers({});
    setProofFiles({});
    setExtractingMap({});
    setError('');
  };

  return (
    <div className="quiz-view">
      <div className="quiz-header">
        <h3>{quiz.title}</h3>
        <div className="quiz-subtitle">
          {quizMode === 'both' ? 'MCQ + long-answer quiz' : quizMode === 'mcq' ? 'MCQ-only quiz' : 'Long-answer quiz'}
        </div>
      </div>

      {!started ? (
        <div className="quiz-section">
          <h4>Choose topic and mode</h4>
          <div className="settings-row">
            <select className="quiz-input" value={chosenTopicId} onChange={(e) => setChosenTopicId(e.target.value)}>
              {TOPICS.map((t) => (
                <option key={t.id} value={t.id}>{String(t.label || t.id).toUpperCase()}</option>
              ))}
            </select>
            <select className="quiz-input" value={quizMode} onChange={(e) => setQuizMode(e.target.value)}>
              {QUIZ_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <button className="panel-btn primary" onClick={() => setStarted(true)}>Start quiz</button>
          </div>

          <div className="quiz-subtitle" style={{ marginTop: 10 }}>Recent mistakes for this topic:</div>
          {mistakes.length === 0 ? (
            <div className="chat-sessions-empty">No recent mistakes for this topic.</div>
          ) : (
            <div className="topic-map-mini">
              {mistakes.map((m) => (
                <div key={m.id} className="topic-map-edge">
                  <span className="edge-from">{(m.description || '').slice(0, 60) || 'Mistake'}</span>
                  <span className="edge-arrow">•</span>
                  <span className="edge-to">{(m.problem || '').slice(0, 60) || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : result ? (
        <div className="quiz-result-complete">
          <h3>Quiz Completed</h3>
          <div className="result-scores">
            {showMCQ && (
              <div className="score-box">
                <div className="score-label">MCQ Score</div>
                <div className="score-value">{result.mcqScore}/{result.mcqTotal}</div>
              </div>
            )}
            {showLong && (
              <div className="score-box">
                <div className="score-label">Long-answer Score</div>
                <div className="score-value">{result.solveScore}/{result.solveMax}</div>
              </div>
            )}
            <div className="score-box high">
              <div className="score-label">Total Score</div>
              <div className="score-value">{result.totalScore}/{result.totalMax}</div>
              <div className="score-percentage">({result.percentage}%)</div>
            </div>
          </div>

          <div className="quiz-result-note">{result.note}</div>

          {showLong && result.solveDetails?.length > 0 && (
            <div className="solve-details">
              <h4>Long-answer Review</h4>
              {result.solveDetails.map((detail, idx) => (
                <div key={detail.questionId} className={`solve-detail-item ${detail.correct ? 'correct' : 'incorrect'}`}>
                  <div className="detail-header">
                    <span className="detail-num">Q{idx + 1}</span>
                    <span className={`status-badge ${detail.correct ? 'correct' : 'incorrect'}`}>
                      {detail.correct ? 'Correct' : 'Incorrect'}
                    </span>
                    <span className="difficulty-badge">{detail.difficulty}</span>
                  </div>
                  <div className="detail-question" dangerouslySetInnerHTML={{ __html: `<strong>Question:</strong> ${renderMathInText(detail.prompt)}` }} />
                  <div className="detail-answer"><strong>Your answer:</strong> {detail.answer}</div>
                  {!detail.correct && (
                    <>
                      <div className="detail-expected"><strong>Expected:</strong> {detail.expected}</div>
                      <button className="panel-btn small" onClick={() => handleAskAI(detail)}>
                        Ask AI how to solve
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="quiz-actions">
            <button className="panel-btn primary" onClick={resetAttempt}>Start New Quiz</button>
            <button className="panel-btn" onClick={() => onAskAI?.({ type: 'quiz_doubt', topic: chosenTopicId })}>
              Ask AI Doubts
            </button>
          </div>
        </div>
      ) : (
        <>
          {showMCQ && (
            <div className="quiz-section">
              <h4>MCQ ({quiz.mcq.length} questions)</h4>
              <div className="quiz-questions">
                {quiz.mcq.map((q, idx) => (
                  <div key={q.id} className="quiz-q">
                    <div className="quiz-q-title" dangerouslySetInnerHTML={{ __html: `${idx + 1}. ${renderMathInText(q.prompt)}` }} />
                    <div className="quiz-options">
                      {q.options.map((opt) => (
                        <label key={opt.id} className={`quiz-option ${answers[q.id] === opt.id ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name={q.id}
                            value={opt.id}
                            checked={answers[q.id] === opt.id}
                            onChange={() => setAnswers((p) => ({ ...p, [q.id]: opt.id }))}
                          />
                          <span className="quiz-option-text" dangerouslySetInnerHTML={{ __html: renderMathInText(opt.text) }} />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showLong && (
            <div className="quiz-section">
              <div className="solve-header">
                <h4>Long Questions ({currentSolveQuestion + 1}/{solveQuestions.length})</h4>
                <span className="difficulty-badge">{currentQuestion?.difficulty?.toUpperCase() || ''}</span>
              </div>

              {currentQuestion && (
                <div className="solve-question-container">
                  <div className="quiz-q">
                    <div className="quiz-q-title" dangerouslySetInnerHTML={{ __html: renderMathInText(currentQuestion.prompt) }} />
                    <input
                      className="quiz-input"
                      value={solveAnswers[currentQuestion.id] || ''}
                      onChange={(e) => setSolveAnswers((p) => ({ ...p, [currentQuestion.id]: e.target.value }))}
                      placeholder="Answer auto-fills from photo (editable)"
                    />
                  </div>

                  <div className="quiz-proof-section">
                    <label className="proof-label">Photo proof for this question</label>
                    <input type="file" accept="image/*" onChange={(e) => handlePickProof(e, currentQuestion)} />
                    {extractingMap[currentQuestion.id] && (
                      <div className="quiz-proof-file">Reading answer from photo...</div>
                    )}
                    {proofFiles[currentQuestion.id] && (
                      <div className="quiz-proof-file">Selected: {proofFiles[currentQuestion.id].name}</div>
                    )}
                  </div>
                </div>
              )}

              <div className="quiz-proof-summary">
                {solveQuestions.map((q, idx) => (
                  <span key={q.id} className={`pill ${proofFiles[q.id] ? 'pill-ok' : ''}`}>
                    Q{idx + 1}: {proofFiles[q.id] ? 'proof uploaded' : 'missing'}
                  </span>
                ))}
              </div>

              <div className="solve-nav">
                <button
                  className="panel-btn"
                  onClick={() => setCurrentSolveQuestion((v) => Math.max(0, v - 1))}
                  disabled={currentSolveQuestion === 0}
                >
                  Previous
                </button>
                <span className="nav-indicator">Question {currentSolveQuestion + 1} of {solveQuestions.length}</span>
                <button
                  className="panel-btn"
                  onClick={() => setCurrentSolveQuestion((v) => Math.min(solveQuestions.length - 1, v + 1))}
                  disabled={currentSolveQuestion === solveQuestions.length - 1}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {error && <div className="quiz-error">{error}</div>}

          <div className="quiz-actions">
            <button className="panel-btn primary" onClick={handleSubmit}>Submit Quiz</button>
            <button className="panel-btn" onClick={resetAttempt}>Change topic</button>
          </div>
        </>
      )}
    </div>
  );
}