'use strict';

const crypto = require('crypto');
const Reel = require('../models/Reel');
const cache = require('../utils/cache');

const REEL_FEED_CACHE_VERSION = 'v1';
const REEL_FEED_SEEN_MAX = 160;
const REEL_FEED_HARD_EXCLUDE_LIMIT = 40;
const REEL_FEED_SOFT_SEEN_LIMIT = 120;

function normalizeIds(values = [], max = REEL_FEED_SEEN_MAX) {
  const seen = new Set();
  const normalized = [];
  values.forEach((value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0 || seen.has(numericValue)) return;
    seen.add(numericValue);
    normalized.push(numericValue);
  });
  return normalized.slice(0, max);
}

function hashIds(values = []) {
  return crypto.createHash('sha1').update(normalizeIds(values).join(',')).digest('hex').slice(0, 16);
}

function decodeCursor(rawCursor) {
  if (!rawCursor || typeof rawCursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
    const rankingScore = Number(parsed?.rankingScore);
    const createdAtSort = Number(parsed?.createdAtSort);
    const id = Number(parsed?.id);
    if (!Number.isFinite(rankingScore) || !Number.isFinite(createdAtSort) || !Number.isFinite(id)) {
      return null;
    }
    return { rankingScore, createdAtSort, id };
  } catch (_) {
    return null;
  }
}

function buildReelFeedSession(session, { refresh = false } = {}) {
  if (refresh || !session.reelFeedSessionToken) {
    session.reelFeedSessionToken = crypto.randomUUID();
  }
  if (refresh || !session.reelFeedSeed) {
    session.reelFeedSeed = Math.floor(Math.random() * 999999) + 1;
  }
  return {
    token: session.reelFeedSessionToken,
    seed: Number(session.reelFeedSeed)
  };
}

function getSeenKey(userId, sessionToken) {
  return `reelfeed:seen:${REEL_FEED_CACHE_VERSION}:${userId}:${sessionToken}`;
}

function getPageKey(userId, sessionToken, cursorToken, limit, seenIds = []) {
  const cursorKey = cursorToken || 'initial';
  const seenSignature = hashIds(normalizeIds(seenIds, REEL_FEED_SOFT_SEEN_LIMIT));
  return `reelfeed:page:${REEL_FEED_CACHE_VERSION}:${userId}:${sessionToken}:${limit}:${cursorKey}:${seenSignature}`;
}

async function getSeenIds(userId, sessionToken) {
  return normalizeIds(await cache.get(getSeenKey(userId, sessionToken)) || []);
}

async function setSeenIds(userId, sessionToken, ids = []) {
  const normalized = normalizeIds(ids);
  await cache.set(getSeenKey(userId, sessionToken), normalized, cache.TTL.FEED_SEEN);
  return normalized;
}

async function prefetchNextPage({
  currentUserId,
  userCountry,
  sessionToken,
  feedSeed,
  cursorToken,
  limit,
  seenIds = []
}) {
  if (!cursorToken) return;

  const hardExcludeIds = normalizeIds(seenIds, REEL_FEED_HARD_EXCLUDE_LIMIT);
  const softSeenIds = normalizeIds(seenIds, REEL_FEED_SOFT_SEEN_LIMIT);
  const cacheKey = getPageKey(currentUserId, sessionToken, cursorToken, limit, softSeenIds);
  const existing = await cache.get(cacheKey);
  if (existing) return;

  const page = await Reel.getFeedPaginated(currentUserId, {
    limit,
    userCountry,
    feedSeed,
    cursor: decodeCursor(cursorToken),
    hardExcludeIds,
    softSeenIds
  });

  await cache.set(cacheKey, page, cache.TTL.REELS);
}

async function getReelFeedPage({
  session,
  currentUserId,
  userCountry = '',
  limit = 6,
  cursorToken = null,
  clientSeenIds = [],
  refreshSession = false
}) {
  const feedSession = buildReelFeedSession(session, { refresh: refreshSession });
  const cachedSeenIds = await getSeenIds(currentUserId, feedSession.token);
  const mergedSeenIds = normalizeIds([...(clientSeenIds || []), ...cachedSeenIds], REEL_FEED_SEEN_MAX);
  const hardExcludeIds = normalizeIds(mergedSeenIds, REEL_FEED_HARD_EXCLUDE_LIMIT);
  const softSeenIds = normalizeIds(mergedSeenIds, REEL_FEED_SOFT_SEEN_LIMIT);
  const pageCacheKey = getPageKey(currentUserId, feedSession.token, cursorToken, limit, softSeenIds);

  let page = await cache.get(pageCacheKey);
  if (!page) {
    page = await Reel.getFeedPaginated(currentUserId, {
      limit,
      userCountry,
      feedSeed: feedSession.seed,
      cursor: decodeCursor(cursorToken),
      hardExcludeIds,
      softSeenIds
    });
    await cache.set(pageCacheKey, page, cache.TTL.REELS);
  }

  const pageReelIds = normalizeIds((page.reels || []).map((reel) => reel.id), REEL_FEED_SEEN_MAX);
  const nextSeenIds = await setSeenIds(
    currentUserId,
    feedSession.token,
    [...pageReelIds, ...mergedSeenIds]
  );

  if (page.hasMore && page.nextCursor) {
    setImmediate(() => {
      prefetchNextPage({
        currentUserId,
        userCountry,
        sessionToken: feedSession.token,
        feedSeed: feedSession.seed,
        cursorToken: page.nextCursor,
        limit,
        seenIds: nextSeenIds
      }).catch((error) => {
        console.warn('[reels] next-page prefetch skipped:', error.message);
      });
    });
  }

  return {
    reels: page.reels || [],
    hasMore: Boolean(page.hasMore),
    nextCursor: page.nextCursor || null,
    feedSeed: feedSession.seed,
    feedSessionToken: feedSession.token
  };
}

module.exports = {
  buildReelFeedSession,
  getReelFeedPage
};
