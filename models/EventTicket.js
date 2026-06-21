const crypto = require('node:crypto');
const db = require('../config/db');
const { generateTicketAsset } = require('../utils/eventTicketAssets');

let eventTicketSchemaPromise = null;

async function ensureTicketColumns() {
  if (!eventTicketSchemaPromise) {
    eventTicketSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS event_tickets (
          id INT AUTO_INCREMENT PRIMARY KEY,
          event_id INT NOT NULL,
          user_id INT NOT NULL,
          ticket_code VARCHAR(80) NOT NULL UNIQUE,
          ticket_type ENUM('free', 'paid') DEFAULT 'free',
          ticket_asset_url VARCHAR(255) DEFAULT NULL,
          ticket_asset_name VARCHAR(255) DEFAULT NULL,
          ticket_asset_type VARCHAR(50) DEFAULT NULL,
          email_sent_at TIMESTAMP NULL DEFAULT NULL,
          message_sent_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_event_tickets_event_user (event_id, user_id)
        )
      `);

      const requiredColumns = [
        ['ticket_asset_url', 'VARCHAR(255) DEFAULT NULL'],
        ['ticket_asset_name', 'VARCHAR(255) DEFAULT NULL'],
        ['ticket_asset_type', 'VARCHAR(50) DEFAULT NULL']
      ];

      for (const [columnName, columnDefinition] of requiredColumns) {
        const [rows] = await db.query('SHOW COLUMNS FROM event_tickets LIKE ?', [columnName]);
        if (!rows || rows.length === 0) {
          await db.query(`ALTER TABLE event_tickets ADD COLUMN ${columnName} ${columnDefinition}`);
        }
      }
    })().catch((error) => {
      eventTicketSchemaPromise = null;
      throw error;
    });
  }

  return eventTicketSchemaPromise;
}

function normalizeTicketAsset(row) {
  return {
    ticket_asset_url: row.ticket_asset_url || null,
    ticket_asset_name: row.ticket_asset_name || null,
    ticket_asset_type: row.ticket_asset_type || null
  };
}

class EventTicket {
  static generateCode(eventId, userId) {
    return `EVT-${eventId}-${userId}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  }

  static async getByEventAndUser(eventId, userId) {
    await ensureTicketColumns();
    const [rows] = await db.query(
      `
        SELECT
          et.*,
          e.title AS event_title,
          e.description AS event_description,
          e.location_name,
          e.location_address,
          e.starts_at,
          e.ends_at,
          e.cover_image_url,
          e.ticket_mode,
          e.is_paid,
          e.ticket_price,
          e.ticket_asset_url,
          e.ticket_asset_name,
          e.ticket_asset_type,
          COALESCE(et.ticket_asset_url, e.ticket_asset_url) AS ticket_asset_url,
          COALESCE(et.ticket_asset_name, e.ticket_asset_name) AS ticket_asset_name,
          COALESCE(et.ticket_asset_type, e.ticket_asset_type) AS ticket_asset_type,
          CONCAT(u.first_name, ' ', u.last_name) AS holder_name,
          u.email AS holder_email,
          CONCAT(o.first_name, ' ', o.last_name) AS organizer_name,
          o.email AS organizer_email
        FROM event_tickets et
        JOIN events e ON et.event_id = e.id
        JOIN users u ON et.user_id = u.id
        JOIN users o ON e.organizer_id = o.id
        WHERE et.event_id = ? AND et.user_id = ?
        LIMIT 1
      `,
      [eventId, userId]
    );
    return rows[0] || null;
  }

  static async getByCode(ticketCode) {
    await ensureTicketColumns();
    const [rows] = await db.query(
      `
        SELECT
          et.*,
          e.title AS event_title,
          e.description AS event_description,
          e.location_name,
          e.location_address,
          e.starts_at,
          e.ends_at,
          e.cover_image_url,
          e.ticket_mode,
          e.is_paid,
          e.ticket_price,
          e.ticket_asset_url,
          e.ticket_asset_name,
          e.ticket_asset_type,
          COALESCE(et.ticket_asset_url, e.ticket_asset_url) AS ticket_asset_url,
          COALESCE(et.ticket_asset_name, e.ticket_asset_name) AS ticket_asset_name,
          COALESCE(et.ticket_asset_type, e.ticket_asset_type) AS ticket_asset_type,
          CONCAT(u.first_name, ' ', u.last_name) AS holder_name,
          u.email AS holder_email,
          CONCAT(o.first_name, ' ', o.last_name) AS organizer_name,
          o.email AS organizer_email
        FROM event_tickets et
        JOIN events e ON et.event_id = e.id
        JOIN users u ON et.user_id = u.id
        JOIN users o ON e.organizer_id = o.id
        WHERE et.ticket_code = ?
        LIMIT 1
      `,
      [ticketCode]
    );
    return rows[0] || null;
  }

  static async issueForUser({ eventId, userId, ticketType = 'free', ticketAssetUrl = null, ticketAssetName = null, ticketAssetType = null }) {
    await ensureTicketColumns();
    const existing = await this.getByEventAndUser(eventId, userId);
    if (existing) {
      return existing;
    }

    const ticketCode = this.generateCode(eventId, userId);
    await db.query(
      `
        INSERT INTO event_tickets (
          event_id,
          user_id,
          ticket_code,
          ticket_type,
          ticket_asset_url,
          ticket_asset_name,
          ticket_asset_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        eventId,
        userId,
        ticketCode,
        ticketType,
        ticketAssetUrl || null,
        ticketAssetName || null,
        ticketAssetType || null
      ]
    );

    return this.getByCode(ticketCode);
  }

  static async updateAssetByCode(ticketCode, asset = {}) {
    await ensureTicketColumns();
    const normalizedAsset = normalizeTicketAsset(asset);
    if (!ticketCode) return null;

    await db.query(
      `
        UPDATE event_tickets
        SET ticket_asset_url = ?,
            ticket_asset_name = ?,
            ticket_asset_type = ?
        WHERE ticket_code = ?
      `,
      [
        normalizedAsset.ticket_asset_url,
        normalizedAsset.ticket_asset_name,
        normalizedAsset.ticket_asset_type,
        ticketCode
      ]
    );

    return this.getByCode(ticketCode);
  }

  static async ensureGeneratedAsset({ ticket, event, holderName, ticketPageUrl }) {
    await ensureTicketColumns();
    if (!ticket || !ticket.ticket_code) {
      return null;
    }

    if (ticket.ticket_asset_url && String(ticket.ticket_asset_type || '').startsWith('image/')) {
      return normalizeTicketAsset(ticket);
    }

    const existing = normalizeTicketAsset(ticket);
    if (existing.ticket_asset_url && existing.ticket_asset_type) {
      return existing;
    }

    const asset = await generateTicketAsset({
      event,
      holderName,
      ticketCode: ticket.ticket_code,
      ticketType: ticket.ticket_type || 'free',
      ticketPageUrl
    });

    await this.updateAssetByCode(ticket.ticket_code, {
      ticket_asset_url: asset.fileUrl,
      ticket_asset_name: asset.fileName,
      ticket_asset_type: asset.mimeType
    });

    return {
      ticket_asset_url: asset.fileUrl,
      ticket_asset_name: asset.fileName,
      ticket_asset_type: asset.mimeType,
      ticket_asset_size: asset.size
    };
  }

  static async markDeliveryStatusByCode(ticketCode, { emailSent = false, messageSent = false } = {}) {
    await ensureTicketColumns();
    if (!ticketCode) return null;

    const updates = [];
    const values = [];

    if (emailSent) {
      updates.push('email_sent_at = COALESCE(email_sent_at, NOW())');
    }
    if (messageSent) {
      updates.push('message_sent_at = COALESCE(message_sent_at, NOW())');
    }

    if (updates.length === 0) {
      return this.getByCode(ticketCode);
    }

    values.push(ticketCode);
    await db.query(
      `UPDATE event_tickets SET ${updates.join(', ')} WHERE ticket_code = ?`,
      values
    );

    return this.getByCode(ticketCode);
  }
}

module.exports = EventTicket;
