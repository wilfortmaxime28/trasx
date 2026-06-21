const db = require('../config/db');
const P2PMarket = require('../models/P2PMarket');
const User = require('../models/User');

async function main() {
  console.log('--- STARTING P2P INTEGRATION TESTS ---');
  let testOfferId = null;
  let testOrderId = null;

  try {
    // 1. Get test users
    const [users] = await db.query('SELECT id, username, email, token_balance, withdrawal_account_balance FROM users WHERE email IN (?, ?)', [
      'cameron@example.com',
      'terry@example.com'
    ]);

    const cameron = users.find(u => u.email === 'cameron@example.com');
    const terry = users.find(u => u.email === 'terry@example.com');

    if (!cameron || !terry) {
      throw new Error('Test users Cameron and Terry not found in the database.');
    }

    console.log('Test Users:', {
      cameron: { id: cameron.id, username: cameron.username, tokens: cameron.token_balance },
      terry: { id: terry.id, username: terry.username, balance: terry.withdrawal_account_balance }
    });

    // Ensure Cameron has tokens for selling
    await db.query('UPDATE users SET token_balance = 50.0000 WHERE id = ?', [cameron.id]);
    console.log('Cameron token balance set to 50.0000.');

    // 2. Create a Token offer with commas in numbers to test normalization and exchange rate calculation
    console.log('\nCreating P2P Token offer with exchange rate "133,5" and amount "20,5"...');
    
    // Simulating frontend calculated price: rate * admin_token_price = 133.5 * 0.1 = 13.35
    const computedPrice = '13,35'; 

    testOfferId = await P2PMarket.createOffer(cameron.id, {
      offerType: 'sell',
      assetCode: 'TOKEN',
      currencyCode: 'HTG',
      price: computedPrice,
      usdRate: '133,5',
      totalAmount: '20,5',
      minAmount: '5,25',
      maxAmount: '15,75',
      paymentMethods: 'MonCash,Sogebank',
      paymentAccountName: 'Cameron W',
      paymentAccountNumber: '12345678',
      terms: 'Vente de tokens test avec virgule'
    });

    console.log(`Offer created successfully! ID: ${testOfferId}`);

    // 3. Verify database row contents
    const [offers] = await db.query('SELECT * FROM p2p_offers WHERE id = ?', [testOfferId]);
    const offer = offers[0];
    if (!offer) {
      throw new Error('Could not find created offer in the database.');
    }

    console.log('Database Offer Row values:', {
      id: offer.id,
      user_id: offer.user_id,
      offer_type: offer.offer_type,
      asset_code: offer.asset_code,
      currency_code: offer.currency_code,
      price: offer.price,
      usd_rate: offer.usd_rate,
      min_amount: offer.min_amount,
      max_amount: offer.max_amount,
      total_amount: offer.total_amount,
      available_amount: offer.available_amount,
      payment_account_name: offer.payment_account_name,
      payment_account_number: offer.payment_account_number,
      status: offer.status
    });

    // Check assertions
    if (Number(offer.usd_rate) !== 133.5) throw new Error(`usd_rate expected 133.5, got ${offer.usd_rate}`);
    if (Number(offer.price) !== 13.35) throw new Error(`price expected 13.35, got ${offer.price}`);
    if (Number(offer.total_amount) !== 20.5) throw new Error(`total_amount expected 20.5, got ${offer.total_amount}`);
    if (Number(offer.min_amount) !== 5.25) throw new Error(`min_amount expected 5.25, got ${offer.min_amount}`);
    if (Number(offer.max_amount) !== 15.75) throw new Error(`max_amount expected 15.75, got ${offer.max_amount}`);
    console.log('>> SUCCESS: All comma-to-period normalization and pricing assertion tests passed!');

    // 4. Create an order from Terry (buyer) to buy some of Cameron's tokens
    console.log('\nCreating P2P order as Terry to buy "10,25" tokens from Cameron...');
    const orderResult = await P2PMarket.createOrder(terry.id, {
      offerId: testOfferId,
      amount: '10,25'
    });

    testOrderId = orderResult.orderId;
    console.log(`Order created successfully! ID: ${testOrderId}`, orderResult);

    // 5. Verify order database row contents
    const [orders] = await db.query('SELECT * FROM p2p_orders WHERE id = ?', [testOrderId]);
    const order = orders[0];
    if (!order) {
      throw new Error('Could not find created order in the database.');
    }

    console.log('Database Order Row values:', {
      id: order.id,
      offer_id: order.offer_id,
      buyer_user_id: order.buyer_user_id,
      seller_user_id: order.seller_user_id,
      amount: order.amount,
      unit_price: order.unit_price,
      total_price: order.total_price,
      status: order.status
    });

    if (Number(order.amount) !== 10.25) throw new Error(`order amount expected 10.25, got ${order.amount}`);
    if (Number(order.unit_price) !== 13.35) throw new Error(`order unit_price expected 13.35, got ${order.unit_price}`);
    // total_price should be amount * unit_price = 10.25 * 13.35 = 136.8375, rounded to 2 decimals = 136.84
    if (Number(order.total_price) !== 136.84) throw new Error(`order total_price expected 136.84, got ${order.total_price}`);
    console.log('>> SUCCESS: Order placement and precision math assertion tests passed!');

    // 6. Clean up database
    console.log('\nCleaning up test order and offer...');
    await db.query('DELETE FROM p2p_orders WHERE id = ?', [testOrderId]);
    await db.query('DELETE FROM p2p_offers WHERE id = ?', [testOfferId]);
    console.log('Cleanup completed successfully.');

    console.log('\n--- ALL P2P INTEGRATION TESTS COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('\n>> TEST FAILED:', err.message);
    // Cleanup if possible
    if (testOrderId) await db.query('DELETE FROM p2p_orders WHERE id = ?', [testOrderId]).catch(() => {});
    if (testOfferId) await db.query('DELETE FROM p2p_offers WHERE id = ?', [testOfferId]).catch(() => {});
  } finally {
    process.exit();
  }
}

main();
