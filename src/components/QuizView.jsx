import React, { useEffect, useMemo, useState } from 'react';
import { renderMathInText } from './StreamingText.jsx';
import { TOPICS } from '../agents/KnowledgeGraph.js';
import { getMistakes, saveMistake } from '../store/localVault.js';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

const QUIZ_MODES = [
  { id: 'both', label: 'Both (MCQ + Long)' },
  { id: 'mcq', label: 'MCQ only' },
  { id: 'long', label: 'Long answer only' },
];

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function clampMarks(value, min = 0, max = 5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeAnswer(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\$+/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function toLines(value) {
  return normalizeText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isUnclearText(line));
}

function isUnclearText(value) {
  const text = String(value || '').trim().toLowerCase();
  return (
    !text
    || text === 'unclear'
    || text.includes('could not read')
    || text.includes('unreadable')
    || text.includes('unable to transcribe')
    || text.includes('cannot transcribe')
    || text.includes("can't transcribe")
    || text.includes('unable to read')
    || text.includes('cannot read')
    || text.includes("can't read")
    || text.includes('please provide')
    || text.includes('please upload')
    || text.includes('error_no_content')
    || text.includes('i am unable')
    || text.includes('i cannot')
  );
}

function normalizeStepStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'correct' || status === 'partial' || status === 'incorrect' || status === 'unreadable') {
    return status;
  }
  return 'partial';
}

function toStepEntries(rawStepBreakdown) {
  if (Array.isArray(rawStepBreakdown)) return rawStepBreakdown;
  if (rawStepBreakdown === null || rawStepBreakdown === undefined) return [];

  if (typeof rawStepBreakdown === 'string') {
    const trimmed = rawStepBreakdown.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      return toStepEntries(parsed);
    } catch {
      // Treat non-JSON text as one line per step.
    }

    return trimmed
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({ step: index + 1, studentLine: line }));
  }

  if (typeof rawStepBreakdown === 'object') {
    const nestedCandidates = [
      rawStepBreakdown.stepBreakdown,
      rawStepBreakdown.steps,
      rawStepBreakdown.stepResults,
      rawStepBreakdown.lines,
      rawStepBreakdown.items,
      rawStepBreakdown.entries,
    ];

    for (const candidate of nestedCandidates) {
      if (Array.isArray(candidate)) return candidate;
    }

    const singleton = String(
      rawStepBreakdown.studentLine
      || rawStepBreakdown.line
      || rawStepBreakdown.stepText
      || rawStepBreakdown.text
      || rawStepBreakdown.content
      || rawStepBreakdown.ocrLine
      || rawStepBreakdown.extractedLine
      || ''
    ).trim();

    if (singleton) return [rawStepBreakdown];
  }

  return [];
}

function normalizeStepBreakdown(rawStepBreakdown, studentWork, marksLost, isCorrect) {
  const rawStepAsText = typeof rawStepBreakdown === 'string' ? rawStepBreakdown.trim() : '';
  const normalizedRawStep = rawStepAsText && isUnclearText(rawStepAsText) ? '' : rawStepBreakdown;

  let steps = toStepEntries(normalizedRawStep)
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const line = entry.trim();
        if (!line || isUnclearText(line)) return null;
        return {
          step: index + 1,
          studentLine: line,
          status: isCorrect ? 'correct' : 'partial',
          marksLost: 0,
          note: '',
        };
      }

      if (!entry || typeof entry !== 'object') return null;

      const line = String(
        entry.studentLine
        || entry.line
        || entry.stepText
        || entry.text
        || entry.content
        || entry.ocrLine
        || entry.extractedLine
        || ''
      ).trim();

      if (!line || isUnclearText(line)) return null;

      const stepRaw = Number(entry.step ?? entry.stepNumber ?? entry.index ?? entry.id);
      const step = Number.isFinite(stepRaw) ? Math.max(1, Math.round(stepRaw)) : (index + 1);
      const lossRaw = Number(entry.marksLost ?? entry.markLoss ?? entry.deduction ?? entry.loss ?? entry.marksDeducted ?? 0);
      const stepLoss = Number.isFinite(lossRaw) ? clampMarks(lossRaw, 0, 5) : 0;

      return {
        step,
        studentLine: line,
        status: normalizeStepStatus(entry.status || entry.result || entry.grade || (stepLoss > 0 ? 'partial' : 'correct')),
        marksLost: stepLoss,
        note: String(entry.note || entry.feedback || entry.reason || entry.comment || '').trim(),
      };
    })
    .filter(Boolean);

  if (steps.length === 0) {
    const lines = toLines(studentWork);
    steps = lines.map((line, index) => ({
      step: index + 1,
      studentLine: line,
      status: isCorrect ? 'correct' : 'partial',
      marksLost: 0,
      note: '',
    }));
  }

  if (steps.length === 0) {
    return [
      {
        step: 1,
        studentLine: 'OCR transcript is unreadable from the uploaded image.',
        status: 'unreadable',
        marksLost: marksLost > 0 ? marksLost : 5,
        note: 'Upload a clearer photo to enable reliable step-by-step grading.',
      },
    ];
  }

  if (marksLost <= 0) {
    return steps.map((step) => ({
      ...step,
      status: step.status === 'incorrect' || step.status === 'unreadable' ? 'correct' : step.status,
      marksLost: 0,
      note: step.note || 'No marks lost on this step.',
    }));
  }

  const assigned = steps.reduce((sum, step) => sum + (Number(step.marksLost) || 0), 0);
  if (assigned < marksLost && steps.length > 0) {
    const delta = marksLost - assigned;
    const firstDeduction = steps.findIndex((step) => step.status === 'incorrect' || step.status === 'unreadable' || Number(step.marksLost) > 0);
    const targetIndex = firstDeduction >= 0 ? firstDeduction : (steps.length - 1);
    const target = steps[targetIndex];

    steps[targetIndex] = {
      ...target,
      status: target.status === 'correct' ? 'partial' : target.status,
      marksLost: (Number(target.marksLost) || 0) + delta,
      note: target.note || 'This is the main deduction point based on the submitted work.',
    };
  }

  return steps;
}

function deriveFinalAnswer(studentWork) {
  const lines = toLines(studentWork);
  if (lines.length === 0) return 'UNCLEAR';

  const equationTailCandidates = lines
    .map((line) => {
      const eqIdx = line.lastIndexOf('=');
      if (eqIdx >= 0 && eqIdx < line.length - 1) {
        return line.slice(eqIdx + 1).trim();
      }
      return '';
    })
    .filter(Boolean);

  const best = equationTailCandidates[equationTailCandidates.length - 1] || lines[lines.length - 1] || '';
  return isUnclearText(best) ? 'UNCLEAR' : best;
}

function normalizeLongPhotoAnalysis(raw, question) {
  if (!raw || typeof raw !== 'object') return null;

  const expected = String(question?.expected || '').trim();
  const studentWork = normalizeText(
    raw.studentWork
    ?? raw.detectedWork
    ?? raw.ocrText
    ?? raw.fullText
    ?? raw.transcript
    ?? raw.solutionText
    ?? ''
  );

  const rawFinalAnswer = String(
    raw.finalAnswer
    ?? raw.answer
    ?? raw.studentAnswer
    ?? raw.final_answer
    ?? raw.finalAnswerText
    ?? ''
  ).trim();

  const finalAnswer = isUnclearText(rawFinalAnswer)
    ? deriveFinalAnswer(studentWork)
    : rawFinalAnswer;

  const inferredCorrect = finalAnswer !== 'UNCLEAR'
    && expected
    && normalizeAnswer(finalAnswer) === normalizeAnswer(expected);

  const isCorrect = typeof raw.isCorrect === 'boolean' ? raw.isCorrect : inferredCorrect;

  const score = Number.isFinite(Number(raw.score))
    ? clampMarks(raw.score, 0, 5)
    : (isCorrect ? 5 : (finalAnswer !== 'UNCLEAR' ? 2 : 0));

  const marksLost = Math.max(0, 5 - score);
  const stepBreakdown = normalizeStepBreakdown(
    raw.stepBreakdown ?? raw.steps ?? raw.stepResults ?? raw.lines,
    studentWork || finalAnswer,
    marksLost,
    isCorrect
  );

  const whatWentWrong = String(raw.whatWentWrong || raw.stepError || '').trim()
    || (isCorrect
      ? 'Your method and final answer match the expected solution.'
      : (finalAnswer !== 'UNCLEAR'
        ? 'A transformation error led to a different final answer.'
        : 'The uploaded work is unreadable, so the method could not be verified.'));

  const whereLostMarks = String(raw.whereLostMarks || raw.markDeduction || '').trim()
    || (isCorrect
      ? 'No marks were deducted.'
      : (finalAnswer !== 'UNCLEAR'
        ? `Marks were deducted around the step that produced "${finalAnswer}".`
        : 'Marks were deducted where key steps could not be read from the image.'));

  return {
    finalAnswer,
    studentWork,
    isCorrect,
    score,
    marksLost,
    whatWentWrong,
    whereLostMarks,
    stepBreakdown,
    _debug: raw._debug && typeof raw._debug === 'object' ? raw._debug : null,
  };
}

function buildPolynomialQuiz() {
  return {
    title: 'Polynomials Quiz',
    mcq: [
      {
        id: 'poly_mcq_1',
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
        id: 'poly_mcq_2',
        prompt: 'What is the degree of $7x^4 + x - 9$?',
        options: [
          { id: 'a', text: '$1$' },
          { id: 'b', text: '$4$' },
          { id: 'c', text: '$7$' },
          { id: 'd', text: '$9$' },
        ],
        answer: 'b',
      },
      {
        id: 'poly_mcq_3',
        prompt: 'Expand: $(x+2)(x-3)$',
        options: [
          { id: 'a', text: '$x^2 - x - 6$' },
          { id: 'b', text: '$x^2 + x - 6$' },
          { id: 'c', text: '$x^2 - 5x - 6$' },
          { id: 'd', text: '$x^2 - x + 6$' },
        ],
        answer: 'a',
      },
      {
        id: 'poly_mcq_4',
        prompt: 'Factor: $x^2 - 5x + 6$',
        options: [
          { id: 'a', text: '$(x+2)(x+3)$' },
          { id: 'b', text: '$(x-2)(x-3)$' },
          { id: 'c', text: '$(x-1)(x-6)$' },
          { id: 'd', text: '$(x+1)(x-6)$' },
        ],
        answer: 'b',
      },
      {
        id: 'poly_mcq_5',
        prompt: 'Compute $p(2)$ if $p(x) = x^3 - 1$',
        options: [
          { id: 'a', text: '$6$' },
          { id: 'b', text: '$7$' },
          { id: 'c', text: '$8$' },
          { id: 'd', text: '$9$' },
        ],
        answer: 'b',
      },
      {
        id: 'poly_mcq_6',
        prompt: 'Which is NOT a polynomial?',
        options: [
          { id: 'a', text: '$2x^2 - 1$' },
          { id: 'b', text: '$x^{-1} + 3$' },
          { id: 'c', text: '$9$' },
          { id: 'd', text: '$x^5$' },
        ],
        answer: 'b',
      },
    ],
    solveQuestions: [
      { id: 'poly_solve_1', prompt: 'Expand: $(x + 2)(x + 3)$', expected: 'x^2 + 5x + 6', difficulty: 'easy' },
      { id: 'poly_solve_2', prompt: 'Factor: $x^2 + 7x + 12$', expected: '(x + 3)(x + 4)', difficulty: 'medium' },
      { id: 'poly_solve_3', prompt: 'Solve: $2x^2 - 8x = 0$', expected: 'x = 0 or x = 4', difficulty: 'medium' },
      { id: 'poly_solve_4', prompt: 'Simplify: $(3x - 2)^2$', expected: '9x^2 - 12x + 4', difficulty: 'hard' },
      { id: 'poly_solve_5', prompt: 'Expand and simplify: $(2x - 3)(x + 4) - 5$', expected: '2x^2 + 5x - 17', difficulty: 'hard' },
    ],
  };
}

function buildGeneralQuiz() {
  return {
    title: 'Quick Quiz',
    mcq: [
      {
        id: 'gen_mcq_1',
        prompt: 'Simplify: $6 + 2 \\cdot 3$',
        options: [
          { id: 'a', text: '$12$' },
          { id: 'b', text: '$6$' },
          { id: 'c', text: '$9$' },
          { id: 'd', text: '$8$' },
        ],
        answer: 'a',
      },
      {
        id: 'gen_mcq_2',
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
        id: 'gen_mcq_3',
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
        id: 'gen_mcq_4',
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
        id: 'gen_mcq_5',
        prompt: 'Simplify: $\\frac{8}{4}$',
        options: [
          { id: 'a', text: '$2$' },
          { id: 'b', text: '$4$' },
          { id: 'c', text: '$8$' },
          { id: 'd', text: '$1$' },
        ],
        answer: 'a',
      },
      {
        id: 'gen_mcq_6',
        prompt: 'Which identity is correct?',
        options: [
          { id: 'a', text: '$(a+b)^2 = a^2 + b^2$' },
          { id: 'b', text: '$(a+b)^2 = a^2 + 2ab + b^2$' },
          { id: 'c', text: '$a^2 - b^2 = (a-b)^2$' },
          { id: 'd', text: '$a^2 + b^2 = (a+b)(a-b)$' },
        ],
        answer: 'b',
      },
    ],
    solveQuestions: [
      { id: 'gen_solve_1', prompt: 'Compute: $8 \\times 7$', expected: '56', difficulty: 'easy' },
      { id: 'gen_solve_2', prompt: 'Solve: $2x + 5 = 15$', expected: 'x = 5', difficulty: 'easy' },
      { id: 'gen_solve_3', prompt: 'Compute: $15 \\div 3 + 2$', expected: '7', difficulty: 'medium' },
      { id: 'gen_solve_4', prompt: 'Solve: $3x - 7 = 20$', expected: 'x = 9', difficulty: 'medium' },
      { id: 'gen_solve_5', prompt: 'Simplify: $\\frac{12x}{4}$', expected: '3x', difficulty: 'hard' },
    ],
  };
}

function defaultQuiz(topicId) {
  const topic = String(topicId || 'polynomials').toLowerCase();
  if (topic.includes('polynomial')) return buildPolynomialQuiz();
  return buildGeneralQuiz();
}

function getMaxQuestionCount(baseQuiz, quizMode) {
  const mcqCount = (baseQuiz?.mcq || []).length;
  const longCount = (baseQuiz?.solveQuestions || []).length;

  if (quizMode === 'mcq') return Math.max(1, mcqCount);
  if (quizMode === 'long') return Math.max(1, longCount);
  return Math.max(1, mcqCount + longCount);
}

function buildQuizForConfig(topicId, quizMode = 'both', questionCount = 6, randomQuestionCount = false) {
  const baseQuiz = defaultQuiz(topicId);
  const allMcq = shuffleArray(baseQuiz.mcq || []);
  const allLong = shuffleArray(baseQuiz.solveQuestions || []);
  const maxCount = getMaxQuestionCount(baseQuiz, quizMode);
  const requestedCount = randomQuestionCount
    ? Math.floor(Math.random() * maxCount) + 1
    : clampInt(questionCount, 1, maxCount);

  if (quizMode === 'mcq') {
    return {
      ...baseQuiz,
      mcq: allMcq.slice(0, requestedCount),
      solveQuestions: [],
      requestedCount,
      maxCount,
    };
  }

  if (quizMode === 'long') {
    return {
      ...baseQuiz,
      mcq: [],
      solveQuestions: allLong.slice(0, requestedCount),
      requestedCount,
      maxCount,
    };
  }

  const targetMcq = Math.ceil(requestedCount / 2);
  const targetLong = Math.floor(requestedCount / 2);
  const pickedMcq = allMcq.slice(0, Math.min(targetMcq, allMcq.length));
  const pickedLong = allLong.slice(0, Math.min(targetLong, allLong.length));

  while (pickedMcq.length + pickedLong.length < requestedCount) {
    if (pickedMcq.length < allMcq.length) {
      pickedMcq.push(allMcq[pickedMcq.length]);
      if (pickedMcq.length + pickedLong.length >= requestedCount) break;
    }

    if (pickedLong.length < allLong.length) {
      pickedLong.push(allLong[pickedLong.length]);
      if (pickedMcq.length + pickedLong.length >= requestedCount) break;
    }

    if (pickedMcq.length >= allMcq.length && pickedLong.length >= allLong.length) break;
  }

  return {
    ...baseQuiz,
    mcq: pickedMcq,
    solveQuestions: pickedLong,
    requestedCount,
    maxCount,
  };
}

export default function QuizView({
  topicId,
  onRequirePhotoProof = true,
  onSubmit,
  onAskAI,
  onExtractAnswerFromPhoto,
  onAnalyzeLongAnswerPhoto,
}) {
  const [chosenTopicId, setChosenTopicId] = useState(topicId || 'polynomials');
  const [quizMode, setQuizMode] = useState('both');
  const [questionCount, setQuestionCount] = useState(6);
  const [randomQuestionCount, setRandomQuestionCount] = useState(false);
  const [quizSeed, setQuizSeed] = useState(0);

  const [started, setStarted] = useState(false);
  const [currentLongIndex, setCurrentLongIndex] = useState(0);

  const [mistakes, setMistakes] = useState([]);
  const [answers, setAnswers] = useState({});
  const [solveAnswers, setSolveAnswers] = useState({});
  const [solveAnalyses, setSolveAnalyses] = useState({});
  const [proofFiles, setProofFiles] = useState({});
  const [extractingMap, setExtractingMap] = useState({});

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

  const baseQuiz = useMemo(() => defaultQuiz(chosenTopicId), [chosenTopicId]);
  const maxQuestionCount = useMemo(() => getMaxQuestionCount(baseQuiz, quizMode), [baseQuiz, quizMode]);

  useEffect(() => {
    setQuestionCount((prev) => clampInt(prev, 1, maxQuestionCount));
  }, [maxQuestionCount]);

  const quiz = useMemo(
    () => buildQuizForConfig(chosenTopicId, quizMode, questionCount, randomQuestionCount),
    [chosenTopicId, quizMode, questionCount, randomQuestionCount, quizSeed]
  );

  const showMcq = (quizMode === 'both' || quizMode === 'mcq') && (quiz.mcq || []).length > 0;
  const showLong = (quizMode === 'both' || quizMode === 'long') && (quiz.solveQuestions || []).length > 0;
  const longQuestions = quiz.solveQuestions || [];
  const currentLongQuestion = longQuestions[currentLongIndex] || null;

  const resetAttempt = () => {
    setStarted(false);
    setCurrentLongIndex(0);
    setAnswers({});
    setSolveAnswers({});
    setSolveAnalyses({});
    setProofFiles({});
    setExtractingMap({});
    setError('');
    setResult(null);
  };

  const startQuiz = () => {
    setCurrentLongIndex(0);
    setQuizSeed((prev) => prev + 1);
    setStarted(true);
    setResult(null);
    setAnswers({});
    setSolveAnswers({});
    setSolveAnalyses({});
    setProofFiles({});
    setExtractingMap({});
    setError('');
  };

  const handlePickProof = async (event, question) => {
    setError('');
    const file = event.target.files?.[0] || null;
    event.target.value = '';

    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setProofFiles((prev) => ({ ...prev, [question.id]: null }));
      setError('Photo proof must be an image file (PNG/JPG/WebP/GIF/BMP).');
      return;
    }

    setProofFiles((prev) => ({ ...prev, [question.id]: file }));
    setExtractingMap((prev) => ({ ...prev, [question.id]: true }));

    try {
      if (onAnalyzeLongAnswerPhoto) {
        const rawAnalysis = await onAnalyzeLongAnswerPhoto(file, question);
        const normalized = normalizeLongPhotoAnalysis(rawAnalysis, question);
        if (normalized) {
          setSolveAnalyses((prev) => ({ ...prev, [question.id]: normalized }));
          if (!isUnclearText(normalized.finalAnswer)) {
            setSolveAnswers((prev) => ({ ...prev, [question.id]: normalized.finalAnswer }));
          }
          return;
        }
      }

      if (onExtractAnswerFromPhoto) {
        const extracted = await onExtractAnswerFromPhoto(file, question.prompt);
        const nextValue = String(extracted || '').trim();
        if (!isUnclearText(nextValue)) {
          setSolveAnswers((prev) => ({ ...prev, [question.id]: nextValue }));
        }
      }
    } catch {
      setError('Could not analyze this photo. Please upload a clearer image.');
    } finally {
      setExtractingMap((prev) => ({ ...prev, [question.id]: false }));
    }
  };

  const handleSubmit = async () => {
    setError('');

    if (showMcq) {
      for (const question of quiz.mcq) {
        if (!answers[question.id]) {
          setError('Please answer all MCQ questions.');
          return;
        }
      }
    }

    if (showLong && onRequirePhotoProof) {
      for (let i = 0; i < longQuestions.length; i += 1) {
        const question = longQuestions[i];
        if (!proofFiles[question.id]) {
          setError(`Please upload photo proof for all long questions. Missing: Question ${i + 1}`);
          return;
        }
      }
    }

    const mcqScore = showMcq
      ? quiz.mcq.reduce((sum, question) => sum + (answers[question.id] === question.answer ? 1 : 0), 0)
      : 0;
    const mcqTotal = showMcq ? quiz.mcq.length : 0;

    let solveScore = 0;
    const solveMax = showLong ? longQuestions.length * 5 : 0;
    const solveDetails = [];

    if (showLong) {
      for (const question of longQuestions) {
        const analysis = solveAnalyses[question.id] || null;
        const hasAnalysis = Boolean(analysis);

        const answer = String((hasAnalysis ? analysis.finalAnswer : solveAnswers[question.id]) || '').trim() || 'UNCLEAR';
        const studentWork = String((hasAnalysis ? analysis.studentWork : '') || '').trim();
        const derivedCorrect = answer !== 'UNCLEAR' && normalizeAnswer(answer) === normalizeAnswer(question.expected);
        const correct = hasAnalysis && typeof analysis.isCorrect === 'boolean' ? analysis.isCorrect : derivedCorrect;
        const score = hasAnalysis && Number.isFinite(Number(analysis.score))
          ? clampMarks(analysis.score, 0, 5)
          : (correct ? 5 : (answer !== 'UNCLEAR' ? 2 : 0));

        const marksLost = Math.max(0, 5 - score);
        const stepBreakdown = normalizeStepBreakdown(
          analysis?.stepBreakdown,
          studentWork || answer,
          marksLost,
          correct
        );

        const whatWentWrong = String(analysis?.whatWentWrong || '').trim()
          || (correct
            ? 'Your method and final answer are consistent with the expected solution.'
            : (answer !== 'UNCLEAR'
              ? 'A transformation error led to a different final answer.'
              : 'The uploaded image was unreadable, so the method could not be verified.'));

        const whereLostMarks = String(analysis?.whereLostMarks || '').trim()
          || (correct
            ? 'No marks were deducted.'
            : (answer !== 'UNCLEAR'
              ? `Marks were deducted around the step that produced "${answer}".`
              : 'Marks were deducted where the key lines could not be read.'));

        solveScore += score;

        solveDetails.push({
          questionId: question.id,
          prompt: question.prompt,
          expected: question.expected,
          answer,
          studentWork,
          correct,
          score,
          marksLost,
          whatWentWrong,
          whereLostMarks,
          stepBreakdown,
          difficulty: question.difficulty,
        });
      }
    }

    const totalScore = mcqScore + solveScore;
    const totalMax = mcqTotal + solveMax;
    const percentage = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

    if (showMcq) {
      for (const question of quiz.mcq) {
        const selected = answers[question.id];
        if (!selected || selected === question.answer) continue;

        const wrongOption = question.options.find((option) => String(option.id) === String(selected));
        const rightOption = question.options.find((option) => String(option.id) === String(question.answer));

        const wrongLabel = String(selected).toUpperCase();
        const rightLabel = String(question.answer).toUpperCase();
        const wrongText = String(wrongOption?.text || '').trim();
        const rightText = String(rightOption?.text || '').trim();

        await saveMistake({
          topicId: chosenTopicId,
          problem: question.prompt,
          description: 'MCQ correction needed',
          type: 'mcq',
          wrongOption: wrongLabel,
          wrongOptionText: wrongText,
          correctOption: rightLabel,
          correctOptionText: rightText,
          whyCorrect: `Option ${rightLabel}${rightText ? ` (${rightText})` : ''} is correct for the question condition.`,
          howToFind: 'Read the condition, eliminate incompatible options, then verify the final choice.',
        });
      }
    }

    if (showLong) {
      for (const detail of solveDetails) {
        if (detail.correct) continue;
        await saveMistake({
          topicId: chosenTopicId,
          problem: detail.prompt,
          description: `Long-answer mistake (${detail.difficulty}): lost ${detail.marksLost}/5 marks. ${detail.whereLostMarks}`,
          type: 'solve',
          difficulty: detail.difficulty,
          whatWentWrong: detail.whatWentWrong,
          whereLostMarks: detail.whereLostMarks,
          studentAnswer: detail.answer,
          studentWork: detail.studentWork,
          expectedAnswer: detail.expected,
        });
      }
    }

    const payload = {
      topicId: chosenTopicId,
      quizMode,
      questionCount: quiz.requestedCount || questionCount,
      randomQuestionCount,
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
      detectedAnswer: detail.answer,
      studentWork: detail.studentWork,
      whatWentWrong: detail.whatWentWrong,
      whereLostMarks: detail.whereLostMarks,
      marksLost: detail.marksLost,
      stepBreakdown: detail.stepBreakdown,
    });
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
              {TOPICS.map((topic) => (
                <option key={topic.id} value={topic.id}>{String(topic.label || topic.id).toUpperCase()}</option>
              ))}
            </select>

            <select className="quiz-input" value={quizMode} onChange={(e) => setQuizMode(e.target.value)}>
              {QUIZ_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              max={maxQuestionCount}
              className="quiz-input quiz-count-input"
              value={questionCount}
              onChange={(e) => setQuestionCount(clampInt(e.target.value, 1, maxQuestionCount))}
              disabled={randomQuestionCount}
              title="Number of questions"
            />

            <button className="panel-btn primary" onClick={startQuiz}>Start quiz</button>
          </div>

          <div className="quiz-config-row">
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={randomQuestionCount}
                onChange={(e) => setRandomQuestionCount(Boolean(e.target.checked))}
              />
              Use random number of questions
            </label>
            <span className="quiz-count-hint">
              {randomQuestionCount
                ? `Random count from 1 to ${maxQuestionCount}`
                : `Questions: ${questionCount} (max ${maxQuestionCount})`}
            </span>
          </div>

          <div className="quiz-subtitle" style={{ marginTop: 10 }}>Recent mistakes for this topic:</div>
          {mistakes.length === 0 ? (
            <div className="chat-sessions-empty">No recent mistakes for this topic.</div>
          ) : (
            <div className="topic-map-mini">
              {mistakes.map((mistake) => (
                <div key={mistake.id} className="topic-map-edge">
                  <span className="edge-from">{(mistake.description || '').slice(0, 60) || 'Mistake'}</span>
                  <span className="edge-arrow">-</span>
                  <span className="edge-to">{(mistake.problem || '').slice(0, 60) || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : result ? (
        <div className="quiz-result-complete">
          <h3>Quiz Completed</h3>

          <div className="result-scores">
            {showMcq && (
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
              {result.solveDetails.map((detail, index) => (
                <div key={detail.questionId} className={`solve-detail-item ${detail.correct ? 'correct' : 'incorrect'}`}>
                  <div className="detail-header">
                    <span className="detail-num">Q{index + 1}</span>
                    <span className={`status-badge ${detail.correct ? 'correct' : 'incorrect'}`}>
                      {detail.correct ? 'Correct' : 'Incorrect'}
                    </span>
                    <span className="difficulty-badge">{detail.difficulty}</span>
                  </div>

                  <div className="detail-question" dangerouslySetInnerHTML={{ __html: `<strong>Question:</strong> ${renderMathInText(detail.prompt)}` }} />
                  <div className="detail-answer"><strong>Detected answer from photo:</strong> {detail.answer || 'UNCLEAR'}</div>

                  {detail.studentWork && (
                    <div className="detail-student-work">
                      <strong>Full OCR transcript of your uploaded work:</strong>
                      <div className="detail-student-work-body" dangerouslySetInnerHTML={{ __html: renderMathInText(detail.studentWork) }} />
                    </div>
                  )}

                  {Array.isArray(detail.stepBreakdown) && detail.stepBreakdown.length > 0 && (
                    <div className="step-breakdown">
                      <strong className="step-breakdown-title">Step-by-step OCR and mark deductions</strong>
                      <ol className="step-breakdown-list">
                        {detail.stepBreakdown.map((step, stepIndex) => (
                          <li key={`${detail.questionId}-step-${stepIndex}`} className={`step-breakdown-item ${step.status || 'partial'}`}>
                            <div className="step-breakdown-line" dangerouslySetInnerHTML={{ __html: renderMathInText(String(step.studentLine || '')) }} />
                            <div className="step-breakdown-meta">
                              <span className={`step-status-chip ${step.status || 'partial'}`}>{String(step.status || 'partial').toUpperCase()}</span>
                              {Number.isFinite(Number(step.marksLost)) && Number(step.marksLost) > 0 && (
                                <span className="step-loss-chip">Lost {step.marksLost}/5 at this step</span>
                              )}
                            </div>
                            {step.note && <div className="step-breakdown-note">{step.note}</div>}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div className="detail-feedback">
                    <div className="detail-feedback-line"><strong>What went wrong:</strong> {detail.whatWentWrong}</div>
                    <div className="detail-feedback-line"><strong>Where marks were lost:</strong> {detail.whereLostMarks}</div>
                    <div className="detail-feedback-line"><strong>Marks lost:</strong> {detail.marksLost}/5</div>
                  </div>

                  {!detail.correct && (
                    <>
                      <div className="detail-expected"><strong>Expected:</strong> {detail.expected}</div>
                      <button className="panel-btn small" onClick={() => handleAskAI(detail)}>Ask AI how to solve</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="quiz-actions">
            <button className="panel-btn primary" onClick={resetAttempt}>Start New Quiz</button>
            <button className="panel-btn" onClick={() => onAskAI?.({ type: 'quiz_doubt', topic: chosenTopicId })}>Ask AI Doubts</button>
          </div>
        </div>
      ) : (
        <>
          {showMcq && (
            <div className="quiz-section">
              <h4>MCQ ({quiz.mcq.length} questions)</h4>
              <div className="quiz-questions">
                {quiz.mcq.map((question, index) => (
                  <div key={question.id} className="quiz-q">
                    <div className="quiz-q-title" dangerouslySetInnerHTML={{ __html: `${index + 1}. ${renderMathInText(question.prompt)}` }} />
                    <div className="quiz-options">
                      {question.options.map((option) => (
                        <label key={option.id} className={`quiz-option ${answers[question.id] === option.id ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name={question.id}
                            value={option.id}
                            checked={answers[question.id] === option.id}
                            onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: option.id }))}
                          />
                          <span className="quiz-option-text" dangerouslySetInnerHTML={{ __html: renderMathInText(option.text) }} />
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
                <h4>Long Questions ({currentLongIndex + 1}/{longQuestions.length})</h4>
                <span className="difficulty-badge">{currentLongQuestion?.difficulty?.toUpperCase() || ''}</span>
              </div>

              {currentLongQuestion && (
                <div className="solve-question-container">
                  <div className="quiz-q">
                    <div className="quiz-q-title" dangerouslySetInnerHTML={{ __html: renderMathInText(currentLongQuestion.prompt) }} />
                    <div className="quiz-proof-note">Long-answer is photo-only. Upload your handwritten steps; typed answers are disabled.</div>
                  </div>

                  <div className="quiz-proof-section">
                    <label className="proof-label">Photo proof for this question</label>
                    <input type="file" accept="image/*" onChange={(event) => handlePickProof(event, currentLongQuestion)} />

                    {extractingMap[currentLongQuestion.id] && (
                      <div className="quiz-proof-file">Reading answer from photo...</div>
                    )}

                    {proofFiles[currentLongQuestion.id] && (
                      <div className="quiz-proof-file">Selected: {proofFiles[currentLongQuestion.id].name}</div>
                    )}

                    {solveAnalyses[currentLongQuestion.id] && (
                      <div className={`quiz-photo-analysis ${solveAnalyses[currentLongQuestion.id].isCorrect ? 'correct' : 'incorrect'}`}>
                        <div className="quiz-proof-file"><strong>Detected final answer:</strong> {solveAnalyses[currentLongQuestion.id].finalAnswer || 'UNCLEAR'}</div>

                        {solveAnalyses[currentLongQuestion.id].studentWork && (
                          <div
                            className="quiz-proof-file"
                            dangerouslySetInnerHTML={{ __html: `<strong>Full OCR transcript:</strong><br />${renderMathInText(solveAnalyses[currentLongQuestion.id].studentWork)}` }}
                          />
                        )}

                        {Array.isArray(solveAnalyses[currentLongQuestion.id].stepBreakdown) && solveAnalyses[currentLongQuestion.id].stepBreakdown.length > 0 && (
                          <div className="step-breakdown step-breakdown-inline">
                            <strong className="step-breakdown-title">Step-by-step OCR and mark deductions</strong>
                            <ol className="step-breakdown-list">
                              {solveAnalyses[currentLongQuestion.id].stepBreakdown.map((step, stepIndex) => (
                                <li key={`${currentLongQuestion.id}-step-${stepIndex}`} className={`step-breakdown-item ${step.status || 'partial'}`}>
                                  <div className="step-breakdown-line" dangerouslySetInnerHTML={{ __html: renderMathInText(String(step.studentLine || '')) }} />
                                  <div className="step-breakdown-meta">
                                    <span className={`step-status-chip ${step.status || 'partial'}`}>{String(step.status || 'partial').toUpperCase()}</span>
                                    {Number.isFinite(Number(step.marksLost)) && Number(step.marksLost) > 0 && (
                                      <span className="step-loss-chip">Lost {step.marksLost}/5 at this step</span>
                                    )}
                                  </div>
                                  {step.note && <div className="step-breakdown-note">{step.note}</div>}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        <div className="quiz-proof-file"><strong>Estimated score:</strong> {solveAnalyses[currentLongQuestion.id].score}/5</div>
                        <div className="quiz-proof-file"><strong>What went wrong:</strong> {solveAnalyses[currentLongQuestion.id].whatWentWrong}</div>
                        <div className="quiz-proof-file"><strong>Where marks were lost:</strong> {solveAnalyses[currentLongQuestion.id].whereLostMarks}</div>

                        {solveAnalyses[currentLongQuestion.id]?._debug && (
                          <div className="ocr-debug-panel">
                            <div className="ocr-debug-head">OCR debug</div>
                            <div className="ocr-debug-meta">
                              Source: {String(solveAnalyses[currentLongQuestion.id]._debug.source || 'unknown')} | OCR pass: {String(solveAnalyses[currentLongQuestion.id]._debug.ocrSource || 'unknown')}
                            </div>
                            {Array.isArray(solveAnalyses[currentLongQuestion.id]._debug.ocrAttempts) && solveAnalyses[currentLongQuestion.id]._debug.ocrAttempts.length > 0 && (
                              <div className="ocr-debug-meta">
                                Attempts: {solveAnalyses[currentLongQuestion.id]._debug.ocrAttempts.map((attempt) => `${String(attempt?.label || 'attempt')}:${attempt?.lowConfidence ? 'low' : 'ok'}`).join(' | ')}
                              </div>
                            )}
                            {String(solveAnalyses[currentLongQuestion.id]._debug.extractedText || '').trim() && (
                              <div className="ocr-debug-grid">
                                <div className="ocr-debug-col">
                                  <strong>Extracted transcript</strong>
                                  <pre>{String(solveAnalyses[currentLongQuestion.id]._debug.extractedText || '')}</pre>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="quiz-proof-summary">
                {longQuestions.map((question, index) => (
                  <span key={question.id} className={`pill ${proofFiles[question.id] ? 'pill-ok' : ''}`}>
                    Q{index + 1}: {proofFiles[question.id] ? 'proof uploaded' : 'missing'}
                  </span>
                ))}
              </div>

              <div className="solve-nav">
                <button
                  className="panel-btn"
                  onClick={() => setCurrentLongIndex((value) => Math.max(0, value - 1))}
                  disabled={currentLongIndex === 0}
                >
                  Previous
                </button>

                <span className="nav-indicator">Question {currentLongIndex + 1} of {longQuestions.length}</span>

                <button
                  className="panel-btn"
                  onClick={() => setCurrentLongIndex((value) => Math.min(longQuestions.length - 1, value + 1))}
                  disabled={currentLongIndex === longQuestions.length - 1}
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