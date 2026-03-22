/**
 * @module GamificationEngine
 * @description XP system with levels and achievement tracking.
 *
 * XP Awards:
 *   100 XP  — Full MCQ (correct answer)
 *   250 XP  — Step-by-Step with 0 errors
 *   150 XP  — Step-by-Step with some errors (scaled by accuracy)
 *    50 XP  — Recovery Bonus (fixing a previous mistake)
 *    25 XP  — Attempting a problem (participation)
 *
 * Level Formula:
 *   Level = floor(sqrt(totalXP / 100)) + 1
 *   So: Level 2 = 100 XP, Level 3 = 400 XP, Level 5 = 1600 XP, Level 10 = 8100 XP
 */

import { getProfile, updateProfile } from '../store/localVault.js';

/* ────────────────────── XP Constants ─────────────────────── */

export const XP_REWARDS = {
  MCQ_CORRECT: 100,
  STEP_PERFECT: 250,
  STEP_BASE: 50,
  RECOVERY_BONUS: 50,
  PARTICIPATION: 25,
};

/* ────────────────────── Level Thresholds ─────────────────── */

export const LEVEL_TITLES = {
  1: 'Beginner',
  2: 'Apprentice',
  3: 'Learner',
  4: 'Scholar',
  5: 'Mathematician',
  6: 'Problem Solver',
  7: 'Analyst',
  8: 'Expert',
  9: 'Master',
  10: 'Grandmaster',
};

/**
 * Calculate user level from total XP.
 * @param {number} totalXP
 * @returns {{ level: number, title: string, currentXP: number, xpForNext: number, progress: number }}
 */
export function calculateLevel(totalXP) {
  const level = Math.floor(Math.sqrt(totalXP / 100)) + 1;
  const xpForCurrentLevel = Math.pow(level - 1, 2) * 100;
  const xpForNextLevel = Math.pow(level, 2) * 100;
  const currentXP = totalXP - xpForCurrentLevel;
  const xpNeeded = xpForNextLevel - xpForCurrentLevel;
  const progress = xpNeeded > 0 ? Math.min(currentXP / xpNeeded, 1) : 1;

  const maxTitleLevel = Math.min(level, 10);
  const title = LEVEL_TITLES[maxTitleLevel] || `Level ${level}`;

  return { level, title, currentXP, xpForNext: xpNeeded, progress, totalXP };
}

/**
 * Award XP for completing an MCQ correctly.
 * @returns {Promise<{xpAwarded: number, levelInfo: Object, leveledUp: boolean}>}
 */
export async function awardMCQ() {
  return _awardXP(XP_REWARDS.MCQ_CORRECT, 'mcq_correct');
}

/**
 * Award XP for a step-by-step solution.
 * @param {number} score - Student's score
 * @param {number} maxScore - Maximum possible score
 * @returns {Promise<{xpAwarded: number, levelInfo: Object, leveledUp: boolean}>}
 */
export async function awardStepByStep(score, maxScore) {
  const accuracy = maxScore > 0 ? score / maxScore : 0;

  let xp;
  if (accuracy >= 1) {
    xp = XP_REWARDS.STEP_PERFECT; // Perfect: 250 XP
  } else {
    xp = XP_REWARDS.STEP_BASE + Math.round(accuracy * (XP_REWARDS.STEP_PERFECT - XP_REWARDS.STEP_BASE));
  }

  return _awardXP(xp, 'step_by_step');
}

/**
 * Award Recovery Bonus for fixing a previous mistake.
 * @returns {Promise<{xpAwarded: number, levelInfo: Object, leveledUp: boolean}>}
 */
export async function awardRecoveryBonus() {
  return _awardXP(XP_REWARDS.RECOVERY_BONUS, 'recovery');
}

/**
 * Award participation XP.
 * @returns {Promise<{xpAwarded: number, levelInfo: Object, leveledUp: boolean}>}
 */
export async function awardParticipation() {
  return _awardXP(XP_REWARDS.PARTICIPATION, 'participation');
}

/**
 * Internal: add XP and persist.
 * @param {number} amount
 * @param {string} reason
 */
async function _awardXP(amount, reason) {
  const profile = await getProfile();
  const oldLevel = calculateLevel(profile.totalXP);

  const newTotalXP = (profile.totalXP || 0) + amount;
  await updateProfile({ totalXP: newTotalXP });

  const newLevel = calculateLevel(newTotalXP);
  const leveledUp = newLevel.level > oldLevel.level;

  // Also update level in profile
  if (leveledUp) {
    await updateProfile({ level: newLevel.level });
  }

  return {
    xpAwarded: amount,
    reason,
    levelInfo: newLevel,
    leveledUp,
    newLevelTitle: leveledUp ? newLevel.title : null,
  };
}

/**
 * Get current level info from stored profile.
 * @returns {Promise<Object>}
 */
export async function getCurrentLevel() {
  try {
    const profile = await getProfile();
    return calculateLevel(profile.totalXP || 0);
  } catch (error) {
    console.warn('⚠️ getCurrentLevel failed:', error);
    // Return default level
    return calculateLevel(0);
  }
}

/**
 * Get XP breakdown for display.
 * @returns {Object}
 */
export function getXPRewardTable() {
  return {
    'Correct MCQ Answer': `${XP_REWARDS.MCQ_CORRECT} XP`,
    'Perfect Step-by-Step': `${XP_REWARDS.STEP_PERFECT} XP`,
    'Fix a Mistake': `${XP_REWARDS.RECOVERY_BONUS} XP`,
    'Attempt a Problem': `${XP_REWARDS.PARTICIPATION} XP`,
  };
}
