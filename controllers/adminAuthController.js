const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const Admin = require('../models/Admin');
const mailer = require('../utils/mailer');
const { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } = require('../config/sessionConfig');

async function isSmtpConfigured() {
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('smtp_host', 'smtp_user', 'smtp_pass')"
    );
    const config = {};
    rows.forEach(row => {
      config[row.setting_key] = row.setting_value;
    });

    if (!config.smtp_host || !config.smtp_user || !config.smtp_pass) {
      return false;
    }

    const host = config.smtp_host.trim();
    const user = config.smtp_user.trim();
    const pass = config.smtp_pass.trim();

    if (
      host === '' || host === 'smtp.example.com' ||
      user === '' || user === 'user@example.com' ||
      pass === '' || pass === 'password'
    ) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking SMTP configuration status:', error);
    return false;
  }
}

exports.getLogin = async (req, res) => {
  const smtpConfigured = await isSmtpConfigured();
  res.render('admin-login', { error: null, success: null, isSmtpConfigured: smtpConfigured });
};

exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !email.trim()) {
      const smtpConfigured = await isSmtpConfigured();
      return res.render('admin-login', { 
        error: 'Veuillez saisir votre adresse email.', 
        success: null, 
        isSmtpConfigured: smtpConfigured 
      });
    }

    const admin = await Admin.getByEmail(email.trim());
    if (!admin) {
      const smtpConfigured = await isSmtpConfigured();
      return res.render('admin-login', { 
        error: 'Adresse email incorrecte ou non autorisée.', 
        success: null,
        isSmtpConfigured: smtpConfigured
      });
    }

    const smtpConfigured = await isSmtpConfigured();
    if (!smtpConfigured) {
      // SMTP not configured: login with email and password directly
      if (!password) {
        return res.render('admin-login', {
          error: 'Veuillez saisir votre mot de passe.',
          success: null,
          isSmtpConfigured: false
        });
      }

      const isMatch = await bcrypt.compare(password, admin.password_hash);
      if (!isMatch) {
        return res.render('admin-login', {
          error: 'Mot de passe incorrect.',
          success: null,
          isSmtpConfigured: false
        });
      }

      // Success: initialize admin session
      return req.session.regenerate((sessionError) => {
        if (sessionError) {
          console.error('Admin Session Regenerate Error:', sessionError);
          return res.render('admin-login', { error: 'Erreur de session.', success: null, isSmtpConfigured: false });
        }

        req.session.adminId = admin.id;
        req.session.isAdminAuthenticated = true;
        req.session.cookie.maxAge = SESSION_MAX_AGE_MS;
        req.session.cookie.expires = new Date(Date.now() + SESSION_MAX_AGE_MS);

        req.session.save((saveError) => {
          if (saveError) {
            console.error('Admin Session Save Error:', saveError);
            return res.render('admin-login', { error: 'Erreur de session.', success: null, isSmtpConfigured: false });
          }

          return res.redirect('/admin');
        });
      });
    } else {
      // SMTP is configured: generate 2FA token/code and dispatch email
      const token = crypto.randomBytes(32).toString('hex');
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Stocker dans la base de données avec expiration (+15 minutes)
      await db.query(
        `UPDATE admins 
         SET secret_login_token = ?, 
             secret_login_code = ?, 
             secret_login_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE) 
         WHERE id = ?`,
        [token, code, admin.id]
      );

      // Envoyer l'email sécurisé
      const loginLink = `${req.protocol}://${req.get('host')}/sec-login-9x2k-token/${token}`;
      const subject = 'Votre lien de connexion administrateur TrasX';
      const htmlContent = `
        <div style="font-family: sans-serif; padding: 24px; color: #111827; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px;">
          <h2 style="color: #4f46e5; border-bottom: 2px solid #f3f4f6; padding-bottom: 12px; margin-top: 0;">Connexion Administrative TrasX</h2>
          <p>Bonjour,</p>
          <p>Une tentative de connexion a été détectée sur votre compte administrateur. Veuillez cliquer sur le bouton ci-dessous pour valider votre identité :</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${loginLink}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.25);">Se connecter au Backoffice</a>
          </p>
          <p>Si le bouton ci-dessus ne fonctionne pas, veuillez copier-coller ce lien dans votre navigateur :</p>
          <p style="word-break: break-all; background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 13px;"><code>${loginLink}</code></p>
          
          <div style="margin: 25px 0; padding: 20px; background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 8px; text-align: center;">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Votre Code d'Accès à Saisir</p>
            <p style="margin: 0; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #1e1b4b;">${code}</p>
          </div>
          <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f3f4f6; padding-top: 12px; margin-bottom: 0;">
            Ce lien et ce code d'accès de sécurité expireront dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.
          </p>
        </div>
      `;

      // Log the credentials in the console as a fallback if SMTP is slow/failing
      console.log('\n==================================================');
      console.log(`[SECURE LOGIN] Login attempt for Admin: ${admin.email}`);
      console.log(`[SECURE LOGIN] Access Code: ${code}`);
      console.log(`[SECURE LOGIN] Login Link: ${loginLink}`);
      console.log('==================================================\n');

      let mailErrorOccurred = false;
      try {
        await mailer.sendHtmlEmail(admin.email, subject, htmlContent);
      } catch (mailErr) {
        console.error('Error sending email:', mailErr);
        mailErrorOccurred = true;
      }

      if (mailErrorOccurred) {
        return res.render('admin-login', { 
          error: 'Erreur d\'envoi d\'e-mail (vérifiez les paramètres SMTP). Le code et le lien ont été générés dans les logs de la console.', 
          success: null,
          isSmtpConfigured: true
        });
      }

      return res.render('admin-login', { 
        error: null, 
        success: 'Si votre adresse email est valide, un lien d\'accès sécurisé et un code de connexion vous ont été envoyés par email.',
        isSmtpConfigured: true
      });
    }
  } catch (error) {
    console.error('Admin Login Request Error:', error);
    const smtpConfigured = await isSmtpConfigured();
    res.render('admin-login', { error: 'Une erreur serveur est survenue.', success: null, isSmtpConfigured: smtpConfigured });
  }
};

exports.getVerifyToken = async (req, res) => {
  try {
    const { token } = req.params;
    
    // Rechercher l'admin avec ce token actif
    const [rows] = await db.query(
      'SELECT * FROM admins WHERE secret_login_token = ? AND secret_login_expires > NOW()',
      [token]
    );
    
    if (rows.length === 0) {
      return res.render('admin-login', { 
        error: 'Ce lien de connexion est invalide ou a expiré. Veuillez refaire une demande.', 
        success: null,
        isSmtpConfigured: true
      });
    }

    res.render('admin-verify-code', { token, error: null });
  } catch (error) {
    console.error('Admin Token Verification Error:', error);
    res.render('admin-login', { error: 'Une erreur serveur est survenue.', success: null, isSmtpConfigured: true });
  }
};

exports.postVerifyToken = async (req, res) => {
  try {
    const { token } = req.params;
    const { code } = req.body;

    if (!code || !code.trim()) {
      return res.render('admin-verify-code', { token, error: 'Veuillez saisir votre code d\'accès.' });
    }

    // Rechercher l'admin avec ce token
    const [rows] = await db.query(
      'SELECT * FROM admins WHERE secret_login_token = ? AND secret_login_expires > NOW()',
      [token]
    );

    if (rows.length === 0) {
      return res.render('admin-login', { 
        error: 'Votre session de connexion a expiré. Veuillez refaire une demande.', 
        success: null,
        isSmtpConfigured: true
      });
    }

    const admin = rows[0];

    // Vérifier le code d'accès
    if (String(code).trim() !== String(admin.secret_login_code).trim()) {
      return res.render('admin-verify-code', { token, error: 'Code d\'accès incorrect. Veuillez réessayer.' });
    }

    // Code valide : Supprimer le token/code pour éviter toute réutilisation
    await db.query(
      `UPDATE admins 
       SET secret_login_token = NULL, 
           secret_login_code = NULL, 
           secret_login_expires = NULL 
       WHERE id = ?`,
      [admin.id]
    );

    // Initialiser la session de l'admin
    return req.session.regenerate((sessionError) => {
      if (sessionError) {
        console.error('Admin Session Regenerate Error:', sessionError);
        return res.render('admin-login', { error: 'Erreur de session.', success: null, isSmtpConfigured: true });
      }

      req.session.adminId = admin.id;
      req.session.isAdminAuthenticated = true;
      req.session.cookie.maxAge = SESSION_MAX_AGE_MS;
      req.session.cookie.expires = new Date(Date.now() + SESSION_MAX_AGE_MS);

      req.session.save((saveError) => {
        if (saveError) {
          console.error('Admin Session Save Error:', saveError);
          return res.render('admin-login', { error: 'Erreur de session.', success: null, isSmtpConfigured: true });
        }

        return res.redirect('/admin');
      });
    });
  } catch (error) {
    console.error('Admin Access Verification Error:', error);
    res.render('admin-login', { error: 'Une erreur serveur est survenue.', success: null, isSmtpConfigured: true });
  }
};

exports.logout = (req, res) => {
  if (!req.session) {
    return res.redirect('/backoffice-sec-9x2k');
  }

  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true'
    });
    res.redirect('/backoffice-sec-9x2k');
  });
};
