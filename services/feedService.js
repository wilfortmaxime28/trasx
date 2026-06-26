'use strict';

const crypto = require('crypto');
const Post = require('../models/Post');
const Challenge = require('../models/Challenge');
const cache = require('../utils/cache');

const FEED_CACHE_VERSION = 'v4';
const FEED_SEEN_MAX = 180;
const FEED_HARD_EXCLUDE_LIMIT = 36;
const FEED_SOFT_SEEN_LIMIT = 120;

function normalizeIds(values = [], max = FEED_SEEN_MAX) {
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

function encodeCursor(payload) {
  if (!payload) return null;
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
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

function buildFeedSession(session, { refresh = false } = {}) {
  if (refresh || !session.feedSessionToken) {
    session.feedSessionToken = crypto.randomUUID();
  }
  if (refresh || !session.feedSeed) {
    session.feedSeed = Math.floor(Math.random() * 999999) + 1;
  }
  return {
    token: session.feedSessionToken,
    seed: Number(session.feedSeed)
  };
}

function getSeenKey(userId, sessionToken) {
  return `feed:seen:${FEED_CACHE_VERSION}:${userId}:${sessionToken}`;
}

function getPageKey(userId, sessionToken, cursorToken, limit, seenIds = []) {
  const cursorKey = cursorToken || 'initial';
  const seenSignature = hashIds(normalizeIds(seenIds, FEED_SOFT_SEEN_LIMIT));
  return `feed:page:${FEED_CACHE_VERSION}:${userId}:${sessionToken}:${limit}:${cursorKey}:${seenSignature}`;
}

async function getSeenIds(userId, sessionToken) {
  return normalizeIds(await cache.get(getSeenKey(userId, sessionToken)) || []);
}

async function setSeenIds(userId, sessionToken, ids = []) {
  const normalized = normalizeIds(ids);
  await cache.set(getSeenKey(userId, sessionToken), normalized, cache.TTL.FEED_SEEN);
  return normalized;
}

async function hydratePosts(posts = []) {
  const normalizedPosts = Array.isArray(posts) ? posts : [];
  if (!normalizedPosts.length) return [];

  await Promise.all(normalizedPosts.map(async (post) => {
    post.comments = [];
    if (post.challenge_type) {
      post.challenge_participants = await Challenge.getParticipants(post.id);
    }
  }));

  return normalizedPosts;
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

  const hardExcludeIds = normalizeIds(seenIds, FEED_HARD_EXCLUDE_LIMIT);
  const softSeenIds = normalizeIds(seenIds, FEED_SOFT_SEEN_LIMIT);
  const cacheKey = getPageKey(currentUserId, sessionToken, cursorToken, limit, softSeenIds);

  const existing = await cache.get(cacheKey);
  if (existing) return;

  const page = await Post.getFeedPaginated(currentUserId, {
    limit,
    userCountry,
    feedSeed,
    cursor: decodeCursor(cursorToken),
    hardExcludeIds,
    softSeenIds
  });

  const hydratedPosts = await hydratePosts(page.posts);
  await cache.set(cacheKey, {
    ...page,
    posts: hydratedPosts,
    nextCursor: page.nextCursor
  }, cache.TTL.FEED_PAGE);
}

async function getFeedPage({
  session,
  currentUserId,
  userCountry = '',
  limit = 20,
  cursorToken = null,
  clientSeenIds = [],
  refreshSession = false
}) {
  const feedSession = buildFeedSession(session, { refresh: refreshSession });
  const cachedSeenIds = await getSeenIds(currentUserId, feedSession.token);
  const mergedSeenIds = normalizeIds([...(clientSeenIds || []), ...cachedSeenIds], FEED_SEEN_MAX);
  const hardExcludeIds = normalizeIds(mergedSeenIds, FEED_HARD_EXCLUDE_LIMIT);
  const softSeenIds = normalizeIds(mergedSeenIds, FEED_SOFT_SEEN_LIMIT);
  const pageCacheKey = getPageKey(currentUserId, feedSession.token, cursorToken, limit, softSeenIds);

  let page = await cache.get(pageCacheKey);
  if (!page) {
    page = await Post.getFeedPaginated(currentUserId, {
      limit,
      userCountry,
      feedSeed: feedSession.seed,
      cursor: decodeCursor(cursorToken),
      hardExcludeIds,
      softSeenIds
    });
    page.posts = await hydratePosts(page.posts);
    await cache.set(pageCacheKey, page, cache.TTL.FEED_PAGE);
  }

  const pagePostIds = normalizeIds((page.posts || []).map((post) => post.id), FEED_SEEN_MAX);
  const nextSeenIds = await setSeenIds(
    currentUserId,
    feedSession.token,
    [...pagePostIds, ...mergedSeenIds]
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
        console.warn('[feed] next-page prefetch skipped:', error.message);
      });
    });
  }

  return {
    posts: page.posts || [],
    hasMore: Boolean(page.hasMore),
    nextCursor: page.nextCursor || null,
    feedSeed: feedSession.seed,
    feedSessionToken: feedSession.token
  };
}

module.exports = {
  buildFeedSession,
  getFeedPage,
  encodeCursor,
  decodeCursor
};
