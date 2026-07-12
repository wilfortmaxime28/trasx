const db = require('../config/db');
const { getNumberSetting } = require('../utils/appSettings');

let platformRevenueSchemaPromise = null;

async function ensurePlatformRevenueSchema() {
  if (!platformRevenueSchemaPromise) {
    platformRevenueSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS platform_revenue_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          entry_type VARCHAR(80) NOT NULL,
          payer_user_id INT NULL,
          reference_id VARCHAR(80) DEFAULT NULL,
          currency ENUM('USD', 'TOKEN') NOT NULL DEFAULT 'USD',
          amount_native DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
          amount_usd DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
          note VARCHAR(255) DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_platform_revenue_created (created_at),
          INDEX idx_platform_revenue_type (entry_type),
          INDEX idx_platform_revenue_payer (payer_user_id)
        )
      `);
    })().catch((error) => {
      platformRevenueSchemaPromise = null;
      throw error;
    });
  }

  return platformRevenueSchemaPromise;
}

class PlatformRevenue {
  static async ensureSchema() {
    await ensurePlatformRevenueSchema();
  }

  static async recordUsd({ amount, entryType, payerUserId = null, referenceId = null, note = null, connection = db }) {
    await ensurePlatformRevenueSchema();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return false;
    }

    await connection.query(
      `
        INSERT INTO platform_revenue_entries
          (entry_type, payer_user_id, reference_id, currency, amount_native, amount_usd, note)
        VALUES (?, ?, ?, 'USD', ?, ?, ?)
      `,
      [String(entryType || 'service'), payerUserId, referenceId, numericAmount, numericAmount, note ? String(note).trim() : null]
    );
    return true;
  }

  static async recordTokens({ amountTokens, entryType, payerUserId = null, referenceId = null, note = null, tokenPriceUsd = null, connection = db }) {
    await ensurePlatformRevenueSchema();
    const numericTokens = Number(amountTokens);
    if (!Number.isFinite(numericTokens) || numericTokens <= 0) {
      return false;
    }

    const resolvedTokenPriceUsd = Number.isFinite(Number(tokenPriceUsd))
      ? Number(tokenPriceUsd)
      : await getNumberSetting('token_price_usd', 0.1);

    const amountUsd = numericTokens * (Number.isFinite(resolvedTokenPriceUsd) && resolvedTokenPriceUsd > 0 ? resolvedTokenPriceUsd : 0);

    await connection.query(
      `
        INSERT INTO platform_revenue_entries
          (entry_type, payer_user_id, reference_id, currency, amount_native, amount_usd, note)
        VALUES (?, ?, ?, 'TOKEN', ?, ?, ?)
      `,
      [String(entryType || 'service'), payerUserId, referenceId, numericTokens, amountUsd, note ? String(note).trim() : null]
    );
    return true;
  }

  static async getSummary(connection = db) {
    await ensurePlatformRevenueSchema();
    const [rows] = await connection.query(
      `
        SELECT
          COALESCE(SUM(amount_usd), 0) AS total_usd_equivalent,
          COALESCE(SUM(CASE WHEN currency = 'USD' THEN amount_native ELSE 0 END), 0) AS total_usd_native,
          COALESCE(SUM(CASE WHEN currency = 'TOKEN' THEN amount_native ELSE 0 END), 0) AS total_tokens_native,
          COUNT(*) AS entries_count
        FROM platform_revenue_entries
      `
    );
    return rows[0] || {
      total_usd_equivalent: 0,
      total_usd_native: 0,
      total_tokens_native: 0,
      entries_count: 0
    };
  }

  static async getRecentEntries(limit = 20, connection = db) {
    await ensurePlatformRevenueSchema();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20;
    const [rows] = await connection.query(
      `
        SELECT
          e.*,
          u.username AS payer_username,
          CONCAT(u.first_name, ' ', u.last_name) AS payer_name
        FROM platform_revenue_entries e
        LEFT JOIN users u ON u.id = e.payer_user_id
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${safeLimit}
      `
    );
    return rows;
  }
}

module.exports = PlatformRevenue;
