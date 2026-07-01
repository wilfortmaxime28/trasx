const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AdminModerationNotice = require('../models/AdminModerationNotice');
const db = require('../config/db');
const ActivityLog = require('../models/ActivityLog');
const mailer = require('../utils/mailer');
const { getNumberSetting } = require('../utils/appSettings');
const { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } = require('../config/sessionConfig');

function renderForgotPassword(res, overrides = {}) {
  res.render('forgotPassword', {
    error: null,
    success: null,
    mode: 'request',
    email: '',
    deliveryFallback: null,
    ...overrides
  });
}

exports.getTerms = (req, res) => {
  res.render('terms');
};

exports.getRegister = (req, res) => {
  res.render('register', { error: null });
};

exports.postRegister = async (req, res) => {
  try {
    let { username, email, password, first_name, last_name, dob, phone, country, terms } = req.body;

    if (username) username = username.replace(/\s+/g, '').trim();
    if (email) email = email.trim();
    if (first_name) first_name = first_name.trim().replace(/<[^>]*>/g, '');
    if (last_name) last_name = last_name.trim().replace(/<[^>]*>/g, '');
    if (phone) phone = phone.trim().replace(/[^0-9+\s-]/g, '');
    if (country) country = country.trim().replace(/<[^>]*>/g, '');

    if(!username || !email || !password || !first_name || !last_name || !dob || !phone) {
      return res.render('register', { error: 'Please provide all required real data.' });
    }

    if (username.includes('@')) {
      return res.render('register', { error: 'Username cannot resemble an email address.' });
    }

    if (dob) {
      const parts = dob.split('-');
      if (parts.length === 3) {
        const birthYear = parseInt(parts[0], 10);
        const birthMonth = parseInt(parts[1], 10) - 1;
        const birthDay = parseInt(parts[2], 10);

        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        const currentDay = today.getDate();

        let age = currentYear - birthYear;
        if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
          age--;
        }

        if (age < 18) {
          return res.render('register', { error: 'You must be at least 18 years old to register.' });
        }
      }
    }

    if(terms !== 'on') {
      return res.render('register', { error: 'You must accept the terms and conditions.' });
    }

    const existingUser = await User.getByEmail(email) || await User.getByUsername(username);
    if (existingUser) {
      return res.render('register', { error: 'User with that email or username already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const verification_code = Math.floor(100000 + Math.random() * 900000).toString();
    const baseDailyViews = await getNumberSetting('new_user_daily_view_base', 1000);

    const userId = await User.create({
      username,
      email,
      password_hash,
      first_name,
      last_name,
      dob,
      phone,
      country,
      verification_code,
      promo_post_daily_base: baseDailyViews,
      promo_reel_daily_base: baseDailyViews
    });

    await ActivityLog.log(userId, 'user', 'register', 'user', userId, { username, email }, req);

    const emailSent = await mailer.sendVerificationEmail(email, verification_code);

    if (!emailSent) {
      req.session.pendingVerificationFallback = {
        userId: Number(userId),
        email,
        code: verification_code,
        createdAt: Date.now()
      };
      return res.redirect('/auth/verify?id=' + userId + '&delivery=manual');
    }

    res.redirect('/auth/verify?id=' + userId);
  } catch (error) {
    console.error('Register Error:', error);
    res.render('register', { error: 'An error occurred during registration.' });
  }
};

exports.checkUsername = async (req, res) => {
  try {
    const { username, first_name, last_name } = req.query;
    if (!username) return res.json({ available: false });

    if (username.includes('@')) {
      return res.json({ available: false, error: 'Username cannot resemble an email address.' });
    }

    const existingUser = await User.getByUsername(username);
    
    if (!existingUser) {
      return res.json({ available: true });
    }

    // Generate suggestions
    const suggestions = [];
    const baseNames = [];
    
    if (first_name && last_name) {
      const cleanFirst = first_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanLast = last_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      baseNames.push(`${cleanFirst}_${cleanLast}`);
      baseNames.push(`${cleanFirst}.${cleanLast}`);
      baseNames.push(`${cleanFirst}${cleanLast}`);
    }
    
    baseNames.push(username);

    for (let base of baseNames) {
      for (let i = 0; i < 3 && suggestions.length < 3; i++) {
        const randNum = Math.floor(10 + Math.random() * 900);
        const suggestion = `${base}${randNum}`;
        const check = await User.getByUsername(suggestion);
        if (!check && !suggestions.includes(suggestion)) {
          suggestions.push(suggestion);
        }
      }
    }

    res.json({ available: false, suggestions });
  } catch (error) {
    console.error('Check Username Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getVerify = (req, res) => {
  const userId = req.query.id;
  const fallback = req.session.pendingVerificationFallback;
  const deliveryFallback = fallback && Number(fallback.userId) === Number(userId)
    ? {
        email: fallback.email,
        code: fallback.code
      }
    : null;

  res.render('verify', { userId, error: null, deliveryFallback });
};

exports.postVerify = async (req, res) => {
  try {
    const { userId, code } = req.body;
    const user = await User.getById(userId);
    const fallback = req.session.pendingVerificationFallback;
    const deliveryFallback = fallback && Number(fallback.userId) === Number(userId)
      ? {
          email: fallback.email,
          code: fallback.code
        }
      : null;

    if (!user) return res.render('verify', { userId, error: 'User not found', deliveryFallback });
    if (user.is_verified) return res.redirect('/auth/login');
    if (user.verification_code !== code) {
      return res.render('verify', { userId, error: 'Invalid verification code', deliveryFallback });
    }

    await User.verifyEmail(userId);
    if (fallback && Number(fallback.userId) === Number(userId)) {
      delete req.session.pendingVerificationFallback;
    }
    res.redirect('/auth/login?verified=true');
  } catch (error) {
    const fallback = req.session.pendingVerificationFallback;
    const deliveryFallback = fallback && Number(fallback.userId) === Number(req.body.userId)
      ? {
          email: fallback.email,
          code: fallback.code
        }
      : null;
    res.render('verify', { userId: req.body.userId, error: 'Server error', deliveryFallback });
  }
};

exports.getLogin = (req, res) => {
  const verified = req.query.verified;
  const reset = req.query.reset;
  let error = req.query.error || null;
  if (error === 'kyc_conflict_blocked') {
    error = "Votre compte a été bloqué pour cause de conflit de KYC avec un autre utilisateur.";
  }
  res.render('login', {
    error: error,
    verified: verified ? 'Your account has been verified. You can now login.' : (reset ? 'Your password has been updated. You can now login.' : null)
  });
};

exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.getByIdentifier(email);

    if (!user) {
      return res.render('login', { error: 'Invalid credentials', verified: null });
    }

    if (!user.is_verified) {
      return res.render('login', { error: 'Please verify your email first.', verified: null });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.render('login', { error: 'Invalid credentials', verified: null });
    }

    if (user.account_status === 'Blocked') {
      const allowDispute = !!user.allow_dispute;
      let blockedMessage = "Votre compte a été bloqué par l'administration. Veuillez contacter le support.";

      if (allowDispute) {
        blockedMessage = 'Votre compte a été bloqué pour cause de conflit de KYC avec un autre utilisateur.';
      } else {
        const moderationNotices = await AdminModerationNotice.getActiveForUser(user.id);
        const restrictionNotice = moderationNotices.find((notice) => (
          notice.target_type === 'profile' && notice.notice_kind === 'restriction'
        ));

        if (restrictionNotice?.reason) {
          blockedMessage = `Votre compte a été bloqué par l'administration. Raison : ${restrictionNotice.reason}.`;
          if (restrictionNotice.details) {
            blockedMessage += ` Détail : ${restrictionNotice.details}`;
          }
        }
      }

      return res.render('login', {
        error: blockedMessage,
        verified: null,
        allowDispute,
        userId: user.id
      });
    }

    if (user.account_status === 'Frozen') {
      return res.render('login', { error: 'Votre compte a été gelé par un administrateur. Veuillez contacter le support.', verified: null });
    }

    req.session.userId = user.id;
    await ActivityLog.log(user.id, 'user', 'login', 'user', user.id, { username: user.username }, req);

    req.session.rememberMe = true;
    req.session.cookie.maxAge = SESSION_MAX_AGE_MS;
    req.session.cookie.expires = new Date(Date.now() + SESSION_MAX_AGE_MS);

    return req.session.save((saveError) => {
      if (saveError) {
        console.error('Login Session Save Error:', saveError);
        return res.render('login', { error: 'Server error', verified: null });
      }

      return res.redirect('/');
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.render('login', { error: 'Server error', verified: null });
  }
};

exports.logout = async (req, res) => {
  const userId = req.session?.userId || null;

  if (userId) {
    await ActivityLog.log(userId, 'user', 'logout', 'user', userId, null, req);
  }

  if (!req.session) {
    return res.redirect('/auth/login');
  }

  req.session.destroy((error) => {
    if (error) {
      console.error('Logout Session Destroy Error:', error);
      return res.redirect('/auth/login');
    }

    res.clearCookie(SESSION_COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true'
    });

    return res.redirect('/auth/login');
  });
};

exports.getForgotPassword = (req, res) => {
  renderForgotPassword(res);
};

exports.postForgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email) {
      return renderForgotPassword(res, {
        error: 'Please enter your email address.',
        mode: 'request'
      });
    }

    const user = await User.getByEmail(email);

    if (!user) {
      return renderForgotPassword(res, {
        success: 'If this email exists, a reset code has been prepared.',
        mode: 'reset',
        email
      });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    await User.setVerificationCode(user.id, resetCode);

    const emailSent = await mailer.sendPasswordResetEmail(email, resetCode);

    if (!emailSent) {
      req.session.pendingPasswordResetFallback = {
        userId: Number(user.id),
        email,
        code: resetCode,
        createdAt: Date.now()
      };

      return renderForgotPassword(res, {
        success: 'The reset code is ready. Continue below to create a new password.',
        mode: 'reset',
        email,
        deliveryFallback: {
          email,
          code: resetCode
        }
      });
    }

    if (req.session.pendingPasswordResetFallback && Number(req.session.pendingPasswordResetFallback.userId) === Number(user.id)) {
      delete req.session.pendingPasswordResetFallback;
    }

    return renderForgotPassword(res, {
      success: 'A reset code has been sent to your email.',
      mode: 'reset',
      email
    });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    return renderForgotPassword(res, {
      error: 'Unable to start password recovery right now.',
      mode: 'request'
    });
  }
};

exports.postResetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirm_password || '');
    const fallback = req.session.pendingPasswordResetFallback;

    const deliveryFallback = fallback && fallback.email === email
      ? { email: fallback.email, code: fallback.code }
      : null;

    if (!email || !code || !password || !confirmPassword) {
      return renderForgotPassword(res, {
        error: 'Please complete all required fields.',
        mode: 'reset',
        email,
        deliveryFallback
      });
    }

    if (password.length < 6) {
      return renderForgotPassword(res, {
        error: 'Your new password must contain at least 6 characters.',
        mode: 'reset',
        email,
        deliveryFallback
      });
    }

    if (password !== confirmPassword) {
      return renderForgotPassword(res, {
        error: 'The passwords do not match.',
        mode: 'reset',
        email,
        deliveryFallback
      });
    }

    const user = await User.getByEmail(email);
    if (!user || String(user.verification_code || '') !== code) {
      return renderForgotPassword(res, {
        error: 'Invalid reset code.',
        mode: 'reset',
        email,
        deliveryFallback
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await User.updatePassword(user.id, passwordHash);

    if (fallback && Number(fallback.userId) === Number(user.id)) {
      delete req.session.pendingPasswordResetFallback;
    }

    return res.redirect('/auth/login?reset=true');
  } catch (error) {
    console.error('Reset Password Error:', error);
    return renderForgotPassword(res, {
      error: 'Unable to reset the password right now.',
      mode: 'reset',
      email: String(req.body.email || '').trim().toLowerCase()
    });
  }
};

exports.postDispute = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.redirect('/auth/login');
    }
    
    // Check if the user exists and is Blocked
    const user = await User.getById(userId);
    if (!user || user.account_status !== 'Blocked' || !user.allow_dispute) {
      return res.redirect('/auth/login');
    }
    
    // Insert/update dispute in disputes table
    await db.query(
      `INSERT INTO disputes (user_id, status, message) 
       VALUES (?, 'pending', 'Dispute opened by user regarding KYC block') 
       ON DUPLICATE KEY UPDATE status = 'pending', message = 'Dispute re-opened by user regarding KYC block'`,
      [userId]
    );
    
    return res.render('login', {
      error: null,
      verified: "Votre litige a été soumis avec succès à l'administrateur. Nous examinerons votre cas dans les plus brefs délais.",
      allowDispute: false
    });
  } catch (error) {
    console.error('Post Dispute Error:', error);
    return res.render('login', {
      error: 'Une erreur est survenue lors de la soumission du litige.',
      verified: null,
      allowDispute: true,
      userId: req.body.userId
    });
  }
};
