const db = require('../config/db');
const HiddenPost = require('./HiddenPost');
const Challenge = require('./Challenge');

let postSchemaPromise = null;
async function ensurePostSchema() {
  if (!postSchemaPromise) {
    postSchemaPromise = (async () => {
      const requiredColumns = [
        ['image_url_3', 'VARCHAR(255) DEFAULT NULL AFTER image_url_2'],
        ['image_url_4', 'VARCHAR(255) DEFAULT NULL AFTER image_url_3'],
        ['next_trade_payout_admin', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER last_possession_user_id'],
        ['promo_daily_target', 'INT NOT NULL DEFAULT 0 AFTER next_trade_payout_admin'],
        ['promo_paid_hashtag_count', 'INT NOT NULL DEFAULT 0 AFTER promo_daily_target'],
        ['promo_paid_background_price', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER promo_paid_hashtag_count'],
        ['challenge_type', 'VARCHAR(40) DEFAULT NULL AFTER promo_paid_background_price'],
        ['challenge_title', 'VARCHAR(255) DEFAULT NULL AFTER challenge_type'],
        ['challenge_entry_mode', "VARCHAR(30) DEFAULT NULL AFTER challenge_title"],
        ['challenge_vote_mode', "VARCHAR(20) DEFAULT NULL AFTER challenge_entry_mode"],
        ['challenge_vote_price', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER challenge_vote_mode'],
        ['challenge_invited_user_id', 'INT DEFAULT NULL AFTER challenge_vote_price'],
        ['challenge_creator_share_percent', 'INT NOT NULL DEFAULT 30 AFTER challenge_invited_user_id'],
        ['challenge_participant_share_percent', 'INT NOT NULL DEFAULT 70 AFTER challenge_creator_share_percent'],
        ['challenge_end_date', 'DATETIME DEFAULT NULL AFTER challenge_participant_share_percent'],
        ['is_live', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER challenge_end_date'],
        ['live_url', 'VARCHAR(255) DEFAULT NULL AFTER is_live'],
        ['live_price', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER live_url'],
        ['live_status', "VARCHAR(20) NOT NULL DEFAULT 'active' AFTER live_price"]
      ];

      const [tableExists] = await db.query("SHOW TABLES LIKE 'posts'");
      if (!tableExists || tableExists.length === 0) {
        console.log('Posts table does not exist yet. Skipping post schema check.');
        postSchemaPromise = null;
        return;
      }

      for (const [columnName, columnDefinition] of requiredColumns) {
        const [rows] = await db.query('SHOW COLUMNS FROM posts LIKE ?', [columnName]);
        if (!rows || rows.length === 0) {
          await db.query(`ALTER TABLE posts ADD COLUMN ${columnName} ${columnDefinition}`);
        }
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS post_daily_unique_views (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          viewer_user_id INT NOT NULL,
          view_date DATE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_post_viewer_day (post_id, viewer_user_id, view_date),
          INDEX idx_post_daily_views_date (view_date),
          INDEX idx_post_daily_views_post (post_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS live_unlocks (
          user_id INT NOT NULL,
          post_id INT NOT NULL,
          unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, post_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        )
      `);
      await Challenge.ensureSchema();
    })().catch((error) => {
      postSchemaPromise = null;
      throw error;
    });
  }
  return postSchemaPromise;
}

class Post {
  static async ensureSchema() {
    await ensurePostSchema();
  }

  static async getAll(currentUserId) {
    await ensurePostSchema();
    await HiddenPost.ensureSchema();
    const query = `
      SELECT 
        p.id,
        p.user_id,
        p.content,
        p.image_url,
        p.image_url_2,
        p.image_url_3,
        p.image_url_4,
        p.media_type,
        p.bg_image_url,
        p.text_color,
        p.text_alignment,
        p.text_position,
        p.text_font,
        p.text_size,
        p.is_trade,
        p.trade_price,
        p.last_possession_user_id,
        p.next_trade_payout_admin,
        p.promo_daily_target,
        p.promo_paid_hashtag_count,
        p.promo_paid_background_price,
        p.challenge_type,
        p.challenge_title,
        p.challenge_entry_mode,
        p.challenge_vote_mode,
        p.challenge_vote_price,
        p.challenge_invited_user_id,
        p.challenge_creator_share_percent,
        p.challenge_participant_share_percent,
        p.challenge_end_date,
        p.created_at,
        p.thumbnail_url,
        p.allow_download,
        p.is_live,
        p.live_url,
        p.live_price,
        p.live_status,
        (
          SELECT COUNT(*)
          FROM post_shares ps
          WHERE ps.post_id = p.id AND ps.clicked_at IS NOT NULL
        ) AS shares_count,
        CONCAT(u.first_name, ' ', u.last_name) AS author_name,
        u.avatar AS author_avatar,
        u.username AS author_username,
        u.country AS author_country,
        u.certification_type AS author_certification_type,
        u.created_at AS author_created_at,
        (
          SELECT COUNT(*)
          FROM follows f2
          WHERE f2.following_id = p.user_id
        ) AS author_followers_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) AS is_liked,
        (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id AND user_id = ?) AS is_bookmarked,
        (SELECT COUNT(*) FROM live_unlocks WHERE post_id = p.id AND user_id = ?) AS is_live_unlocked,
        EXISTS(
          SELECT 1
          FROM follows f
          WHERE f.follower_id = ? AND f.following_id = p.user_id
        ) AS is_author_following
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE NOT EXISTS (
        SELECT 1
        FROM hidden_posts hp
        WHERE hp.user_id = ? AND hp.post_id = p.id
      ) AND (p.is_live = 0 OR p.live_status != 'ended')
      ORDER BY p.created_at DESC
    `;
    const [rows] = await db.query(query, [currentUserId, currentUserId, currentUserId, currentUserId, currentUserId]);
    // Convert status to boolean
    return rows.map(r => ({
      ...r,
      is_liked: !!r.is_liked,
      is_bookmarked: !!r.is_bookmarked
    }));
  }
  /**
   * getFeedPaginated — Paginated feed with SQL-side scoring.
   * Replaces JS sortForDiscovery(). Scoring: following > country > premium > popularity > random > recency.
   * Uses pre-aggregated JOINs (6x faster than correlated subqueries).
   */
  static async getFeedPaginated(currentUserId, {
    offset = 0,
    limit = 20,
    userCountry = '',
    feedSeed = 1,
    excludedIds = []
  } = {}) {
    await ensurePostSchema();
    await HiddenPost.ensureSchema();

    const safeLimit  = Math.min(Math.max(1, Number(limit)  || 20), 50);
    const safeOffset = Math.min(Math.max(0, Number(offset) || 0),  300);
    const safeSeed   = Math.abs(Number(feedSeed) || 1);
    const country    = String(userCountry || '').trim().toLowerCase();

    const safeExcluded = Array.isArray(excludedIds)
      ? excludedIds.map(Number).filter(n => Number.isFinite(n) && n > 0).slice(0, 150)
      : [];
    const excludedClause = safeExcluded.length
      ? `AND p.id NOT IN (${safeExcluded.join(',')})`
      : '';

    const query = `
      SELECT
        p.id, p.user_id, p.content,
        p.image_url, p.image_url_2, p.image_url_3, p.image_url_4,
        p.media_type, p.bg_image_url, p.text_color, p.text_alignment,
        p.text_position, p.text_font, p.text_size,
        p.is_trade, p.trade_price, p.last_possession_user_id, p.next_trade_payout_admin,
        p.promo_daily_target, p.promo_paid_hashtag_count, p.promo_paid_background_price,
        p.challenge_type, p.challenge_title, p.challenge_entry_mode,
        p.challenge_vote_mode, p.challenge_vote_price, p.challenge_invited_user_id,
        p.challenge_creator_share_percent, p.challenge_participant_share_percent, p.challenge_end_date,
        p.created_at, p.thumbnail_url, p.allow_download,
        p.is_live, p.live_url, p.live_price, p.live_status,
        CONCAT(u.first_name, ' ', u.last_name) AS author_name,
        u.avatar       AS author_avatar,
        u.username     AS author_username,
        u.country      AS author_country,
        u.certification_type AS author_certification_type,
        u.created_at   AS author_created_at,
        COALESCE(lc.likes_count, 0)     AS likes_count,
        COALESCE(cc.comments_count, 0)  AS comments_count,
        COALESCE(fc.followers_count, 0) AS author_followers_count,
        COALESCE(sc.shares_count, 0)    AS shares_count,
        (ul.user_id IS NOT NULL)        AS is_liked,
        (ub.user_id IS NOT NULL)        AS is_bookmarked,
        (lu.user_id IS NOT NULL)        AS is_live_unlocked,
        (fw.follower_id IS NOT NULL)    AS is_author_following,
        CASE WHEN fw.follower_id IS NOT NULL THEN 1 ELSE 0 END AS _s_follow,
        CASE WHEN LOWER(u.country) = ? THEN 1 ELSE 0 END       AS _s_country,
        (p.promo_paid_hashtag_count * 140 + p.promo_paid_background_price * 40) AS _s_premium,
        LEAST(COALESCE(fc.followers_count, 0), 5000)           AS _s_popular,
        (CRC32(CONCAT(p.id, '-', ?)) % 10000) / 10.0           AS _s_random
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (SELECT post_id, COUNT(*) AS likes_count    FROM likes     GROUP BY post_id) lc ON lc.post_id = p.id
      LEFT JOIN (SELECT post_id, COUNT(*) AS comments_count FROM comments  GROUP BY post_id) cc ON cc.post_id = p.id
      LEFT JOIN (SELECT following_id, COUNT(*) AS followers_count FROM follows GROUP BY following_id) fc ON fc.following_id = p.user_id
      LEFT JOIN (SELECT post_id, COUNT(*) AS shares_count   FROM post_shares WHERE clicked_at IS NOT NULL GROUP BY post_id) sc ON sc.post_id = p.id
      LEFT JOIN likes        ul ON ul.post_id     = p.id AND ul.user_id      = ?
      LEFT JOIN bookmarks    ub ON ub.post_id     = p.id AND ub.user_id      = ?
      LEFT JOIN live_unlocks lu ON lu.post_id     = p.id AND lu.user_id      = ?
      LEFT JOIN follows      fw ON fw.follower_id = ?     AND fw.following_id = p.user_id
      WHERE NOT EXISTS (
        SELECT 1 FROM hidden_posts hp WHERE hp.user_id = ? AND hp.post_id = p.id
      )
      AND (p.is_live = 0 OR p.live_status != 'ended')
      ${excludedClause}
      ORDER BY _s_follow DESC, _s_country DESC, _s_premium DESC, _s_popular DESC, _s_random DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const params = [
      country, safeSeed,
      currentUserId, currentUserId, currentUserId, currentUserId,
      currentUserId,
      safeLimit, safeOffset
    ];

    const [rows] = await db.query(query, params);
    const hasMore = rows.length === safeLimit;

    return {
      posts: rows.map(({ _s_follow, _s_country, _s_premium, _s_popular, _s_random, ...r }) => ({
        ...r,
        is_liked:            !!r.is_liked,
        is_bookmarked:       !!r.is_bookmarked,
        is_live_unlocked:    !!r.is_live_unlocked,
        is_author_following: !!r.is_author_following
      })),
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null
    };
  }



  static async create(userId, content, imageUrl = null, bgImageUrl = null, textColor = null, textAlignment = null, textPosition = null, textFont = null, textSize = null, isTrade = 0, tradePrice = null, lastPossessionUserId = null, mediaType = null, thumbnailUrl = null, allowDownload = 1, imageUrl2 = null, imageUrl3 = null, imageUrl4 = null, promoDailyTarget = 0, promoPaidHashtagCount = 0, promoPaidBackgroundPrice = 0, challengeConfig = null, isLive = 0, liveUrl = null, livePrice = 0.00) {
    await ensurePostSchema();
    const normalizedChallenge = challengeConfig && challengeConfig.type ? challengeConfig : null;
    
    let finalEndDate = null;
    const rawEndDate = normalizedChallenge?.challengeEndDate || normalizedChallenge?.endDate || normalizedChallenge?.challenge_end_date || null;
    if (rawEndDate) {
      const parsedEnd = new Date(rawEndDate);
      if (!isNaN(parsedEnd.getTime())) {
        finalEndDate = parsedEnd;
      }
    }

    const [result] = await db.query(
      `INSERT INTO posts
        (user_id, content, image_url, bg_image_url, text_color, text_alignment, text_position, text_font, text_size, is_trade, trade_price, last_possession_user_id, media_type, thumbnail_url, allow_download, image_url_2, image_url_3, image_url_4, promo_daily_target, promo_paid_hashtag_count, promo_paid_background_price, challenge_type, challenge_title, challenge_entry_mode, challenge_vote_mode, challenge_vote_price, challenge_invited_user_id, challenge_creator_share_percent, challenge_participant_share_percent, challenge_end_date, is_live, live_url, live_price, live_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, content, imageUrl, bgImageUrl, textColor, textAlignment, textPosition, textFont, textSize, isTrade, tradePrice, lastPossessionUserId, mediaType, thumbnailUrl, allowDownload, imageUrl2, imageUrl3, imageUrl4, promoDailyTarget, promoPaidHashtagCount, promoPaidBackgroundPrice, normalizedChallenge?.type || null, normalizedChallenge?.title || null, normalizedChallenge?.entryMode || null, normalizedChallenge?.voteMode || null, Number(normalizedChallenge?.votePrice || 0), normalizedChallenge?.invitedUserId || null, Number(normalizedChallenge?.creatorSharePercent || 30), Number(normalizedChallenge?.participantSharePercent || 70), finalEndDate, isLive, liveUrl, livePrice, 'active']
    );
    return result.insertId;
  }

  static async getTodayUniqueViewCounts(postIds) {
    await ensurePostSchema();
    const ids = Array.isArray(postIds) ? postIds.map((id) => Number(id)).filter(Number.isFinite) : [];
    if (ids.length === 0) {
      return new Map();
    }

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await db.query(
      `
        SELECT post_id, COUNT(*) AS views_count
        FROM post_daily_unique_views
        WHERE view_date = CURDATE() AND post_id IN (${placeholders})
        GROUP BY post_id
      `,
      ids
    );

    return new Map(rows.map((row) => [Number(row.post_id), Number(row.views_count || 0)]));
  }

  static async recordDailyViews(postIds, viewerUserId) {
    await ensurePostSchema();
    const ids = Array.isArray(postIds) ? postIds.map((id) => Number(id)).filter(Number.isFinite) : [];
    const numericViewerUserId = Number(viewerUserId);
    if (ids.length === 0 || !Number.isFinite(numericViewerUserId)) {
      return;
    }

    const values = ids.map(() => '(?, ?, CURDATE())').join(', ');
    const params = [];
    ids.forEach((postId) => {
      params.push(postId, numericViewerUserId);
    });

    await db.query(
      `
        INSERT IGNORE INTO post_daily_unique_views (post_id, viewer_user_id, view_date)
        VALUES ${values}
      `,
      params
    );
  }

  static async getById(postId, currentUserId) {
    await ensurePostSchema();
    const query = `
      SELECT 
        p.id,
        p.user_id,
        p.content,
        p.image_url,
        p.image_url_2,
        p.image_url_3,
        p.image_url_4,
        p.media_type,
        p.bg_image_url,
        p.text_color,
        p.text_alignment,
        p.text_position,
        p.text_font,
        p.text_size,
        p.is_trade,
        p.trade_price,
        p.last_possession_user_id,
        p.next_trade_payout_admin,
        p.challenge_type,
        p.challenge_title,
        p.challenge_entry_mode,
        p.challenge_vote_mode,
        p.challenge_vote_price,
        p.challenge_invited_user_id,
        p.challenge_creator_share_percent,
        p.challenge_participant_share_percent,
        p.challenge_end_date,
        p.created_at,
        p.thumbnail_url,
        p.allow_download,
        p.is_live,
        p.live_url,
        p.live_price,
        p.live_status,
        (
          SELECT COUNT(*)
          FROM post_shares ps
          WHERE ps.post_id = p.id AND ps.clicked_at IS NOT NULL
        ) AS shares_count,
        CONCAT(u.first_name, ' ', u.last_name) AS author_name,
        u.avatar AS author_avatar,
        u.username AS author_username,
        u.certification_type AS author_certification_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) AS is_liked,
        (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id AND user_id = ?) AS is_bookmarked,
        (SELECT COUNT(*) FROM live_unlocks WHERE post_id = p.id AND user_id = ?) AS is_live_unlocked,
        EXISTS(
          SELECT 1
          FROM follows f
          WHERE f.follower_id = ? AND f.following_id = p.user_id
        ) AS is_author_following
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `;
    const [rows] = await db.query(query, [currentUserId, currentUserId, currentUserId, currentUserId, postId]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ...r,
      is_liked: !!r.is_liked,
      is_bookmarked: !!r.is_bookmarked
    };
  }

  static async getByIdForAdmin(postId) {
    await ensurePostSchema();
    const [rows] = await db.query(
      `
        SELECT
          p.id,
          p.user_id,
          p.content,
          p.image_url,
          p.image_url_2,
          p.image_url_3,
          p.image_url_4,
          p.media_type,
          p.bg_image_url,
          p.text_color,
          p.text_alignment,
          p.text_position,
          p.text_font,
          p.text_size,
          p.is_trade,
          p.trade_price,
          p.last_possession_user_id,
          p.next_trade_payout_admin,
          p.challenge_type,
          p.challenge_title,
          p.challenge_entry_mode,
          p.challenge_vote_mode,
          p.challenge_vote_price,
          p.challenge_invited_user_id,
          p.challenge_creator_share_percent,
          p.challenge_participant_share_percent,
          p.challenge_end_date,
          p.created_at,
          p.thumbnail_url,
          p.allow_download,
          p.is_live,
          p.live_url,
          p.live_price,
          p.live_status,
          CONCAT(u.first_name, ' ', u.last_name) AS author_name,
          u.avatar AS author_avatar,
          u.username AS author_username,
          u.certification_type AS author_certification_type,
          (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes_count,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count
        FROM posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.id = ?
        LIMIT 1
      `,
      [postId]
    );
    return rows[0] || null;
  }

  static async toggleLike(userId, postId) {
    const [existing] = await db.query('SELECT * FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
    let liked = false;
    if (existing.length > 0) {
      await db.query('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
    } else {
      await db.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId]);
      liked = true;
    }
    const [countRow] = await db.query('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?', [postId]);
    return { liked, count: countRow[0].count };
  }

  static async toggleBookmark(userId, postId) {
    const [existing] = await db.query('SELECT * FROM bookmarks WHERE user_id = ? AND post_id = ?', [userId, postId]);
    let bookmarked = false;
    if (existing.length > 0) {
      await db.query('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?', [userId, postId]);
    } else {
      await db.query('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)', [userId, postId]);
      bookmarked = true;
    }
    return { bookmarked };
  }

  static async getByUserId(userId, viewerId = null) {
    await ensurePostSchema();
    const checkViewerId = viewerId || userId;
    const query = `
      SELECT 
        p.id,
        p.user_id,
        p.content,
        p.image_url,
        p.image_url_2,
        p.image_url_3,
        p.image_url_4,
        p.media_type,
        p.bg_image_url,
        p.text_color,
        p.text_alignment,
        p.text_position,
        p.text_font,
        p.text_size,
        p.is_trade,
        p.trade_price,
        p.last_possession_user_id,
        p.next_trade_payout_admin,
        p.challenge_type,
        p.challenge_title,
        p.challenge_entry_mode,
        p.challenge_vote_mode,
        p.challenge_vote_price,
        p.challenge_invited_user_id,
        p.challenge_creator_share_percent,
        p.challenge_participant_share_percent,
        p.challenge_end_date,
        p.created_at,
        p.thumbnail_url,
        p.allow_download,
        p.is_live,
        p.live_url,
        p.live_price,
        p.live_status,
        (
          SELECT COUNT(*)
          FROM post_shares ps
          WHERE ps.post_id = p.id AND ps.clicked_at IS NOT NULL
        ) AS shares_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) AS is_liked,
        (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id AND user_id = ?) AS is_bookmarked,
        (SELECT COUNT(*) FROM live_unlocks WHERE post_id = p.id AND user_id = ?) AS is_live_unlocked,
        EXISTS(
          SELECT 1
          FROM follows f
          WHERE f.follower_id = ? AND f.following_id = p.user_id
        ) AS is_author_following
      FROM posts p
      WHERE p.user_id = ?
        AND (p.is_live = 0 OR p.live_status != 'ended')
      ORDER BY p.created_at DESC
    `;
    const [rows] = await db.query(query, [checkViewerId, checkViewerId, checkViewerId, checkViewerId, userId]);
    return rows;
  }

  static async getAllForAdmin(limit = null) {
    await ensurePostSchema();
    const baseQuery = `
      SELECT
        p.id,
        p.user_id,
        p.content,
        p.image_url,
        p.image_url_2,
        p.image_url_3,
        p.image_url_4,
        p.media_type,
        p.bg_image_url,
        p.text_color,
        p.text_alignment,
        p.text_position,
        p.text_font,
        p.text_size,
        p.is_trade,
        p.trade_price,
        p.last_possession_user_id,
        p.next_trade_payout_admin,
        p.challenge_type,
        p.challenge_title,
        p.challenge_entry_mode,
        p.challenge_vote_mode,
        p.challenge_vote_price,
        p.challenge_invited_user_id,
        p.challenge_creator_share_percent,
        p.challenge_participant_share_percent,
        p.challenge_end_date,
        p.created_at,
        p.thumbnail_url,
        p.allow_download,
        p.is_live,
        p.live_url,
        p.live_price,
        p.live_status,
        CONCAT(u.first_name, ' ', u.last_name) AS author_name,
        u.avatar AS author_avatar,
        u.username AS author_username,
        u.certification_type AS author_certification_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
        (
          SELECT COUNT(*)
          FROM post_shares ps
          WHERE ps.post_id = p.id AND ps.clicked_at IS NOT NULL
        ) AS shares_count
      FROM posts p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
    `;

    if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
      const [limitedRows] = await db.query(`${baseQuery} LIMIT ?`, [Number(limit)]);
      return limitedRows;
    }

    const [rows] = await db.query(baseQuery);
    return rows;
  }

  static async getTotalLikesForUser(userId) {
    const query = `
      SELECT COUNT(*) as count 
      FROM likes l 
      JOIN posts p ON l.post_id = p.id 
      WHERE p.user_id = ?
    `;
    const [rows] = await db.query(query, [userId]);
    return rows[0].count;
  }

  static async delete(postId, userId) {
    await db.query('DELETE FROM posts WHERE id = ? AND user_id = ?', [postId, userId]);
  }

  static async deleteByAdmin(postId) {
    await db.query('DELETE FROM posts WHERE id = ?', [postId]);
  }
}

module.exports = Post;
