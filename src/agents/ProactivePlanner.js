/**
 * @module ProactivePlanner
 * @description On startup, reads localVault and suggests a personalized Learning Path.
 *
 * Reason-Act-Observe:
 *   REASON  → Load mistakes, exam history, prerequisite progress from IndexedDB
 *   ACT     → Analyze weak areas, build a priority queue, generate session plan
 *   OBSERVE → Return structured plan with recommendations
 */

import { getMistakes, getExamHistory, getPrerequisiteProgress, getProfile } from '../store/localVault.js';
import { getAnnotatedTopics, buildProgressMap, getPrerequisiteChain, TOPICS } from './KnowledgeGraph.js';

/**
 * @typedef {Object} SessionPlan
 * @property {string}   studentName
 * @property {string}   greeting
 * @property {Object[]} weakTopics     - Sorted by weakness severity
 * @property {Object[]} nextLessons    - Unlocked, unmastered topics in order
 * @property {Object[]} prerequisitePath - For the next target topic
 * @property {Object}   stats
 */

/**
 * Generate a personalized session plan by analyzing all stored data.
 * @returns {Promise<SessionPlan>}
 */
export async function generateSessionPlan() {
  const [profile, mistakes, examHistory, progress] = await Promise.all([
    getProfile(),
    getMistakes(),
    getExamHistory(),
    getPrerequisiteProgress(),
  ]);

  const progressMap = buildProgressMap(progress);
  const annotatedTopics = getAnnotatedTopics(progressMap);

  // ── 1. Identify Weak Topics (from mistakes + low scores) ──
  const topicScores = {};
  for (const exam of examHistory) {
    if (!topicScores[exam.topicId]) {
      topicScores[exam.topicId] = { total: 0, max: 0, attempts: 0 };
    }
    topicScores[exam.topicId].total += exam.score;
    topicScores[exam.topicId].max += exam.maxScore;
    topicScores[exam.topicId].attempts += 1;
  }

  // Count mistakes per topic
  const mistakeCounts = {};
  for (const m of mistakes) {
    mistakeCounts[m.topicId] = (mistakeCounts[m.topicId] || 0) + 1;
  }

  // Build weakness ranking
  const weakTopics = Object.entries(topicScores)
    .map(([topicId, data]) => {
      const accuracy = data.max > 0 ? data.total / data.max : 0;
      const mistakeCount = mistakeCounts[topicId] || 0;
      const topic = TOPICS.find((t) => t.id === topicId);
      return {
        topicId,
        label: topic?.label || topicId,
        accuracy: Math.round(accuracy * 100),
        mistakeCount,
        attempts: data.attempts,
        // Lower score = weaker (more urgent)
        weaknessScore: (1 - accuracy) * 100 + mistakeCount * 10,
      };
    })
    .filter((t) => t.accuracy < 80) // Only flag topics below 80%
    .sort((a, b) => b.weaknessScore - a.weaknessScore);

  // ── 2. Determine Next Lessons ──
  const nextLessons = annotatedTopics
    .filter((t) => t.unlocked && t.status !== 'mastered')
    .sort((a, b) => a.tier - b.tier)
    .slice(0, 5)
    .map((t) => ({
      topicId: t.id,
      label: t.label,
      category: t.category,
      tier: t.tier,
      status: t.status,
    }));

  // ── 3. Get Prerequisite Path for next target ──
  const nextTarget = annotatedTopics.find((t) => !t.unlocked);
  let prerequisitePath = [];
  if (nextTarget) {
    const chain = getPrerequisiteChain(nextTarget.id);
    prerequisitePath = chain
      .filter((id) => progressMap.get(id) !== 'mastered')
      .map((id) => {
        const topic = TOPICS.find((t) => t.id === id);
        return { topicId: id, label: topic?.label || id, status: progressMap.get(id) || 'locked' };
      });
  }

  // ── 4. Compile Stats ──
  const stats = {
    totalProblemsSolved: examHistory.length,
    totalMistakes: mistakes.length,
    uncorrectedMistakes: mistakes.filter((m) => !m.corrected).length,
    topicsMastered: annotatedTopics.filter((t) => t.status === 'mastered').length,
    topicsTotal: TOPICS.length,
    overallAccuracy: examHistory.length > 0
      ? Math.round(
          (examHistory.reduce((s, e) => s + e.score, 0) /
            examHistory.reduce((s, e) => s + e.maxScore, 0)) * 100
        )
      : 0,
  };

  // ── 5. Generate Greeting ──
  const studentName = profile?.name || 'Student';
  let greeting;

  if (examHistory.length === 0) {
    greeting = `Welcome, ${studentName}! 🎉 This is your first session. Let's find the perfect starting point for you. I recommend we begin with the fundamentals and build up from there.`;
  } else if (weakTopics.length > 0) {
    greeting = `Welcome back, ${studentName}! 🧠 I've analyzed your progress. You've solved ${stats.totalProblemsSolved} problems so far. I noticed you could use some extra practice in **${weakTopics[0].label}** (${weakTopics[0].accuracy}% accuracy). Should I plan your session based on your weakest topics, or would you prefer to start the next new lesson?`;
  } else {
    greeting = `Welcome back, ${studentName}! 🌟 You're doing great — ${stats.topicsMastered}/${stats.topicsTotal} topics mastered. Ready for the next challenge?`;
  }

  return {
    studentName,
    greeting,
    weakTopics,
    nextLessons,
    prerequisitePath,
    stats,
    nextTarget: nextTarget
      ? { topicId: nextTarget.id, label: nextTarget.label }
      : null,
  };
}

/**
 * Generate a concise AI prompt for the planner chat message.
 * @param {SessionPlan} plan
 * @returns {string}
 */
export function planToMessage(plan) {
  let msg = plan.greeting + '\n\n';

  if (plan.weakTopics.length > 0) {
    msg += '### 📊 Areas to Improve\n';
    for (const t of plan.weakTopics.slice(0, 3)) {
      msg += `- **${t.label}**: ${t.accuracy}% accuracy (${t.mistakeCount} mistakes)\n`;
    }
    msg += '\n';
  }

  if (plan.nextLessons.length > 0) {
    msg += '### 📚 Recommended Next Lessons\n';
    for (const t of plan.nextLessons.slice(0, 3)) {
      msg += `- **${t.label}** _(${t.category})_\n`;
    }
    msg += '\n';
  }

  if (plan.prerequisitePath.length > 0 && plan.nextTarget) {
    msg += `### 🔗 Path to Unlock "${plan.nextTarget.label}"\n`;
    msg += plan.prerequisitePath.map((t) => `${t.label}`).join(' → ') + ` → **${plan.nextTarget.label}**\n\n`;
  }

  msg += `_What would you like to focus on?_`;
  return msg;
}

export default { generateSessionPlan, planToMessage };
