const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const Admin = require('../models/Admin');

// Helper function to check if the database is configured and has at least one super admin
async function checkIsInstalled() {
  try {
    // 1. Check database connection
    await db.query('SELECT 1');
    
    // 2. Check if admins table exists and has a super admin
    const [rows] = await db.query('SELECT COUNT(*) AS total FROM admins WHERE COALESCE(is_super_admin, 0) = 1');
    const totalSuperAdmins = Number(rows?.[0]?.total || 0);
    return totalSuperAdmins > 0;
  } catch (err) {
    // If connection fails or tables are missing, it's not installed
    return false;
  }
}

function updateEnvFile(updates) {
  const envPath = path.resolve(__dirname, '../.env');
  let content = '';
  
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  } else {
    const examplePath = path.resolve(__dirname, '../.env.example');
    if (fs.existsSync(examplePath)) {
      content = fs.readFileSync(examplePath, 'utf8');
    }
  }

  const lines = content.split('\n');
  const updatedKeys = new Set();
  
  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    
    const equalsIdx = line.indexOf('=');
    if (equalsIdx === -1) return line;
    
    const key = line.slice(0, equalsIdx).trim();
    if (updates.hasOwnProperty(key)) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  for (const key in updates) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${updates[key]}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
}

exports.getInstallPage = async (req, res) => {
  try {
    const installed = await checkIsInstalled();
    if (installed) {
      return res.redirect('/');
    }
    
    // Pass existing env variables to the view for pre-filling
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'weshare',
      port: process.env.DB_PORT || '3306'
    };
    
    res.render('install', { dbConfig, error: null });
  } catch (err) {
    console.error('Error in getInstallPage:', err);
    res.status(500).send('Server Error');
  }
};

exports.testDbConnection = async (req, res) => {
  const { host, user, password, database, port } = req.body;
  
  let testPool = null;
  try {
    testPool = mysql.createPool({
      host: host || 'localhost',
      user: user || 'root',
      password: password || '',
      port: Number(port) || 3306,
      connectTimeout: 5000
    });
    
    const conn = await testPool.getConnection();
    
    // Also check if we can create or use the database
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    conn.release();
    await testPool.end();
    
    return res.json({ success: true, message: 'Database connection successful!' });
  } catch (err) {
    console.error('Database connection test failed:', err);
    if (testPool) {
      await testPool.end().catch(() => {});
    }
    return res.json({ success: false, error: err.message || 'Database connection failed.' });
  }
};

exports.performInstall = async (req, res) => {
  const {
    db_host,
    db_user,
    db_password,
    db_name,
    db_port,
    admin_display_name,
    admin_email,
    admin_password
  } = req.body;

  let conn = null;
  let setupPool = null;
  
  try {
    // 1. Verify DB credentials work & database is created
    setupPool = mysql.createPool({
      host: db_host || 'localhost',
      user: db_user || 'root',
      password: db_password || '',
      port: Number(db_port) || 3306,
      connectTimeout: 5000
    });
    
    conn = await setupPool.getConnection();
    
    // Create database if it does not exist
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db_name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    // 2. Write/Update .env file
    updateEnvFile({
      DB_HOST: db_host || 'localhost',
      DB_USER: db_user || 'root',
      DB_PASSWORD: db_password || '',
      DB_NAME: db_name || 'weshare',
      DB_PORT: db_port || '3306'
    });
    
    // 3. Recreate the pool in db.js configuration wrapper
    db.recreatePool();
    
    // 4. Run schema.sql on the newly configured database
    const schemaPath = path.resolve(__dirname, '../schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error('schema.sql file not found in the workspace root.');
    }
    
    let sqlContent = fs.readFileSync(schemaPath, 'utf8');
    // Replace default database declarations in schema.sql to target configured database name
    sqlContent = sqlContent.replace(/CREATE DATABASE IF NOT EXISTS trasx/g, `CREATE DATABASE IF NOT EXISTS \`${db_name}\``);
    sqlContent = sqlContent.replace(/USE trasx;/g, `USE \`${db_name}\`;`);
    
    // Run schema queries
    const multiConn = await mysql.createConnection({
      host: db_host || 'localhost',
      user: db_user || 'root',
      password: db_password || '',
      port: Number(db_port) || 3306,
      database: db_name,
      multipleStatements: true
    });
    
    await multiConn.query(sqlContent);
    await multiConn.end();
    
    // 5. Ensure admin and other auxiliary tables/columns are fully created/migrated
    // Run Admin.ensureSchema to create the admins table
    await Admin.ensureSchema();
    await require('../models/P2PMarket').ensureSchema();
    await require('../models/KycRequest').ensureSchema();
    
    // Create bsc_deposits & bsc_withdrawals tables
    await conn.query(`USE \`${db_name}\``);
    
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bsc_deposits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        tx_hash VARCHAR(66) NOT NULL UNIQUE,
        from_address VARCHAR(42) NOT NULL,
        to_address VARCHAR(42) NOT NULL,
        amount_wei VARCHAR(40) NOT NULL,
        amount_usdt DECIMAL(18,6) NOT NULL,
        token_symbol VARCHAR(20) DEFAULT 'USDT',
        block_number INT DEFAULT NULL,
        confirmations INT DEFAULT 0,
        status ENUM('pending','confirmed','failed') DEFAULT 'pending',
        credited_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_bsc_deposits_status (status),
        INDEX idx_bsc_deposits_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure users has extra columns
    try {
      const [addrUpdatedRows] = await conn.query("SHOW COLUMNS FROM users LIKE 'wallet_address_updated_at'");
      if (!addrUpdatedRows || addrUpdatedRows.length === 0) {
        await conn.query("ALTER TABLE users ADD COLUMN wallet_address_updated_at TIMESTAMP NULL DEFAULT NULL AFTER wallet_address");
      }
    } catch (e) {}

    try {
      const [pinRows] = await conn.query("SHOW COLUMNS FROM users LIKE 'withdrawal_pin'");
      if (!pinRows || pinRows.length === 0) {
        await conn.query("ALTER TABLE users ADD COLUMN withdrawal_pin VARCHAR(255) NULL DEFAULT NULL AFTER wallet_address_updated_at");
      }
    } catch (e) {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS bsc_withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        tx_hash VARCHAR(66) DEFAULT NULL,
        recipient_address VARCHAR(42) NOT NULL,
        amount_usdt DECIMAL(18,6) NOT NULL,
        fee_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
        net_amount_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
        gas_cost_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
        status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
        error_message TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_bsc_withdrawals_user (user_id),
        INDEX idx_bsc_withdrawals_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Create the super admin account
    const passwordHash = await bcrypt.hash(admin_password, 10);
    
    // Check if there is already any admin inside the database
    const [existingAdmins] = await db.query('SELECT COUNT(*) AS count FROM admins WHERE email = ?', [admin_email.toLowerCase()]);
    if (existingAdmins[0].count === 0) {
      await Admin.createAdmin({
        displayName: admin_display_name,
        email: admin_email,
        passwordHash: passwordHash,
        isSuperAdmin: true
      });
    }

    conn.release();
    await setupPool.end();
    
    return res.json({ success: true, redirectUrl: '/backoffice-sec-9x2k' });
  } catch (err) {
    console.error('Installation error:', err);
    if (conn) {
      try { conn.release(); } catch (_) {}
    }
    if (setupPool) {
      await setupPool.end().catch(() => {});
    }
    return res.status(500).json({ success: false, error: err.message || 'Installation setup failed.' });
  }
};

exports.checkIsInstalled = checkIsInstalled;
