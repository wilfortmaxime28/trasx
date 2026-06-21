const db = require('../config/db');
const User = require('../models/User');
const adminController = require('../controllers/adminController');

async function testBalanceTopUp() {
  console.log('=== STARTING BALANCE TOP-UP ACCOUNT SELECTION TESTS ===');
  let testUserId = null;

  try {
    // 1. Ensure all schemas/tables exist
    await User.ensureSchema();

    // 2. Clean up any stale test user
    await db.query("DELETE FROM users WHERE username = 'testtopup'");

    // 3. Create a test user
    const [res] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, certification_type, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.00, 0.00, 0.00, 'None', 'Active')`,
      ['testtopup', 'testtopup@example.com', 'hash', 'Jean', 'Dupont', '2000-01-01', '123456789', 'France']
    );
    testUserId = res.insertId;

    console.log(`Created test user ID: ${testUserId}`);

    // Ensure admin has enough balance to credit in test environment
    await db.query("UPDATE admins SET balance = 999999.00");

    // Mock response object
    let redirectUrl = '';
    const mockRes = {
      redirect: (url) => {
        redirectUrl = url;
      }
    };

    // Test A: Top up Deposit Account
    console.log('\n--- Test A: Top up Deposit Account ---');
    const reqA = {
      app: { get: (name) => null }, // Mock socket io
      headers: {},
      body: {
        scope: 'user',
        user_lookup: 'testtopup',
        amount: '150.00',
        account_type: 'deposit',
        note: 'Deposit Top-up Test'
      }
    };
    
    await adminController.balanceTopUp(reqA, mockRes);
    
    let [uA] = await db.query('SELECT deposit_account_balance, withdrawal_account_balance, bonus_account_balance FROM users WHERE id = ?', [testUserId]);
    console.log('Balances after Deposit credit:', uA[0]);
    if (Number(uA[0].deposit_account_balance) === 150 && Number(uA[0].withdrawal_account_balance) === 0 && Number(uA[0].bonus_account_balance) === 0) {
      console.log('>> SUCCESS: Deposit account credited successfully!');
    } else {
      throw new Error('Incorrect balance after Deposit credit.');
    }

    // Test B: Top up Withdrawal Account
    console.log('\n--- Test B: Top up Withdrawal Account ---');
    const reqB = {
      app: { get: (name) => null },
      headers: {},
      body: {
        scope: 'user',
        user_lookup: 'testtopup',
        amount: '50.00',
        account_type: 'withdrawal',
        note: 'Withdrawal Top-up Test'
      }
    };

    await adminController.balanceTopUp(reqB, mockRes);

    let [uB] = await db.query('SELECT deposit_account_balance, withdrawal_account_balance, bonus_account_balance FROM users WHERE id = ?', [testUserId]);
    console.log('Balances after Withdrawal credit:', uB[0]);
    if (Number(uB[0].deposit_account_balance) === 150 && Number(uB[0].withdrawal_account_balance) === 50 && Number(uB[0].bonus_account_balance) === 0) {
      console.log('>> SUCCESS: Withdrawal account credited successfully!');
    } else {
      throw new Error('Incorrect balance after Withdrawal credit.');
    }

    // Test C: Top up Bonus Account
    console.log('\n--- Test C: Top up Bonus Account ---');
    const reqC = {
      app: { get: (name) => null },
      headers: {},
      body: {
        scope: 'user',
        user_lookup: 'testtopup',
        amount: '20.00',
        account_type: 'bonus',
        note: 'Bonus Top-up Test'
      }
    };

    await adminController.balanceTopUp(reqC, mockRes);

    let [uC] = await db.query('SELECT deposit_account_balance, withdrawal_account_balance, bonus_account_balance FROM users WHERE id = ?', [testUserId]);
    console.log('Balances after Bonus credit:', uC[0]);
    if (Number(uC[0].deposit_account_balance) === 150 && Number(uC[0].withdrawal_account_balance) === 50 && Number(uC[0].bonus_account_balance) === 20) {
      console.log('>> SUCCESS: Bonus account credited successfully!');
    } else {
      throw new Error('Incorrect balance after Bonus credit.');
    }

    console.log('\n=== ALL TOP-UP ACCOUNT SELECTION TESTS PASSED ===');

  } catch (error) {
    console.error('\n>> TEST RUN FAILED:', error.message);
  } finally {
    // Clean up test user
    if (testUserId) {
      console.log('\n--- Cleaning up test records ---');
      await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
      console.log('Clean up done.');
    }
    process.exit();
  }
}

testBalanceTopUp();
