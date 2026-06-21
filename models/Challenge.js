const db = require('../config/db');

let challengeSchemaPromise = null;

const COUNTRY_CODE_ALIASES = {
  haiti: 'HT',
  'haiti (ayiti)': 'HT',
  'united states': 'US',
  usa: 'US',
  'united states of america': 'US',
  canada: 'CA',
  france: 'FR',
  brazil: 'BR',
  brasil: 'BR',
  mexico: 'MX',
  spain: 'ES',
  espana: 'ES',
  italy: 'IT',
  germany: 'DE',
  belgium: 'BE',
  portugal: 'PT',
  argentina: 'AR',
  chile: 'CL',
  colombia: 'CO',
  dominican: 'DO',
  'dominican republic': 'DO',
  jamaica: 'JM',
  cuba: 'CU'
};

function countryToFlagEmoji(country) {
  const raw = String(country || '').trim();
  if (!raw) return '';
  let code = raw.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    code = COUNTRY_CODE_ALIASES[raw.toLowerCase()] || '';
  }
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...code.split('').map((char) => 127397 + char.charCodeAt(0)));
}

async function ensureChallengeSchema() {
  if (!challengeSchemaPromise) {
    challengeSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS challenge_participants (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          user_id INT NOT NULL,
          invited_by_user_id INT DEFAULT NULL,
          status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'accepted',
          photo_url VARCHAR(255) DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          responded_at TIMESTAMP NULL DEFAULT NULL,
          UNIQUE KEY uniq_challenge_participant (post_id, user_id),
          INDEX idx_challenge_participants_post (post_id),
          INDEX idx_challenge_participants_user (user_id)
        )
      `);

      // Add photo_url column dynamically if table exists without it
      const [photoCols] = await db.query('SHOW COLUMNS FROM challenge_participants LIKE ?', ['photo_url']);
      if (!photoCols || photoCols.length === 0) {
        await db.query('ALTER TABLE challenge_participants ADD COLUMN photo_url VARCHAR(255) DEFAULT NULL AFTER status');
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS challenge_votes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          voter_user_id INT NOT NULL,
          participant_user_id INT NOT NULL,
          amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_challenge_votes_post (post_id),
          INDEX idx_challenge_votes_participant (participant_user_id)
        )
      `);

      await db.query('ALTER TABLE challenge_votes DROP INDEX uniq_challenge_vote').catch(() => {});
    })().catch((error) => {
      challengeSchemaPromise = null;
      throw error;
    });
  }

  return challengeSchemaPromise;
}

class Challenge {
  static async ensureSchema() {
    await ensureChallengeSchema();
  }

  static async addParticipant({ postId, userId, invitedByUserId = null, status = 'accepted', photoUrl = null, connection = db }) {
    await ensureChallengeSchema();
    await connection.query(
      `
        INSERT INTO challenge_participants (post_id, user_id, invited_by_user_id, status, photo_url, responded_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          invited_by_user_id = VALUES(invited_by_user_id),
          status = VALUES(status),
          photo_url = VALUES(photo_url),
          responded_at = VALUES(responded_at)
      `,
      [postId, userId, invitedByUserId, status, photoUrl, status === 'pending' ? null : new Date()]
    );
  }

  static async updateParticipantStatus({ postId, userId, status, photoUrl = null, connection = db }) {
    await ensureChallengeSchema();
    await connection.query(
      `
        UPDATE challenge_participants
        SET status = ?, photo_url = COALESCE(?, photo_url), responded_at = NOW()
        WHERE post_id = ? AND user_id = ?
      `,
      [status, photoUrl, postId, userId]
    );
  }

  static async getParticipants(postId, connection = db) {
    await ensureChallengeSchema();
    const [rows] = await connection.query(
      `
        SELECT
          cp.id,
          cp.post_id,
          cp.user_id,
          cp.invited_by_user_id,
          cp.status,
          cp.photo_url,
          cp.created_at,
          cp.responded_at,
          u.username,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar,
          u.country,
          COALESCE(v.vote_count, 0) AS vote_count,
          COALESCE(v.vote_amount_total, 0) AS vote_amount_total
        FROM challenge_participants cp
        JOIN users u ON u.id = cp.user_id
        LEFT JOIN (
          SELECT
            participant_user_id,
            post_id,
            COUNT(*) AS vote_count,
            SUM(amount) AS vote_amount_total
          FROM challenge_votes
          GROUP BY participant_user_id, post_id
        ) v ON v.participant_user_id = cp.user_id AND v.post_id = cp.post_id
        WHERE cp.post_id = ?
        ORDER BY cp.status = 'accepted' DESC, vote_count DESC, cp.created_at ASC
      `,
      [postId]
    );
    return rows.map((row) => ({
      ...row,
      country_flag: countryToFlagEmoji(row.country)
    }));
  }

  static async getAcceptedParticipants(postId, connection = db) {
    await ensureChallengeSchema();
    const [rows] = await connection.query(
      `
        SELECT cp.user_id
        FROM challenge_participants cp
        WHERE cp.post_id = ? AND cp.status = 'accepted'
      `,
      [postId]
    );
    return rows.map((row) => Number(row.user_id));
  }

  static async createVote({ postId, voterUserId, participantUserId, amount = 0, connection = db }) {
    await ensureChallengeSchema();
    const [result] = await connection.query(
      `
        INSERT INTO challenge_votes (post_id, voter_user_id, participant_user_id, amount)
        VALUES (?, ?, ?, ?)
      `,
      [postId, voterUserId, participantUserId, amount]
    );
    return result.insertId;
  }

  static async getVoteLeaderboard(postId, connection = db) {
    await ensureChallengeSchema();
    const [rows] = await connection.query(
      `
        SELECT
          cp.user_id,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.username,
          u.avatar,
          u.country,
          COUNT(cv.id) AS vote_count,
          COALESCE(SUM(cv.amount), 0) AS vote_amount_total
        FROM challenge_participants cp
        JOIN users u ON u.id = cp.user_id
        LEFT JOIN challenge_votes cv
          ON cv.post_id = cp.post_id
         AND cv.participant_user_id = cp.user_id
        WHERE cp.post_id = ? AND cp.status = 'accepted'
        GROUP BY cp.user_id, u.first_name, u.last_name, u.username, u.avatar
        ORDER BY vote_count DESC, vote_amount_total DESC, cp.created_at ASC
      `,
      [postId]
    );
    return rows.map((row) => ({
      ...row,
      country_flag: countryToFlagEmoji(row.country)
    }));
  }
}

module.exports = Challenge;
