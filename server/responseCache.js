/**
 * Response Caching Layer for Math Tutor
 * Caches repeated math questions and their answers
 * 
 * Reduces latency from 22s to <10ms for cached queries
 * LRU cache with configurable TTL
 */

import crypto from 'crypto';

export class ResponseCache {
  constructor(maxSize = 500, ttlMs = 3600000) { // 1 hour default TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.accessOrder = [];
    this.cleanupInterval = setInterval(() => this.evictExpired(), 60000);
  }

  /**
   * Normalize query for fuzzy matching
   * "What is 2+2?" = "what is 2+2"
   */
  normalizeQuery(query) {
    return query.toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[?!]*$/, '');
  }

  /**
   * Generate cache key from normalized query
   */
  generateKey(query) {
    const normalized = this.normalizeQuery(query);
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  /**
   * Get cached response if available and not expired
   */
  get(query) {
    const key = this.generateKey(query);
    const entry = this.cache.get(key);

    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > this.ttlMs;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    // Update access order for LRU
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(key);

    return entry.response;
  }

  /**
   * Store response in cache
   */
  set(query, response) {
    const key = this.generateKey(query);

    // Remove if already exists
    if (this.cache.has(key)) {
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      query,
    });

    this.accessOrder.push(key);

    // LRU eviction
    if (this.cache.size > this.maxSize) {
      const lruKey = this.accessOrder.shift();
      this.cache.delete(lruKey);
    }
  }

  /**
   * Evict expired entries
   */
  evictExpired() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
    });
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      entries: Array.from(this.cache.values()).map(e => ({
        query: e.query,
        age: Date.now() - e.timestamp,
      })),
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.clear();
  }
}

export default ResponseCache;
