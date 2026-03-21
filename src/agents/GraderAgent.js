/**
 * @module GraderAgent
 * @description Dynamic partial-credit grading engine.
 *
 * Reason-Act-Observe:
 *   REASON  → Parse student steps and solution-key steps
 *   ACT     → Compare each step, award marks based on process
 *   OBSERVE → Return detailed step-by-step results with partial credit
 *
 * Scoring Rules:
 *   - Each step is worth equal share of total marks
 *   - Correct step with correct reasoning: FULL marks
 *   - Correct approach but arithmetic error: 70% marks
 *   - Partial understanding (right formula, wrong application): 40% marks
 *   - Completely incorrect or missing: 0% marks
 *   - Carry-forward: if an error propagates from a previous step,
 *     subsequent steps using that error correctly still earn partial credit
 */

/**
 * @typedef {Object} Step
 * @property {number} stepNumber
 * @property {string} description   - What this step does
 * @property {string} expression    - The math expression / equation
 * @property {string} [reasoning]   - Why this step was taken
 */

/**
 * @typedef {Object} StepResult
 * @property {number}  stepNumber
 * @property {number}  marksAwarded
 * @property {number}  maxMarks
 * @property {'correct'|'arithmetic_error'|'partial'|'incorrect'|'carry_forward'} status
 * @property {string}  feedback
 */

/**
 * @typedef {Object} GradingResult
 * @property {number}      score
 * @property {number}      maxScore
 * @property {number}      percentage
 * @property {StepResult[]} stepResults
 * @property {string}      feedback
 * @property {string}      grade
 * @property {string[]}    mistakeTypes
 */

/**
 * Grade student work by comparing steps to a solution key.
 * Uses AI for semantic comparison when available, falls back to heuristic matching.
 *
 * @param {Object} params
 * @param {Step[]} params.studentSteps
 * @param {Step[]} params.solutionSteps
 * @param {number} [params.totalMarks=10]
 * @param {Function} [params.aiCompare] - Optional AI function for semantic comparison
 * @returns {Promise<GradingResult>}
 */
export async function gradeWork({ studentSteps, solutionSteps, totalMarks = 10, aiCompare }) {
  const marksPerStep = totalMarks / solutionSteps.length;
  const stepResults = [];
  const mistakeTypes = new Set();
  let totalAwarded = 0;
  let hasCarryForward = false;

  for (let i = 0; i < solutionSteps.length; i++) {
    const expected = solutionSteps[i];
    const student = studentSteps[i] || null;

    if (!student) {
      // Missing step
      stepResults.push({
        stepNumber: i + 1,
        marksAwarded: 0,
        maxMarks: marksPerStep,
        status: 'incorrect',
        feedback: `Step ${i + 1} is missing. Expected: ${expected.description}`,
      });
      mistakeTypes.add('missing_step');
      continue;
    }

    let result;

    if (aiCompare) {
      // Use AI for semantic comparison
      result = await aiCompareSteps(student, expected, marksPerStep, aiCompare, hasCarryForward);
    } else {
      // Heuristic comparison
      result = heuristicCompare(student, expected, marksPerStep, hasCarryForward);
    }

    if (result.status !== 'correct') {
      hasCarryForward = true;
      if (result.status === 'arithmetic_error') mistakeTypes.add('calculation_error');
      if (result.status === 'partial') mistakeTypes.add('concept_error');
      if (result.status === 'incorrect') mistakeTypes.add('logic_error');
    }

    totalAwarded += result.marksAwarded;
    stepResults.push(result);
  }

  // Extra steps by student (potential extra credit or errors)
  for (let i = solutionSteps.length; i < studentSteps.length; i++) {
    stepResults.push({
      stepNumber: i + 1,
      marksAwarded: 0,
      maxMarks: 0,
      status: 'incorrect',
      feedback: `Extra step — not in the expected solution. This may indicate an unnecessary detour.`,
    });
  }

  const percentage = Math.round((totalAwarded / totalMarks) * 100);

  return {
    score: Math.round(totalAwarded * 10) / 10,
    maxScore: totalMarks,
    percentage,
    stepResults,
    feedback: generateOverallFeedback(percentage, mistakeTypes),
    grade: calculateGrade(percentage),
    mistakeTypes: [...mistakeTypes],
  };
}

/**
 * Heuristic step comparison (no AI required).
 * Compares expressions after normalizing whitespace and basic math equivalences.
 */
function heuristicCompare(student, expected, marksPerStep, isCarryForward) {
  const normStudent = normalize(student.expression);
  const normExpected = normalize(expected.expression);

  // Exact match
  if (normStudent === normExpected) {
    return {
      stepNumber: student.stepNumber,
      marksAwarded: marksPerStep,
      maxMarks: marksPerStep,
      status: 'correct',
      feedback: `✅ Step ${student.stepNumber}: Correct!`,
    };
  }

  // Check carry-forward correctness
  if (isCarryForward && descriptionSimilarity(student.description, expected.description) > 0.6) {
    return {
      stepNumber: student.stepNumber,
      marksAwarded: marksPerStep * 0.7,
      maxMarks: marksPerStep,
      status: 'carry_forward',
      feedback: `🔄 Step ${student.stepNumber}: Correct method applied to carried-forward value. Partial credit awarded.`,
    };
  }

  // Check if descriptions match (right approach, wrong answer = arithmetic error)
  const descSim = descriptionSimilarity(student.description, expected.description);
  if (descSim > 0.5) {
    return {
      stepNumber: student.stepNumber,
      marksAwarded: marksPerStep * 0.7,
      maxMarks: marksPerStep,
      status: 'arithmetic_error',
      feedback: `⚠️ Step ${student.stepNumber}: Right approach, but check your arithmetic. Expected: ${expected.expression}`,
    };
  }

  // Check for partial understanding
  if (descSim > 0.3 || hasPartialOverlap(normStudent, normExpected)) {
    return {
      stepNumber: student.stepNumber,
      marksAwarded: marksPerStep * 0.4,
      maxMarks: marksPerStep,
      status: 'partial',
      feedback: `🟡 Step ${student.stepNumber}: You're on the right track but the approach needs adjustment.`,
    };
  }

  // Completely wrong
  return {
    stepNumber: student.stepNumber,
    marksAwarded: 0,
    maxMarks: marksPerStep,
    status: 'incorrect',
    feedback: `❌ Step ${student.stepNumber}: This doesn't match. Expected: ${expected.description}`,
  };
}

/** AI-powered semantic comparison */
async function aiCompareSteps(student, expected, marksPerStep, aiCompare, isCarryForward) {
  try {
    const prompt = `Compare the student's math step to the expected step.
Student: "${student.expression}" (${student.description || ''})
Expected: "${expected.expression}" (${expected.description || ''})
Is carry-forward from previous error: ${isCarryForward}

Rate as one of: CORRECT, ARITHMETIC_ERROR (right method wrong calc), PARTIAL (some understanding), INCORRECT
Respond with JSON: { "status": "...", "pctCredit": 0.0-1.0, "feedback": "..." }`;

    const result = JSON.parse(await aiCompare(prompt));
    const statusMap = {
      CORRECT: 'correct',
      ARITHMETIC_ERROR: 'arithmetic_error',
      PARTIAL: 'partial',
      INCORRECT: 'incorrect',
    };

    return {
      stepNumber: student.stepNumber,
      marksAwarded: marksPerStep * (result.pctCredit || 0),
      maxMarks: marksPerStep,
      status: statusMap[result.status] || 'incorrect',
      feedback: result.feedback || '',
    };
  } catch {
    // Fallback to heuristic if AI fails
    return heuristicCompare(student, expected, marksPerStep, isCarryForward);
  }
}

/* ────────────────── Utilities ────────────────────────────── */

function normalize(expr) {
  if (!expr) return '';
  return expr
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .toLowerCase();
}

function descriptionSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  return intersection.length / Math.max(wordsA.size, wordsB.size);
}

function hasPartialOverlap(a, b) {
  if (!a || !b) return false;
  const tokensA = a.match(/[a-z0-9]+/gi) || [];
  const tokensB = b.match(/[a-z0-9]+/gi) || [];
  const overlap = tokensA.filter((t) => tokensB.includes(t));
  return overlap.length >= Math.min(2, tokensA.length);
}

function generateOverallFeedback(percentage, mistakeTypes) {
  if (percentage >= 90) return '🌟 Outstanding work! Near perfect execution.';
  if (percentage >= 70) return '👍 Great job! A few areas to polish — review the flagged steps.';
  if (percentage >= 50) return '📝 Good effort! You understand the concepts but need more practice with execution.';
  if (percentage >= 30) return '💪 Keep going! Review the basics for this topic and try again.';
  return '📖 Let\'s go back to the fundamentals. Would you like me to walk through this step-by-step?';
}

function calculateGrade(percentage) {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B';
  if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'D';
  return 'F';
}

/**
 * Quick-grade a simple answer (for MCQs or single-answer problems).
 * @param {string} studentAnswer
 * @param {string} correctAnswer
 * @param {number} [marks=1]
 * @returns {GradingResult}
 */
export function gradeSimple(studentAnswer, correctAnswer, marks = 1) {
  const isCorrect = normalize(studentAnswer) === normalize(correctAnswer);
  return {
    score: isCorrect ? marks : 0,
    maxScore: marks,
    percentage: isCorrect ? 100 : 0,
    stepResults: [
      {
        stepNumber: 1,
        marksAwarded: isCorrect ? marks : 0,
        maxMarks: marks,
        status: isCorrect ? 'correct' : 'incorrect',
        feedback: isCorrect ? '✅ Correct!' : `❌ Expected: ${correctAnswer}`,
      },
    ],
    feedback: isCorrect ? '🎉 Perfect!' : '📝 Not quite — review your work.',
    grade: isCorrect ? 'A+' : 'F',
    mistakeTypes: isCorrect ? [] : ['wrong_answer'],
  };
}

export default { gradeWork, gradeSimple };
