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

    const deposit = await bscMonitor.inspectDepositTransaction(cleanHash);
    if (!deposit.found) {
      return res.status(404).json({
        success: false,
        error: 'Transaction introuvable sur la blockchain BSC. Vérifiez le TxID.'
      });
    }
    if (deposit.failedOnChain) {
      return res.status(400).json({
        success: false,
        error: 'Cette transaction a échoué on-chain.'
      });
    }
    if (deposit.belowMinimum) {
      return res.status(400).json({
        success: false,
        error: `Le dépôt BNB détecté (${Number(deposit.detectedBnbAmount || 0).toFixed(4)} BNB) est inférieur au minimum accepté (${Number(deposit.minimumBnbAmount || 0).toFixed(4)} BNB).`
      });
    }
    if (!deposit.isDeposit) {
      return res.status(400).json({
        success: false,
        error: 'Cette transaction ne contient aucun dépôt USDT ou BNB valide vers le portefeuille central de la plateforme.'
      });
    }
    if (deposit.confirmations < deposit.requiredConfirmations) {
      return res.status(202).json({
        success: false,
        pending: true,
        error: `Transaction en attente de confirmation (${deposit.confirmations}/${deposit.requiredConfirmations}). Réessayez dans quelques secondes.`,
        confirmations: deposit.confirmations,
        required: deposit.requiredConfirmations,
        currency: deposit.tokenSymbol
      });
    }

    // Démarrer la transaction DB pour créditer
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      let existingRows;
      if (deposit.tokenSymbol === 'BNB') {
        [existingRows] = await conn.execute(
          "SELECT id, status, user_id FROM bsc_deposits WHERE tx_hash = ? AND token_symbol = 'BNB' LIMIT 1 FOR UPDATE",
          [cleanHash]
        );
      } else {
        [existingRows] = await conn.execute(
          "SELECT id, status, user_id FROM bsc_deposits WHERE tx_hash = ? AND log_index = ? LIMIT 1 FOR UPDATE",
          [cleanHash, deposit.logIndex]
        );
      }

      if (existingRows.length > 0) {
        const existingDeposit = existingRows[0];
        if (existingDeposit.status === 'confirmed') {
          await conn.rollback();
          return res.status(409).json({
            success: false,
            error: `Ce dépôt a déjà été traité et crédité à l'utilisateur #${existingDeposit.user_id}.`
          });
        }
        if (existingDeposit.user_id && Number(existingDeposit.user_id) !== Number(uid)) {
          await conn.rollback();
          return res.status(409).json({
            success: false,
            error: `Ce dépôt est déjà associé à l'utilisateur #${existingDeposit.user_id}.`
          });
        }
      }

      if (!targetUser.wallet_address || String(targetUser.wallet_address).toLowerCase() !== deposit.fromAddress) {
        await conn.execute(
          'UPDATE users SET wallet_address = ?, wallet_address_updated_at = NOW() WHERE id = ?',
          [deposit.fromAddress, uid]
        );
      }

      // Mettre à jour le solde utilisateur
      await conn.execute(
        'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
        [deposit.amountUsdt, uid]
      );

      if (existingRows.length > 0) {
        await conn.execute(
          `UPDATE bsc_deposits
           SET user_id = ?, from_address = ?, to_address = ?, amount_wei = ?, amount_usdt = ?, token_symbol = ?, block_number = ?, confirmations = ?, status = 'confirmed', credited_at = NOW()
           WHERE id = ? AND status != 'confirmed'`,
          [
            uid,
            deposit.fromAddress,
            deposit.toAddress,
            deposit.amountWei,
            deposit.amountUsdt,
            deposit.tokenSymbol,
            deposit.blockNumber,
            deposit.confirmations,
            existingRows[0].id
          ]
        );
      } else {
        await conn.execute(
          `INSERT INTO bsc_deposits 
           (user_id, tx_hash, log_index, from_address, to_address, amount_wei, amount_usdt, token_symbol, block_number, confirmations, status, credited_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
          [
            uid,
            cleanHash,
            deposit.logIndex,
            deposit.fromAddress,
            deposit.toAddress,
            deposit.amountWei,
            deposit.amountUsdt,
            deposit.tokenSymbol,
            deposit.blockNumber,
            deposit.confirmations
          ]
        );
      }

      await conn.commit();

      const amountUsdt = Number(deposit.amountUsdt || 0);
      const adminMessage = deposit.tokenSymbol === 'BNB'
        ? `Dépôt de ${Number(deposit.amountBnb || 0).toFixed(4)} BNB (≈ ${amountUsdt.toFixed(2)} USDT) récupéré par l'administrateur.`
        : `Dépôt de ${amountUsdt.toFixed(2)} USDT récupéré par l'administrateur.`;

      // Envoyer notifications temps réel
      try {
        const io = req.app.get('io');
        if (io) {
          // Mettre à jour le solde
          const [updUser] = await db.query(
            'SELECT deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ?',
            [uid]
          );
          if (updUser && updUser[0]) {
            io.to(`user:${uid}`).emit('balance-updated', {
              userId: uid,
              depositBalance: Number(updUser[0].deposit_account_balance || 0),
              withdrawalBalance: Number(updUser[0].withdrawal_account_balance || 0),
              bonusBalance: Number(updUser[0].bonus_account_balance || 0),
              tokenBalance: Number(updUser[0].token_balance || 0),
              message: adminMessage
            });
          }
          io.to(`user:${uid}`).emit('deposit-status', {
            type: 'confirmed',
            txHash: cleanHash,
            amount: amountUsdt,
            currency: deposit.tokenSymbol,
            bnbAmount: deposit.tokenSymbol === 'BNB' ? Number(deposit.amountBnb || 0) : null,
            message: deposit.tokenSymbol === 'BNB'
              ? `✅ Dépôt de ${Number(deposit.amountBnb || 0).toFixed(4)} BNB (≈ ${amountUsdt.toFixed(2)} USDT) crédité manuellement par l'administrateur.`
              : `✅ Dépôt de ${amountUsdt.toFixed(2)} USDT crédité manuellement par l'administrateur.`
          });
        }
      } catch (notifyErr) {
        console.error('[AdminDepositRecover] Non-blocking notification error:', notifyErr);
      }

      console.log(`[AdminDepositRecover] Admin #${req.session.adminId} recovered ${deposit.tokenSymbol} deposit ${cleanHash} — ${amountUsdt} USDT for user ${targetUser.username} (#${uid})`);

      return res.json({
        success: true,
        message: deposit.tokenSymbol === 'BNB'
          ? `Dépôt de ${Number(deposit.amountBnb || 0).toFixed(4)} BNB (≈ ${amountUsdt.toFixed(2)} USDT) crédité avec succès à ${targetUser.username} (${cleanEmail}).`
          : `Dépôt de ${amountUsdt.toFixed(2)} USDT crédité avec succès à ${targetUser.username} (${cleanEmail}).`,
        amount: amountUsdt,
        currency: deposit.tokenSymbol
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

router.post('/withdrawals/create', requireAdminAction('manage_balances', { json: true }), async (req, res) => {
  try {
    const db = require('../config/db');
    const User = require('../models/User');
    const { ethers } = require('ethers');
    const bscMonitor = require('../utils/bscMonitor');

    const { email, amount, sourceAccount = 'withdrawal' } = req.body;

    if (!email || !email.trim().includes('@')) {
      return res.status(400).json({ success: false, error: 'Adresse email de l\'utilisateur invalide.' });
    }
    const amountVal = parseFloat(amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      return res.status(400).json({ success: false, error: 'Montant de retrait invalide.' });
    }

    if (sourceAccount !== 'withdrawal' && sourceAccount !== 'deposit') {
      return res.status(400).json({ success: false, error: 'Compte de débit invalide (doit être "deposit" ou "withdrawal").' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const balanceColumn = sourceAccount === 'deposit' ? 'deposit_account_balance' : 'withdrawal_account_balance';

    // Trouver l'utilisateur par son email
    const [userRows] = await db.query(
      'SELECT id, username, wallet_address, deposit_account_balance, withdrawal_account_balance FROM users WHERE LOWER(email) = ?',
      [cleanEmail]
    );
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, error: `Aucun utilisateur trouvé avec l'adresse email "${email}".` });
    }
    const targetUser = userRows[0];
    const uid = targetUser.id;

    if (!targetUser.wallet_address || !/^0x[a-fA-F0-9]{40}$/.test(targetUser.wallet_address.trim())) {
      return res.status(400).json({ success: false, error: `Cet utilisateur (${targetUser.username}) n'a pas configuré d'adresse de portefeuille BEP-20 valide.` });
    }

    const userBal = parseFloat(targetUser[balanceColumn] || 0);
    if (amountVal > userBal) {
      const accountName = sourceAccount === 'deposit' ? 'dépôt' : 'retrait';
      return res.status(400).json({ success: false, error: `Le solde du compte de ${accountName} de l'utilisateur (${userBal.toFixed(2)} USDT) est insuffisant pour ce montant (${amountVal.toFixed(2)} USDT).` });
    }

    const recipientAddress = targetUser.wallet_address.trim();

    // 1. Débiter le solde et créer le log en statut 'pending'
    const conn = await db.getConnection();
    let withdrawalLogId;
    try {
      await conn.beginTransaction();

      await conn.execute(
        `UPDATE users SET ${balanceColumn} = ${balanceColumn} - ? WHERE id = ?`,
        [amountVal, uid]
      );

      const [insertRes] = await conn.execute(
        `INSERT INTO bsc_withdrawals (user_id, recipient_address, amount_usdt, fee_usdt, net_amount_usdt, status)
         VALUES (?, ?, ?, 0.000000, ?, 'pending')`,
        [uid, recipientAddress, amountVal, amountVal]
      );
      withdrawalLogId = insertRes.insertId;

      await conn.commit();
    } catch (dbErr) {
      await conn.rollback();
      throw dbErr;
    } finally {
      conn.release();
    }

    // 2. Envoyer notifications temps réel pour le débit de solde
    const io = req.app.get('io');
    if (io) {
      const [updUser] = await db.query(
        'SELECT deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ?',
        [uid]
      );
      if (updUser && updUser[0]) {
        io.to(`user:${uid}`).emit('balance-updated', {
          userId: uid,
          depositBalance: Number(updUser[0].deposit_account_balance || 0),
          withdrawalBalance: Number(updUser[0].withdrawal_account_balance || 0),
          bonusBalance: Number(updUser[0].bonus_account_balance || 0),
          tokenBalance: Number(updUser[0].token_balance || 0),
          message: `Retrait de ${amountVal.toFixed(2)} USDT initié par l'administrateur.`
        });
      }
    }

    // 3. Exécuter le transfert blockchain en direct
    const privateKey = process.env.PLATFORM_PRIVATE_KEY || process.env.BSC_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("Clé privée de la plateforme (BSC_PRIVATE_KEY) non configurée dans le fichier .env.");
    }

    const USDT_CONTRACT = (process.env.BSC_USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955').toLowerCase();
    const provider = bscMonitor.getRpcProvider();
    const signer = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(
      USDT_CONTRACT,
      ['function transfer(address to, uint256 amount) returns (bool)'],
      signer
    );
    const amountWei = ethers.utils.parseUnits(amountVal.toFixed(18), 18);

    let tx;
    try {
      tx = await contract.transfer(recipientAddress, amountWei);
    } catch (blockchainErr) {
      console.error(`[AdminWithdrawal] On-chain transfer failed:`, blockchainErr);
      
      // Rembourser l'utilisateur et marquer en échec
      const refundConn = await db.getConnection();
      try {
        await refundConn.beginTransaction();
        await refundConn.execute(
          `UPDATE users SET ${balanceColumn} = ${balanceColumn} + ? WHERE id = ?`,
          [amountVal, uid]
        );
        await refundConn.execute(
          "UPDATE bsc_withdrawals SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?",
          [blockchainErr.message || 'On-chain transfer failed', withdrawalLogId]
        );
        await refundConn.commit();
      } catch (refundErr) {
        await refundConn.rollback();
        console.error(`[AdminWithdrawal] Critical error rollback failed:`, refundErr);
      } finally {
        refundConn.release();
      }

      // Notifier l'échec
      if (io) {
        const [updUser] = await db.query(
          'SELECT deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ?',
          [uid]
        );
        if (updUser && updUser[0]) {
          io.to(`user:${uid}`).emit('balance-updated', {
            userId: uid,
            depositBalance: Number(updUser[0].deposit_account_balance || 0),
            withdrawalBalance: Number(updUser[0].withdrawal_account_balance || 0),
            bonusBalance: Number(updUser[0].bonus_account_balance || 0),
            tokenBalance: Number(updUser[0].token_balance || 0),
            message: `❌ Retrait de ${amountVal.toFixed(2)} USDT échoué. Solde remboursé.`
          });
        }
      }

      return res.status(400).json({
        success: false,
        error: `Le transfert sur la blockchain a échoué. Raison : ${blockchainErr.message || blockchainErr}`
      });
    }

    // 4. Mettre à jour avec le hash de transaction
    await db.query(
      `UPDATE bsc_withdrawals
       SET tx_hash = ?,
           submitted_at = NOW(),
           confirmations = 0,
           updated_at = NOW()
       WHERE id = ?`,
      [tx.hash, withdrawalLogId]
    );

    console.log(`[AdminWithdrawal] Admin #${req.session.adminId} executed withdrawal of ${amountVal} USDT for user ${targetUser.username} (#${uid}) to address ${recipientAddress}. Tx Hash: ${tx.hash}`);

    return res.json({
      success: true,
      message: `Retrait de ${amountVal.toFixed(2)} USDT envoyé avec succès. Tx Hash: ${tx.hash}`,
      txHash: tx.hash
    });

  } catch (err) {
    console.error('[AdminWithdrawal] Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Une erreur interne est survenue.' });
  }
});

module.exports = router;
