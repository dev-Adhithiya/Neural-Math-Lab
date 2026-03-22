/**
 * @module localVault
 * @description LocalStorage persistence layer.
 *
 * Data Stores:
 *   userProfile          — name, level, totalXP, joinedAt
 *   mistakes             — array of {id, topicId, problem, description, date, corrected}
 *   examMarks            — array of {id, topicId, score, maxScore, date, stepResults}
 *   prerequisiteProgress — array of {topicId, status, completedAt, xp}
 *   chatHistory          — array of {id, role, content, timestamp, sessionId}
 *   settings             — key-value map
 *   chatSessions         — array of {id, title, createdAt, lastMessageAt}
 */

import CryptoJS from 'crypto-js';

const VAULT_KEY = import.meta.env.VITE_LOCAL_VAULT_KEY || '';

function getRawStore(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function shouldEncryptStore(key) {
  if (!VAULT_KEY || key === 'settings') return false;
  const settings = getRawStore('settings') || {};
  return settings.localEncryptionEnabled === true;
}

function encryptPayload(value) {
  const plain = JSON.stringify(value);
  return {
    __enc: true,
    v: CryptoJS.AES.encrypt(plain, VAULT_KEY).toString(),
  };
}

function decryptPayload(payload) {
  try {
    const bytes = CryptoJS.AES.decrypt(payload.v, VAULT_KEY);
    const plain = bytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

function getRetentionDays() {
  const settings = getRawStore('settings') || {};
  if (settings.retentionEnabled === false) return 0;
  const days = Number(settings.retentionDays ?? 30);
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.floor(days);
}

function pruneByRetention(items, dateField = 'timestamp') {
  const retentionDays = getRetentionDays();
  if (!retentionDays || !Array.isArray(items) || items.length === 0) return items;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const t = new Date(item?.[dateField] || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

// Helper: Get all items from localStorage store
function getStore(key, defaultValue = null) {
  try {
    const data = localStorage.getItem(key);
    if (!data) return defaultValue;

    const parsed = JSON.parse(data);
    if (parsed && parsed.__enc === true) {
      const decrypted = decryptPayload(parsed);
      return decrypted ?? defaultValue;
    }

    return parsed;
  } catch (error) {
    console.warn(`⚠️ Error reading ${key} from localStorage:`, error);
    return defaultValue;
  }
}

// Helper: Save items to localStorage store
function setStore(key, value) {
  try {
    const payload = shouldEncryptStore(key) ? encryptPayload(value) : value;
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.warn(`⚠️ Error writing ${key} to localStorage:`, error);
  }
}

// Helper: Generate unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/* ────────────────────── Settings ──────────────────────────── */

export async function getSetting(key) {
  const settings = getStore('settings', {});
  return settings[key] ?? null;
}

export async function setSetting(key, value) {
  const settings = getStore('settings', {});
  settings[key] = value;
  setStore('settings', settings);
}

export async function getAllSettings() {
  return getStore('settings', {});
}

/* ────────────────────── User Profile ──────────────────────── */

export async function getProfile(defaultName) {
  try {
    let profile = getStore('userProfile');
    if (!profile) {
      const name = defaultName || import.meta.env.VITE_STUDENT_NAME || 'Student';
      profile = {
        id: 1,
        name,
        level: 1,
        totalXP: 0,
        joinedAt: new Date().toISOString(),
      };
      setStore('userProfile', profile);
    }
    return profile;
  } catch (error) {
    console.error('❌ getProfile failed:', error);
    // Return fallback profile
    return {
      id: null,
      name: defaultName || import.meta.env.VITE_STUDENT_NAME || 'Student',
      level: 1,
      totalXP: 0,
      joinedAt: new Date().toISOString(),
    };
  }
}

export async function updateProfile(fields) {
  const profile = await getProfile();
  const updated = { ...profile, ...fields };
  setStore('userProfile', updated);
  return updated;
}

/* ────────────────────── Chat Sessions ─────────────────────── */

export async function createChatSession(title) {
  const id = generateId();
  const sessions = getStore('chatSessions', []);
  sessions.push({
    id,
    title: title || `Chat ${new Date().toLocaleString()}`,
    createdAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
  });
  setStore('chatSessions', sessions);
  return id;
}

export async function getChatSessions() {
  try {
    const sessions = pruneByRetention(getStore('chatSessions', []), 'createdAt');
    setStore('chatSessions', sessions);
    return sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.warn('⚠️ getChatSessions failed:', error);
    return [];
  }
}

export async function updateSessionTitle(id, title) {
  const sessions = getStore('chatSessions', []);
  const idx = sessions.findIndex(s => s.id === id);
  if (idx !== -1) {
    sessions[idx].title = title;
    setStore('chatSessions', sessions);
  }
}

export async function updateSessionTimestamp(id) {
  const sessions = getStore('chatSessions', []);
  const idx = sessions.findIndex(s => s.id === id);
  if (idx !== -1) {
    sessions[idx].lastMessageAt = new Date().toISOString();
    setStore('chatSessions', sessions);
  }
}

export async function deleteChatSession(id) {
  const sessions = getStore('chatSessions', []);
  setStore('chatSessions', sessions.filter(s => s.id !== id));
  
  const history = getStore('chatHistory', []);
  setStore('chatHistory', history.filter(m => m.sessionId !== id));
}

/* ────────────────────── Mistakes ──────────────────────────── */

export async function saveMistake(mistake) {
  const mistakes = getStore('mistakes', []);
  const id = generateId();
  mistakes.push({
    id,
    ...mistake,
    date: new Date().toISOString(),
    corrected: false,
  });
  setStore('mistakes', mistakes);
  return id;
}

export async function getMistakes(topicId) {
  const mistakes = getStore('mistakes', []);
  if (topicId) return mistakes.filter(m => m.topicId === topicId);
  return mistakes;
}

export async function markMistakeCorrected(id) {
  const mistakes = getStore('mistakes', []);
  const idx = mistakes.findIndex(m => m.id === id);
  if (idx !== -1) {
    mistakes[idx].corrected = true;
    setStore('mistakes', mistakes);
  }
}

export async function getUncorrectedMistakes() {
  const mistakes = getStore('mistakes', []);
  return mistakes.filter(m => !m.corrected);
}

/* ────────────────────── Exam Marks ───────────────────────── */

export async function saveExamResult(result) {
  const examMarks = getStore('examMarks', []);
  const id = generateId();
  examMarks.push({
    id,
    ...result,
    date: new Date().toISOString(),
  });
  setStore('examMarks', examMarks);
  return id;
}

export async function getExamHistory(topicId) {
  try {
    const examMarks = getStore('examMarks', []);
    let filtered = examMarks;
    if (topicId) {
      filtered = examMarks.filter(e => e.topicId === topicId);
    }
    return filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (error) {
    console.warn('⚠️ getExamHistory failed:', error);
    return [];
  }
}

export async function getTotalProblemsSolved() {
  const examMarks = getStore('examMarks', []);
  return examMarks.length;
}

/* ───────────────── Prerequisite Progress ─────────────────── */

export async function updatePrerequisite(topicId, status, xp = 0) {
  const progress = getStore('prerequisiteProgress', []);
  const idx = progress.findIndex(p => p.topicId === topicId);
  
  if (idx !== -1) {
    progress[idx] = {
      ...progress[idx],
      status,
      xp: (progress[idx].xp || 0) + xp,
      completedAt: status === 'mastered' ? new Date().toISOString() : progress[idx].completedAt,
    };
  } else {
    progress.push({
      topicId,
      status,
      xp,
      completedAt: status === 'mastered' ? new Date().toISOString() : null,
    });
  }
  
  setStore('prerequisiteProgress', progress);
}

export async function getPrerequisiteProgress() {
  try {
    return getStore('prerequisiteProgress', []);
  } catch (error) {
    console.warn('⚠️ getPrerequisiteProgress failed:', error);
    return [];
  }
}

export async function getTopicProgress(topicId) {
  const progress = getStore('prerequisiteProgress', []);
  return progress.find(p => p.topicId === topicId);
}

/* ────────────────────── Chat History ─────────────────────── */

export async function saveChatMessage(message) {
  const history = pruneByRetention(getStore('chatHistory', []), 'timestamp');
  const id = generateId();
  history.push({
    id,
    ...message,
    timestamp: new Date().toISOString(),
  });
  setStore('chatHistory', history);
  return id;
}

export async function getChatHistory(sessionId) {
  try {
    const history = pruneByRetention(getStore('chatHistory', []), 'timestamp');
    setStore('chatHistory', history);
    let filtered = history;
    if (sessionId) {
      filtered = history.filter(m => m.sessionId === sessionId);
    }
    return filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (error) {
    console.warn('⚠️ getChatHistory failed:', error);
    return [];
  }
}

export async function clearChatHistory() {
  setStore('chatHistory', []);
}

/* ────────────────────── Utilities ─────────────────────────── */

export async function resetAllData() {
  localStorage.removeItem('userProfile');
  localStorage.removeItem('mistakes');
  localStorage.removeItem('examMarks');
  localStorage.removeItem('prerequisiteProgress');
  localStorage.removeItem('chatHistory');
  localStorage.removeItem('settings');
  localStorage.removeItem('chatSessions');
}

export async function exportAllData() {
  return {
    exportedAt: new Date().toISOString(),
    userProfile: getStore('userProfile', null),
    mistakes: getStore('mistakes', []),
    examMarks: getStore('examMarks', []),
    prerequisiteProgress: getStore('prerequisiteProgress', []),
    chatHistory: getStore('chatHistory', []),
    settings: getStore('settings', {}),
    chatSessions: getStore('chatSessions', []),
  };
}

// Dummy export for compatibility
export const db = { name: 'localStorage' };
export default { name: 'localStorage' };
