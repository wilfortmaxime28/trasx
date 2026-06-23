/**
 * utils/cache.js
 * Cache abstraction layer — currently uses in-memory Map.
 * Drop-in compatible with Redis: swap the implementation by requiring config/redis.js
 * and replacing the Map operations with redis.get/set/del.
 *
 * Usage:
 *   const cache = require('./utils/cache');
 *   const value = await cache.wrap('user:123', 300, () => db.findUser(123));
 *   await cache.del('user:123'); // invalidate
 */

'use strict';

// ── In-memory store (replaced by Redis in Phase 2) ────────────────────────
const _store = new Map(); // key → { value, expiresAt }

const memCache = {
  async get(key) {
    const entry = _store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      _store.delete(key);
      return null;
    }
    return entry.value;
  },

  async set(key, value, ttlSeconds = 60) {
    _store.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null
    });
  },

  async del(key) {
    _store.delete(key);
  },

  async delPattern(pattern) {
    // Simple prefix match for in-memory (Redis uses KEYS pattern)
    const prefix = pattern.replace(/\*$/, '');
    for (const key of _store.keys()) {
      if (key.startsWith(prefix)) _store.delete(key);
    }
  }
};

// ── Recommended TTLs (seconds) ────────────────────────────────────────────
const TTL = {
  USER_PROFILE:        300, // 5 min
  NOTIFICATION_COUNT:   30, // 30 sec (near real-time)
  FEED_STATS:          120, // 2 min
  POPULAR_POSTS:       300, // 5 min
  FOLLOWERS_COUNT:     120, // 2 min
  REELS:               180, // 3 min
};

// ── Public API ────────────────────────────────────────────────────────────
const cache = {
  TTL,

  /** Get a cached value. Returns null if missing or expired. */
  async get(key) {
    try { return await memCache.get(key); }
    catch (e) { console.warn('[cache] get error:', e.message); return null; }
  },

  /** Set a value with TTL in seconds. */
  async set(key, value, ttl = 60) {
    try { await memCache.set(key, value, ttl); }
    catch (e) { console.warn('[cache] set error:', e.message); }
  },

  /** Delete a specific key. */
  async del(key) {
    try { await memCache.del(key); }
    catch (e) { console.warn('[cache] del error:', e.message); }
  },

  /** Delete all keys matching a pattern prefix (e.g. 'user:*'). */
  async delPattern(pattern) {
    try { await memCache.delPattern(pattern); }
    catch (e) { console.warn('[cache] delPattern error:', e.message); }
  },

  /**
   * Get-or-set helper. Returns cached value if available, otherwise calls
   * fetchFn(), caches the result, and returns it.
   *
   * @param {string}   key       Cache key
   * @param {number}   ttl       TTL in seconds
   * @param {Function} fetchFn   Async function to fetch fresh data
   */
  async wrap(key, ttl, fetchFn) {
    const cached = await cache.get(key);
    if (cached !== null) return cached;
    const fresh = await fetchFn();
    await cache.set(key, fresh, ttl);
    return fresh;
  },

  /**
   * Returns cache statistics (only relevant for in-memory store).
   * Useful for monitoring cache size in development.
   */
  stats() {
    let active = 0;
    const now = Date.now();
    for (const [, entry] of _store) {
      if (!entry.expiresAt || now <= entry.expiresAt) active++;
    }
    return { total: _store.size, active };
  }
};

module.exports = cache;

/*
 * ─── HOW TO MIGRATE TO REDIS ──────────────────────────────────────────────
 * 1. npm install ioredis
 * 2. Create config/redis.js (see implementation_plan.md)
 * 3. In this file, replace memCache with:
 *
 *    const redis = require('../config/redis');
 *    const redisCache = {
 *      async get(key) {
 *        const val = await redis.get(key);
 *        return val ? JSON.parse(val) : null;
 *      },
 *      async set(key, value, ttl) {
 *        await redis.set(key, JSON.stringify(value), 'EX', ttl);
 *      },
 *      async del(key) { await redis.del(key); },
 *      async delPattern(pattern) {
 *        const keys = await redis.keys(pattern);
 *        if (keys.length) await redis.del(...keys);
 *      }
 *    };
 *
 * 4. Replace `memCache` with `redisCache` in the cache methods above.
 * 5. No other code changes needed — the API is identical.
 */
