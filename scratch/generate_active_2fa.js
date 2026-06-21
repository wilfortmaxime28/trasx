const db = require('../config/db');

async function generateActive2fa() {
  try {
    const token = 'testtoken123';
    const code = '123456';
    const email = 'wilfortmaxime917@gmail.com';

    await db.query(
      `UPDATE admins 
       SET secret_login_token = ?, 
           secret_login_code = ?, 
           secret_login_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE) 
       WHERE email = ?`,
      [token, code, email]
    );

    console.log('--- 2FA TOKEN GENERATED SUCCESSFULLY ---');
    console.log(`Email: ${email}`);
    console.log(`URL: http://localhost:3000/sec-login-9x2k-token/${token}`);
    console.log(`Verification Code: ${code}`);
    process.exit(0);
  } catch (error) {
    console.error('Error generating 2FA token:', error);
    process.exit(1);
  }
}

generateActive2fa();
