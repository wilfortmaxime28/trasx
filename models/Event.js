const db = require('../config/db');

let eventSchemaPromise = null;

async function ensureEventColumns() {
  if (!eventSchemaPromise) {
    eventSchemaPromise = (async () => {
      const requiredColumns = [
        ['description', 'TEXT DEFAULT NULL'],
        ['location_name', 'VARCHAR(180) DEFAULT NULL'],
        ['location_address', 'VARCHAR(255) DEFAULT NULL'],
        ['starts_at', 'DATETIME NULL DEFAULT NULL'],
        ['ends_at', 'DATETIME DEFAULT NULL'],
        ['category', "VARCHAR(80) DEFAULT 'Community'"],
        ['cover_image_url', 'VARCHAR(255) DEFAULT NULL'],
        ['ticket_mode', "ENUM('generated', 'uploaded') DEFAULT 'generated'"],
        ['is_paid', 'TINYINT(1) DEFAULT 0'],
        ['ticket_price', 'DECIMAL(10,2) DEFAULT 0.00'],
        ['ticket_asset_url', 'VARCHAR(255) DEFAULT NULL'],
        ['ticket_asset_name', 'VARCHAR(255) DEFAULT NULL'],
        ['ticket_asset_type', 'VARCHAR(50) DEFAULT NULL'],
        ['visibility', "ENUM('public', 'friends', 'private') DEFAULT 'public'"],
        ['capacity', 'INT DEFAULT NULL']
      ];

      for (const [columnName, columnDefinition] of requiredColumns) {
        const [rows] = await db.query('SHOW COLUMNS FROM events LIKE ?', [columnName]);
        if (!rows || rows.length === 0) {
          await db.query(`ALTER TABLE events ADD COLUMN ${columnName} ${columnDefinition}`);
        }
      }
    })().catch((error) => {
      eventSchemaPromise = null;
      throw error;
    });
  }

  return eventSchemaPromise;
}

function normalizeEventRow(row, currentUserId = null) {
  const attendeeCount = Number(row.attendee_count || 0);
  const goingCount = Number(row.going_count || 0);
  const interestedCount = Number(row.interested_count || 0);
  const capacity = row.capacity === null || row.capacity === undefined ? null : Number(row.capacity);
  const remainingSpots = capacity === null ? null : Math.max(capacity - goingCount, 0);
  const startsAt = row.starts_at ? new Date(row.starts_at) : null;
  const endsAt = row.ends_at ? new Date(row.ends_at) : null;

  return {
    ...row,
    id: Number(row.id),
    organizer_id: Number(row.organizer_id),
    is_paid: Number(row.is_paid || 0) === 1,
    attendee_count: attendeeCount,
    going_count: goingCount,
    interested_count: interestedCount,
    capacity,
    remaining_spots: remainingSpots,
    my_status: row.my_status || null,
    is_organizer: currentUserId !== null ? Number(row.organizer_id) === Number(currentUserId) : false,
    starts_at: startsAt,
    ends_at: endsAt,
    time_label: startsAt ? startsAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    end_label: endsAt ? endsAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    is_full: capacity !== null && capacity > 0 ? goingCount >= capacity : false
  };
}

class Event {
  static async getDashboard(currentUserId) {
    await ensureEventColumns();
    const [upcomingRows] = await db.query(
      `
        SELECT
          e.id,
          e.organizer_id,
          e.title,
          e.description,
          e.location_name,
          e.location_address,
          e.starts_at,
          e.ends_at,
          e.category,
          e.cover_image_url,
          e.ticket_mode,
          e.is_paid,
          e.ticket_price,
          e.ticket_asset_url,
          e.ticket_asset_name,
          e.ticket_asset_type,
          e.visibility,
          e.capacity,
          e.created_at,
          CONCAT(u.first_name, ' ', u.last_name) AS organizer_name,
          u.username AS organizer_username,
          u.avatar AS organizer_avatar,
          COUNT(DISTINCT ea.user_id) AS attendee_count,
          SUM(CASE WHEN ea.status = 'going' THEN 1 ELSE 0 END) AS going_count,
          SUM(CASE WHEN ea.status = 'interested' THEN 1 ELSE 0 END) AS interested_count,
          MAX(CASE WHEN ea.user_id = ? THEN ea.status ELSE NULL END) AS my_status
        FROM events e
        JOIN users u ON e.organizer_id = u.id
        LEFT JOIN event_attendees ea ON ea.event_id = e.id
        WHERE e.starts_at >= NOW() AND e.visibility IN ('public', 'friends')
        GROUP BY e.id
        ORDER BY e.starts_at ASC, attendee_count DESC
      `,
      [currentUserId]
    );

    const [hostedRows] = await db.query(
      `
        SELECT
          e.id,
          e.organizer_id,
          e.title,
          e.description,
          e.location_name,
          e.location_address,
          e.starts_at,
          e.ends_at,
          e.category,
          e.cover_image_url,
          e.ticket_mode,
          e.is_paid,
          e.ticket_price,
          e.ticket_asset_url,
          e.ticket_asset_name,
          e.ticket_asset_type,
          e.visibility,
          e.capacity,
          e.created_at,
          CONCAT(u.first_name, ' ', u.last_name) AS organizer_name,
          u.username AS organizer_username,
          u.avatar AS organizer_avatar,
          COUNT(DISTINCT ea.user_id) AS attendee_count,
          SUM(CASE WHEN ea.status = 'going' THEN 1 ELSE 0 END) AS going_count,
          SUM(CASE WHEN ea.status = 'interested' THEN 1 ELSE 0 END) AS interested_count,
          MAX(CASE WHEN ea.user_id = ? THEN ea.status ELSE NULL END) AS my_status
        FROM events e
        JOIN users u ON e.organizer_id = u.id
        LEFT JOIN event_attendees ea ON ea.event_id = e.id
        WHERE e.organizer_id = ? AND e.starts_at >= NOW()
        GROUP BY e.id
        ORDER BY e.starts_at ASC
      `,
      [currentUserId, currentUserId]
    );

    const [attendingRows] = await db.query(
      `
        SELECT
          e.id,
          e.organizer_id,
          e.title,
          e.description,
          e.location_name,
          e.location_address,
          e.starts_at,
          e.ends_at,
          e.category,
          e.cover_image_url,
          e.ticket_mode,
          e.is_paid,
          e.ticket_price,
          e.ticket_asset_url,
          e.ticket_asset_name,
          e.ticket_asset_type,
          e.visibility,
          e.capacity,
          e.created_at,
          CONCAT(u.first_name, ' ', u.last_name) AS organizer_name,
          u.username AS organizer_username,
          u.avatar AS organizer_avatar,
          COUNT(DISTINCT ea.user_id) AS attendee_count,
          SUM(CASE WHEN ea.status = 'going' THEN 1 ELSE 0 END) AS going_count,
          SUM(CASE WHEN ea.status = 'interested' THEN 1 ELSE 0 END) AS interested_count,
          MAX(CASE WHEN ea.user_id = ? THEN ea.status ELSE NULL END) AS my_status
        FROM events e
        JOIN users u ON e.organizer_id = u.id
        LEFT JOIN event_attendees ea ON ea.event_id = e.id
        INNER JOIN event_attendees my_ea ON my_ea.event_id = e.id AND my_ea.user_id = ? AND my_ea.status IN ('going', 'interested')
        WHERE e.starts_at >= NOW()
        GROUP BY e.id
        ORDER BY e.starts_at ASC
      `,
      [currentUserId, currentUserId]
    );

    const [suggestedRows] = await db.query(
      `
        SELECT
          e.id,
          e.organizer_id,
          e.title,
          e.description,
          e.location_name,
          e.location_address,
          e.starts_at,
          e.ends_at,
          e.category,
          e.cover_image_url,
          e.ticket_mode,
          e.is_paid,
          e.ticket_price,
          e.ticket_asset_url,
          e.ticket_asset_name,
          e.ticket_asset_type,
          e.visibility,
          e.capacity,
          e.created_at,
          CONCAT(u.first_name, ' ', u.last_name) AS organizer_name,
          u.username AS organizer_username,
          u.avatar AS organizer_avatar,
          COUNT(DISTINCT ea.user_id) AS attendee_count,
          SUM(CASE WHEN ea.status = 'going' THEN 1 ELSE 0 END) AS going_count,
          SUM(CASE WHEN ea.status = 'interested' THEN 1 ELSE 0 END) AS interested_count,
          NULL AS my_status
        FROM events e
        JOIN users u ON e.organizer_id = u.id
        LEFT JOIN event_attendees ea ON ea.event_id = e.id
        WHERE e.starts_at >= NOW()
          AND e.visibility = 'public'
          AND e.organizer_id <> ?
          AND NOT EXISTS (
            SELECT 1 FROM event_attendees my_ea
            WHERE my_ea.event_id = e.id
              AND my_ea.user_id = ?
          )
        GROUP BY e.id
        ORDER BY attendee_count DESC, e.starts_at ASC
        LIMIT 6
      `,
      [currentUserId, currentUserId]
    );

    const [statsRows] = await db.query(
      `
        SELECT
          COUNT(DISTINCT CASE WHEN e.organizer_id = ? AND e.starts_at >= NOW() THEN e.id END) AS hosted_count,
          COUNT(DISTINCT CASE WHEN ea.user_id = ? AND ea.status IN ('going', 'interested') AND e.starts_at >= NOW() THEN e.id END) AS attending_count,
          COUNT(DISTINCT CASE WHEN ea.user_id = ? AND ea.status = 'interested' AND e.starts_at >= NOW() THEN e.id END) AS interested_count,
          COUNT(DISTINCT CASE WHEN e.starts_at >= NOW() THEN e.id END) AS total_upcoming_count
        FROM events e
        LEFT JOIN event_attendees ea ON ea.event_id = e.id
      `,
      [currentUserId, currentUserId, currentUserId]
    );

    return {
      upcomingEvents: upcomingRows.map((row) => normalizeEventRow(row, currentUserId)),
      hostedEvents: hostedRows.map((row) => normalizeEventRow(row, currentUserId)),
      attendingEvents: attendingRows.map((row) => normalizeEventRow(row, currentUserId)),
      suggestedEvents: suggestedRows.map((row) => normalizeEventRow(row, currentUserId)),
      stats: {
        hostedCount: Number(statsRows[0]?.hosted_count || 0),
        attendingCount: Number(statsRows[0]?.attending_count || 0),
        interestedCount: Number(statsRows[0]?.interested_count || 0),
        totalUpcomingCount: Number(statsRows[0]?.total_upcoming_count || 0)
      }
    };
  }

  static async getById(eventId, currentUserId) {
    await ensureEventColumns();
    const [rows] = await db.query(
      `
        SELECT
          e.id,
          e.organizer_id,
          e.title,
          e.description,
          e.location_name,
          e.location_address,
          e.starts_at,
          e.ends_at,
          e.category,
          e.cover_image_url,
          e.ticket_mode,
          e.is_paid,
          e.ticket_price,
          e.ticket_asset_url,
          e.ticket_asset_name,
          e.ticket_asset_type,
          e.visibility,
          e.capacity,
          e.created_at,
          CONCAT(u.first_name, ' ', u.last_name) AS organizer_name,
          u.username AS organizer_username,
          u.avatar AS organizer_avatar,
          COUNT(DISTINCT ea.user_id) AS attendee_count,
          SUM(CASE WHEN ea.status = 'going' THEN 1 ELSE 0 END) AS going_count,
          SUM(CASE WHEN ea.status = 'interested' THEN 1 ELSE 0 END) AS interested_count,
          MAX(CASE WHEN ea.user_id = ? THEN ea.status ELSE NULL END) AS my_status
        FROM events e
        JOIN users u ON e.organizer_id = u.id
        LEFT JOIN event_attendees ea ON ea.event_id = e.id
        WHERE e.id = ?
        GROUP BY e.id
        LIMIT 1
      `,
      [currentUserId, eventId]
    );

    if (rows.length === 0) return null;
    return normalizeEventRow(rows[0], currentUserId);
  }

  static async create(userId, data, connection = db) {
    await ensureEventColumns();
    const {
      title,
      description,
      locationName,
      locationAddress,
      startsAt,
      endsAt,
      category,
      visibility,
      capacity,
      coverImageUrl,
      ticketMode = 'generated',
      isPaid = 0,
      ticketPrice = 0,
      ticketAssetUrl = null,
      ticketAssetName = null,
      ticketAssetType = null
    } = data;

    const [result] = await connection.query(
      `
        INSERT INTO events (
          organizer_id,
          title,
          description,
          location_name,
          location_address,
          starts_at,
          ends_at,
          category,
          visibility,
          capacity,
          cover_image_url,
          ticket_mode,
          is_paid,
          ticket_price,
          ticket_asset_url,
          ticket_asset_name,
          ticket_asset_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        title,
        description,
        locationName || null,
        locationAddress || null,
        startsAt,
        endsAt || null,
        category || 'Community',
        visibility || 'public',
        capacity || null,
        coverImageUrl || null,
        ticketMode || 'generated',
        isPaid ? 1 : 0,
        Number.isFinite(Number(ticketPrice)) ? Number(ticketPrice) : 0,
        ticketAssetUrl || null,
        ticketAssetName || null,
        ticketAssetType || null
      ]
    );

    return result.insertId;
  }

  static async upsertRsvp(eventId, userId, status) {
    await ensureEventColumns();
    const normalizedStatus = ['going', 'interested'].includes(status) ? status : null;
    if (!normalizedStatus) {
      await db.query('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?', [eventId, userId]);
      return { status: null };
    }

    await db.query(
      `
        INSERT INTO event_attendees (event_id, user_id, status)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status)
      `,
      [eventId, userId, normalizedStatus]
    );
    return { status: normalizedStatus };
  }

  static async getMyRsvp(eventId, userId) {
    await ensureEventColumns();
    const [rows] = await db.query(
      'SELECT status FROM event_attendees WHERE event_id = ? AND user_id = ? LIMIT 1',
      [eventId, userId]
    );
    return rows[0]?.status || null;
  }
}

module.exports = Event;
