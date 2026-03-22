import React, { useMemo, useState, useEffect } from 'react';
import { renderMathInText } from './StreamingText.jsx';
import { TOPICS } from '../agents/KnowledgeGraph.js';
import { getMistakes, saveMistake } from '../store/localVault.js';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

const SUBTOPICS = {
  polynomials: ['Definition', 'Degree', 'Add/Subtract like terms', 'Simplify', 'Expand'],
  'linear-equations': ['One-step', 'Two-step', 'Variables both sides'],
  quadratics: ['Factoring', 'Completing the square', 'Quadratic formula'],
  functions: ['Domain', 'Range', 'Graph basics'],
};

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generatePolynomialQuiz() {
  const allQuestions = [
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
  ];

  // Pick 5 random questions
  const shuffled = shuffleArray(allQuestions);
  const selected = shuffled.slice(0, 5).map((q, i) => ({ ...q, id: `mcq_${i + 1}` }));

  return {
    title: 'Polynomials Quiz',
    mcq: selected,
    solve: {
      id: 'solve1',
      prompt: 'Expand and simplify: $(2x - 3)(x + 4) - 5x$',
      expected: '2x^2 - 12',
    },
  };
}

function defaultQuiz(topicId, subtopic) {
  const topic = (topicId || 'polynomials').toLowerCase();
  if (topic.includes('polynomial')) {
    return generatePolynomialQuiz();
  }

  return {
    title: 'Quick Quiz',
    mcq: [
      { id: 'mcq1', prompt: 'Which is true for all real numbers $a$ and $b$?', options: [
        { id: 'a', text: '$(a+b)^2 = a^2 + b^2$' },
        { id: 'b', text: '$(a+b)^2 = a^2 + 2ab + b^2$' },
        { id: 'c', text: '$a^2 - b^2 = (a-b)^2$' },
        { id: 'd', text: '$a^2 + b^2 = (a+b)(a-b)$' },
      ], answer: 'b' },
      { id: 'mcq2', prompt: 'Simplify: $6 + 2\\cdot 3$', options: [
        { id: 'a', text: '$12$' }, { id: 'b', text: '$6$' }, { id: 'c', text: '$9$' }, { id: 'd', text: '$8$' },
      ], answer: 'a' },
      { id: 'mcq3', prompt: 'Solve: $x + 5 = 9$', options: [
        { id: 'a', text: '$x=14$' }, { id: 'b', text: '$x=4$' }, { id: 'c', text: '$x=-4$' }, { id: 'd', text: '$x=0$' },
      ], answer: 'b' },
      { id: 'mcq4', prompt: 'Which is equal to $\\frac{1}{2}$?', options: [
        { id: 'a', text: '$0.2$' }, { id: 'b', text: '$0.5$' }, { id: 'c', text: '$2$' }, { id: 'd', text: '$1.5$' },
      ], answer: 'b' },
      { id: 'mcq5', prompt: 'Compute: $3^2$', options: [
        { id: 'a', text: '$6$' }, { id: 'b', text: '$9$' }, { id: 'c', text: '$8$' }, { id: 'd', text: '$12$' },
      ], answer: 'b' },
    ],
    solve: {
      id: 'solve1',
      prompt: 'Compute: $8\\times 7$',
      expected: '56',
    },
  };
}

export default function QuizView({ topicId, onRequirePhotoProof = true, onSubmit }) {
  const [chosenTopicId, setChosenTopicId] = useState(topicId || 'polynomials');
  const [chosenSubtopic, setChosenSubtopic] = useState('');
  const [started, setStarted] = useState(false);
  const [mistakes, setMistakes] = useState([]);

  useEffect(() => {
    setChosenTopicId(topicId || 'polynomials');
  }, [topicId]);

  useEffect(() => {
    (async () => {
      const rows = await getMistakes(chosenTopicId);
      setMistakes((rows || []).slice(-5).reverse());
    })();
  }, [chosenTopicId]);

  const quiz = useMemo(() => defaultQuiz(chosenTopicId, chosenSubtopic), [chosenTopicId, chosenSubtopic]);
  const [answers, setAnswers] = useState({});
  const [solveAnswer, setSolveAnswer] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handlePickProof = (e) => {
    setError('');
    const f = e.target.files?.[0] || null;
    if (!f) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
      setProofFile(null);
      setError('❌ Photo proof must be an image file (PNG/JPG/WebP/GIF/BMP).');
      e.target.value = '';
      return;
    }
    setProofFile(f);
  };

  const handleSubmit = async () => {
    setError('');

    for (const q of quiz.mcq) {
      if (!answers[q.id]) {
        setError('❌ Please answer all MCQ questions.');
        return;
      }
    }
    if (!solveAnswer.trim()) {
      setError('❌ Please enter an answer for the solving question.');
      return;
    }
    if (onRequirePhotoProof && !proofFile) {
      setError('❌ Please upload a photo proof before submitting the quiz.');
      return;
    }

    const mcqScore = quiz.mcq.reduce((acc, q) => acc + (answers[q.id] === q.answer ? 1 : 0), 0);
    const mcqTotal = quiz.mcq.length;

    const payload = {
      topicId: chosenTopicId,
      subtopic: chosenSubtopic,
      answers,
      solveAnswer: solveAnswer.trim(),
      solveExpected: quiz.solve.expected,
      solvePrompt: quiz.solve.prompt,
      proofFile,
      mcqScore,
      mcqTotal,
    };

    // Record mistakes for wrong MCQs (lightweight)
    for (const q of quiz.mcq) {
      const picked = answers[q.id];
      if (picked && picked !== q.answer) {
        await saveMistake({
          topicId: chosenTopicId,
          problem: q.prompt,
          description: `MCQ mistake: chose ${picked.toUpperCase()} instead of ${q.answer.toUpperCase()}`,
        });
      }
    }

    const submissionResult = await onSubmit?.(payload);
    if (submissionResult) {
      setResult({
        mcqScore,
        mcqTotal,
        totalScore: submissionResult.score,
        totalMax: submissionResult.maxScore,
        note: `Submitted. Final score: ${submissionResult.score}/${submissionResult.maxScore} (${submissionResult.percentage}%).`,
      });
      return;
    }

    setResult({
      mcqScore,
      mcqTotal,
      note: 'Submitted. A tutor/grader can verify the photo proof and solution.',
    });
  };

  return (
    <div className="quiz-view">
      <div className="quiz-header">
        <h3>🏆 {quiz.title}</h3>
        <div className="quiz-subtitle">MCQ + solving question. Photo proof required to submit.</div>
      </div>

      {!started ? (
        <div className="quiz-section">
          <h4>Choose topic</h4>
          <div className="settings-row">
            <select className="quiz-input" value={chosenTopicId} onChange={(e) => setChosenTopicId(e.target.value)}>
              {TOPICS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <select
              className="quiz-input"
              value={chosenSubtopic}
              onChange={(e) => setChosenSubtopic(e.target.value)}
            >
              <option value="">(Subtopic: optional)</option>
              {(SUBTOPICS[chosenTopicId] || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button className="panel-btn primary" onClick={() => setStarted(true)}>
              Start quiz
            </button>
          </div>

          <div className="quiz-subtitle" style={{ marginTop: 10 }}>
            Recent mistakes for this topic (used for context):
          </div>
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
      ) : (
        <>
      <div className="quiz-section">
        <h4>MCQ</h4>
        <div className="quiz-questions">
          {quiz.mcq.map((q, idx) => (
            <div key={q.id} className="quiz-q">
              <div
                className="quiz-q-title"
                dangerouslySetInnerHTML={{ __html: `${idx + 1}. ${renderMathInText(q.prompt)}` }}
              />
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
                    <span
                      className="quiz-option-text"
                      dangerouslySetInnerHTML={{ __html: renderMathInText(opt.text) }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="quiz-section">
        <h4>Solve</h4>
        <div className="quiz-q">
          <div
            className="quiz-q-title"
            dangerouslySetInnerHTML={{ __html: renderMathInText(quiz.solve.prompt) }}
          />
          <input
            className="quiz-input"
            value={solveAnswer}
            onChange={(e) => setSolveAnswer(e.target.value)}
            placeholder="Type your final answer here"
          />
        </div>
      </div>

      <div className="quiz-section">
        <h4>Photo proof</h4>
        <div className="quiz-proof">
          <input type="file" accept="image/*" onChange={handlePickProof} />
          {proofFile && <div className="quiz-proof-file">Selected: {proofFile.name}</div>}
        </div>
      </div>

      {error && <div className="quiz-error">{error}</div>}

      <div className="quiz-actions">
        <button className="panel-btn primary" onClick={handleSubmit}>Submit quiz</button>
        <button className="panel-btn" onClick={() => setStarted(false)}>Change topic</button>
      </div>

      {result && (
        <div className="quiz-result">
          <b>MCQ score:</b> {result.mcqScore}/{result.mcqTotal}
          {typeof result.totalScore === 'number' && typeof result.totalMax === 'number' && (
            <div><b>Total score:</b> {result.totalScore}/{result.totalMax}</div>
          )}
          <div className="quiz-result-note">{result.note}</div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

