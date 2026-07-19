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
  const wasOffline = state.count === 0;
  state.count += 1;
  state.lastSeenAt = new Date();

  // CRITICAL: update last_seen_at in DB on every new connection
  // This is what makes the fallback query work (last_seen_at >= NOW() - INTERVAL X MINUTE)
  db.query(
    'UPDATE users SET last_seen_at = NOW(), is_online = 1 WHERE id = ?',
    [id]
  ).catch(() => {
    // is_online column may not exist yet (migration pending), retry with just last_seen_at
    db.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [id]).catch(() => {});
  });

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

  db.query(
    'UPDATE users SET last_seen_at = NOW(), is_online = 0 WHERE id = ?',
    [id]
  ).catch(() => {
    db.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [id]).catch(() => {});
  });

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

function getOnlineUserIds() {
  const ids = [];
  for (const [id, state] of presenceMap.entries()) {
    if (state && state.count > 0) {
      ids.push(Number(id));
    }
  }
  return ids;
}

// Heartbeat: refresh last_seen_at in DB every 2 minutes for all connected users
// This keeps the fallback query working for long sessions
setInterval(() => {
  const onlineIds = getOnlineUserIds();
  if (onlineIds.length === 0) return;
  const placeholders = onlineIds.map(() => '?').join(', ');
  db.query(
    `UPDATE users SET last_seen_at = NOW() WHERE id IN (${placeholders})`,
    onlineIds
  ).catch(() => {});
}, 2 * 60 * 1000); // every 2 minutes

module.exports = {
  markUserOnline,
  markUserOffline,
  isUserOnline,
  getLastSeenAt,
  getOnlineUserIds,
  getPresenceText,
  formatRelativeTime
};
