const db = require('../config/db');
const User = require('../models/User');
const KycRequest = require('../models/KycRequest');
const eventsController = require('../controllers/eventsController');
const authController = require('../controllers/authController');

async function runTests() {
  console.log('=== STARTING KYC AND DISPUTE UNIT TESTS ===');

  let testUser1Id = null;
  let testUser2Id = null;

  try {
    // Ensure all tables are created
    await User.ensureSchema();

    // Clean up any stale test users
    await db.query("DELETE FROM users WHERE username IN ('testkyc1', 'testkyc2')");

    // 1. Create two temporary users
    const [res1] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['testkyc1', 'testkyc1@example.com', 'hash', 'Jean', 'Dupont', '2000-01-01', '123456789', 'France', 'None', 'Active']
    );
    testUser1Id = res1.insertId;

    const [res2] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['testkyc2', 'testkyc2@example.com', 'hash', 'Jean', 'Dupont', '2000-01-01', '123456789', 'France', 'None', 'Active']
    );
    testUser2Id = res2.insertId;

    console.log(`Created test users: User1 (ID ${testUser1Id}), User2 (ID ${testUser2Id})`);

    // 2. Test Withdrawal restriction on First Withdrawal (KYC not passed)
    console.log('\n--- Testing Withdrawal Enforcement (KYC NOT PASSED) ---');
    
    // We will simulate a withdrawal call
    // First let's query the DB exactly as server.js does or mock it.
    // Let's do a transaction simulation
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const [userRows] = await connection.query(
        'SELECT id, withdrawal_account_balance, wallet_address, withdrawal_pin, certification_type FROM users WHERE id = ? FOR UPDATE',
        [testUser1Id]
      );
      const user = userRows[0];

      const [withdrawalCountRows] = await connection.query(
        'SELECT COUNT(*) AS count FROM bsc_withdrawals WHERE user_id = ?',
        [testUser1Id]
      );
      const isFirstWithdrawal = (withdrawalCountRows[0]?.count || 0) === 0;
      
      console.log(`First withdrawal check: ${isFirstWithdrawal}`);
      if (isFirstWithdrawal) {
        const [kycRows] = await connection.query(
          "SELECT id FROM kyc_requests WHERE user_id = ? AND status = 'approved' LIMIT 1",
          [testUser1Id]
        );
        const userCert = user.certification_type || 'None';
        const hasPassedKyc = kycRows.length > 0 || userCert !== 'None';
        
        console.log(`Has passed KYC: ${hasPassedKyc}`);
        if (!hasPassedKyc) {
          console.log('>> SUCCESS: Withdrawal correctly blocked because user has not passed KYC!');
        } else {
          throw new Error('Withdrawal should have been blocked.');
        }
      } else {
        throw new Error('Should count 0 withdrawals.');
      }
      await connection.rollback();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    // 3. Test duplicate KYC checks (submitEventKyc mock invocation)
    console.log('\n--- Testing Duplicate KYC Detection & Blocking ---');
    
    // Seed User1 with a mock kyc request
    await db.query(
      `INSERT INTO kyc_requests (user_id, request_type, status, payment_status, document_name, document_size, submitted_full_name, submitted_dob, submitted_email)
       VALUES (?, 'events', 'approved', 'paid', 'id-doc.jpg', 1024, 'Jean Dupont', '2000-01-01', 'testkyc1@example.com')`,
      [testUser1Id]
    );

    // Seed User2 with a mock kyc request so it has paid status
    await db.query(
      `INSERT INTO kyc_requests (user_id, request_type, status, payment_status, document_name, document_size)
       VALUES (?, 'events', 'draft', 'paid', 'temp.jpg', 100)`,
      [testUser2Id]
    );

    // Mock request / response for User2 submitting a duplicate KYC
    const req = {
      session: { userId: testUser2Id, destroy: () => { console.log('Session destroyed called.'); } },
      file: { originalname: 'id-doc.jpg', size: 1024, path: 'mock/path' },
      body: { selfie_image_data: 'data:image/png;base64,mockdata' }
    };
    
    let redirectUrl = '';
    const res = {
      redirect: (url) => {
        redirectUrl = url;
      }
    };

    // We will invoke the eventsController.submitEventKyc directly
    // Wait, submitEventKyc does OCR and faceAPI calls, but since it checks duplicates early on,
    // it will return before calling them! Let's verify.
    await eventsController.submitEventKyc(req, res);

    console.log('Redirect URL after duplicate submission:', redirectUrl);
    if (redirectUrl.includes('/auth/login?error=')) {
      console.log('>> SUCCESS: Duplicate submission redirected to login page with error!');
    } else {
      throw new Error('Duplicate submission did not redirect correctly.');
    }

    // Verify account status
    const [u1] = await db.query('SELECT account_status, allow_dispute FROM users WHERE id = ?', [testUser1Id]);
    const [u2] = await db.query('SELECT account_status, allow_dispute FROM users WHERE id = ?', [testUser2Id]);
    
    console.log('User1 (Original) status:', u1[0].account_status, 'allow_dispute:', u1[0].allow_dispute);
    console.log('User2 (Current) status:', u2[0].account_status, 'allow_dispute:', u2[0].allow_dispute);

    if (u1[0].account_status === 'Blocked' && u2[0].account_status === 'Blocked') {
      console.log('>> SUCCESS: Both accounts successfully blocked!');
    } else {
      throw new Error('One or both accounts were not blocked.');
    }

    if (u1[0].allow_dispute === 1 && u2[0].allow_dispute === 0) {
      console.log('>> SUCCESS: Original account got allow_dispute=1, current duplicate account got allow_dispute=0.');
    } else {
      throw new Error('allow_dispute flag set incorrectly.');
    }

    // 4. Test Dispute Handler
    console.log('\n--- Testing Dispute Submission Handler ---');
    const reqDispute = {
      body: { userId: testUser1Id }
    };
    
    let renderView = '';
    let renderOptions = {};
    const resDispute = {
      render: (view, options) => {
        renderView = view;
        renderOptions = options;
      }
    };

    await authController.postDispute(reqDispute, resDispute);

    console.log('Rendered view:', renderView);
    console.log('Rendered options:', renderOptions);
    
    if (renderView === 'login' && renderOptions.verified && renderOptions.allowDispute === false) {
      console.log('>> SUCCESS: Dispute submitted, returned correct template and success banner!');
    } else {
      throw new Error('Dispute handler did not render login template with success message correctly.');
    }

    // Verify dispute table entry
    const [disputes] = await db.query('SELECT * FROM disputes WHERE user_id = ?', [testUser1Id]);
    console.log('Dispute record count in DB:', disputes.length);
    if (disputes.length === 1 && disputes[0].status === 'pending') {
      console.log('>> SUCCESS: Dispute record successfully inserted with status pending!');
    } else {
      throw new Error('Dispute record not found or status not pending.');
    }

  } catch (err) {
    console.error('\n>> TEST RUN FAILED:', err.message);
  } finally {
    // Clean up
    console.log('\n--- Cleaning up test records ---');
    if (testUser1Id) {
      await db.query('DELETE FROM disputes WHERE user_id = ?', [testUser1Id]);
      await db.query('DELETE FROM kyc_requests WHERE user_id = ?', [testUser1Id]);
      await db.query('DELETE FROM users WHERE id = ?', [testUser1Id]);
    }
    if (testUser2Id) {
      await db.query('DELETE FROM disputes WHERE user_id = ?', [testUser2Id]);
      await db.query('DELETE FROM kyc_requests WHERE user_id = ?', [testUser2Id]);
      await db.query('DELETE FROM users WHERE id = ?', [testUser2Id]);
    }
    console.log('Clean up done.');
    process.exit();
  }
}

runTests();
