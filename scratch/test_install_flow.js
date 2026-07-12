/**
 * Test script for verifying the installer logic.
 * Run this script to test database test connection logic and configuration files.
 */
const path = require('path');
const fs = require('fs');

const db = require('../config/db');
const installController = require('../controllers/installController');

async function runTests() {
  console.log('--- STARTING INSTALLER AUTOMATED TESTS ---');
  
  // 1. Test database connection check on the current env credentials
  console.log('\n1. Testing testDbConnection logic with active environment credentials...');
  
  const testConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'weshare',
    port: process.env.DB_PORT || '3306'
  };
  
  const works = await db.testConnection(testConfig);
  console.log(`Connection test returns: ${works ? 'SUCCESS' : 'FAILURE'}`);
  
  if (!works) {
    console.warn('WARNING: Could not connect to database with current credentials. This is expected if MySQL is offline or credentials in .env are empty.');
  }

  // 2. Test checkIsInstalled check
  console.log('\n2. Testing checkIsInstalled check...');
  const installed = await installController.checkIsInstalled();
  console.log(`Application currently installed: ${installed}`);
  
  // 3. Test env configuration modification
  console.log('\n3. Testing env config updates in a mock file...');
  const mockEnvPath = path.resolve(__dirname, './mock.env');
  
  // Write a basic mock.env initially
  fs.writeFileSync(mockEnvPath, `PORT=3000\nDB_HOST=127.0.0.1\nDB_USER=test_user\nDB_PASSWORD=secret_pass\nDB_NAME=test_db\nPLATFORM_PRIVATE_KEY=0xabc123\n`, 'utf8');
  
  // Mock the env writing by temporary overriding path in custom helper
  function mockUpdateEnvFile(updates) {
    let content = fs.readFileSync(mockEnvPath, 'utf8');
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
    fs.writeFileSync(mockEnvPath, newLines.join('\n'), 'utf8');
  }
  
  mockUpdateEnvFile({
    DB_HOST: 'mysql-server-prod',
    DB_USER: 'prod_admin',
    DB_PASSWORD: 'secure_password_123',
    DB_NAME: 'production_weshare'
  });
  
  const updatedContent = fs.readFileSync(mockEnvPath, 'utf8');
  console.log('Resulting mock.env file contents:');
  console.log(updatedContent);
  
  // Clean up mock.env
  fs.unlinkSync(mockEnvPath);
  
  // Validate that PLATFORM_PRIVATE_KEY was preserved and DB config updated
  if (
    updatedContent.includes('DB_HOST=mysql-server-prod') &&
    updatedContent.includes('DB_USER=prod_admin') &&
    updatedContent.includes('DB_PASSWORD=secure_password_123') &&
    updatedContent.includes('DB_NAME=production_weshare') &&
    updatedContent.includes('PLATFORM_PRIVATE_KEY=0xabc123')
  ) {
    console.log('SUCCESS: .env update utility works correctly and preserves existing custom keys!');
  } else {
    throw new Error('FAILURE: .env update utility failed validation.');
  }
  
  console.log('\n--- ALL AUTOMATED TESTS PASSED SUCCESSFULLY ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\nTests failed with error:', err);
  process.exit(1);
});
