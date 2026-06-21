const db = require('../config/db');

async function main() {
  try {
    for (const userId of [18, 23]) {
      console.log(`\n=== User ID: ${userId} ===`);
      const [users] = await db.query(
        'SELECT id, username, email, certification_type, account_status, withdrawal_account_balance FROM users WHERE id = ?',
        [userId]
      );
      if (users.length === 0) {
        console.log('Not found');
        continue;
      }
      const user = users[0];
      console.log('User Details:', user);

      const [withdrawals] = await db.query(
        'SELECT id, amount_usdt, status, created_at FROM bsc_withdrawals WHERE user_id = ?',
        [userId]
      );
      console.log('Withdrawals Count:', withdrawals.length);
      console.log('Withdrawals:', withdrawals);

      const [kycRequests] = await db.query(
        'SELECT id, status, request_type, document_name, submitted_full_name FROM kyc_requests WHERE user_id = ?',
        [userId]
      );
      console.log('KYC Requests:', kycRequests);
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
