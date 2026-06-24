const db = require('../config/db');
const { getMessagePreviewText, parseStructuredMessageContent } = require('../utils/messageInbox');

class Message {
  static async ensureMessageColumns() {
    try {
      await db.query('ALTER TABLE messages ADD COLUMN parent_id INT DEFAULT NULL');
    } catch (e) {}
    try {
      await db.query('ALTER TABLE messages ADD COLUMN deleted_by_sender TINYINT(1) DEFAULT 0');
    } catch (e) {}
    try {
      await db.query('ALTER TABLE messages ADD COLUMN deleted_by_receiver TINYINT(1) DEFAULT 0');
    } catch (e) {}
    try {
      await db.query('ALTER TABLE messages ADD COLUMN deleted_for_everyone TINYINT(1) DEFAULT 0');
    } catch (e) {}
  }

  static async ensureMessageRequestsTable() {
    await Message.ensureMessageColumns();
    await db.query(`
      CREATE TABLE IF NOT EXISTS message_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        requester_id INT NOT NULL,
        recipient_id INT NOT NULL,
        status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_message_request (requester_id, recipient_id),
        INDEX idx_message_requests_recipient_status (recipient_id, status),
        INDEX idx_message_requests_requester_status (requester_id, status)
      )
    `);
  }

  static normalizeNullableInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  static async getRecentForUser(userId) {
    await Message.ensureMessageRequestsTable();
    const query = `
      SELECT 
        m.id,
        m.sender_id,
        m.receiver_id,
        m.content,
        m.attachment_url,
        m.attachment_type,
        m.attachment_name,
        m.attachment_size,
        m.voice_duration_seconds,
        m.delivered_at,
        m.read_at,
        m.created_at,
        mr.status AS request_status,
        mr.requester_id AS request_requester_id,
        mr.recipient_id AS request_recipient_id,
        CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
        u.avatar AS sender_avatar,
        u.username AS sender_username
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN message_requests mr
        ON (
          (mr.requester_id = m.sender_id AND mr.recipient_id = m.receiver_id)
          OR (mr.requester_id = m.receiver_id AND mr.recipient_id = m.sender_id)
        )
      WHERE m.receiver_id = ? OR m.sender_id = ?
      ORDER BY m.created_at ASC
    `;
    const [rows] = await db.query(query, [userId, userId]);
    return rows;
  }

  static async create(senderId, receiverId, content, attachment = {}, parentId = null) {
    const normalizedContent = String(content ?? '');
    const {
      attachmentUrl = null,
      attachmentType = null,
      attachmentName = null,
      attachmentSize = null,
      voiceDurationSeconds = null
    } = attachment || {};
    const normalizedAttachmentSize = Message.normalizeNullableInt(attachmentSize);
    const normalizedVoiceDurationSeconds = Message.normalizeNullableInt(voiceDurationSeconds);
    const normalizedParentId = Message.normalizeNullableInt(parentId);
    const [result] = await db.query(
      `
        INSERT INTO messages (
          sender_id,
          receiver_id,
          content,
          attachment_url,
          attachment_type,
          attachment_name,
          attachment_size,
          voice_duration_seconds,
          parent_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        senderId,
        receiverId,
        normalizedContent,
        attachmentUrl,
        attachmentType,
        attachmentName,
        normalizedAttachmentSize,
        normalizedVoiceDurationSeconds,
        normalizedParentId
      ]
    );
    return result.insertId;
  }

  static async getHistoryBetween(userId, contactId) {
    const query = `
      SELECT 
        m.id,
        m.sender_id,
        m.receiver_id,
        m.content,
        m.attachment_url,
        m.attachment_type,
        m.attachment_name,
        m.attachment_size,
        m.voice_duration_seconds,
        m.delivered_at,
        m.read_at,
        m.created_at,
        m.parent_id,
        m.deleted_by_sender,
        m.deleted_by_receiver,
        m.deleted_for_everyone,
        CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
        u.avatar AS sender_avatar,
        u.username AS sender_username,
        pm.content AS parent_content,
        pmu.username AS parent_sender_username,
        pm.attachment_type AS parent_attachment_type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN messages pm ON m.parent_id = pm.id
      LEFT JOIN users pmu ON pm.sender_id = pmu.id
      WHERE (
        (m.sender_id = ? AND m.receiver_id = ?)
        OR (m.sender_id = ? AND m.receiver_id = ?)
      ) AND (
        (m.sender_id = ? AND m.deleted_by_sender = 0)
        OR (m.receiver_id = ? AND m.deleted_by_receiver = 0)
      )
      ORDER BY m.created_at ASC
    `;
    const [rows] = await db.query(query, [
      userId, contactId, contactId, userId,
      userId, userId
    ]);
    return rows;
  }

  static async getById(messageId) {
    const [rows] = await db.query(
      `
        SELECT 
          m.id,
          m.sender_id,
          m.receiver_id,
          m.content,
          m.attachment_url,
          m.attachment_type,
          m.attachment_name,
          m.parent_id,
          u.username AS sender_username
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `,
      [messageId]
    );
    return rows[0] || null;
  }

  static async deleteForMe(messageId, userId) {
    const msg = await Message.getById(messageId);
    if (!msg) return false;
    
    if (Number(msg.sender_id) === Number(userId)) {
      await db.query('UPDATE messages SET deleted_by_sender = 1 WHERE id = ?', [messageId]);
      return true;
    } else if (Number(msg.receiver_id) === Number(userId)) {
      await db.query('UPDATE messages SET deleted_by_receiver = 1 WHERE id = ?', [messageId]);
      return true;
    }
    return false;
  }

  static async deleteForEveryone(messageId, userId) {
    const msg = await Message.getById(messageId);
    if (!msg) return false;
    
    if (Number(msg.sender_id) !== Number(userId)) return false;
    
    await db.query(`
      UPDATE messages 
      SET 
        deleted_for_everyone = 1,
        content = '',
        attachment_url = NULL,
        attachment_type = NULL,
        attachment_name = NULL,
        attachment_size = NULL,
        voice_duration_seconds = NULL
      WHERE id = ?
    `, [messageId]);
    return true;
  }

  static async getAllForAdmin() {
    await Message.ensureMessageRequestsTable();
    const query = `
      SELECT
        m.id,
        m.sender_id,
        m.receiver_id,
        m.content,
        m.attachment_url,
        m.attachment_type,
        m.attachment_name,
        m.attachment_size,
        m.voice_duration_seconds,
        m.delivered_at,
        m.read_at,
        m.created_at,
        sender.username AS sender_username,
        sender.avatar AS sender_avatar,
        CONCAT(COALESCE(sender.first_name, ''), ' ', COALESCE(sender.last_name, '')) AS sender_name,
        receiver.username AS receiver_username,
        receiver.avatar AS receiver_avatar,
        CONCAT(COALESCE(receiver.first_name, ''), ' ', COALESCE(receiver.last_name, '')) AS receiver_name
      FROM messages m
      JOIN users sender ON sender.id = m.sender_id
      JOIN users receiver ON receiver.id = m.receiver_id
      ORDER BY m.created_at DESC, m.id DESC
    `;
    const [rows] = await db.query(query);
    return rows;
  }

  static async getConversationSummariesForAdmin() {
    await Message.ensureMessageRequestsTable();
    const query = `
      SELECT
        convo.user_a_id,
        convo.user_b_id,
        convo.total_messages,
        convo.last_message_at,
        convo.last_message_id,
        convo.last_sender_id,
        convo.last_receiver_id,
        convo.last_message_content,
        convo.last_attachment_type,
        convo.last_attachment_name,
        u1.username AS user_a_username,
        u1.avatar AS user_a_avatar,
        CONCAT(COALESCE(u1.first_name, ''), ' ', COALESCE(u1.last_name, '')) AS user_a_name,
        u2.username AS user_b_username,
        u2.avatar AS user_b_avatar,
        CONCAT(COALESCE(u2.first_name, ''), ' ', COALESCE(u2.last_name, '')) AS user_b_name
        FROM (
          SELECT
            grouped.user_a_id,
            grouped.user_b_id,
            grouped.total_messages,
            latest.created_at AS last_message_at,
            latest.id AS last_message_id,
            latest.sender_id AS last_sender_id,
            latest.receiver_id AS last_receiver_id,
            latest.content AS last_message_content,
            latest.attachment_type AS last_attachment_type,
            latest.attachment_name AS last_attachment_name
        FROM (
          SELECT
            LEAST(sender_id, receiver_id) AS user_a_id,
            GREATEST(sender_id, receiver_id) AS user_b_id,
            COUNT(*) AS total_messages,
            MAX(created_at) AS last_message_at
          FROM messages
          GROUP BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)
        ) grouped
        JOIN messages latest
          ON LEAST(latest.sender_id, latest.receiver_id) = grouped.user_a_id
         AND GREATEST(latest.sender_id, latest.receiver_id) = grouped.user_b_id
         AND latest.created_at = grouped.last_message_at
        LEFT JOIN messages latest_newer
          ON LEAST(latest_newer.sender_id, latest_newer.receiver_id) = grouped.user_a_id
         AND GREATEST(latest_newer.sender_id, latest_newer.receiver_id) = grouped.user_b_id
         AND latest_newer.created_at = latest.created_at
         AND latest_newer.id > latest.id
        WHERE latest_newer.id IS NULL
      ) convo
      JOIN users u1 ON u1.id = convo.user_a_id
      JOIN users u2 ON u2.id = convo.user_b_id
      ORDER BY convo.last_message_at DESC, convo.last_message_id DESC
    `;
    const [rows] = await db.query(query);
    return rows;
  }

  static getPreviewText(message) {
    return getMessagePreviewText(message);
  }

  static parseStructuredContent(content) {
    return parseStructuredMessageContent(content);
  }

  static async markDelivered(messageId) {
    const parsedId = Number.parseInt(messageId, 10);
    if (!Number.isFinite(parsedId)) return false;
    const [result] = await db.query(
      'UPDATE messages SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = ?',
      [parsedId]
    );
    return result.affectedRows > 0;
  }

  static async markConversationRead(senderId, receiverId) {
    const [rows] = await db.query(
      `
        SELECT id
        FROM messages
        WHERE sender_id = ?
          AND receiver_id = ?
          AND read_at IS NULL
      `,
      [senderId, receiverId]
    );

    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    if (ids.length === 0) return [];

    await db.query(
      `
        UPDATE messages
        SET
          delivered_at = COALESCE(delivered_at, NOW()),
          read_at = NOW()
        WHERE id IN (?)
      `,
      [ids]
    );

    return ids;
  }

  static async createOrKeepMessageRequest(requesterId, recipientId) {
    await Message.ensureMessageRequestsTable();
    await db.query(
      `
        INSERT INTO message_requests (requester_id, recipient_id, status)
        VALUES (?, ?, 'pending')
        ON DUPLICATE KEY UPDATE
          status = IF(status = 'accepted', 'accepted', 'pending'),
          updated_at = NOW()
      `,
      [requesterId, recipientId]
    );
    const [rows] = await db.query(
      'SELECT status FROM message_requests WHERE requester_id = ? AND recipient_id = ? LIMIT 1',
      [requesterId, recipientId]
    );
    return rows[0]?.status || 'pending';
  }

  static async updateMessageRequestStatus(recipientId, requesterId, status) {
    await Message.ensureMessageRequestsTable();
    const normalizedStatus = status === 'accepted' ? 'accepted' : 'declined';
    const [result] = await db.query(
      `
        UPDATE message_requests
        SET status = ?, updated_at = NOW()
        WHERE recipient_id = ? AND requester_id = ?
      `,
      [normalizedStatus, recipientId, requesterId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = Message;
