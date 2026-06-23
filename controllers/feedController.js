const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Reel = require('../models/Reel');
const Message = require('../models/Message');
const Event = require('../models/Event');
const Status = require('../models/Status');
const Ad = require('../models/Ad');
const Challenge = require('../models/Challenge');
const P2PMarket = require('../models/P2PMarket');
const { buildMessageInboxSections } = require('../utils/messageInbox');
const { getNumberSetting } = require('../utils/appSettings');
const { getSupportedCurrencyOptions, getPreferredCurrencyForCountry, getDefaultPaymentMethodsForCountry } = require('../utils/p2pCurrencies');

function isWithinPromoWindow(authorCreatedAt, promoWindowDays) {
  const createdAtMs = new Date(authorCreatedAt || 0).getTime();
  if (!createdAtMs || !Number.isFinite(createdAtMs)) return false;
  const windowMs = Math.max(1, Number(promoWindowDays || 0)) * 24 * 60 * 60 * 1000;
  return (Date.now() - createdAtMs) <= windowMs;
}

function normalizeHistoryIds(ids = [], maxLength = 120) {
  const seen = new Set();
  const normalized = [];
  ids.forEach((value) => {
    const numericId = Number(value);
    if (!Number.isFinite(numericId) || numericId <= 0 || seen.has(numericId)) return;
    seen.add(numericId);
    normalized.push(numericId);
  });
  return normalized.slice(0, maxLength);
}

function getFeedMemory(session) {
  if (!session.feedDiscoveryMemory || typeof session.feedDiscoveryMemory !== 'object') {
    session.feedDiscoveryMemory = {};
  }

  session.feedDiscoveryMemory.posts = normalizeHistoryIds(session.feedDiscoveryMemory.posts, 180);
  session.feedDiscoveryMemory.reels = normalizeHistoryIds(session.feedDiscoveryMemory.reels, 180);
  return session.feedDiscoveryMemory;
}

function updateFeedMemory(session, { visiblePostIds = [], visibleReelIds = [] } = {}) {
  const memory = getFeedMemory(session);
  memory.posts = normalizeHistoryIds([...(visiblePostIds || []), ...(memory.posts || [])], 180);
  memory.reels = normalizeHistoryIds([...(visibleReelIds || []), ...(memory.reels || [])], 180);
}

function normalizeCountry(value) {
  return String(value || '').trim().toLowerCase();
}

function buildDiscoveryMetrics(item, todayViewsMap, promoWindowDays, options = {}) {
  const includeBackgroundPremium = options.includeBackgroundPremium !== false;
  const target = Number(item.promo_daily_target || 0);
  const todayViews = Number(todayViewsMap.get(Number(item.id)) || 0);
  const eligible = target > 0 && isWithinPromoWindow(item.author_created_at, promoWindowDays);
  const remaining = eligible ? Math.max(0, target - todayViews) : 0;
  const isFollowing = Number(item.is_author_following || 0) === 1;
  const premiumHashtagCount = Number(item.promo_paid_hashtag_count || 0);
  const premiumBackgroundPrice = includeBackgroundPremium ? Number(item.promo_paid_background_price || 0) : 0;
  const premiumScore = (premiumHashtagCount * 140) + (premiumBackgroundPrice * 40);
  const createdAtValue = new Date(item.created_at || 0).getTime();
  const authorId = Number(item.user_id || item.author_id || 0);
  const authorFollowersCount = Number(item.author_followers_count || 0);
  const currentUserCountry = normalizeCountry(options.currentUserCountry);
  const authorCountry = normalizeCountry(item.author_country);
  const recentIds = new Set(Array.isArray(options.recentIds) ? options.recentIds.map((id) => Number(id)) : []);
  const isRecentlySurfaced = recentIds.has(Number(item.id));
  const randomSeed = Number(options.randomSeed || Date.now());
  const itemSeed = ((Number(item.id) || 0) * 37) + ((authorId || 0) * 17) + randomSeed;
  const randomScore = Math.abs(Math.sin(itemSeed)) * 1000;
  const sameCountry = Boolean(currentUserCountry && authorCountry && currentUserCountry === authorCountry);
  const popularityScore = Math.min(authorFollowersCount, 5000);

  return {
    item,
    authorId,
    authorFollowersCount,
    eligible,
    remaining,
    isFollowing,
    sameCountry,
    popularityScore,
    premiumScore,
    isRecentlySurfaced,
    createdAtValue: Number.isFinite(createdAtValue) ? createdAtValue : 0,
    randomScore
  };
}

function sortMetricsForDiscovery(metrics, options = {}) {
  const prioritizeFollowing = options.prioritizeFollowing !== false;
  const prioritizeSameCountry = options.prioritizeSameCountry !== false;
  const prioritizePopularity = options.prioritizePopularity !== false;

  return [...metrics].sort((a, b) => {
    if (prioritizeFollowing && a.isFollowing !== b.isFollowing) return a.isFollowing ? -1 : 1;
    if (prioritizeSameCountry && a.sameCountry !== b.sameCountry) return a.sameCountry ? -1 : 1;
    if (a.isRecentlySurfaced !== b.isRecentlySurfaced) return a.isRecentlySurfaced ? 1 : -1;
    if (a.premiumScore !== b.premiumScore) return b.premiumScore - a.premiumScore;
    if (prioritizePopularity && a.popularityScore !== b.popularityScore) return b.popularityScore - a.popularityScore;
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.remaining !== b.remaining) return b.remaining - a.remaining;
    if (a.randomScore !== b.randomScore) return b.randomScore - a.randomScore;
    if (a.createdAtValue !== b.createdAtValue) return b.createdAtValue - a.createdAtValue;
    return 0;
  });
}

function interleaveByAuthor(metrics, options = {}) {
  const sorted = sortMetricsForDiscovery(metrics, options);
  const buckets = new Map();
  const bucketOrder = [];

  sorted.forEach((entry) => {
    const bucketKey = entry.authorId > 0 ? entry.authorId : `fallback-${entry.item.id}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
      bucketOrder.push(bucketKey);
    }
    buckets.get(bucketKey).push(entry);
  });

  bucketOrder.sort((a, b) => {
    const firstA = buckets.get(a)?.[0];
    const firstB = buckets.get(b)?.[0];
    if (!firstA && !firstB) return 0;
    if (!firstA) return 1;
    if (!firstB) return -1;
    if (firstA.isRecentlySurfaced !== firstB.isRecentlySurfaced) return firstA.isRecentlySurfaced ? 1 : -1;
    if (firstA.premiumScore !== firstB.premiumScore) return firstB.premiumScore - firstA.premiumScore;
    if (firstA.randomScore !== firstB.randomScore) return firstB.randomScore - firstA.randomScore;
    return firstB.createdAtValue - firstA.createdAtValue;
  });

  const result = [];
  let hasRemaining = true;

  while (hasRemaining) {
    hasRemaining = false;
    for (const bucketKey of bucketOrder) {
      const queue = buckets.get(bucketKey);
      if (queue && queue.length) {
        result.push(queue.shift());
        hasRemaining = true;
      }
    }
  }

  return result;
}

function mergeDiscoveryStreams(followingStream, otherStream, premiumStream, options = {}) {
  const merged = [];
  const usedIds = new Set();
  let followingCursor = 0;
  let otherCursor = 0;
  let premiumCursor = 0;
  const premiumInterval = Math.max(3, Number(options.premiumInterval || 4));

  const pushEntry = (entry) => {
    if (!entry) return false;
    const entryId = Number(entry.item?.id || 0);
    if (!Number.isFinite(entryId) || entryId <= 0 || usedIds.has(entryId)) return false;
    usedIds.add(entryId);
    merged.push(entry);
    return true;
  };

  const maybePushPremium = () => {
    while (premiumCursor < premiumStream.length) {
      if (pushEntry(premiumStream[premiumCursor++])) {
        return true;
      }
    }
    return false;
  };

  while (followingCursor < followingStream.length || otherCursor < otherStream.length) {
    for (let count = 0; count < 2 && followingCursor < followingStream.length; count += 1) {
      pushEntry(followingStream[followingCursor++]);
      if (merged.length > 0 && merged.length % premiumInterval === 0) {
        maybePushPremium();
      }
    }
    if (otherCursor < otherStream.length) {
      pushEntry(otherStream[otherCursor++]);
      if (merged.length > 0 && merged.length % premiumInterval === 0) {
        maybePushPremium();
      }
    }
    if (followingCursor >= followingStream.length && otherCursor < otherStream.length) {
      pushEntry(otherStream[otherCursor++]);
      if (merged.length > 0 && merged.length % premiumInterval === 0) {
        maybePushPremium();
      }
    }
  }

  followingStream.forEach(pushEntry);
  otherStream.forEach(pushEntry);
  premiumStream.forEach(pushEntry);

  return merged.map((entry) => entry.item);
}

function mergeNoFollowingStreams(sameCountryStream, popularStream, premiumStream, randomStream, options = {}) {
  const merged = [];
  const usedIds = new Set();
  let sameCountryCursor = 0;
  let popularCursor = 0;
  let premiumCursor = 0;
  let randomCursor = 0;
  const premiumInterval = Math.max(3, Number(options.premiumInterval || 4));

  const pushEntry = (entry) => {
    if (!entry) return false;
    const entryId = Number(entry.item?.id || 0);
    if (!Number.isFinite(entryId) || entryId <= 0 || usedIds.has(entryId)) return false;
    usedIds.add(entryId);
    merged.push(entry);
    return true;
  };

  const pushNext = (stream, cursorRef) => {
    while (cursorRef.index < stream.length) {
      if (pushEntry(stream[cursorRef.index])) {
        cursorRef.index += 1;
        return true;
      }
      cursorRef.index += 1;
    }
    return false;
  };

  const sameCountryRef = { index: sameCountryCursor };
  const popularRef = { index: popularCursor };
  const premiumRef = { index: premiumCursor };
  const randomRef = { index: randomCursor };

  while (
    sameCountryRef.index < sameCountryStream.length
    || popularRef.index < popularStream.length
    || premiumRef.index < premiumStream.length
    || randomRef.index < randomStream.length
  ) {
    pushNext(sameCountryStream, sameCountryRef);
    pushNext(popularStream, popularRef);
    if (merged.length > 0 && merged.length % premiumInterval === 0) {
      pushNext(premiumStream, premiumRef);
    }
    pushNext(randomStream, randomRef);
  }

  sameCountryStream.forEach(pushEntry);
  popularStream.forEach(pushEntry);
  premiumStream.forEach(pushEntry);
  randomStream.forEach(pushEntry);

  return merged.map((entry) => entry.item);
}

function sortForDiscovery(items, todayViewsMap, promoWindowDays, options = {}) {
  const randomSeed = Date.now() + Math.floor(Math.random() * 1000000);
  const enriched = items.map((item, index) => {
    return {
      index,
      ...buildDiscoveryMetrics(item, todayViewsMap, promoWindowDays, {
        ...options,
        randomSeed: randomSeed + index
      })
    };
  });

  const noFollowingMode = Boolean(options.noFollowingMode);

  if (noFollowingMode) {
    const buildNoFollowingLane = (entries) => {
      const sameCountryStream = interleaveByAuthor(entries.filter((entry) => entry.sameCountry), {
        prioritizeFollowing: false,
        prioritizeSameCountry: true,
        prioritizePopularity: true
      });
      const popularStream = interleaveByAuthor(entries.filter((entry) => entry.popularityScore > 0), {
        prioritizeFollowing: false,
        prioritizeSameCountry: false,
        prioritizePopularity: true
      });
      const premiumStream = interleaveByAuthor(entries.filter((entry) => entry.premiumScore > 0), {
        prioritizeFollowing: false,
        prioritizeSameCountry: false,
        prioritizePopularity: true
      });
      const randomStream = interleaveByAuthor(entries, {
        prioritizeFollowing: false,
        prioritizeSameCountry: false,
        prioritizePopularity: false
      });

      return mergeNoFollowingStreams(sameCountryStream, popularStream, premiumStream, randomStream, { premiumInterval: 4 });
    };

    const freshEntries = enriched.filter((entry) => !entry.isRecentlySurfaced);
    const seenEntries = enriched.filter((entry) => entry.isRecentlySurfaced);
    return [
      ...buildNoFollowingLane(freshEntries),
      ...buildNoFollowingLane(seenEntries)
    ];
  }

  const buildLane = (entries) => {
    const followingStream = interleaveByAuthor(entries.filter((entry) => entry.isFollowing), { prioritizeFollowing: false });
    const otherStream = interleaveByAuthor(entries.filter((entry) => !entry.isFollowing), { prioritizeFollowing: false });
    const premiumStream = interleaveByAuthor(entries.filter((entry) => entry.premiumScore > 0), { prioritizeFollowing: false });
    return mergeDiscoveryStreams(followingStream, otherStream, premiumStream, { premiumInterval: 4 });
  };

  const freshEntries = enriched.filter((entry) => !entry.isRecentlySurfaced);
  const seenEntries = enriched.filter((entry) => entry.isRecentlySurfaced);

  return [
    ...buildLane(freshEntries),
    ...buildLane(seenEntries)
  ];
}

function buildBirthdayCelebrantsPayload(rows = []) {
  return rows.map((user) => ({
    id: Number(user.id),
    username: String(user.username || '').trim(),
    first_name: String(user.first_name || '').trim(),
    last_name: String(user.last_name || '').trim(),
    name: String(user.name || `${user.first_name || ''} ${user.last_name || ''}`).trim() || 'Utilisateur',
    avatar: user.avatar || '/assets/avatar_placeholder.jpg',
    country: String(user.country || '').trim(),
    age: Number(user.age || 0),
    certification_type: String(user.certification_type || 'None').trim() || 'None',
    is_self: Boolean(user.is_self),
    is_preview: Boolean(user.is_preview),
    birthday_label: String(user.birthday_label || '').trim(),
    preview_message: String(user.preview_message || '').trim()
  }));
}

async function loadBirthdayCelebrantsForFeed(currentUserId) {
  return buildBirthdayCelebrantsPayload(await User.getTodaysBirthdayCelebrants(currentUserId));
}

class FeedController {
  static async getFeed(req, res) {
    try {
      const currentUserId = req.session.userId;
      const currentUser = res.locals.currentUser || await User.getById(currentUserId);
      
      if (!currentUser) {
        req.session.destroy();
        return res.redirect('/auth/login');
      }

      const promoWindowDays = await getNumberSetting('new_user_promo_days', 30);
      const initialFeedBatchSize = 10;
      const feedRevealBatchSize = 6;
      const initialShortBatchSize = 4;
      const shortRevealBatchSize = 2;
      const feedMemory = getFeedMemory(req.session);
      const followingCount = await User.getFollowingCount(currentUserId);
      const noFollowingMode = Number(followingCount || 0) === 0;

      // Récupérer tous les posts puis charger leurs commentaires en un seul lot
      let posts = await Post.getAll(currentUserId);
      const postViewCounts = await Post.getTodayUniqueViewCounts(posts.map((post) => post.id));
      posts = sortForDiscovery(posts, postViewCounts, promoWindowDays, {
        includeBackgroundPremium: true,
        recentIds: feedMemory.posts,
        currentUserCountry: currentUser.country,
        noFollowingMode
      });
      const commentRows = await Comment.getByPostIds(posts.map((post) => post.id));
      const commentsByPostId = new Map();

      for (const comment of commentRows) {
        const postComments = commentsByPostId.get(comment.post_id) || [];
        postComments.push(comment);
        commentsByPostId.set(comment.post_id, postComments);
      }

      for (const post of posts) {
        post.comments = commentsByPostId.get(post.id) || [];
        if (post.challenge_type) {
          const participants = await Challenge.getParticipants(post.id);
          post.challenge_participants = participants;
        }
      }

      // Récupérer les shorts/reels
      let reels = await Reel.getAll(currentUserId);
      const reelViewCounts = await Reel.getTodayUniqueViewCounts(reels.map((reel) => reel.id));
      reels = sortForDiscovery(reels, reelViewCounts, promoWindowDays, {
        includeBackgroundPremium: false,
        recentIds: feedMemory.reels,
        currentUserCountry: currentUser.country,
        noFollowingMode
      });

      // Récupérer les contacts (tous les autres utilisateurs)
      const contacts = await User.getContactsWithFollowState(currentUserId);

      const followingShareTargets = await User.getFollowingForShare(currentUserId);
      const friendShareTargets = await User.getFriendsForShare(currentUserId);
      const dashboard = await Event.getDashboard(currentUserId);

      // Récupérer l'historique des messages récents
      const messages = await Message.getRecentForUser(currentUserId);
      const messageInbox = buildMessageInboxSections(currentUserId, contacts, messages);
      const statuses = await Status.getFeedStatuses(currentUserId);
      const activeAds = await Ad.getActiveAds();
      const birthdayCelebrants = await loadBirthdayCelebrantsForFeed(currentUserId);
      const marketData = await P2PMarket.getSnapshot(currentUserId);
      const marketCurrencyOptions = getSupportedCurrencyOptions();
      const marketDefaultCurrencyCode = getPreferredCurrencyForCountry(currentUser.country);
      const marketDefaultPaymentMethods = getDefaultPaymentMethodsForCountry(currentUser.country);

      const initiallyVisiblePostIds = posts
        .slice(0, initialFeedBatchSize)
        .map((post) => Number(post.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      const initiallyVisibleReelIds = reels
        .slice(0, initialShortBatchSize)
        .map((reel) => Number(reel.id))
        .filter((id) => Number.isFinite(id) && id > 0);

      updateFeedMemory(req.session, {
        visiblePostIds: initiallyVisiblePostIds,
        visibleReelIds: initiallyVisibleReelIds
      });

      // Récupérer les statistiques de l'utilisateur pour la sidebar
      const followersCount = await User.getFollowersCount(currentUserId);
      const postLikes = await Post.getTotalLikesForUser(currentUserId);
      const reelLikes = await Reel.getTotalLikesForUser(currentUserId);
      const totalLikesCount = Number(postLikes) + Number(reelLikes);

      await Promise.all([
        Post.recordDailyViews(initiallyVisiblePostIds, currentUserId),
        Reel.recordDailyViews(initiallyVisibleReelIds, currentUserId)
      ]);

      // Effectuer le rendu de index.ejs avec toutes les données
      res.render('index', {
        currentUser,
        currentUserId: Number(currentUserId),
        posts,
        reels,
        contacts,
        messages,
        messageInbox,
        statuses,
        activeAds,
        birthdayCelebrants,
        marketData,
        marketCurrencyOptions,
        marketDefaultCurrencyCode,
        marketDefaultPaymentMethods,
        initialFeedBatchSize,
        feedRevealBatchSize,
        initialShortBatchSize,
        shortRevealBatchSize,
        followersCount,
        followingCount,
        totalLikesCount,
        followingShareTargets,
        friendShareTargets,
        dashboard,
        statusStatus: req.query.success || null,
        statusError: req.query.error || null,
        activeTab: 'feed',
        activeView: req.query.view || 'feed'
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal server error while loading the feed.');
    }
  }

  static async getBirthdayCards(req, res) {
    try {
      const currentUserId = req.session.userId;
      const celebrants = await loadBirthdayCelebrantsForFeed(currentUserId);
      return res.json({
        success: true,
        celebrants,
        serverTime: new Date().toISOString()
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        error: 'Impossible de charger les anniversaires du jour.'
      });
    }
  }
}

module.exports = FeedController;
