const db = require('../config/db');

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: node scripts/unverify_user.js <userId>");
    process.exit(1);
  }

  console.log(`Resetting verification statuses for user ID: ${userId}...`);

  try {

    // 2. Reset events KYC activation
    await db.query("UPDATE users SET events_status = NULL, events_activated_at = NULL WHERE id = ?", [userId]);
    console.log("- Events KYC status reset (events_status = NULL)");

    // 3. Reset certification badge
    await db.query("UPDATE users SET certification_type = NULL WHERE id = ?", [userId]);
    console.log("- Certification badge reset (certification_type = NULL)");

    // 4. Reset KYC requests (delete to allow starting fresh)
    await db.query("DELETE FROM kyc_requests WHERE user_id = ?", [userId]);
    console.log("- Deleted KYC requests from kyc_requests table");

    console.log(`\nSuccess: User ID ${userId} has been completely unverified.`);
    process.exit(0);
  } catch (err) {
    console.error("Error unverifying user:", err);
    process.exit(1);
  }
}

main();
