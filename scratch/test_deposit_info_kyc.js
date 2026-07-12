const db = require('../config/db');
const User = require('../models/User');

async function testDepositInfoKyc() {
  console.log('=== STARTING /api/wallet/deposit-info KYC FIELDS TEST ===');
  let testUserId = null;

  try {
    // 1. Create a test user
    const [res] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['testdepinfo', 'testdepinfo@example.com', 'hash', 'Jean', 'Dupont', '2000-01-01', '123456789', 'France', 'None', 'Active']
    );
    testUserId = res.insertId;
    console.log(`Created test user with ID: ${testUserId}`);

    // Mock the handler logic inside server.js for deposit-info
    const getDepositInfoStatus = async (userId) => {
      const user = await User.getById(userId);
      
      // Check if this is the user's first withdrawal
      const [withdrawalCountRows] = await db.query(
        "SELECT COUNT(*) AS count FROM bsc_withdrawals WHERE user_id = ? AND status != 'failed'",
        [userId]
      );
      const isFirstWithdrawal = (withdrawalCountRows[0]?.count || 0) === 0;

      // Check if user has passed KYC
      const [kycRows] = await db.query(
        "SELECT id FROM kyc_requests WHERE user_id = ? AND status = 'approved' LIMIT 1",
        [userId]
      );
      const hasPassedKyc = kycRows.length > 0;

      return { isFirstWithdrawal, hasPassedKyc };
    };

    // Scenario A: First withdrawal, KYC not passed
    let status = await getDepositInfoStatus(testUserId);
    console.log('Scenario A (No withdrawals, no KYC):');
    console.log(`- isFirstWithdrawal (Expected: true): ${status.isFirstWithdrawal}`);
    console.log(`- hasPassedKyc (Expected: false): ${status.hasPassedKyc}`);
    if (status.isFirstWithdrawal !== true || status.hasPassedKyc !== false) {
      throw new Error('Scenario A failed');
    }

    // Scenario B: First withdrawal, KYC passed via kyc_requests
    await db.query(
      `INSERT INTO kyc_requests (user_id, request_type, status, payment_status, document_name, document_size)
       VALUES (?, 'events', 'approved', 'paid', 'doc.jpg', 100)`,
      [testUserId]
    );
    status = await getDepositInfoStatus(testUserId);
    console.log('Scenario B (No withdrawals, KYC passed via kyc_requests):');
    console.log(`- isFirstWithdrawal (Expected: true): ${status.isFirstWithdrawal}`);
    console.log(`- hasPassedKyc (Expected: true): ${status.hasPassedKyc}`);
    if (status.isFirstWithdrawal !== true || status.hasPassedKyc !== true) {
      throw new Error('Scenario B failed');
    }

    // Scenario C: First withdrawal, KYC NOT passed because certification_type alone doesn't count
    // Clean up kyc_requests first
    await db.query('DELETE FROM kyc_requests WHERE user_id = ?', [testUserId]);
    await db.query("UPDATE users SET certification_type = 'Basique' WHERE id = ?", [testUserId]);
    status = await getDepositInfoStatus(testUserId);
    console.log('Scenario C (No withdrawals, certification_type only, expect KYC false):');
    console.log(`- isFirstWithdrawal (Expected: true): ${status.isFirstWithdrawal}`);
    console.log(`- hasPassedKyc (Expected: false): ${status.hasPassedKyc}`);
    if (status.isFirstWithdrawal !== true || status.hasPassedKyc !== false) {
      throw new Error('Scenario C failed');
    }

    // Scenario D: Not first withdrawal
    await db.query("UPDATE users SET certification_type = 'None' WHERE id = ?", [testUserId]);
    await db.query(
      `INSERT INTO bsc_withdrawals (user_id, recipient_address, amount_usdt, fee_usdt, net_amount_usdt, status)
       VALUES (?, '0x123', 50, 15, 35, 'completed')`,
      [testUserId]
    );
    status = await getDepositInfoStatus(testUserId);
    console.log('Scenario D (Has withdrawals, no KYC):');
    console.log(`- isFirstWithdrawal (Expected: false): ${status.isFirstWithdrawal}`);
    console.log(`- hasPassedKyc (Expected: false): ${status.hasPassedKyc}`);
    if (status.isFirstWithdrawal !== false || status.hasPassedKyc !== false) {
      throw new Error('Scenario D failed');
    }

    console.log('>> ALL /api/wallet/deposit-info SCENARIOS PASSED SUCCESSFULLY!');

  } catch (err) {
    console.error('>> TEST RUN FAILED:', err.message);
  } finally {
    // Clean up
    console.log('Cleaning up...');
    if (testUserId) {
      await db.query('DELETE FROM bsc_withdrawals WHERE user_id = ?', [testUserId]);
      await db.query('DELETE FROM kyc_requests WHERE user_id = ?', [testUserId]);
      await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
    }
    process.exit();
  }
}

testDepositInfoKyc();
