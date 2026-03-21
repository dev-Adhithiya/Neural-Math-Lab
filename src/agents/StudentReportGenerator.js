/**
 * @module StudentReportGenerator
 * @description Compiles a comprehensive student report:
 *   - Total Problems Solved
 *   - Level / XP
 *   - Mastery Heatmap (based on Prerequisite Map)
 *   - Forensic Summary (accuracy patterns, error types)
 *
 * Output as clean JSON ready for PDF print CSS.
 *
 * Reason-Act-Observe:
 *   REASON  → Pull all data from localVault
 *   ACT     → Aggregate, analyze patterns, classify error types
 *   OBSERVE → Return structured report JSON
 */

import { getProfile, getMistakes, getExamHistory, getPrerequisiteProgress } from '../store/localVault.js';
import { TOPICS, buildProgressMap } from './KnowledgeGraph.js';
import { calculateLevel } from '../engine/GamificationEngine.js';

/**
 * @typedef {Object} StudentReport
 * @property {Object} student
 * @property {Object} stats
 * @property {Object[]} masteryHeatmap
 * @property {Object} forensicSummary
 * @property {string} generatedAt
 */

/**
 * Generate a full student report.
 * @returns {Promise<StudentReport>}
 */
export async function generateReport() {
  const [profile, mistakes, exams, progress] = await Promise.all([
    getProfile(),
    getMistakes(),
    getExamHistory(),
    getPrerequisiteProgress(),
  ]);

  const progressMap = buildProgressMap(progress);
  const levelInfo = calculateLevel(profile?.totalXP || 0);

  // ── 1. Overall Stats ──
  const totalProblemsSolved = exams.length;
  const totalScore = exams.reduce((s, e) => s + e.score, 0);
  const totalMaxScore = exams.reduce((s, e) => s + e.maxScore, 0);
  const overallAccuracy = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;
  const correctedMistakes = mistakes.filter((m) => m.corrected).length;

  // ── 2. Mastery Heatmap ──
  const topicPerformance = {};
  for (const exam of exams) {
    if (!topicPerformance[exam.topicId]) {
      topicPerformance[exam.topicId] = { score: 0, max: 0, attempts: 0 };
    }
    topicPerformance[exam.topicId].score += exam.score;
    topicPerformance[exam.topicId].max += exam.maxScore;
    topicPerformance[exam.topicId].attempts += 1;
  }

  const masteryHeatmap = TOPICS.map((topic) => {
    const perf = topicPerformance[topic.id];
    const status = progressMap.get(topic.id) || 'locked';
    const accuracy = perf && perf.max > 0 ? Math.round((perf.score / perf.max) * 100) : null;

    let masteryLevel;
    if (status === 'mastered') masteryLevel = 'mastered';
    else if (accuracy === null) masteryLevel = status === 'locked' ? 'locked' : 'not_attempted';
    else if (accuracy >= 90) masteryLevel = 'proficient';
    else if (accuracy >= 70) masteryLevel = 'developing';
    else if (accuracy >= 50) masteryLevel = 'emerging';
    else masteryLevel = 'needs_work';

    return {
      topicId: topic.id,
      label: topic.label,
      category: topic.category,
      tier: topic.tier,
      status,
      accuracy,
      attempts: perf?.attempts || 0,
      masteryLevel,
    };
  });

  // ── 3. Forensic Summary (error pattern analysis) ──
  const errorCategories = {
    calculation_error: { count: 0, examples: [] },
    concept_error: { count: 0, examples: [] },
    logic_error: { count: 0, examples: [] },
    missing_step: { count: 0, examples: [] },
    wrong_answer: { count: 0, examples: [] },
  };

  for (const exam of exams) {
    if (exam.stepResults) {
      for (const step of exam.stepResults) {
        if (step.status === 'arithmetic_error') {
          errorCategories.calculation_error.count++;
          errorCategories.calculation_error.examples.push(step.feedback);
        } else if (step.status === 'partial') {
          errorCategories.concept_error.count++;
          errorCategories.concept_error.examples.push(step.feedback);
        } else if (step.status === 'incorrect') {
          errorCategories.logic_error.count++;
          errorCategories.logic_error.examples.push(step.feedback);
        }
      }
    }
  }

  // Calculate error pattern percentages
  const totalErrors = Object.values(errorCategories).reduce((s, c) => s + c.count, 0);
  const errorBreakdown = {};
  for (const [type, data] of Object.entries(errorCategories)) {
    if (data.count > 0) {
      errorBreakdown[type] = {
        count: data.count,
        percentage: totalErrors > 0 ? Math.round((data.count / totalErrors) * 100) : 0,
        recentExamples: data.examples.slice(-3),
      };
    }
  }

  // Generate forensic narrative
  const forensicNarrative = generateForensicNarrative(errorBreakdown, overallAccuracy);

  // ── 4. Compile Report ──
  return {
    student: {
      name: profile?.name || 'Student',
      level: levelInfo.level,
      title: levelInfo.title,
      totalXP: levelInfo.totalXP,
      xpProgress: Math.round(levelInfo.progress * 100),
      joinedAt: profile?.joinedAt || new Date().toISOString(),
    },
    stats: {
      totalProblemsSolved,
      overallAccuracy,
      totalScore,
      totalMaxScore,
      totalMistakes: mistakes.length,
      correctedMistakes,
      topicsMastered: masteryHeatmap.filter((t) => t.masteryLevel === 'mastered').length,
      topicsAttempted: masteryHeatmap.filter((t) => t.accuracy !== null).length,
      topicsTotal: TOPICS.length,
      streakDays: calculateStreak(exams),
    },
    masteryHeatmap,
    forensicSummary: {
      errorBreakdown,
      narrative: forensicNarrative,
      strongestArea: findStrongestArea(masteryHeatmap),
      weakestArea: findWeakestArea(masteryHeatmap),
    },
    generatedAt: new Date().toISOString(),
  };
}

/* ────────────────── Helper Functions ─────────────────────── */

function generateForensicNarrative(errorBreakdown, overallAccuracy) {
  const parts = [];

  parts.push(`Overall accuracy: ${overallAccuracy}%.`);

  if (errorBreakdown.logic_error) {
    parts.push(
      `You are ${100 - errorBreakdown.logic_error.percentage}% accurate in logic, ` +
      `but ${errorBreakdown.logic_error.percentage}% of your errors are logic-related.`
    );
  }

  if (errorBreakdown.calculation_error) {
    parts.push(
      `${errorBreakdown.calculation_error.percentage}% of errors are calculation mistakes — ` +
      `double-check your arithmetic!`
    );
  }

  if (errorBreakdown.concept_error) {
    parts.push(
      `${errorBreakdown.concept_error.percentage}% of errors suggest partial understanding — ` +
      `reviewing foundational concepts would help.`
    );
  }

  if (Object.keys(errorBreakdown).length === 0) {
    parts.push(`No significant error patterns detected. Keep up the great work!`);
  }

  return parts.join(' ');
}

function findStrongestArea(heatmap) {
  const attempted = heatmap.filter((t) => t.accuracy !== null);
  if (attempted.length === 0) return null;
  const best = attempted.reduce((a, b) => ((a.accuracy || 0) > (b.accuracy || 0) ? a : b));
  return { topicId: best.topicId, label: best.label, accuracy: best.accuracy };
}

function findWeakestArea(heatmap) {
  const attempted = heatmap.filter((t) => t.accuracy !== null);
  if (attempted.length === 0) return null;
  const worst = attempted.reduce((a, b) => ((a.accuracy || 0) < (b.accuracy || 0) ? a : b));
  return { topicId: worst.topicId, label: worst.label, accuracy: worst.accuracy };
}

function calculateStreak(exams) {
  if (exams.length === 0) return 0;
  const dates = [...new Set(exams.map((e) => e.date?.split('T')[0]))].sort().reverse();
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (prev - curr) / (1000 * 60 * 60 * 24);
    if (diff <= 1) streak++;
    else break;
  }
  return streak;
}

export default { generateReport };
