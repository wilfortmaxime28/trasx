const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Initial load of environment variables
dotenv.config();

let currentPool = null;
let poolId = 1;

function createPool() {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'weshare';
  
  return mysql.createPool({
    host,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z'
  });
}

// Try to initialize the pool initially
try {
  currentPool = createPool();
} catch (err) {
  console.error('Failed to initialize database pool initially:', err.message);
}

function recreatePool() {
  // Reload dotenv from the filesystem (forcing update of process.env)
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }
  }
  
  const oldPool = currentPool;
  currentPool = createPool();
  poolId++;
  
  if (oldPool) {
    oldPool.end().catch(err => {
      console.error('Error closing old database pool:', err);
    });
  }
  console.log('Database connection pool recreated successfully.');
}

async function testConnection(config) {
  let testPool = null;
  try {
    testPool = mysql.createPool({
      host: config.host,
      user: config.user,
      password: config.password,
      database: config.database,
      connectTimeout: 5000
    });
    const conn = await testPool.getConnection();
    conn.release();
    await testPool.end();
    return true;
  } catch (err) {
    console.error('Database connection test failed:', err.message);
    if (testPool) {
      await testPool.end().catch(() => {});
    }
    return false;
  }
}

// Proxy all requests to currentPool, allowing us to swap the pool dynamically
const poolWrapper = new Proxy({}, {
  get(target, prop, receiver) {
    if (prop === 'poolId') {
      return poolId;
    }
    if (prop === 'recreatePool') {
      return recreatePool;
    }
    if (prop === 'testConnection') {
      return testConnection;
    }
    if (!currentPool) {
      throw new Error(`Database connection not initialized (requested property: ${String(prop)})`);
    }
    const value = currentPool[prop];
    if (typeof value === 'function') {
      return value.bind(currentPool);
    }
    return value;
  }
});

module.exports = poolWrapper;
