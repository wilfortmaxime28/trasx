const db = require('../config/db');
const presence = require('../utils/presence');

let eventAccessSchemaPromise = null;

async function ensureEventAccessColumns() {
  if (!eventAccessSchemaPromise) {
    eventAccessSchemaPromise = (async () => {
      const [tableExists] = await db.query("SHOW TABLES LIKE 'users'");
      if (!tableExists || tableExists.length === 0) {
        console.log('Users table does not exist yet. Skipping user extra columns check.');
        eventAccessSchemaPromise = null;
        return;
      }

      const requiredColumns = [
        ['events_status', "ENUM('locked', 'active') DEFAULT 'locked'"],
        ['events_followers_threshold', 'INT DEFAULT 1000'],
        ['events_activated_at', 'TIMESTAMP NULL DEFAULT NULL'],
        ['promo_post_daily_base', 'INT DEFAULT 1000'],
        ['promo_reel_daily_base', 'INT DEFAULT 1000'],
        ['allow_dispute', 'TINYINT(1) DEFAULT 0'],
        ['token_balance', 'DECIMAL(15,4) DEFAULT 0.0000']
      ];

      for (const [columnName, columnDefinition] of requiredColumns) {
        const [rows] = await db.query(
          'SHOW COLUMNS FROM users LIKE ?',
          [columnName]
        );

        if (!rows || rows.length === 0) {
          await db.query(
            `ALTER TABLE users ADD COLUMN ${columnName} ${columnDefinition}`
          );
        }
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS disputes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL UNIQUE,
          status ENUM('pending', 'resolved') DEFAULT 'pending',
          message TEXT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    })().catch((error) => {
      eventAccessSchemaPromise = null;
      throw error;
    });
  }

  return eventAccessSchemaPromise;
}

class User {
  static async ensureSchema() {
    await ensureEventAccessColumns();
  }

  static async getById(id) {
    await ensureEventAccessColumns();
    const [rows] = await db.query(
      `SELECT *, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?`,
      [id]
    );
    return rows[0];
  }

  static async getByEmail(email) {
    await ensureEventAccessColumns();
    const [rows] = await db.query(
      `SELECT *, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE email = ?`,
      [email]
    );
    return rows[0];
  }

  static async getByUsername(username) {
    await ensureEventAccessColumns();
    const [rows] = await db.query(
      `SELECT *, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE username = ?`,
      [username]
    );
    return rows[0];
  }

  static async getByIdentifier(identifier) {
    await ensureEventAccessColumns();
    const [rows] = await db.query(
      `SELECT *, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE email = ? OR username = ? OR phone = ?`,
      [identifier, identifier, identifier]
    );
    return rows[0];
  }

  static async getAll() {
    await ensureEventAccessColumns();
    const [rows] = await db.query(`SELECT *, CONCAT(first_name, ' ', last_name) AS name FROM users`);
    return rows;
  }

  static async getTodaysBirthdayCelebrants(currentUserId, limit = 8) {
    await ensureEventAccessColumns();
    const safeLimit = Math.max(1, Math.min(24, Number(limit) || 8));
    const [rows] = await db.query(
      `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.country,
          u.dob,
          u.certification_type,
          TIMESTAMPDIFF(YEAR, u.dob, CURDATE()) AS age,
          CASE WHEN u.id = ? THEN 1 ELSE 0 END AS is_self
        FROM users u
        WHERE u.dob IS NOT NULL
          AND u.account_status = 'Active'
          AND DATE_FORMAT(u.dob, '%m-%d') = DATE_FORMAT(CURDATE(), '%m-%d')
        ORDER BY is_self ASC, u.first_name ASC, u.last_name ASC
        LIMIT ?
      `,
      [Number(currentUserId) || 0, safeLimit]
    );
    return rows.map((row) => ({
      ...row,
      age: Number(row.age || 0),
      is_self: Number(row.is_self) === 1
    }));
  }

  static async getUpcomingBirthdayCelebrants(currentUserId, limit = 1) {
    await ensureEventAccessColumns();
    const safeLimit = Math.max(1, Math.min(8, Number(limit) || 1));
    const [rows] = await db.query(
      `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.country,
          u.dob,
          u.certification_type,
          TIMESTAMPDIFF(YEAR, u.dob, CURDATE()) AS age,
          CASE WHEN u.id = ? THEN 1 ELSE 0 END AS is_self
        FROM users u
        WHERE u.dob IS NOT NULL
          AND u.account_status = 'Active'
        ORDER BY
          CASE
            WHEN DATE_FORMAT(u.dob, '%m-%d') >= DATE_FORMAT(CURDATE(), '%m-%d') THEN 0
            ELSE 1
          END ASC,
          DATE_FORMAT(u.dob, '%m-%d') ASC,
          u.first_name ASC,
          u.last_name ASC
        LIMIT ?
      `,
      [Number(currentUserId) || 0, safeLimit]
    );

    return rows.map((row) => ({
      ...row,
      age: Number(row.age || 0),
      is_self: Number(row.is_self) === 1
    }));
  }

  static async create(userData) {
    await ensureEventAccessColumns();
    const {
      username,
      email,
      password_hash,
      first_name,
      last_name,
      dob,
      phone,
      country,
      verification_code,
      promo_post_daily_base = 1000,
      promo_reel_daily_base = 1000
    } = userData;
    const [result] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, verification_code, promo_post_daily_base, promo_reel_daily_base) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, password_hash, first_name, last_name, dob, phone, country, verification_code, promo_post_daily_base, promo_reel_daily_base]
    );
    return result.insertId;
  }

  static async verifyEmail(id) {
    await db.query('UPDATE users SET is_verified = TRUE, verification_code = NULL WHERE id = ?', [id]);
  }

  static async setVerificationCode(id, code) {
    await db.query('UPDATE users SET verification_code = ? WHERE id = ?', [code, id]);
  }

  static async updatePassword(id, passwordHash) {
    await db.query(
      'UPDATE users SET password_hash = ?, verification_code = NULL WHERE id = ?',
      [passwordHash, id]
    );
  }

  static async updateStatus(id, status) {
    await db.query('UPDATE users SET account_status = ? WHERE id = ?', [status, id]);
  }

  static async updateCertification(id, certificationType) {
    const normalizedType = String(certificationType || 'None').trim() || 'None';
    if (normalizedType === 'None') {
      await db.query(
        'UPDATE users SET certification_type = ? WHERE id = ?',
        [normalizedType, id]
      );
      return;
    }

    await db.query(
      'UPDATE users SET certification_type = ?, is_verified = TRUE WHERE id = ?',
      [normalizedType, id]
    );
  }

  static async delete(id) {
    await db.query('DELETE FROM users WHERE id = ?', [id]);
  }

  static async updateAvatar(id, avatarUrl) {
    await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, id]);
  }

  static async updateProfile(id, data) {
    const { bio, phone, wallet_address, banner_color } = data;
    
    // We update conditionally based on what's passed, or just update all if we assume all are passed
    if (banner_color !== undefined) {
      await db.query(
        'UPDATE users SET bio = ?, phone = ?, wallet_address = ?, banner_color = ? WHERE id = ?',
        [bio, phone, wallet_address, banner_color, id]
      );
    } else {
      await db.query(
        'UPDATE users SET bio = ?, phone = ?, wallet_address = ? WHERE id = ?',
        [bio, phone, wallet_address, id]
      );
    }
  }

  static async updateLanguagePreference(id, locale) {
    const supportedLocales = ['en', 'fr', 'es'];
    const normalizedLocale = supportedLocales.includes(String(locale || '').toLowerCase()) ? String(locale || '').toLowerCase() : 'en';
    await db.query('UPDATE users SET preferred_language = ? WHERE id = ?', [normalizedLocale, id]);
    return normalizedLocale;
  }

  static async getFollowersCount(userId) {
    const [rows] = await db.query('SELECT COUNT(*) as count FROM follows WHERE following_id = ?', [userId]);
    return rows[0].count;
  }

  static async getFollowingCount(userId) {
    const [rows] = await db.query('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?', [userId]);
    return rows[0].count;
  }

  static async getFollowingIds(userId) {
    const [rows] = await db.query(
      'SELECT following_id FROM follows WHERE follower_id = ?',
      [userId]
    );
    return rows.map((row) => Number(row.following_id));
  }

  static async getContactsWithFollowState(userId) {
    const [rows] = await db.query(
      `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.certification_type,
          u.last_seen_at,
          EXISTS(
            SELECT 1
            FROM follows f
            WHERE f.follower_id = ? AND f.following_id = u.id
          ) AS is_following,
          EXISTS(
            SELECT 1
            FROM follows f
            WHERE f.follower_id = u.id AND f.following_id = ?
          ) AS is_followed_by
        FROM users u
        WHERE u.id <> ?
        ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [userId, userId, userId]
    );
    return rows.map((row) => ({
      ...row,
      is_following: Number(row.is_following) === 1,
      is_followed_by: Number(row.is_followed_by) === 1,
      is_mutual: Number(row.is_following) === 1 && Number(row.is_followed_by) === 1,
      is_online: presence.isUserOnline(row.id),
      presence_text: presence.getPresenceText(presence.isUserOnline(row.id), row.last_seen_at)
    }));
  }

  static async getFollowersIds(userId) {
    const [rows] = await db.query(
      'SELECT follower_id FROM follows WHERE following_id = ?',
      [userId]
    );
    return rows.map((row) => Number(row.follower_id));
  }

  static async updateLastSeen(id) {
    await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [id]);
  }

  static async toggleFollow(followerId, followingId) {
    if (Number(followerId) === Number(followingId)) {
      return {
        followed: false,
        isFollowing: false,
        changed: false
      };
    }

    const [existing] = await db.query(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
      [followerId, followingId]
    );

    let followed = false;

    if (existing.length > 0) {
      await db.query(
        'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
        [followerId, followingId]
      );
    } else {
      await db.query(
        'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)',
        [followerId, followingId]
      );
      followed = true;
    }

    const [followersRows] = await db.query(
      'SELECT COUNT(*) AS count FROM follows WHERE following_id = ?',
      [followingId]
    );
    const [followingRows] = await db.query(
      'SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?',
      [followerId]
    );

    const followersCount = Number(followersRows[0]?.count || 0);
    await this.maybeAutoActivatePremium(followingId, followersCount);
    await this.maybeAutoActivateEvents(followingId, followersCount);

    return {
      followed,
      isFollowing: followed,
      followersCount,
      followingCount: Number(followingRows[0]?.count || 0),
      changed: true
    };
  }

  static async updateEventAccessPreferences(userId, { followersThreshold }) {
    await ensureEventAccessColumns();
    const threshold = Number.isFinite(Number(followersThreshold)) ? Math.max(0, Number(followersThreshold)) : 1000;
    await db.query(
      `
        UPDATE users
        SET events_followers_threshold = ?
        WHERE id = ?
      `,
      [threshold || 1000, userId]
    );
    return { threshold: threshold || 1000 };
  }

  static async updateEventThresholdForUser(userId, followersThreshold) {
    await ensureEventAccessColumns();
    const threshold = Number.isFinite(Number(followersThreshold)) ? Math.max(0, Number(followersThreshold)) : 1000;
    await db.query(
      `
        UPDATE users
        SET events_followers_threshold = ?
        WHERE id = ?
      `,
      [threshold || 1000, userId]
    );
    return { threshold: threshold || 1000 };
  }

  static async updateEventThresholdForAllUsers(followersThreshold) {
    await ensureEventAccessColumns();
    const threshold = Number.isFinite(Number(followersThreshold)) ? Math.max(0, Number(followersThreshold)) : 1000;
    await db.query(
      `
        UPDATE users
        SET events_followers_threshold = ?
      `,
      [threshold || 1000]
    );
    return { threshold: threshold || 1000 };
  }

  static async updatePremiumPreferences(userId, { unlockMethod, followersThreshold }) {
    const method = ['auto_followers'].includes(unlockMethod) ? unlockMethod : 'auto_followers';
    const threshold = Number.isFinite(Number(followersThreshold)) ? Math.max(0, Number(followersThreshold)) : 1000;

    await db.query(
      `
        UPDATE users
        SET premium_unlock_method = ?, premium_followers_threshold = ?
        WHERE id = ?
      `,
      [method, threshold || 1000, userId]
    );

    return { method, threshold: threshold || 1000 };
  }

  static async activatePremium(userId, activationMethod = 'paid') {
    const method = activationMethod === 'paid' ? 'paid' : 'auto_followers';
    await db.query(
      `
        UPDATE users
        SET premium_status = 'active',
            premium_unlock_method = ?,
            premium_activated_at = COALESCE(premium_activated_at, NOW()),
            premium_paid_at = CASE WHEN ? = 'paid' THEN NOW() ELSE premium_paid_at END
        WHERE id = ?
      `,
      [method, method, userId]
    );
  }

  static async maybeAutoActivatePremium(userId, followersCount = null) {
    const [rows] = await db.query(
      `
        SELECT id, premium_status, premium_followers_threshold, account_status, is_verified, certification_type
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user || user.premium_status === 'active') {
      return { activated: false };
    }

    const threshold = Number(user.premium_followers_threshold || 0);
    const totalFollowers = Number.isFinite(Number(followersCount)) ? Number(followersCount) : await this.getFollowersCount(userId);
    const isAccountActive = String(user.account_status || '').toLowerCase() === 'active';
    const isVerified = Number(user.is_verified || 0) === 1;
    const hasCertification = String(user.certification_type || 'None') !== 'None';

    if (threshold > 0 && totalFollowers >= threshold && isAccountActive && isVerified && hasCertification) {
      await db.query(
        `
          UPDATE users
          SET premium_status = 'active',
              premium_activated_at = COALESCE(premium_activated_at, NOW())
          WHERE id = ?
        `,
        [userId]
      );
      return { activated: true };
    }

    return { activated: false };
  }

  static async getPremiumEligibility(userId, followersCount = null) {
    const [rows] = await db.query(
      `
        SELECT id, premium_status, premium_followers_threshold, account_status, is_verified, certification_type
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user) {
      return {
        canAutoActivate: false,
        needsKyc: false,
        thresholdReached: false,
        followersCount: Number.isFinite(Number(followersCount)) ? Number(followersCount) : 0,
        requiredFollowers: 0,
        reasons: ['Account not found.']
      };
    }

    const requiredFollowers = Number(user.premium_followers_threshold || 0);
    const currentFollowers = Number.isFinite(Number(followersCount))
      ? Number(followersCount)
      : await this.getFollowersCount(userId);
    const thresholdReached = requiredFollowers <= 0 ? true : currentFollowers >= requiredFollowers;
    const isAccountActive = String(user.account_status || '').toLowerCase() === 'active';
    const isVerified = Number(user.is_verified || 0) === 1;
    const hasCertification = String(user.certification_type || 'None') !== 'None';
    const canAutoActivate = thresholdReached && isAccountActive && isVerified && hasCertification && user.premium_status !== 'active';
    const needsKyc = thresholdReached && user.premium_status !== 'active' && (!isVerified || !hasCertification);

    const reasons = [];
    if (!isAccountActive) reasons.push('Your account must be active.');
    if (!isVerified) reasons.push('You must verify your email first.');
    if (!hasCertification) reasons.push('You must complete KYC certification.');
    if (!thresholdReached) reasons.push(`Reach ${requiredFollowers} followers to unlock premium.`);

    return {
      canAutoActivate,
      needsKyc,
      thresholdReached,
      followersCount: currentFollowers,
      requiredFollowers,
      isAccountActive,
      isVerified,
      hasCertification,
      reasons
    };
  }

  static async maybeAutoActivateEvents(userId, followersCount = null) {
    await ensureEventAccessColumns();
    const [rows] = await db.query(
      `
        SELECT id, events_status, events_followers_threshold, account_status, is_verified, certification_type
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user) {
      return { activated: false };
    }

    const threshold = Number(user.events_followers_threshold || 0);
    const totalFollowers = Number.isFinite(Number(followersCount)) ? Number(followersCount) : await this.getFollowersCount(userId);
    const isAccountActive = String(user.account_status || '').toLowerCase() === 'active';
    const isVerified = Number(user.is_verified || 0) === 1;
    const hasCertification = String(user.certification_type || 'None') !== 'None';
    const eventsActivated = String(user.events_status || 'locked') === 'active';

    const [eventsKycRows] = await db.query(
      `
        SELECT status, payment_status
        FROM kyc_requests
        WHERE user_id = ? AND request_type = 'events'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [userId]
    );
    const eventsKycApproved = String(eventsKycRows[0]?.status || '').toLowerCase() === 'approved'
      && String(eventsKycRows[0]?.payment_status || '').toLowerCase() === 'paid';

    if (eventsActivated && !hasCertification && eventsKycApproved && threshold > 0 && totalFollowers >= threshold && isAccountActive && isVerified) {
      await db.query(
        `
          UPDATE users
          SET certification_type = CASE
                WHEN certification_type IS NULL OR certification_type = '' OR certification_type = 'None' THEN 'Basique'
                ELSE certification_type
              END
          WHERE id = ?
        `,
        [userId]
      );
      return { activated: false, certified: true };
    }

    if (!eventsActivated && threshold > 0 && totalFollowers >= threshold && isAccountActive && isVerified && hasCertification) {
      await db.query(
        `
          UPDATE users
          SET events_status = 'active',
              events_activated_at = COALESCE(events_activated_at, NOW())
          WHERE id = ?
        `,
        [userId]
      );
      return { activated: true };
    }

    return { activated: false };
  }

  static async getEventCreationEligibility(userId, followersCount = null) {
    await ensureEventAccessColumns();
    const [rows] = await db.query(
      `
        SELECT id, account_status, is_verified, certification_type, events_status, events_followers_threshold
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user) {
      return {
        canCreateEvent: false,
        thresholdReached: false,
        followersCount: Number.isFinite(Number(followersCount)) ? Number(followersCount) : 0,
        requiredFollowers: 0,
        reasons: ['Account not found.']
      };
    }

    const requiredFollowers = Number(user.events_followers_threshold || 0);
    const currentFollowers = Number.isFinite(Number(followersCount))
      ? Number(followersCount)
      : await this.getFollowersCount(userId);
    const thresholdReached = requiredFollowers <= 0 ? true : currentFollowers >= requiredFollowers;
    const isAccountActive = String(user.account_status || '').toLowerCase() === 'active';
    const isVerified = Number(user.is_verified || 0) === 1;
    const hasCertification = String(user.certification_type || 'None') !== 'None';
    const eventsActivated = String(user.events_status || 'locked') === 'active';
    const kycUnlockedAccess = eventsActivated;

    const reasons = [];
    if (!isAccountActive) reasons.push('Your account must be active.');
    if (!kycUnlockedAccess) {
      if (!isVerified) reasons.push('You must verify your account first.');
      if (!hasCertification) reasons.push('You must have a certified profile.');
      if (!thresholdReached) reasons.push(`Reach ${requiredFollowers} followers or unlock event access to create an event.`);
    }

    return {
      canCreateEvent: isAccountActive && (kycUnlockedAccess || (isVerified && hasCertification && thresholdReached)),
      thresholdReached,
      followersCount: currentFollowers,
      requiredFollowers,
      isAccountActive,
      isVerified,
      hasCertification,
      eventsActivated,
      reasons
    };
  }

  static async search(query) {
    const searchQuery = `%${query}%`;
    const [rows] = await db.query(
      `SELECT id, username, first_name, last_name, CONCAT(first_name, ' ', last_name) AS name, avatar 
       FROM users 
       WHERE username LIKE ? OR first_name LIKE ? OR last_name LIKE ? 
       LIMIT 10`,
      [searchQuery, searchQuery, searchQuery]
    );
    return rows;
  }

  static async listForOpponentSearch(limit = 50) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const [rows] = await db.query(
      `SELECT id, username, first_name, last_name, CONCAT(first_name, ' ', last_name) AS name, avatar
       FROM users
       ORDER BY first_name ASC, last_name ASC
       LIMIT ${safeLimit}`
    );
    return rows;
  }

  static async getFollowingForShare(userId) {
    const [rows] = await db.query(
      `
      SELECT 
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.certification_type
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY u.first_name ASC, u.last_name ASC
        LIMIT 12
      `,
      [userId]
    );
    return rows;
  }

  static async getFriendsForShare(userId) {
    const [rows] = await db.query(
      `
      SELECT DISTINCT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.certification_type
        FROM follows f1
        INNER JOIN follows f2 ON f1.following_id = f2.follower_id
        INNER JOIN users u ON u.id = f1.following_id
        WHERE f1.follower_id = ? AND f2.following_id = ?
        ORDER BY u.first_name ASC, u.last_name ASC
        LIMIT 12
      `,
      [userId, userId]
    );
    return rows;
  }

  static async getFollowersForProfile(userId, viewerId) {
    const [rows] = await db.query(
      `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.certification_type,
          EXISTS(
            SELECT 1
            FROM follows f
            WHERE f.follower_id = ? AND f.following_id = u.id
          ) AS is_following,
          EXISTS(
            SELECT 1
            FROM follows f
            WHERE f.follower_id = u.id AND f.following_id = ?
          ) AS is_mutual
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ?
        ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [viewerId, userId, userId]
    );
    return rows.map((row) => ({
      ...row,
      is_following: Number(row.is_following) === 1,
      is_mutual: Number(row.is_mutual) === 1
    }));
  }

  static async getFollowingForProfile(userId, viewerId) {
    const [rows] = await db.query(
      `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.certification_type,
          EXISTS(
            SELECT 1
            FROM follows f
            WHERE f.follower_id = ? AND f.following_id = u.id
          ) AS is_following,
          EXISTS(
            SELECT 1
            FROM follows f
            WHERE f.follower_id = u.id AND f.following_id = ?
          ) AS is_mutual
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [viewerId, userId, userId]
    );
    return rows.map((row) => ({
      ...row,
      is_following: Number(row.is_following) === 1,
      is_mutual: Number(row.is_mutual) === 1
    }));
  }
}

module.exports = User;
