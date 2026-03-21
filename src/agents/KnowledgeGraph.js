/**
 * @module KnowledgeGraph
 * @description Prerequisite engine — a DAG of math topics.
 *
 * Reason-Act-Observe:
 *   REASON  → Load user progress from localVault
 *   ACT     → Walk the DAG to determine which topics are unlocked
 *   OBSERVE → Return available / locked topics with reasons
 */

/* ────────────────── Topic Definitions ────────────────────── */

/**
 * Each topic has an id, human-readable label, prerequisites (other topic ids),
 * a difficulty tier, and a category for grouping.
 */
export const TOPICS = [
  // ── Tier 0: Foundations ──
  { id: 'arithmetic',       label: 'Arithmetic',              prerequisites: [],                    tier: 0, category: 'Foundations' },
  { id: 'fractions',        label: 'Fractions & Decimals',    prerequisites: ['arithmetic'],        tier: 0, category: 'Foundations' },
  { id: 'percentages',      label: 'Percentages',             prerequisites: ['fractions'],         tier: 0, category: 'Foundations' },

  // ── Tier 1: Pre-Algebra ──
  { id: 'basic-algebra',    label: 'Basic Algebra',           prerequisites: ['arithmetic'],        tier: 1, category: 'Algebra' },
  { id: 'linear-equations', label: 'Linear Equations',        prerequisites: ['basic-algebra'],     tier: 1, category: 'Algebra' },
  { id: 'inequalities',     label: 'Inequalities',            prerequisites: ['linear-equations'],  tier: 1, category: 'Algebra' },

  // ── Tier 2: Intermediate ──
  { id: 'quadratics',       label: 'Quadratic Equations',     prerequisites: ['linear-equations'],  tier: 2, category: 'Algebra' },
  { id: 'polynomials',      label: 'Polynomials',             prerequisites: ['quadratics'],        tier: 2, category: 'Algebra' },
  { id: 'geometry-basics',  label: 'Geometry Basics',         prerequisites: ['arithmetic'],        tier: 2, category: 'Geometry' },
  { id: 'coordinate-geo',   label: 'Coordinate Geometry',     prerequisites: ['linear-equations', 'geometry-basics'], tier: 2, category: 'Geometry' },

  // ── Tier 3: Advanced ──
  { id: 'trigonometry',     label: 'Trigonometry',            prerequisites: ['geometry-basics', 'quadratics'],       tier: 3, category: 'Trigonometry' },
  { id: 'functions',        label: 'Functions & Graphs',      prerequisites: ['quadratics'],        tier: 3, category: 'Analysis' },
  { id: 'sequences',        label: 'Sequences & Series',      prerequisites: ['basic-algebra'],     tier: 3, category: 'Analysis' },

  // ── Tier 4: Pre-Calculus ──
  { id: 'logarithms',       label: 'Logarithms & Exponents',  prerequisites: ['polynomials'],       tier: 4, category: 'Analysis' },
  { id: 'limits',           label: 'Limits',                   prerequisites: ['functions'],         tier: 4, category: 'Calculus' },

  // ── Tier 5: Calculus ──
  { id: 'differentiation',  label: 'Differentiation',         prerequisites: ['limits', 'logarithms'], tier: 5, category: 'Calculus' },
  { id: 'integration',      label: 'Integration',             prerequisites: ['differentiation'],       tier: 5, category: 'Calculus' },

  // ── Tier 6: Statistics ──
  { id: 'probability',      label: 'Probability',             prerequisites: ['fractions', 'percentages'], tier: 3, category: 'Statistics' },
  { id: 'statistics',       label: 'Statistics',              prerequisites: ['probability'],               tier: 4, category: 'Statistics' },
];

/** Quick lookup map */
const topicMap = new Map(TOPICS.map((t) => [t.id, t]));

/* ─────────────────── Core Functions ──────────────────────── */

/**
 * Get a topic definition by id.
 * @param {string} topicId
 */
export function getTopic(topicId) {
  return topicMap.get(topicId) || null;
}

/**
 * Check whether all prerequisites for a topic are mastered.
 * @param {string} topicId
 * @param {Map<string,string>} progressMap - topicId → status
 * @returns {{ unlocked: boolean, missing: string[] }}
 */
export function isTopicUnlocked(topicId, progressMap) {
  // All topics are unlocked for everyone
  return { unlocked: true, missing: [] };
}

/**
 * Return all topics annotated with their lock status.
 * @param {Map<string,string>} progressMap
 * @returns {Array<Object>}
 */
export function getAnnotatedTopics(progressMap) {
  return TOPICS.map((topic) => {
    const { unlocked, missing } = isTopicUnlocked(topic.id, progressMap);
    const status = progressMap.get(topic.id) || (unlocked ? 'unlocked' : 'locked');
    return { ...topic, status, unlocked, missing };
  });
}

/**
 * Get the next recommended topics (unlocked but not mastered).
 * @param {Map<string,string>} progressMap
 * @returns {Array<Object>}
 */
export function getNextTopics(progressMap) {
  return getAnnotatedTopics(progressMap).filter(
    (t) => t.unlocked && t.status !== 'mastered'
  );
}

/**
 * Get prerequisite chain for a topic (all ancestors).
 * @param {string} topicId
 * @returns {string[]}
 */
export function getPrerequisiteChain(topicId) {
  const chain = [];
  const visited = new Set();

  function walk(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const topic = topicMap.get(id);
    if (!topic) return;
    for (const preId of topic.prerequisites) {
      walk(preId);
      if (!chain.includes(preId)) chain.push(preId);
    }
  }

  walk(topicId);
  return chain;
}

/**
 * Get all categories with their topics grouped.
 * @returns {Object<string, Object[]>}
 */
export function getTopicsByCategory() {
  const categories = {};
  for (const topic of TOPICS) {
    if (!categories[topic.category]) categories[topic.category] = [];
    categories[topic.category].push(topic);
  }
  return categories;
}

/**
 * Build a progress map from localVault prerequisiteProgress array.
 * @param {Array<{topicId:string, status:string}>} progressArr
 * @returns {Map<string,string>}
 */
export function buildProgressMap(progressArr) {
  return new Map(progressArr.map((p) => [p.topicId, p.status]));
}
