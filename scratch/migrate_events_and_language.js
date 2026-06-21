const db = require('../config/db');

async function ensureColumn(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length > 0) {
    console.log(`${table}.${column} already exists`);
    return;
  }

  await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`Added ${table}.${column}`);
}

async function ensureTable(sql) {
  await db.query(sql);
}

async function seedSampleEvents() {
  const [rows] = await db.query('SELECT COUNT(*) AS count FROM events');
  const count = Number(rows[0]?.count || 0);
  if (count > 0) {
    console.log('Events table already has rows, skipping seed');
    return;
  }

  const [users] = await db.query('SELECT id FROM users ORDER BY id ASC LIMIT 3');
  const userIds = users.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  if (userIds.length < 3) {
    console.log('Not enough users to seed demo events, skipping seed');
    return;
  }

  const [event1] = await db.query(
    `
      INSERT INTO events (organizer_id, title, description, location_name, location_address, starts_at, ends_at, category, cover_image_url, visibility, capacity)
      VALUES (?, 'Creative Network Night', 'An evening for designers, builders, and product people to meet, share ideas, and open new conversations.', 'Harpoon Hall', 'New York, NY', DATE_ADD(NOW(), INTERVAL 2 DAY), DATE_ADD(DATE_ADD(NOW(), INTERVAL 2 DAY), INTERVAL 3 HOUR), 'Networking', 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80', 'public', 120)
    `,
    [userIds[0]]
  );
  const [event2] = await db.query(
    `
      INSERT INTO events (organizer_id, title, description, location_name, location_address, starts_at, ends_at, category, cover_image_url, visibility, capacity)
      VALUES (?, 'Frontend Systems Workshop', 'Hands-on workshop focused on modern UI systems, component reuse, and production-ready frontends.', 'Downtown Lab', 'Brooklyn, NY', DATE_ADD(NOW(), INTERVAL 4 DAY), DATE_ADD(DATE_ADD(NOW(), INTERVAL 4 DAY), INTERVAL 2 HOUR), 'Workshop', 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80', 'public', 60)
    `,
    [userIds[1]]
  );
  const [event3] = await db.query(
    `
      INSERT INTO events (organizer_id, title, description, location_name, location_address, starts_at, ends_at, category, cover_image_url, visibility, capacity)
      VALUES (?, 'Community Creator Meetup', 'A relaxed meetup for creators, friends, and followers to connect offline and plan collaborations.', 'Civic Center', 'Miami, FL', DATE_ADD(NOW(), INTERVAL 7 DAY), DATE_ADD(DATE_ADD(NOW(), INTERVAL 7 DAY), INTERVAL 4 HOUR), 'Meetup', 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80', 'public', 80)
    `,
    [userIds[2]]
  );

  const eventIds = [event1.insertId, event2.insertId, event3.insertId];

  await db.query(
    `
      INSERT INTO event_attendees (event_id, user_id, status) VALUES
      (?, ?, 'going'),
      (?, ?, 'interested'),
      (?, ?, 'going'),
      (?, ?, 'going'),
      (?, ?, 'interested'),
      (?, ?, 'going')
    `,
    [
      eventIds[0], userIds[1],
      eventIds[0], userIds[2],
      eventIds[1], userIds[0],
      eventIds[1], userIds[2],
      eventIds[2], userIds[0],
      eventIds[2], userIds[1]
    ]
  );

  console.log('Seeded sample events');
}

async function main() {
  try {
    await ensureColumn('users', 'preferred_language', "ENUM('en', 'fr', 'es') DEFAULT 'en'");
    await ensureColumn('users', 'events_status', "ENUM('locked', 'active') DEFAULT 'locked'");
    await ensureColumn('users', 'events_followers_threshold', 'INT DEFAULT 1000');
    await ensureColumn('users', 'events_activated_at', 'TIMESTAMP NULL DEFAULT NULL');

    await ensureTable(`
      CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organizer_id INT NOT NULL,
        title VARCHAR(180) NOT NULL,
        description TEXT DEFAULT NULL,
        location_name VARCHAR(180) DEFAULT NULL,
        location_address VARCHAR(255) DEFAULT NULL,
        starts_at DATETIME NOT NULL,
        ends_at DATETIME DEFAULT NULL,
        category VARCHAR(80) DEFAULT 'Community',
        cover_image_url VARCHAR(255) DEFAULT NULL,
        ticket_mode ENUM('generated', 'uploaded') DEFAULT 'generated',
        is_paid TINYINT(1) DEFAULT 0,
        ticket_price DECIMAL(10,2) DEFAULT 0.00,
        ticket_asset_url VARCHAR(255) DEFAULT NULL,
        ticket_asset_name VARCHAR(255) DEFAULT NULL,
        ticket_asset_type VARCHAR(50) DEFAULT NULL,
        visibility ENUM('public', 'friends', 'private') DEFAULT 'public',
        capacity INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_events_starts_at (starts_at),
        INDEX idx_events_organizer (organizer_id)
      )
    `);

    await ensureTable(`
      CREATE TABLE IF NOT EXISTS event_attendees (
        event_id INT NOT NULL,
        user_id INT NOT NULL,
        status ENUM('going', 'interested') NOT NULL DEFAULT 'going',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (event_id, user_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_event_attendees_status (status)
      )
    `);

    await ensureTable(`
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

    await seedSampleEvents();
    console.log('Events/language migration completed successfully');
  } catch (err) {
    console.error('Events/language migration failed:', err);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
