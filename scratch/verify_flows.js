const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function runTests() {
  const adminEmail = 'wilfortmaxime917@gmail.com';
  const oldPassword = 'admin123';
  const newPassword = 'newadminpassword456';

  console.log('--- STARTING FLOWS VERIFICATION ---');

  // 1. Ensure test token/code is generated in database
  const token = 'testtoken123';
  const code = '123456';
  const hash = await bcrypt.hash(oldPassword, 10);
  
  await db.query(
    `UPDATE admins 
     SET password_hash = ?,
         secret_login_token = ?, 
         secret_login_code = ?, 
         secret_login_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE) 
     WHERE email = ?`,
    [hash, token, code, adminEmail]
  );
  console.log('1. Injected test admin settings in DB successfully.');

  try {
    // 2. Fetch the verification URL
    const getVerifyUrl = `http://localhost:3000/sec-login-9x2k-token/${token}`;
    const getVerifyRes = await fetch(getVerifyUrl);
    const getVerifyText = await getVerifyRes.text();
    
    if (getVerifyRes.status !== 200 || !getVerifyText.includes('Validation 2FA')) {
      throw new Error(`Token verification view failed to load: status ${getVerifyRes.status}`);
    }
    console.log('2. GET verification view token endpoint works perfectly.');

    // 3. Post verification code
    const postVerifyUrl = `http://localhost:3000/sec-login-9x2k-token/${token}`;
    const postVerifyRes = await fetch(postVerifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ code }).toString(),
      redirect: 'manual' // manual to capture redirect header and set-cookie
    });

    const setCookieHeaders = postVerifyRes.headers.getSetCookie();
    let sessionCookie = '';
    if (setCookieHeaders && setCookieHeaders.length > 0) {
      // Find connect.sid
      const sidCookie = setCookieHeaders.find(c => c.startsWith('connect.sid='));
      if (sidCookie) {
        sessionCookie = sidCookie.split(';')[0];
      }
    }

    if (!sessionCookie) {
      throw new Error('Failed to retrieve connect.sid session cookie from postVerifyToken.');
    }
    console.log('3. POST code to token endpoint validated code and set session cookie.');

    // 4. Request the /admin page with session cookie
    const adminDashboardRes = await fetch('http://localhost:3000/admin', {
      headers: {
        'Cookie': sessionCookie
      }
    });

    const adminDashboardText = await adminDashboardRes.text();
    if (adminDashboardRes.status !== 200 || !adminDashboardText.includes('Secure Logout')) {
      throw new Error(`Failed to access admin dashboard with session: status ${adminDashboardRes.status}`);
    }
    console.log('4. Access to admin dashboard using 2FA session is successful.');

    // 4.5 Verify unauthorized access to /admin redirects to '/' instead of backoffice login
    const unauthorizedRes = await fetch('http://localhost:3000/admin', {
      redirect: 'manual'
    });
    const redirectUrl = unauthorizedRes.headers.get('location');
    // It can redirect to '/' (host + '/') or '/' path
    if (unauthorizedRes.status !== 302 || (!redirectUrl.endsWith('/') && !redirectUrl.includes('localhost:3000/'))) {
      throw new Error(`Unauthorized /admin access did not redirect to home: status ${unauthorizedRes.status}, redirect URL: ${redirectUrl}`);
    }
    if (redirectUrl.includes('/backoffice-sec-9x2k')) {
      throw new Error('Security warning: Unauthorized /admin access exposed secret login page via redirect.');
    }
    console.log('4.5. Verified that unauthorized /admin access redirects securely to home page.');

    // 5. Call password update endpoint
    const changePasswordRes = await fetch('http://localhost:3000/admin/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        current_password: oldPassword,
        new_password: newPassword,
        confirm_password: newPassword
      })
    });

    const changePasswordData = await changePasswordRes.json();
    if (!changePasswordRes.ok || !changePasswordData.success) {
      throw new Error(`Password modification failed: ${JSON.stringify(changePasswordData)}`);
    }
    console.log(`5. POST change-password returned: ${JSON.stringify(changePasswordData)}`);

    // 6. Verify password hash updated in database
    const [rows] = await db.query('SELECT password_hash FROM admins WHERE email = ?', [adminEmail]);
    const updatedHash = rows[0].password_hash;
    const isNewPasswordMatch = await bcrypt.compare(newPassword, updatedHash);
    
    if (!isNewPasswordMatch) {
      throw new Error('Database password hash does not match new password.');
    }
    console.log('6. Verified in database that new password hash is stored.');

    console.log('--- ALL FLOWS TESTED AND RUN SUCCESSFULLY ---');
  } catch (err) {
    console.error('--- INTEGRATION TEST FAILED ---');
    console.error(err);
  } finally {
    // 7. Cleanup and restore old password
    const cleanHash = await bcrypt.hash(oldPassword, 10);
    await db.query(
      `UPDATE admins 
       SET password_hash = ?,
           secret_login_token = NULL,
           secret_login_code = NULL,
           secret_login_expires = NULL
       WHERE email = ?`,
      [cleanHash, adminEmail]
    );
    console.log('7. Pristine database state restored.');
    process.exit(0);
  }
}

runTests();
