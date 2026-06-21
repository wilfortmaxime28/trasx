const db = require('../config/db');
const P2PMarket = require('../models/P2PMarket');

async function testNotifications() {
  console.log('--- STARTING NOTIFICATION UNIT TESTS ---');
  let offerId = null;
  let orderId = null;

  try {
    const [users] = await db.query('SELECT id, email FROM users WHERE email IN (?, ?)', [
      'cameron@example.com',
      'terry@example.com'
    ]);
    const cameron = users.find(u => u.email === 'cameron@example.com');
    const terry = users.find(u => u.email === 'terry@example.com');

    if (!cameron || !terry) {
      throw new Error('Test users Cameron and Terry not found.');
    }

    // Ensure Cameron has tokens
    await db.query('UPDATE users SET token_balance = 100.0000 WHERE id = ?', [cameron.id]);

    // Test 1: Close Offer returns assetCode
    console.log('\nTesting P2PMarket.closeOffer return attributes...');
    offerId = await P2PMarket.createOffer(cameron.id, {
      offerType: 'sell',
      assetCode: 'TOKEN',
      currencyCode: 'HTG',
      price: '13.35',
      usdRate: '133.5',
      totalAmount: '10.0',
      minAmount: '1.0',
      maxAmount: '10.0',
      paymentMethods: 'MonCash',
      paymentAccountName: 'Cameron W',
      paymentAccountNumber: '12345678',
      terms: 'Vente'
    });

    const closeResult = await P2PMarket.closeOffer(offerId, cameron.id);
    console.log('closeOffer result:', closeResult);
    if (closeResult.assetCode !== 'TOKEN') {
      throw new Error(`Expected closeResult.assetCode to be "TOKEN", got: ${closeResult.assetCode}`);
    }
    console.log('>> SUCCESS: closeOffer returned assetCode "TOKEN"!');

    // Test 2: Cancel Order returns assetCode
    console.log('\nTesting P2PMarket.cancelOrder return attributes...');
    offerId = await P2PMarket.createOffer(cameron.id, {
      offerType: 'sell',
      assetCode: 'TOKEN',
      currencyCode: 'HTG',
      price: '13.35',
      usdRate: '133.5',
      totalAmount: '10.0',
      minAmount: '1.0',
      maxAmount: '10.0',
      paymentMethods: 'MonCash',
      paymentAccountName: 'Cameron W',
      paymentAccountNumber: '12345678',
      terms: 'Vente'
    });

    const orderResult = await P2PMarket.createOrder(terry.id, {
      offerId: offerId,
      amount: '5.0'
    });
    orderId = orderResult.orderId;

    const cancelResult = await P2PMarket.cancelOrder(orderId, terry.id, 'Changement d avis');
    console.log('cancelOrder result:', cancelResult);
    if (cancelResult.assetCode !== 'TOKEN') {
      throw new Error(`Expected cancelResult.assetCode to be "TOKEN", got: ${cancelResult.assetCode}`);
    }
    console.log('>> SUCCESS: cancelOrder returned assetCode "TOKEN"!');

    // Test 3: Dispute Order returns assetCode
    console.log('\nTesting P2PMarket.disputeOrder return attributes...');
    // Create new order to dispute
    const orderResult2 = await P2PMarket.createOrder(terry.id, {
      offerId: offerId, // reuse the offer (it has available amount again after cancel)
      amount: '5.0'
    });
    const orderId2 = orderResult2.orderId;

    const disputeResult = await P2PMarket.disputeOrder(orderId2, terry.id, 'Litige test');
    console.log('disputeOrder result:', disputeResult);
    if (disputeResult.assetCode !== 'TOKEN') {
      throw new Error(`Expected disputeResult.assetCode to be "TOKEN", got: ${disputeResult.assetCode}`);
    }
    console.log('>> SUCCESS: disputeOrder returned assetCode "TOKEN"!');

    // Clean up
    console.log('\nCleaning up database rows...');
    await db.query('DELETE FROM p2p_orders WHERE offer_id = ?', [offerId]);
    await db.query('DELETE FROM p2p_offers WHERE id = ?', [offerId]);
    console.log('Cleanup finished.');

    console.log('\n--- ALL NOTIFICATION UNIT TESTS PASSED ---');
  } catch (err) {
    console.error('\n>> TEST FAILED:', err.message);
    if (offerId) {
      await db.query('DELETE FROM p2p_orders WHERE offer_id = ?', [offerId]).catch(() => {});
      await db.query('DELETE FROM p2p_offers WHERE id = ?', [offerId]).catch(() => {});
    }
  } finally {
    process.exit();
  }
}

testNotifications();
