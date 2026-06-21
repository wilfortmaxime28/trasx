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
    await ensureColumn('users', 'premium_status', "ENUM('free', 'active') DEFAULT 'free'");
    await ensureColumn('users', 'premium_unlock_method', "ENUM('manual', 'auto_followers', 'paid') DEFAULT 'manual'");
    await ensureColumn('users', 'premium_followers_threshold', 'INT DEFAULT 1000');
    await ensureColumn('users', 'premium_paid_at', 'TIMESTAMP NULL DEFAULT NULL');
    await ensureColumn('users', 'premium_activated_at', 'TIMESTAMP NULL DEFAULT NULL');
    console.log('Premium settings migration completed successfully');
  } catch (err) {
    console.error('Premium settings migration failed:', err);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
