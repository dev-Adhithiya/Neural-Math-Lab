/**
 * @module localVault
 * @description IndexedDB persistence layer via Dexie.js.
 *
 * Tables:
 *   userProfile          — name, level, totalXP, joinedAt
 *   mistakes             — topicId, problem, description, date, corrected
 *   examMarks            — topicId, score, maxScore, date, stepResults
 *   prerequisiteProgress — topicId, status, completedAt, xp
 *   chatHistory          — role, content, timestamp, sessionId
 *   settings             — key-value store for API keys, theme, etc.
 *   chatSessions         — id, title, createdAt, lastMessageAt
 */

import Dexie from 'dexie';

const db = new Dexie('NeuralMathLab');

db.version(1).stores({
  userProfile: '++id, name',
  mistakes: '++id, topicId, date, corrected',
  examMarks: '++id, topicId, date',
  prerequisiteProgress: 'topicId, status',
  chatHistory: '++id, sessionId, timestamp',
});

db.version(2).stores({
  userProfile: '++id, name',
  mistakes: '++id, topicId, date, corrected',
  examMarks: '++id, topicId, date',
  prerequisiteProgress: 'topicId, status',
  chatHistory: '++id, sessionId, timestamp',
  settings: 'key',
  chatSessions: '++id, createdAt',
});

/* ────────────────────── Settings ──────────────────────────── */

export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

export async function getAllSettings() {
  const rows = await db.settings.toArray();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

/* ────────────────────── User Profile ──────────────────────── */

export async function getProfile(defaultName) {
  let profile = await db.userProfile.toCollection().first();
  if (!profile) {
    const name = defaultName || import.meta.env.VITE_STUDENT_NAME || 'Student';
    const id = await db.userProfile.add({
      name,
      level: 1,
      totalXP: 0,
      joinedAt: new Date().toISOString(),
    });
    profile = await db.userProfile.get(id);
  }
  return profile;
}

export async function updateProfile(fields) {
  const profile = await getProfile();
  await db.userProfile.update(profile.id, fields);
  return db.userProfile.get(profile.id);
}

/* ────────────────────── Chat Sessions ─────────────────────── */

export async function createChatSession(title) {
  const id = await db.chatSessions.add({
    title: title || `Chat ${new Date().toLocaleString()}`,
    createdAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
  });
  return id;
}

export async function getChatSessions() {
  return db.chatSessions.orderBy('createdAt').reverse().toArray();
}

export async function updateSessionTitle(id, title) {
  return db.chatSessions.update(id, { title });
}

export async function updateSessionTimestamp(id) {
  return db.chatSessions.update(id, { lastMessageAt: new Date().toISOString() });
}

export async function deleteChatSession(id) {
  await db.chatHistory.where('sessionId').equals(id).delete();
  return db.chatSessions.delete(id);
}

/* ────────────────────── Mistakes ──────────────────────────── */

export async function saveMistake(mistake) {
  return db.mistakes.add({
    ...mistake,
    date: new Date().toISOString(),
    corrected: false,
  });
}

export async function getMistakes(topicId) {
  if (topicId) return db.mistakes.where('topicId').equals(topicId).toArray();
  return db.mistakes.toArray();
}

export async function markMistakeCorrected(id) {
  return db.mistakes.update(id, { corrected: true });
}

export async function getUncorrectedMistakes() {
  return db.mistakes.where('corrected').equals(0).toArray();
}

/* ────────────────────── Exam Marks ───────────────────────── */

export async function saveExamResult(result) {
  return db.examMarks.add({
    ...result,
    date: new Date().toISOString(),
  });
}

export async function getExamHistory(topicId) {
  if (topicId) return db.examMarks.where('topicId').equals(topicId).toArray();
  return db.examMarks.orderBy('date').reverse().toArray();
}

export async function getTotalProblemsSolved() {
  return db.examMarks.count();
}

/* ───────────────── Prerequisite Progress ─────────────────── */

export async function updatePrerequisite(topicId, status, xp = 0) {
  const existing = await db.prerequisiteProgress.get(topicId);
  if (existing) {
    return db.prerequisiteProgress.update(topicId, {
      status,
      xp: (existing.xp || 0) + xp,
      completedAt: status === 'mastered' ? new Date().toISOString() : existing.completedAt,
    });
  }
  return db.prerequisiteProgress.add({
    topicId,
    status,
    xp,
    completedAt: status === 'mastered' ? new Date().toISOString() : null,
  });
}

export async function getPrerequisiteProgress() {
  return db.prerequisiteProgress.toArray();
}

export async function getTopicProgress(topicId) {
  return db.prerequisiteProgress.get(topicId);
}

/* ────────────────────── Chat History ─────────────────────── */

export async function saveChatMessage(message) {
  return db.chatHistory.add({
    ...message,
    timestamp: new Date().toISOString(),
  });
}

export async function getChatHistory(sessionId) {
  if (sessionId) {
    // Ensure stable order for playback
    return db.chatHistory
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp');
  }
  return db.chatHistory.orderBy('timestamp').toArray();
}

export async function clearChatHistory() {
  return db.chatHistory.clear();
}

/* ────────────────────── Utilities ─────────────────────────── */

export async function resetAllData() {
  await Promise.all([
    db.userProfile.clear(),
    db.mistakes.clear(),
    db.examMarks.clear(),
    db.prerequisiteProgress.clear(),
    db.chatHistory.clear(),
    db.settings.clear(),
    db.chatSessions.clear(),
  ]);
}

export { db };
export default db;
