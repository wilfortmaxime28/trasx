const db = require('../config/db');

const presenceMap = new Map();

const normalizeUserId = (userId) => Number.parseInt(userId, 10) || 0;

const getState = (userId) => {
  const id = normalizeUserId(userId);
  if (!id) return null;
  if (!presenceMap.has(id)) {
    presenceMap.set(id, { count: 0, lastSeenAt: null });
  }
  return presenceMap.get(id);
};

const formatRelativeTime = (dateLike) => {
  if (!dateLike) return 'Offline';
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return 'Offline';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Last seen just now';
  if (diffMinutes < 60) return `Last seen ${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Last seen ${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Last seen ${diffDays}d ago`;

  return `Last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};

const getPresenceText = (isOnline, lastSeenAt) => (isOnline ? 'Online now' : formatRelativeTime(lastSeenAt));

async function markUserOnline(userId) {
  const id = normalizeUserId(userId);
  if (!id) return { isOnline: false, lastSeenAt: null };

  const state = getState(id);
  state.count += 1;
  state.lastSeenAt = state.lastSeenAt || null;

  return {
    isOnline: true,
    lastSeenAt: state.lastSeenAt
  };
}

async function markUserOffline(userId) {
  const id = normalizeUserId(userId);
  if (!id) return { isOnline: false, lastSeenAt: null, changed: false };

  const state = getState(id);
  if (!state) return { isOnline: false, lastSeenAt: null, changed: false };

  state.count = Math.max(0, state.count - 1);
  if (state.count > 0) {
    return {
      isOnline: true,
      lastSeenAt: state.lastSeenAt,
      changed: false
    };
  }

  const lastSeenAt = new Date();
  state.lastSeenAt = lastSeenAt;

  await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [id]);

  return {
    isOnline: false,
    lastSeenAt,
    changed: true
  };
}

function isUserOnline(userId) {
  const id = normalizeUserId(userId);
  if (!id) return false;
  const state = presenceMap.get(id);
  return !!state && state.count > 0;
}

function getLastSeenAt(userId) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  const state = presenceMap.get(id);
  return state?.lastSeenAt || null;
}

module.exports = {
  markUserOnline,
  markUserOffline,
  isUserOnline,
  getLastSeenAt,
  getPresenceText,
  formatRelativeTime
};
