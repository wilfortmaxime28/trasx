const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const Admin = require('../models/Admin');
const { requireAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// Configure multer for background uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../public/assets/uploads/'));
  },
  filename: function (req, file, cb) {
    cb(null, 'bg_' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

router.use(requireAdmin);

const redirectUnauthorizedAdmin = (req, res, fallbackMessage = 'Accès refusé.') => {
  const visiblePages = Admin.getAccessiblePageKeys(res.locals.currentAdmin);
  const firstPage = Admin.getFirstAccessiblePageKey(res.locals.currentAdmin);
  const targetPath = visiblePages.includes(firstPage) ? (adminController.ADMIN_PAGE_PATHS?.[firstPage] || '/admin') : '/admin';
  return res.redirect(`${targetPath}?error=${encodeURIComponent(fallbackMessage)}`);
};

const requireAdminPageAccess = (page) => (req, res, next) => {
  if (Admin.canAccessPage(res.locals.currentAdmin, page)) {
    return next();
  }
  return redirectUnauthorizedAdmin(req, res, 'Vous ne pouvez pas voir cette page.');
};

const requireAdminAction = (action, options = {}) => (req, res, next) => {
  if (Admin.canPerformAction(res.locals.currentAdmin, action)) {
    return next();
  }

  if (options.json) {
    return res.status(403).json({ success: false, message: 'Vous n’avez pas les droits nécessaires pour cette action.' });
  }

  return redirectUnauthorizedAdmin(req, res, 'Vous n’avez pas les droits nécessaires pour cette action.');
};

const renderAdminPage = (page) => [
  requireAdminPageAccess(page),
  (req, res, next) => {
  req.adminPage = page;
  return adminController.getAdminDashboard(req, res, next);
  }
];

router.get('/', ...renderAdminPage('overview'));
router.get('/users', ...renderAdminPage('users'));
router.get('/moderation', ...renderAdminPage('moderation'));
router.get('/revenue', ...renderAdminPage('revenue'));
router.get('/transactions', ...renderAdminPage('transactions'));
router.get('/balances', ...renderAdminPage('balances'));
router.get('/backgrounds', ...renderAdminPage('backgrounds'));
router.get('/rules', ...renderAdminPage('rules'));
router.get('/kyc', ...renderAdminPage('kyc'));
router.get('/receipts', ...renderAdminPage('receipts'));
router.get('/system-settings', ...renderAdminPage('smtp'));
router.get('/admins', ...renderAdminPage('admins'));
router.get('/disputes', ...renderAdminPage('disputes'));
router.get('/conversations', ...renderAdminPage('conversations'));
router.get('/comments', ...renderAdminPage('comments'));

router.post('/user-status', requireAdminAction('manage_users'), adminController.updateUserStatus);
router.post('/user-certification', requireAdminAction('manage_kyc'), adminController.updateUserCertification);
router.post('/settings', requireAdminAction('manage_settings'), adminController.updateSettings);
router.post('/event-thresholds', requireAdminAction('manage_settings'), adminController.updateEventThresholds);
router.post('/balance-topup', requireAdminAction('manage_balances'), adminController.balanceTopUp);
router.post('/balance-debit', requireAdminAction('manage_balances'), adminController.balanceDebit);
router.post('/moderation/report-post', requireAdminAction('moderate_content'), adminController.reportPost);
router.post('/moderation/report-profile', requireAdminAction('moderate_content'), adminController.reportProfile);
router.post('/kyc-review', requireAdminAction('manage_kyc'), adminController.reviewKycRequest);
router.post('/user-delete', requireAdminAction('manage_users'), adminController.deleteUser);
router.post('/user-freeze', requireAdminAction('manage_users'), adminController.freezeUserAccount);
router.post('/user-freeze-all', requireAdminAction('manage_users'), adminController.freezeAllAccounts);
router.post('/empty-database', requireAdminAction('manage_settings'), adminController.emptyDatabase);
router.post('/decrypt-receipt', requireAdminPageAccess('receipts'), adminController.decryptReceipt);
router.post('/admins/create', requireAdminAction('manage_admins'), adminController.createAdminAccount);
router.post('/admins/update', requireAdminAction('manage_admins'), adminController.updateAdminAccount);
router.post('/disputes/resolve-account', requireAdminAction('manage_disputes'), adminController.resolveAccountDispute);
router.post('/disputes/resolve-p2p', requireAdminAction('manage_disputes'), adminController.resolveP2PDispute);

router.post('/change-password', adminController.changeOwnPassword);

// Backgrounds management
router.post('/background-add', requireAdminAction('manage_backgrounds'), upload.single('bgFile'), adminController.addBackground);
router.post('/background-delete', requireAdminAction('manage_backgrounds'), adminController.deleteBackground);

module.exports = router;
