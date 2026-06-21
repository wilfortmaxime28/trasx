const db = require('../config/db');
const User = require('../models/User');
const P2PMarket = require('../models/P2PMarket');
const adminController = require('../controllers/adminController');

async function runDisputesTest() {
  console.log('=== STARTING ADMIN DISPUTES INTEGRATION TEST ===');

  let testUserId = null;
  let buyerUserId = null;
  let sellerUserId = null;
  let offerId = null;
  let orderId1 = null;
  let orderId2 = null;
  let disputeId = null;

  try {
    await P2PMarket.ensureSchema();
    // 1. Setup Test User for Blocked Account Dispute
    const [userRes] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['testdisputant', 'disputant@example.com', 'hash', 'Marc', 'Vasseur', '1995-05-05', '987654321', 'Belgique', 'None', 'Blocked']
    );
    testUserId = userRes.insertId;
    console.log(`Created blocked test user with ID: ${testUserId}`);

    // Create a dispute entry
    const [dispRes] = await db.query(
      `INSERT INTO disputes (user_id, status, message) VALUES (?, 'pending', ?)`,
      [testUserId, 'Mon compte a été faussement bloqué. Merci de vérifier mes infos.']
    );
    disputeId = dispRes.insertId;
    console.log(`Created account dispute entry with ID: ${disputeId}`);

    // Mock Express Request & Response for resolveAccountDispute (Approve)
    const reqApprove = {
      body: { dispute_id: disputeId, action: 'approve' },
      query: {},
      headers: {},
      session: { adminId: 1 }
    };

    let redirectedTo = '';
    const resMock = {
      redirect: (url) => {
        redirectedTo = url;
      }
    };

    console.log('Testing resolveAccountDispute: APPROVE...');
    await adminController.resolveAccountDispute(reqApprove, resMock);
    console.log('Redirected to:', redirectedTo);

    // Verify database state for User and Dispute
    const [uApprove] = await db.query('SELECT account_status, allow_dispute FROM users WHERE id = ?', [testUserId]);
    const [dApprove] = await db.query('SELECT status FROM disputes WHERE id = ?', [disputeId]);
    console.log('User status after approval:', uApprove[0].account_status, '(Expected: Active)');
    console.log('User allow_dispute after approval:', uApprove[0].allow_dispute, '(Expected: 0)');
    console.log('Dispute status after approval:', dApprove[0].status, '(Expected: resolved)');

    if (uApprove[0].account_status !== 'Active' || uApprove[0].allow_dispute !== 0 || dApprove[0].status !== 'resolved') {
      throw new Error('Dispute approval state verification failed.');
    }

    // Reset user to Blocked and create another dispute for Reject test
    await db.query('UPDATE users SET account_status = "Blocked", allow_dispute = 1 WHERE id = ?', [testUserId]);
    await db.query('UPDATE disputes SET status = "pending" WHERE id = ?', [disputeId]);

    const reqReject = {
      body: { dispute_id: disputeId, action: 'reject' },
      query: {},
      headers: {},
      session: { adminId: 1 }
    };

    console.log('Testing resolveAccountDispute: REJECT...');
    await adminController.resolveAccountDispute(reqReject, resMock);

    const [uReject] = await db.query('SELECT account_status, allow_dispute FROM users WHERE id = ?', [testUserId]);
    const [dReject] = await db.query('SELECT status FROM disputes WHERE id = ?', [disputeId]);
    console.log('User status after rejection:', uReject[0].account_status, '(Expected: Blocked)');
    console.log('User allow_dispute after rejection:', uReject[0].allow_dispute, '(Expected: 0)');
    console.log('Dispute status after rejection:', dReject[0].status, '(Expected: resolved)');

    if (uReject[0].account_status !== 'Blocked' || uReject[0].allow_dispute !== 0 || dReject[0].status !== 'resolved') {
      throw new Error('Dispute rejection state verification failed.');
    }

    // Now test Re-verify (reverify action)
    console.log('\nTesting resolveAccountDispute: REVERIFY...');
    // Create a pending KYC request
    await db.query(
      `INSERT INTO kyc_requests (user_id, request_type, status, document_url, document_name, selfie_url, selfie_name)
       VALUES (?, 'withdrawal', 'pending', 'http://doc.jpg', 'doc.jpg', 'http://selfie.jpg', 'selfie.jpg')
       ON DUPLICATE KEY UPDATE status='pending', document_url='http://doc.jpg', document_name='doc.jpg', selfie_url='http://selfie.jpg', selfie_name='selfie.jpg'`,
      [testUserId]
    );

    // Reset user and dispute status for reverify
    await db.query('UPDATE users SET account_status = "Blocked", allow_dispute = 1 WHERE id = ?', [testUserId]);
    await db.query('UPDATE disputes SET status = "pending" WHERE id = ?', [disputeId]);

    const reqReverify = {
      body: { dispute_id: disputeId, action: 'reverify' },
      query: {},
      headers: {},
      session: { adminId: 1 }
    };

    await adminController.resolveAccountDispute(reqReverify, resMock);

    const [uReverify] = await db.query('SELECT account_status, allow_dispute FROM users WHERE id = ?', [testUserId]);
    const [dReverify] = await db.query('SELECT status FROM disputes WHERE id = ?', [disputeId]);
    const [kReverify] = await db.query('SELECT status, document_url, selfie_url FROM kyc_requests WHERE user_id = ?', [testUserId]);

    console.log('User status after reverify:', uReverify[0].account_status, '(Expected: Active)');
    console.log('User allow_dispute after reverify:', uReverify[0].allow_dispute, '(Expected: 0)');
    console.log('Dispute status after reverify:', dReverify[0].status, '(Expected: resolved)');
    console.log('KYC status after reverify:', kReverify[0].status, '(Expected: draft)');
    console.log('KYC document_url after reverify:', kReverify[0].document_url, '(Expected: null)');

    if (uReverify[0].account_status !== 'Active' || uReverify[0].allow_dispute !== 0 || dReverify[0].status !== 'resolved' || kReverify[0].status !== 'draft' || kReverify[0].document_url !== null) {
      throw new Error('Dispute reverify state verification failed.');
    }

    // Clean up kyc request
    await db.query('DELETE FROM kyc_requests WHERE user_id = ?', [testUserId]);



    // 2. Setup Test P2P Dispute Data
    console.log('\n--- Setup P2P Order Dispute Data ---');
    const [buyerRes] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, deposit_account_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['buyerp2p', 'buyerp2p@example.com', 'hash', 'Acheteur', 'P2P', '1990-01-01', '111111111', 'France', 'None', 0.0]
    );
    buyerUserId = buyerRes.insertId;

    const [sellerRes] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, deposit_account_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['sellerp2p', 'sellerp2p@example.com', 'hash', 'Vendeur', 'P2P', '1985-01-01', '222222222', 'France', 'None', 50.0]
    );
    sellerUserId = sellerRes.insertId;

    // Create a P2P Offer
    const [offerRes] = await db.query(
      `INSERT INTO p2p_offers (user_id, offer_type, asset_code, available_amount, min_amount, max_amount, price, payment_methods, status)
       VALUES (?, 'sell', 'USDT', 50.0, 10.0, 50.0, 1.0, 'Bank Transfer', 'active')`,
      [sellerUserId]
    );
    offerId = offerRes.insertId;

    // Create order 1 for Release Dispute test
    const [order1Res] = await db.query(
      `INSERT INTO p2p_orders (offer_id, offer_owner_id, buyer_user_id, seller_user_id, taker_user_id, unit_price, total_price, escrow_user_id, escrow_amount, status)
       VALUES (?, ?, ?, ?, ?, 1.0, 50.0, ?, 50.0, 'disputed')`,
      [offerId, sellerUserId, buyerUserId, sellerUserId, buyerUserId, sellerUserId]
    );
    orderId1 = order1Res.insertId;

    // Mock resolveP2PDispute (Release)
    const reqRelease = {
      body: { order_id: orderId1, action: 'release' },
      query: {},
      headers: {},
      session: { adminId: 1 },
      app: { get: (name) => null } // Stub io
    };

    console.log('Testing resolveP2PDispute: RELEASE...');
    await adminController.resolveP2PDispute(reqRelease, resMock);

    // Verify order 1 and buyer balance
    const [o1] = await db.query('SELECT status FROM p2p_orders WHERE id = ?', [orderId1]);
    const [b1] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [buyerUserId]);
    console.log('Order 1 status after release:', o1[0].status, '(Expected: released)');
    console.log('Buyer balance after release:', b1[0].deposit_account_balance, '(Expected: 50.0)');

    if (o1[0].status !== 'released' || Number(b1[0].deposit_account_balance) !== 50.0) {
      throw new Error('P2P Dispute Release verification failed.');
    }

    // Create order 2 for Refund Dispute test
    const [order2Res] = await db.query(
      `INSERT INTO p2p_orders (offer_id, offer_owner_id, buyer_user_id, seller_user_id, taker_user_id, unit_price, total_price, escrow_user_id, escrow_amount, status)
       VALUES (?, ?, ?, ?, ?, 1.0, 50.0, ?, 50.0, 'disputed')`,
      [offerId, sellerUserId, buyerUserId, sellerUserId, buyerUserId, sellerUserId]
    );
    orderId2 = order2Res.insertId;

    // Mock resolveP2PDispute (Refund)
    const reqRefund = {
      body: { order_id: orderId2, action: 'refund' },
      query: {},
      headers: {},
      session: { adminId: 1 },
      app: { get: (name) => null } // Stub io
    };

    console.log('Testing resolveP2PDispute: REFUND...');
    await adminController.resolveP2PDispute(reqRefund, resMock);

    // Verify order 2 and seller balance
    const [o2] = await db.query('SELECT status FROM p2p_orders WHERE id = ?', [orderId2]);
    const [s2] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [sellerUserId]);
    console.log('Order 2 status after refund:', o2[0].status, '(Expected: cancelled)');
    console.log('Seller balance after refund:', s2[0].deposit_account_balance, '(Expected: 100.0)');

    if (o2[0].status !== 'cancelled' || Number(s2[0].deposit_account_balance) !== 100.0) {
      throw new Error('P2P Dispute Refund verification failed.');
    }

    console.log('\n=== ALL INTEGRATION TESTS PASSED CLEANLY ===');

  } catch (error) {
    console.error('\n>> INTEGRATION TEST RUN FAILED:', error.message);
  } finally {
    // Clean up
    console.log('\n--- Cleaning up test records ---');
    if (disputeId) {
      await db.query('DELETE FROM disputes WHERE id = ?', [disputeId]);
    }
    if (testUserId) {
      await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
    }
    if (orderId1) {
      await db.query('DELETE FROM p2p_orders WHERE id = ?', [orderId1]);
    }
    if (orderId2) {
      await db.query('DELETE FROM p2p_orders WHERE id = ?', [orderId2]);
    }
    if (offerId) {
      await db.query('DELETE FROM p2p_offers WHERE id = ?', [offerId]);
    }
    if (buyerUserId) {
      await db.query('DELETE FROM users WHERE id = ?', [buyerUserId]);
    }
    if (sellerUserId) {
      await db.query('DELETE FROM users WHERE id = ?', [sellerUserId]);
    }
    console.log('Clean up done.');
    process.exit(0);
  }
}

runDisputesTest();
