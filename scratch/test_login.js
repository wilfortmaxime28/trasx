async function testLoginFlow() {
  try {
    console.log('Sending login POST request for wilfortmaxime28@gmail.com...');
    
    const params = new URLSearchParams();
    params.append('email', 'wilfortmaxime28@gmail.com');
    params.append('password', 'maximeAdmin2026!');

    const loginRes = await fetch('http://localhost:3000/backoffice-sec-9x2k', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      redirect: 'manual'
    });

    console.log('Login Response Status:', loginRes.status);
    
    const cookies = loginRes.headers.get('set-cookie');
    if (!cookies) {
      // Let's print response body to see any error
      const text = await loginRes.text();
      console.log('Response body:', text);
      throw new Error('No session cookie returned on login!');
    }
    console.log('Cookie received:', cookies);

    // Use the cookie to access /admin
    console.log('Fetching /admin dashboard with session cookie...');
    const adminRes = await fetch('http://localhost:3000/admin', {
      headers: {
        Cookie: cookies.split(';')[0]
      }
    });

    console.log('Admin Dashboard Status:', adminRes.status);
    const html = await adminRes.text();
    if (html.includes('Tableau de bord') || html.toLowerCase().includes('dashboard') || html.toLowerCase().includes('backoffice') || html.toLowerCase().includes('admin')) {
      console.log('SUCCESS: Admin was logged in and could access the admin dashboard directly!');
    } else {
      console.log('WARNING: Access successful, but dashboard content was not recognized.');
      console.log(html.slice(0, 1000));
    }

    process.exit(0);
  } catch (error) {
    console.error('Test login flow failed:', error.message);
    process.exit(1);
  }
}

testLoginFlow();
