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

async function main() {
  try {
    await ensureColumn('users', 'last_seen_at', 'TIMESTAMP NULL DEFAULT NULL');
    await ensureColumn('messages', 'attachment_url', 'VARCHAR(255) DEFAULT NULL');
    await ensureColumn('messages', 'attachment_type', 'VARCHAR(50) DEFAULT NULL');
    await ensureColumn('messages', 'attachment_name', 'VARCHAR(255) DEFAULT NULL');
    await ensureColumn('messages', 'attachment_size', 'INT DEFAULT NULL');
    await ensureColumn('messages', 'voice_duration_seconds', 'INT DEFAULT NULL');
    await ensureColumn('messages', 'delivered_at', 'TIMESTAMP NULL DEFAULT NULL');
    await ensureColumn('messages', 'read_at', 'TIMESTAMP NULL DEFAULT NULL');
    console.log('Message/presence migration completed successfully');
  } catch (err) {
    console.error('Message/presence migration failed:', err);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
