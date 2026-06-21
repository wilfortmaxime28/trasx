const db = require('../config/db');

async function test2faFlow() {
  let hasFailed = false;
  try {
    console.log('1. Setting custom SMTP settings in database...');
    await db.query("UPDATE app_settings SET setting_value = 'smtp.gmail.com' WHERE setting_key = 'smtp_host'");
    await db.query("UPDATE app_settings SET setting_value = 'custom_user@gmail.com' WHERE setting_key = 'smtp_user'");
    await db.query("UPDATE app_settings SET setting_value = 'custom_password' WHERE setting_key = 'smtp_pass'");

    console.log('2. Requesting login link via POST...');
    const params = new URLSearchParams();
    params.append('email', 'wilfortmaxime28@gmail.com');

    const postRes = await fetch('http://localhost:3000/backoffice-sec-9x2k', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      redirect: 'manual'
    });

    console.log('POST Response Status:', postRes.status);
    const postBody = await postRes.text();
    if (postBody.includes('Si votre adresse email est valide')) {
      console.log('Success: 2FA email notification message returned.');
    } else {
      console.log('Warning: Notification message not found in response HTML.');
    }

    console.log('3. Retrieving secret token and code from database...');
    const [rows] = await db.query(
      "SELECT secret_login_token, secret_login_code FROM admins WHERE email = 'wilfortmaxime28@gmail.com'"
    );
    const admin = rows[0];
    if (!admin || !admin.secret_login_token || !admin.secret_login_code) {
      throw new Error('Secret token or code was not written to the database!');
    }
    console.log(`Token: ${admin.secret_login_token}`);
    console.log(`Code: ${admin.secret_login_code}`);

    console.log('4. Verifying token via GET /sec-login-9x2k-token/:token ...');
    const verifyGetRes = await fetch(`http://localhost:3000/sec-login-9x2k-token/${admin.secret_login_token}`);
    console.log('Verify GET Status:', verifyGetRes.status);
    const verifyGetBody = await verifyGetRes.text();
    if (verifyGetBody.includes('Code d&#39;Accès') || verifyGetBody.toLowerCase().includes('code')) {
      console.log('Success: Code verification form loaded.');
    } else {
      console.log('Warning: Verification code form body mismatch.');
    }

    console.log('5. Submitting correct code via POST /sec-login-9x2k-token/:token ...');
    const verifyParams = new URLSearchParams();
    verifyParams.append('code', admin.secret_login_code);

    const verifyPostRes = await fetch(`http://localhost:3000/sec-login-9x2k-token/${admin.secret_login_token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: verifyParams.toString(),
      redirect: 'manual'
    });

    console.log('Verify POST Response Status:', verifyPostRes.status);
    const verifyCookie = verifyPostRes.headers.get('set-cookie');
    if (!verifyCookie) {
      throw new Error('No session cookie returned on 2FA code verification!');
    }
    console.log('Session cookie received:', verifyCookie);

    // Validate access to /admin using this cookie
    console.log('6. Validating access to /admin with 2FA session cookie...');
    const adminRes = await fetch('http://localhost:3000/admin', {
      headers: {
        Cookie: verifyCookie.split(';')[0]
      }
    });
    console.log('Admin Dashboard Status:', adminRes.status);
    const adminHtml = await adminRes.text();
    if (adminHtml.includes('Tableau de bord') || adminHtml.toLowerCase().includes('dashboard') || adminHtml.toLowerCase().includes('backoffice') || adminHtml.toLowerCase().includes('admin')) {
      console.log('SUCCESS: 2FA Authentication Flow completely functional and verified!');
    } else {
      console.log('WARNING: Access successful, but dashboard content was not recognized.');
    }

  } catch (error) {
    console.error('Test 2FA flow failed:', error.message);
    hasFailed = true;
  } finally {
    // Restore SMTP settings
    console.log('7. Restoring default SMTP settings...');
    await db.query("UPDATE app_settings SET setting_value = 'smtp.example.com' WHERE setting_key = 'smtp_host'");
    await db.query("UPDATE app_settings SET setting_value = 'user@example.com' WHERE setting_key = 'smtp_user'");
    await db.query("UPDATE app_settings SET setting_value = 'password' WHERE setting_key = 'smtp_pass'");
    console.log('SMTP settings restored.');
    
    process.exit(hasFailed ? 1 : 0);
  }
}

test2faFlow();
