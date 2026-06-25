const User = require('../models/User');
const Notification = require('../models/Notification');
const { createTranslator, normalizeLocale, SUPPORTED_LOCALES } = require('../utils/i18n');
const { getNumberSetting } = require('../utils/appSettings');

const requireAuth = async (req, res, next) => {
  const isApi = req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/') || (req.headers.accept && req.headers.accept.includes('application/json'));

  if (!req.session || !req.session.userId) {
    if (isApi) {
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.', code: 'SESSION_EXPIRED' });
    }
    return res.redirect('/auth/login');
  }

  try {
    const user = await User.getById(req.session.userId);
    if (!user) {
      req.session.destroy();
      if (isApi) {
        return res.status(401).json({ error: 'Utilisateur introuvable.', code: 'SESSION_EXPIRED' });
      }
      return res.redirect('/auth/login');
    }

    if (user.account_status === 'Blocked' || user.account_status === 'Frozen') {
      req.session.destroy();
      if (isApi) {
        return res.status(403).json({ error: 'Votre compte a été suspendu ou bloqué.', code: 'ACCOUNT_STATUS_ERROR' });
      }
      return res.redirect('/auth/login');
    }

    // On stocke l'utilisateur dans res.locals pour l'utiliser dans toutes les vues
    res.locals.currentUser = user;
    res.locals.tokenPriceUsd = await getNumberSetting('token_price_usd', 0.1);
    const locale = normalizeLocale(req.session.locale || user.preferred_language || 'en');
    req.session.locale = locale;
    res.locals.locale = locale;
    res.locals.t = createTranslator(locale);
    res.locals.supportedLocales = SUPPORTED_LOCALES;
    
    // Set global flags
    res.locals.isPartiallyBlocked = (user.account_status === 'Partially Blocked');
    res.locals.isPaused = (user.account_status === 'Paused');

    const [notifications, unreadNotificationCount] = await Promise.all([
      Notification.getRecentForUser(user.id, 8),
      Notification.getUnreadCount(user.id)
    ]);

    res.locals.notifications = notifications;
    res.locals.unreadNotificationCount = unreadNotificationCount;

    next();
  } catch (err) {
    console.error('Auth Middleware Error:', err);
    res.redirect('/auth/login');
  }
};

const requireAdmin = async (req, res, next) => {
  if (!req.session || !req.session.adminId) {
    return res.redirect('/');
  }
  
  try {
    const Admin = require('../models/Admin');
    const admin = await Admin.getById(req.session.adminId);
    if (!admin) {
      req.session.destroy();
      return res.redirect('/');
    }
    res.locals.currentAdmin = admin;
    res.locals.currentAdminPermissions = Admin.getPermissions(admin);
    res.locals.currentAdminVisiblePageKeys = Admin.getAccessiblePageKeys(admin);
    next();
  } catch (err) {
    console.error('Admin Auth Middleware Error:', err);
    res.redirect('/');
  }
};

module.exports = { requireAuth, requireAdmin };
