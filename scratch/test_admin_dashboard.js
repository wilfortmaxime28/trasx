const db = require('/Applications/XAMPP/xamppfiles/htdocs/tras2/config/db');

async function testAdminDashboardQueries() {
  console.log('--- STARTING ADMIN DASHBOARD TRANSACTIONS INTEGRATION TEST WITH SUCCESS SIMULATION ---');
  
  try {
    // 1. Insert a mock successful withdrawal
    console.log('Inserting mock completed withdrawal...');
    const [insertRes] = await db.query(`
      INSERT INTO bsc_withdrawals (user_id, recipient_address, amount_usdt, fee_usdt, net_amount_usdt, gas_cost_usdt, status, tx_hash)
      VALUES (2, '0x4e6c4a06f01c3b46704969bbec0da61fe03bc9a6', 100.0, 30.0, 70.0, 0.113498, 'completed', '0xabc123mocktxhash')
    `);
    const mockId = insertRes.insertId;
    console.log(`Mock withdrawal created with ID: ${mockId}`);

    // 2. Fetch user deposits history
    console.log('\nQuerying user deposits history...');
    const [deposits] = await db.query(`
      SELECT d.*, u.username, CONCAT(u.first_name, ' ', u.last_name) AS user_name, u.email
      FROM bsc_deposits d
      LEFT JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC
    `);
    console.log(`Deposits found: ${deposits.length}`);
    
    // 3. Fetch user withdrawals history
    console.log('\nQuerying user withdrawals history...');
    const [withdrawals] = await db.query(`
      SELECT w.*, u.username, CONCAT(u.first_name, ' ', u.last_name) AS user_name, u.email
      FROM bsc_withdrawals w
      LEFT JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC
    `);
    console.log(`Withdrawals found: ${withdrawals.length}`);
    
    // 4. Test profit calculation logic
    let calculatedTotalProfit = 0;
    let foundMock = false;
    
    withdrawals.forEach((w) => {
      const profit = w.status === 'completed' ? Math.max(0, Number(w.fee_usdt || 0) - Number(w.gas_cost_usdt || 0)) : 0;
      if (w.status === 'completed') {
        calculatedTotalProfit += profit;
      }
      if (w.id === mockId) {
        foundMock = true;
        console.log(`Verified Mock Withdrawal #${w.id} (${w.status}): Gross Fee = ${w.fee_usdt} USDT, Gas Cost = ${w.gas_cost_usdt} USDT -> Net Profit = ${profit.toFixed(6)} USDT (Expected: 29.886502 USDT)`);
        if (Math.abs(profit - 29.886502) > 0.001) {
          throw new Error('Test failed: net profit calculation mismatch');
        }
      }
    });
    
    console.log(`\nAccumulated withdrawal profit: $${calculatedTotalProfit.toFixed(2)} USD`);
    
    // 5. Clean up the mock record
    console.log('\nCleaning up mock record...');
    await db.query('DELETE FROM bsc_withdrawals WHERE id = ?', [mockId]);
    console.log('Cleanup complete.');
    
    if (!foundMock) {
      throw new Error('Test failed: mock withdrawal was not queried');
    }
    
    console.log('\n--- ALL ADMIN TRANSACTION QUERIES AND LOGIC PASSED CLEANLY ---');
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testAdminDashboardQueries();
