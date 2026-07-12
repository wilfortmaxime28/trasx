const db = require('../config/db');
const Admin = require('../models/Admin');
const User = require('../models/User');
const adminController = require('../controllers/adminController');

async function testOperationsBalance() {
  console.log('=== STARTING ADMIN OPERATIONS BALANCE TEST ===');
  let testUserId = null;

  try {
    // 1. Get primary admin
    const admin = await Admin.getPrimaryAdmin();
    if (!admin) {
      throw new Error('Primary admin not found.');
    }
    const initialOpsBalance = Number(admin.operations_balance || 0);
    console.log(`Initial admin operations balance: $${initialOpsBalance.toFixed(2)}`);

    // 2. Setup a test user
    const [userRes] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, deposit_account_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ops_test_user', 'ops_test@example.com', 'hash', 'Test', 'Ops', '1990-01-01', '123456789', 'France', 'None', 10.0]
    );
    testUserId = userRes.insertId;
    console.log(`Created test user with ID: ${testUserId}`);

    // Mock Express Request & Response for balanceTopUp (Credit user)
    const reqTopUp = {
      body: {
        scope: 'user',
        user_lookup: 'ops_test_user',
        account_type: 'deposit',
        amount: '50.00',
        note: 'Test Credit Operations'
      },
      query: {},
      headers: {},
      session: { adminId: admin.id },
      app: { get: (name) => null } // Stub io
    };

    let responsePayload = null;
    const resMock = {
      status: (code) => ({
        json: (payload) => {
          responsePayload = payload;
        }
      }),
      json: (payload) => {
        responsePayload = payload;
      },
      redirect: (url) => {
        console.log('Redirect to:', url);
      }
    };

    console.log('Running balanceTopUp (Credit $50.00)...');
    await adminController.balanceTopUp(reqTopUp, resMock);
    
    // Verify target user's deposit balance
    const [uTopUp] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [testUserId]);
    const [aTopUp] = await db.query('SELECT operations_balance FROM admins WHERE id = ?', [admin.id]);
    const postTopUpUserBalance = Number(uTopUp[0].deposit_account_balance);
    const postTopUpAdminOpsBalance = Number(aTopUp[0].operations_balance);

    console.log(`User deposit balance after credit: $${postTopUpUserBalance.toFixed(2)} (Expected: $60.00)`);
    console.log(`Admin operations balance after credit: $${postTopUpAdminOpsBalance.toFixed(2)} (Expected: $${(initialOpsBalance - 50.0).toFixed(2)})`);

    if (postTopUpUserBalance !== 60.00 || postTopUpAdminOpsBalance !== (initialOpsBalance - 50.00)) {
      throw new Error('Credit operations balance verification failed.');
    }

    // Mock Express Request & Response for balanceDebit (Debit user)
    const reqDebit = {
      body: {
        user_lookup: 'ops_test_user',
        account_type: 'deposit',
        amount: '20,00', // Test comma input support too!
        note: 'Test Debit Operations'
      },
      query: {},
      headers: {},
      session: { adminId: admin.id },
      app: { get: (name) => null } // Stub io
    };

    console.log('Running balanceDebit (Debit $20.00)...');
    await adminController.balanceDebit(reqDebit, resMock);

    // Verify target user's deposit balance and admin ops balance
    const [uDebit] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [testUserId]);
    const [aDebit] = await db.query('SELECT operations_balance FROM admins WHERE id = ?', [admin.id]);
    const postDebitUserBalance = Number(uDebit[0].deposit_account_balance);
    const postDebitAdminOpsBalance = Number(aDebit[0].operations_balance);

    console.log(`User deposit balance after debit: $${postDebitUserBalance.toFixed(2)} (Expected: $40.00)`);
    console.log(`Admin operations balance after debit: $${postDebitAdminOpsBalance.toFixed(2)} (Expected: $${(initialOpsBalance - 30.0).toFixed(2)})`);

    if (postDebitUserBalance !== 40.00 || postDebitAdminOpsBalance !== (initialOpsBalance - 30.00)) {
      throw new Error('Debit operations balance verification failed.');
    }

    console.log('=== ADMIN OPERATIONS BALANCE TEST PASSED SUCCESSFULLY ===');
  } catch (error) {
    console.error('>> TEST FAILED:', error.message);
  } finally {
    console.log('Cleaning up test records...');
    if (testUserId) {
      await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
    }
    process.exit(0);
  }
}

testOperationsBalance();
