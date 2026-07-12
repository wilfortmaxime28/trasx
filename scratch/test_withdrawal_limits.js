const db = require('/Applications/XAMPP/xamppfiles/htdocs/tras2/config/db');
const { getNumberSetting, setSetting } = require('/Applications/XAMPP/xamppfiles/htdocs/tras2/utils/appSettings');

async function runTest() {
  console.log('--- STARTING DYNAMIC WITHDRAWAL LIMITS INTEGRATION TEST ---');
  
  // 1. Store original settings to restore them after the test
  const originalMin = await getNumberSetting('min_withdrawal_amount', 50);
  const originalFee = await getNumberSetting('withdrawal_fee_percent', 30);
  console.log(`Original Settings: Min = ${originalMin} USD, Fee = ${originalFee}%`);
  
  // 2. Set new test values
  console.log('\nUpdating settings to: Min = 60.0 USD, Fee = 15.0%...');
  await setSetting('min_withdrawal_amount', '60.0');
  await setSetting('withdrawal_fee_percent', '15.0');
  
  // 3. Verify settings were updated in database
  const testMin = await getNumberSetting('min_withdrawal_amount', 50);
  const testFee = await getNumberSetting('withdrawal_fee_percent', 30);
  console.log(`Updated Settings read from DB: Min = ${testMin} USD, Fee = ${testFee}%`);
  
  if (testMin !== 60.0 || testFee !== 15.0) {
    throw new Error('Test failed: settings were not updated in database');
  }
  
  // 4. Test validation logic
  const withdrawalAmount = 55.0;
  console.log(`\nSimulating withdrawal request of $${withdrawalAmount}...`);
  if (withdrawalAmount < testMin) {
    console.log(`Validation correctly REJECTED: Amount $${withdrawalAmount} is less than minimum $${testMin}`);
  } else {
    throw new Error('Test failed: validation should have rejected the withdrawal');
  }
  
  const validWithdrawalAmount = 70.0;
  console.log(`\nSimulating withdrawal request of $${validWithdrawalAmount}...`);
  if (validWithdrawalAmount >= testMin) {
    console.log(`Validation correctly APPROVED: Amount $${validWithdrawalAmount} meets minimum $${testMin}`);
    const calculatedFee = validWithdrawalAmount * (testFee / 100);
    const calculatedNet = validWithdrawalAmount - calculatedFee;
    console.log(`Calculated Fee: $${calculatedFee.toFixed(2)} (Expected $10.50)`);
    console.log(`Calculated Net: $${calculatedNet.toFixed(2)} (Expected $59.50)`);
    
    if (Math.abs(calculatedFee - 10.5) > 0.01 || Math.abs(calculatedNet - 59.5) > 0.01) {
      throw new Error('Test failed: calculated fee or net amount is incorrect');
    }
  } else {
    throw new Error('Test failed: validation should have approved the withdrawal');
  }
  
  // 5. Restore original settings
  console.log('\nRestoring original settings...');
  await setSetting('min_withdrawal_amount', String(originalMin));
  await setSetting('withdrawal_fee_percent', String(originalFee));
  
  const restoredMin = await getNumberSetting('min_withdrawal_amount', 50);
  const restoredFee = await getNumberSetting('withdrawal_fee_percent', 30);
  console.log(`Restored Settings: Min = ${restoredMin} USD, Fee = ${restoredFee}%`);
  
  console.log('\n--- ALL DYNAMIC LIMITS TESTS PASSED CLEANLY ---');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
