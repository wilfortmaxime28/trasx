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
router.get('/messaging', ...renderAdminPage('messaging'));

router.post('/user-status', requireAdminAction('manage_users'), adminController.updateUserStatus);
router.post('/user-certification', requireAdminAction('manage_kyc'), adminController.updateUserCertification);
router.post('/settings', requireAdminAction('manage_settings'), adminController.updateSettings);
router.post('/event-thresholds', requireAdminAction('manage_settings'), adminController.updateEventThresholds);
router.post('/balance-topup', requireAdminAction('manage_balances'), adminController.balanceTopUp);
router.post('/balance-debit', requireAdminAction('manage_balances'), adminController.balanceDebit);
router.post('/moderation/report-post', requireAdminAction('moderate_content'), adminController.reportPost);
router.post('/moderation/report-profile', requireAdminAction('moderate_content'), adminController.reportProfile);
router.post('/moderation/dismiss-report', requireAdminAction('moderate_content'), adminController.dismissReport);
router.post('/moderation/delete-reported-post', requireAdminAction('moderate_content'), adminController.deleteReportedPost);
router.post('/moderation/block-reported-user', requireAdminAction('moderate_content'), adminController.blockReportedUser);
router.post('/kyc-review', requireAdminAction('manage_kyc'), adminController.reviewKycRequest);
router.post('/user-delete', requireAdminAction('manage_users'), adminController.deleteUser);
router.post('/user-freeze', requireAdminAction('manage_users'), adminController.freezeUserAccount);
router.post('/user-freeze-all', requireAdminAction('manage_users'), adminController.freezeAllAccounts);
router.post('/official-seeds/settings', requireAdminAction('manage_official_seeds'), adminController.updateOfficialSeedSettings);
router.post('/official-seeds/create', requireAdminAction('manage_official_seeds'), adminController.createOfficialSeedAccounts);
router.post('/official-seeds/generate', requireAdminAction('manage_official_seeds'), adminController.generateOfficialSeedContent);
router.post('/official-seeds/delete', requireAdminAction('manage_official_seeds'), adminController.deleteOfficialSeedAccounts);
router.post('/empty-database', requireAdminAction('manage_settings'), adminController.emptyDatabase);
router.post('/decrypt-receipt', requireAdminPageAccess('receipts'), adminController.decryptReceipt);
router.post('/admins/create', requireAdminAction('manage_admins'), adminController.createAdminAccount);
router.post('/admins/update', requireAdminAction('manage_admins'), adminController.updateAdminAccount);
router.post('/disputes/resolve-account', requireAdminAction('manage_disputes'), adminController.resolveAccountDispute);
router.post('/disputes/resolve-p2p', requireAdminAction('manage_disputes'), adminController.resolveP2PDispute);
router.post('/messaging/send', requireAdminAction('moderate_content', { json: true }), adminController.sendAdminMessage);

router.post('/change-password', adminController.changeOwnPassword);

// Backgrounds management
router.post('/background-add', requireAdminAction('manage_backgrounds'), upload.single('bgFile'), adminController.addBackground);
router.post('/background-delete', requireAdminAction('manage_backgrounds'), adminController.deleteBackground);

router.post('/deposits/recover-txid', requireAdminAction('manage_balances', { json: true }), async (req, res) => {
  try {
    const db = require('../config/db');
    const User = require('../models/User');
    const { ethers } = require('ethers');
    const bscMonitor = require('../utils/bscMonitor');

    const { txHash, email } = req.body;

    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
      return res.status(400).json({ success: false, error: 'TxID (hash de transaction) invalide. Format attendu: 0x... (64 caractères hexadécimaux)' });
    }
    if (!email || !email.trim().includes('@')) {
      return res.status(400).json({ success: false, error: 'Adresse email de l\'utilisateur invalide.' });
    }

    const cleanHash = txHash.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    // Trouver l'utilisateur par son email
    const [userRows] = await db.query(
      'SELECT id, username, wallet_address FROM users WHERE LOWER(email) = ?',
      [cleanEmail]
    );
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, error: `Aucun utilisateur trouvé avec l'adresse email "${email}".` });
    }
    const targetUser = userRows[0];
    const uid = targetUser.id;

    // Vérifier si déjà traité
    const [existing] = await db.query(
      "SELECT id, status, user_id FROM bsc_deposits WHERE tx_hash = ?",
      [cleanHash]
    );
    if (existing.length > 0 && existing[0].status === 'confirmed') {
      return res.status(409).json({
        success: false,
        error: `Ce dépôt a déjà été traité et crédité à l'utilisateur #${existing[0].user_id}.`
      });
    }

    // Récupérer la transaction via le provider RPC rotatif
    const provider = bscMonitor.getRpcProvider();
    let txReceipt;
    try {
      txReceipt = await provider.getTransactionReceipt(cleanHash);
    } catch (rpcErr) {
      console.warn(`[AdminDepositRecover] Failed to get receipt on current RPC, rotating...`);
      const rotatedProvider = bscMonitor.rotateRpcProvider();
      txReceipt = await rotatedProvider.getTransactionReceipt(cleanHash);
    }

    if (!txReceipt) {
      return res.status(404).json({
        success: false,
        error: `Transaction introuvable sur la blockchain BSC. Vérifiez le TxID.`
      });
    }

    if (txReceipt.status !== 1) {
      return res.status(400).json({
        success: false,
        error: 'Cette transaction a échoué on-chain.'
      });
    }

    // Parser les logs pour trouver le Transfer d'USDT vers PLATFORM_WALLET
    const USDT_CONTRACT = (process.env.BSC_USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955').toLowerCase();
    const PLATFORM_WALLET = (process.env.PLATFORM_WALLET_ADDRESS || process.env.BSC_CENTRAL_WALLET || '0x4e6C4a06F01C3B46704969bBEc0da61FE03BC9A6').toLowerCase();

    let targetLog = null;
    let parsedLog = null;

    const transferInterface = new ethers.utils.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    for (const log of txReceipt.logs || []) {
      if (String(log.address || '').toLowerCase() !== USDT_CONTRACT) continue;
      try {
        const parsed = transferInterface.parseLog(log);
        if (
          parsed.name === 'Transfer' &&
          String(parsed.args.to || '').toLowerCase() === PLATFORM_WALLET
        ) {
          targetLog = log;
          parsedLog = parsed;
          break;
        }
      } catch (e) {
        // Skip logs that don't match the Transfer event signature
      }
    }

    if (!targetLog || !parsedLog) {
      return res.status(400).json({
        success: false,
        error: `Cette transaction ne contient aucun transfert d'USDT BEP-20 vers votre portefeuille central (${PLATFORM_WALLET}).`
      });
    }

    const amountUsdt = Number(ethers.utils.formatUnits(parsedLog.args.value, 18));
    const blockNumber = txReceipt.blockNumber;
    const logIndex = targetLog.logIndex;

    // Récupérer le bloc actuel pour calculer les confirmations
    let currentBlock;
    try {
      currentBlock = await provider.getBlockNumber();
    } catch (e) {
      const rotatedProvider = bscMonitor.getRpcProvider();
      currentBlock = await rotatedProvider.getBlockNumber();
    }
    const confirmations = Math.max(0, currentBlock - blockNumber + 1);

    // Mettre à jour le wallet de l'utilisateur cible si nécessaire
    if (!targetUser.wallet_address) {
      await db.query('UPDATE users SET wallet_address = ? WHERE id = ?', [parsedLog.args.from, uid]);
    }

    // Démarrer la transaction DB pour créditer
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Supprimer l'ancienne entrée pending éventuelle (ou unrecognized)
      await conn.execute(
        'DELETE FROM bsc_deposits WHERE tx_hash = ?',
        [cleanHash]
      );

      // Mettre à jour le solde utilisateur
      await conn.execute(
        'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
        [amountUsdt, uid]
      );

      // Insérer le record de dépôt confirmé
      await conn.execute(
        `INSERT INTO bsc_deposits 
         (user_id, tx_hash, log_index, from_address, to_address, amount_wei, amount_usdt, block_number, confirmations, status, credited_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
        [
          uid,
          cleanHash,
          logIndex,
          parsedLog.args.from,
          PLATFORM_WALLET,
          parsedLog.args.value.toString(),
          amountUsdt,
          blockNumber,
          confirmations
        ]
      );

      await conn.commit();

      // Envoyer notifications temps réel
      const io = req.app.get('io');
      if (io) {
        // Mettre à jour le solde
        const [updUser] = await db.query(
          'SELECT deposit_account_balance, withdrawal_account_balance FROM users WHERE id = ?',
          [uid]
        );
        if (updUser && updUser[0]) {
          io.to(`user:${uid}`).emit('balance-update', {
            depositBalance: Number(updUser[0].deposit_account_balance || 0),
            withdrawalBalance: Number(updUser[0].withdrawal_account_balance || 0)
          });
        }
        io.to(`user:${uid}`).emit('deposit-status', {
          type: 'confirmed',
          txHash: cleanHash,
          amount: amountUsdt,
          message: `✅ Dépôt de ${amountUsdt.toFixed(2)} USDT crédité manuellement par l'administrateur.`
        });
      }

      console.log(`[AdminDepositRecover] Admin #${req.session.adminId} recovered deposit ${cleanHash} — ${amountUsdt} USDT for user ${targetUser.username} (#${uid})`);

      return res.json({
        success: true,
        message: `Dépôt de ${amountUsdt.toFixed(2)} USDT crédité avec succès à ${targetUser.username} (${cleanEmail}).`,
        amount: amountUsdt
      });
    } catch (dbErr) {
      await conn.rollback();
      throw dbErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[AdminDepositRecover] Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Une erreur interne est survenue.' });
  }
});

module.exports = router;
