'use strict';

/**
 * services/fcmService.js
 * ──────────────────────
 * Firebase Admin SDK wrapper for sending FCM push notifications.
 *
 * Prerequisites:
 *   1. Install firebase-admin:  npm install firebase-admin
 *   2. Download your Firebase service account JSON from:
 *      Firebase Console → Project Settings → Service Accounts → Generate new private key
 *   3. Set in .env:
 *        FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/serviceAccountKey.json
 *        FIREBASE_PROJECT_ID=your-firebase-project-id
 */

const path = require('path');
const db   = require('../config/db');

let _initialized = false;
let _messaging = null;

/**
 * Lazy-initialize Firebase Admin SDK.
 * Safe to call multiple times — initialises only once.
 * Returns null and logs a warning if credentials are missing.
 */
function getAdmin() {
  if (_initialized) return { messaging: () => _messaging };

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const projectId          = process.env.FIREBASE_PROJECT_ID;

  if (!serviceAccountPath || !projectId) {
    console.warn(
      '[FCM] ⚠  FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID not set in .env — ' +
      'FCM push notifications are disabled.'
    );
    return null;
  }

  try {
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');

    if (!getApps().length) {
      // eslint-disable-next-line import/no-dynamic-require
      const serviceAccount = require(path.resolve(serviceAccountPath));
      initializeApp({
        credential: cert(serviceAccount),
        projectId,
      });
      console.log('[FCM] ✅ Firebase Admin SDK initialised for project:', projectId);
    }
    _messaging = getMessaging();
    _initialized = true;
    return { messaging: () => _messaging };
  } catch (err) {
    console.error('[FCM] ❌ Failed to initialise Firebase Admin SDK:', err.message);
    return null;
  }
}

/**
 * Ensure the fcm_tokens table exists.
 * Called once at server startup.
 */
let _tableReady = false;
async function ensureFcmTokensTable() {
  if (_tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS fcm_tokens (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT         NOT NULL,
      token       VARCHAR(512) NOT NULL,
      platform    VARCHAR(16) NOT NULL DEFAULT 'mobile',
      created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_token (user_id, token(255)),
      INDEX idx_user_id (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  _tableReady = true;
}

/**
 * Save (upsert) an FCM token for a user.
 * If the token already exists for another user, it is reassigned (device transfer).
 *
 * @param {number} userId
 * @param {string} token
 * @param {string} [platform='mobile']
 */
async function saveToken(userId, token, platform = 'mobile') {
  if (!token || !userId) return;
  await ensureFcmTokensTable();

  // Remove this token from any other user (device transfer / re-login)
  await db.query(
    'DELETE FROM fcm_tokens WHERE token = ? AND user_id != ?',
    [token, userId]
  ).catch(() => {});

  // Upsert
  await db.query(
    `INSERT INTO fcm_tokens (user_id, token, platform)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE platform = VALUES(platform), updated_at = NOW()`,
    [userId, token, platform]
  );

  console.log(`[FCM] Token saved for user ${userId} (${platform})`);
}

/**
 * Remove a specific FCM token (logout from one device).
 *
 * @param {number} userId
 * @param {string} token
 */
async function removeToken(userId, token) {
  if (!token || !userId) return;
  await db.query('DELETE FROM fcm_tokens WHERE user_id = ? AND token = ?', [userId, token]);
  console.log(`[FCM] Token removed for user ${userId}`);
}

/**
 * Remove all FCM tokens for a user (full logout / account deletion).
 *
 * @param {number} userId
 */
async function removeAllTokens(userId) {
  if (!userId) return;
  await db.query('DELETE FROM fcm_tokens WHERE user_id = ?', [userId]);
  console.log(`[FCM] All tokens removed for user ${userId}`);
}

/**
 * Build an FCM message object for a single token.
 *
 * @private
 */
function _buildMessage(token, { title, body, imageUrl, data = {}, url }) {
  return {
    token,
    notification: {
      title: String(title || 'TrasX'),
      body:  String(body  || ''),
      ...(imageUrl ? { imageUrl } : {}),
    },
    data: {
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      ...(url ? { url: String(url) } : {}),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
    android: {
      priority: 'high',
      notification: {
        channelId:    'trasx_notifications',
        priority:     'high',
        defaultSound: true,
        ...(imageUrl ? { imageUrl } : {}),
      },
    },
    apns: {
      payload: {
        aps: {
          sound:               'default',
          badge:               1,
          'content-available': 1,
        },
      },
      ...(imageUrl ? { fcmOptions: { imageUrl } } : {}),
    },
  };
}

/**
 * Send an FCM notification to a specific user.
 * Looks up all FCM tokens for the user and sends to each.
 * Automatically removes expired or invalid tokens.
 *
 * @param {object} opts
 * @param {number}  opts.userId      - Recipient user ID
 * @param {string}  opts.title       - Notification title
 * @param {string}  opts.body        - Notification body
 * @param {string}  [opts.imageUrl]  - Optional image URL
 * @param {string}  [opts.url]       - Deep-link URL to open on tap
 * @param {object}  [opts.data]      - Optional key/value data payload for the app
 * @returns {Promise<{sent: number, failed: number}>}
 */
async function sendToUser({ userId, title, body, imageUrl, url, data = {} }) {
  const admin = getAdmin();
  if (!admin) return { sent: 0, failed: 0 };
  if (!userId) return { sent: 0, failed: 0 };

  await ensureFcmTokensTable();

  const [rows] = await db.query(
    'SELECT token FROM fcm_tokens WHERE user_id = ? LIMIT 20',
    [userId]
  );

  if (!rows || rows.length === 0) return { sent: 0, failed: 0 };

  const tokens = rows.map((r) => r.token).filter(Boolean);
  let sent   = 0;
  let failed = 0;

  for (const token of tokens) {
    try {
      const message = _buildMessage(token, { title, body, imageUrl, url, data });
      await admin.messaging().send(message);
      sent++;
    } catch (err) {
      failed++;
      const errCode = String(err.code || err.errorInfo?.code || '');
      const isInvalid =
        errCode.includes('registration-token-not-registered') ||
        errCode.includes('invalid-registration-token') ||
        errCode.includes('invalid-argument');

      if (isInvalid) {
        db.query(
          'DELETE FROM fcm_tokens WHERE user_id = ? AND token = ?',
          [userId, token]
        ).catch(() => {});
        console.warn(`[FCM] Removed stale token for user ${userId}`);
      } else {
        console.error(`[FCM] Send error for user ${userId}:`, err.message);
      }
    }
  }

  if (sent > 0) {
    console.log(`[FCM] ✅ Sent ${sent}/${tokens.length} FCM notification(s) to user ${userId}`);
  }

  return { sent, failed };
}

/**
 * Send an FCM notification to multiple users concurrently.
 *
 * @param {number[]} userIds
 * @param {object}   payload  - Same opts as sendToUser (minus userId)
 */
async function sendToUsers(userIds, payload) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  await Promise.all(
    userIds.map((uid) => sendToUser({ userId: uid, ...payload }).catch(() => {}))
  );
}

module.exports = {
  ensureFcmTokensTable,
  saveToken,
  removeToken,
  removeAllTokens,
  sendToUser,
  sendToUsers,
};
