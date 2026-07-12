const db = require('../config/db');
const { normalizeDateToIso } = require('../utils/dateUtils');

let kycSchemaPromise = null;

async function ensureKycRequestTable() {
  if (!kycSchemaPromise) {
    kycSchemaPromise = (async () => {
      const [tableExists] = await db.query("SHOW TABLES LIKE 'users'");
      if (!tableExists || tableExists.length === 0) {
        console.log("[KycRequest] users table does not exist yet. Skipping kyc_requests table check.");
        kycSchemaPromise = null;
        return;
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS kyc_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          request_type ENUM('premium', 'events', 'withdrawal') NOT NULL DEFAULT 'premium',
          status ENUM('draft', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
          payment_status ENUM('none', 'paid') NOT NULL DEFAULT 'none',
          payment_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          payment_non_refundable TINYINT(1) NOT NULL DEFAULT 0,
          request_note TEXT DEFAULT NULL,
          document_url VARCHAR(255) DEFAULT NULL,
          document_name VARCHAR(255) DEFAULT NULL,
          document_type VARCHAR(100) DEFAULT NULL,
          document_size INT DEFAULT NULL,
          selfie_url VARCHAR(255) DEFAULT NULL,
          selfie_name VARCHAR(255) DEFAULT NULL,
          selfie_type VARCHAR(100) DEFAULT NULL,
          selfie_size INT DEFAULT NULL,
          submitted_full_name VARCHAR(160) DEFAULT NULL,
          submitted_username VARCHAR(80) DEFAULT NULL,
          submitted_email VARCHAR(150) DEFAULT NULL,
          submitted_country VARCHAR(100) DEFAULT NULL,
          submitted_dob DATE DEFAULT NULL,
          verification_score INT DEFAULT NULL,
          face_match_score INT DEFAULT NULL,
          verification_notes TEXT DEFAULT NULL,
          ai_provider VARCHAR(50) DEFAULT NULL,
          ai_model VARCHAR(80) DEFAULT NULL,
          ocr_text_excerpt TEXT DEFAULT NULL,
          ocr_detected_dates LONGTEXT DEFAULT NULL,
          ocr_selected_dob VARCHAR(20) DEFAULT NULL,
          ocr_selected_dob_reason VARCHAR(160) DEFAULT NULL,
          verified_by_ai TINYINT(1) NOT NULL DEFAULT 0,
          reviewed_by_admin_id INT DEFAULT NULL,
          reviewed_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_kyc_requests_type_status (request_type, status),
          INDEX idx_kyc_requests_status (status),
          INDEX idx_kyc_requests_created_at (created_at),
          UNIQUE KEY uniq_kyc_user_type (user_id, request_type)
        )
      `);

      const requiredColumns = [
        ['request_type', "ENUM('premium', 'events', 'withdrawal') NOT NULL DEFAULT 'premium'"],
        ['status', "ENUM('draft', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'draft'"],
        ['payment_status', "ENUM('none', 'paid') NOT NULL DEFAULT 'none'"],
        ['payment_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
        ['payment_non_refundable', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['request_note', 'TEXT DEFAULT NULL'],
        ['document_url', 'VARCHAR(255) DEFAULT NULL'],
        ['document_name', 'VARCHAR(255) DEFAULT NULL'],
        ['document_type', 'VARCHAR(100) DEFAULT NULL'],
        ['document_size', 'INT DEFAULT NULL'],
        ['selfie_url', 'VARCHAR(255) DEFAULT NULL'],
        ['selfie_name', 'VARCHAR(255) DEFAULT NULL'],
        ['selfie_type', 'VARCHAR(100) DEFAULT NULL'],
        ['selfie_size', 'INT DEFAULT NULL'],
        ['submitted_full_name', 'VARCHAR(160) DEFAULT NULL'],
        ['submitted_username', 'VARCHAR(80) DEFAULT NULL'],
        ['submitted_email', 'VARCHAR(150) DEFAULT NULL'],
        ['submitted_country', 'VARCHAR(100) DEFAULT NULL'],
        ['submitted_dob', 'DATE DEFAULT NULL'],
        ['verification_score', 'INT DEFAULT NULL'],
        ['face_match_score', 'INT DEFAULT NULL'],
        ['verification_notes', 'TEXT DEFAULT NULL'],
        ['ai_provider', 'VARCHAR(50) DEFAULT NULL'],
        ['ai_model', 'VARCHAR(80) DEFAULT NULL'],
        ['ocr_text_excerpt', 'TEXT DEFAULT NULL'],
        ['ocr_detected_dates', 'LONGTEXT DEFAULT NULL'],
        ['ocr_selected_dob', 'VARCHAR(20) DEFAULT NULL'],
        ['ocr_selected_dob_reason', 'VARCHAR(160) DEFAULT NULL'],
        ['verified_by_ai', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['reviewed_by_admin_id', 'INT DEFAULT NULL'],
        ['reviewed_at', 'TIMESTAMP NULL DEFAULT NULL'],
        ['updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']
      ];

      for (const [columnName, columnDefinition] of requiredColumns) {
        const [rows] = await db.query('SHOW COLUMNS FROM kyc_requests LIKE ?', [columnName]);
        if (!rows || rows.length === 0) {
          await db.query(`ALTER TABLE kyc_requests ADD COLUMN ${columnName} ${columnDefinition}`);
        }
      }

      const [statusRows] = await db.query('SHOW COLUMNS FROM kyc_requests LIKE "status"');
      const statusType = String(statusRows[0]?.Type || '');
      if (!statusType.includes('draft')) {
        await db.query(
          `ALTER TABLE kyc_requests MODIFY COLUMN status ENUM('draft', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'draft'`
        );
      }

      const [typeRows] = await db.query('SHOW COLUMNS FROM kyc_requests LIKE "request_type"');
      const typeDefinition = String(typeRows[0]?.Type || '');
      if (!typeDefinition.includes('withdrawal')) {
        await db.query(
          `ALTER TABLE kyc_requests MODIFY COLUMN request_type ENUM('premium', 'events', 'withdrawal') NOT NULL DEFAULT 'premium'`
        );
      }
    })().catch((error) => {
      kycSchemaPromise = null;
      throw error;
    });
  }

  return kycSchemaPromise;
}

class KycRequest {
  static async getByUserId(userId) {
    return this.getByUserIdAndType(userId, 'premium');
  }

  static async getByUserIdAndType(userId, requestType = 'premium') {
    await ensureKycRequestTable();
    const [rows] = await db.query(
      `
        SELECT *
        FROM kyc_requests
        WHERE user_id = ? AND request_type = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [userId, requestType]
    );
    return rows[0] || null;
  }

  static async getPending(limit = 20) {
    await ensureKycRequestTable();
    const [rows] = await db.query(
      `
        SELECT
          kr.*,
          u.username,
          u.first_name,
          u.last_name,
          u.avatar,
          u.email,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.certification_type,
          u.is_verified,
          u.account_status
        FROM kyc_requests kr
        JOIN users u ON u.id = kr.user_id
        WHERE kr.status = 'pending'
        ORDER BY kr.created_at DESC
        LIMIT ?
      `,
      [limit]
    );
    return rows;
  }

  static async createOrUpdatePending(userId, requestNote = null, requestType = 'premium') {
    await ensureKycRequestTable();
    await db.query(
      `
        INSERT INTO kyc_requests (
          user_id,
          request_type,
          status,
          payment_status,
          payment_amount,
          payment_non_refundable,
          request_note,
          reviewed_by_admin_id,
          reviewed_at
        ) VALUES (?, ?, 'pending', 'none', 0.00, 0, ?, NULL, NULL)
        ON DUPLICATE KEY UPDATE
          status = 'pending',
          payment_status = 'none',
          payment_amount = 0.00,
          payment_non_refundable = 0,
          request_note = VALUES(request_note),
          reviewed_by_admin_id = NULL,
          reviewed_at = NULL
      `,
      [userId, requestType, requestNote]
    );
    return this.getByUserIdAndType(userId, requestType);
  }

  static async createOrUpdateDraft(userId, options = {}) {
    await ensureKycRequestTable();
    const connection = options.connection || db;
    const requestType = ['events', 'premium'].includes(String(options.requestType || 'events'))
      ? String(options.requestType || 'events')
      : 'events';
    const requestNote = options.requestNote || null;
    const paymentAmount = Number.isFinite(Number(options.paymentAmount)) ? Math.max(0, Number(options.paymentAmount)) : 0;
    const insertColumns = [
      'user_id',
      'request_type',
      'status',
      'payment_status',
      'payment_amount',
      'payment_non_refundable',
      'request_note',
      'document_url',
      'document_name',
      'document_type',
      'document_size',
      'selfie_url',
      'selfie_name',
      'selfie_type',
      'selfie_size',
      'submitted_full_name',
      'submitted_username',
      'submitted_email',
      'submitted_country',
      'submitted_dob',
      'verification_score',
      'face_match_score',
      'verification_notes',
      'ai_provider',
      'ai_model',
      'ocr_text_excerpt',
      'ocr_detected_dates',
      'ocr_selected_dob',
      'ocr_selected_dob_reason',
      'verified_by_ai',
      'reviewed_by_admin_id',
      'reviewed_at'
    ];
    const insertValuesByColumn = {
      user_id: userId,
      request_type: requestType,
      status: 'draft',
      payment_status: 'paid',
      payment_amount: paymentAmount,
      payment_non_refundable: 1,
      request_note: requestNote,
      document_url: null,
      document_name: null,
      document_type: null,
      document_size: null,
      selfie_url: null,
      selfie_name: null,
      selfie_type: null,
      selfie_size: null,
      submitted_full_name: null,
      submitted_username: null,
      submitted_email: null,
      submitted_country: null,
      submitted_dob: null,
      verification_score: 0,
      face_match_score: null,
      verification_notes: null,
      ai_provider: null,
      ai_model: null,
      ocr_text_excerpt: null,
      ocr_detected_dates: null,
      ocr_selected_dob: null,
      ocr_selected_dob_reason: null,
      verified_by_ai: 0,
      reviewed_by_admin_id: null,
      reviewed_at: null
    };
    const insertValues = insertColumns.map((columnName) => (
      Object.prototype.hasOwnProperty.call(insertValuesByColumn, columnName)
        ? insertValuesByColumn[columnName]
        : null
    ));

    await connection.query(
      `
        INSERT INTO kyc_requests (
          ${insertColumns.join(', ')}
        ) VALUES (
          ${insertColumns.map(() => '?').join(', ')}
        )
        ON DUPLICATE KEY UPDATE
          status = 'draft',
          payment_status = 'paid',
          payment_amount = VALUES(payment_amount),
          payment_non_refundable = 1,
          request_note = VALUES(request_note),
          document_url = NULL,
          document_name = NULL,
          document_type = NULL,
          document_size = NULL,
          selfie_url = NULL,
          selfie_name = NULL,
          selfie_type = NULL,
          selfie_size = NULL,
          submitted_full_name = NULL,
          submitted_username = NULL,
          submitted_email = NULL,
          submitted_country = NULL,
          submitted_dob = NULL,
          verification_score = NULL,
          face_match_score = NULL,
          verification_notes = NULL,
          ai_provider = NULL,
          ai_model = NULL,
          ocr_text_excerpt = NULL,
          ocr_detected_dates = NULL,
          ocr_selected_dob = NULL,
          ocr_selected_dob_reason = NULL,
          verified_by_ai = 0,
          reviewed_by_admin_id = NULL,
          reviewed_at = NULL
      `,
      insertValues
    );
    const [rows] = await connection.query(
      `
        SELECT *
        FROM kyc_requests
        WHERE user_id = ? AND request_type = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [userId, requestType]
    );
    return rows[0] || null;
  }

  static async updateEventVerificationResult(userId, payload = {}) {
    await ensureKycRequestTable();
    const requestType = 'events';
    const current = await this.getByUserIdAndType(userId, requestType);
    if (!current) {
      return null;
    }

    const {
      status,
      submittedFullName = null,
      submittedUsername = null,
      submittedEmail = null,
      submittedCountry = null,
      submittedDob = null,
      documentUrl = null,
      documentName = null,
      documentType = null,
      documentSize = null,
      selfieUrl = null,
      selfieName = null,
      selfieType = null,
      selfieSize = null,
      verificationScore = null,
      faceMatchScore = null,
      verificationNotes = null,
      aiProvider = null,
      aiModel = null,
      ocrTextExcerpt = null,
      ocrDetectedDates = null,
      ocrSelectedDob = null,
      ocrSelectedDobReason = null,
      requestNote = null,
      verifiedByAi = 1
    } = payload;

    const normalizedStatus = ['approved', 'rejected', 'pending', 'draft'].includes(String(status || '').toLowerCase())
      ? String(status || '').toLowerCase()
      : 'draft';

    await db.query(
      `
        UPDATE kyc_requests
        SET
          status = ?,
          submitted_full_name = ?,
          submitted_username = ?,
          submitted_email = ?,
          submitted_country = ?,
          submitted_dob = ?,
          document_url = ?,
          document_name = ?,
          document_type = ?,
          document_size = ?,
          selfie_url = ?,
          selfie_name = ?,
          selfie_type = ?,
          selfie_size = ?,
          verification_score = ?,
          face_match_score = ?,
          verification_notes = ?,
          ai_provider = ?,
          ai_model = ?,
          ocr_text_excerpt = ?,
          ocr_detected_dates = ?,
          ocr_selected_dob = ?,
          ocr_selected_dob_reason = ?,
          verified_by_ai = ?,
          request_note = ?,
          reviewed_by_admin_id = NULL,
          reviewed_at = NOW()
        WHERE user_id = ? AND request_type = ?
      `,
      [
        normalizedStatus,
        submittedFullName,
        submittedUsername,
        submittedEmail,
        submittedCountry,
        normalizeDateToIso(submittedDob),
        documentUrl,
        documentName,
        documentType,
        documentSize,
        selfieUrl,
        selfieName,
        selfieType,
        selfieSize,
        verificationScore,
        faceMatchScore,
        verificationNotes,
        aiProvider,
        aiModel,
        ocrTextExcerpt,
        ocrDetectedDates,
        ocrSelectedDob,
        ocrSelectedDobReason,
        verifiedByAi ? 1 : 0,
        requestNote,
        userId,
        requestType
      ]
    );

    return this.getByUserIdAndType(userId, requestType);
  }

  static async updateStatus(requestId, status, adminId = null) {
    await ensureKycRequestTable();
    const normalizedStatus = ['draft', 'pending', 'approved', 'rejected'].includes(String(status || '').toLowerCase())
      ? String(status || '').toLowerCase()
      : 'pending';
    await db.query(
      `
        UPDATE kyc_requests
        SET status = ?, reviewed_by_admin_id = ?, reviewed_at = NOW()
        WHERE id = ?
      `,
      [normalizedStatus, adminId, requestId]
    );
  }

  static async ensureSchema() {
    return ensureKycRequestTable();
  }
}

module.exports = KycRequest;
