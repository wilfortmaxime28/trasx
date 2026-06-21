const db = require('../config/db');
const User = require('../models/User');
const Notification = require('../models/Notification');
const P2PMarket = require('../models/P2PMarket');
const mailer = require('./mailer');

let pollingInterval = null;
let ioInstance = null;

// Platform wallet info
const PLATFORM_WALLET = '0x4e6C4a06F01C3B46704969bBEc0da61FE03BC9A6';
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const REQUIRED_CONFIRMATIONS = 12;

async function emitRealtimeBalanceUpdate(userId, message = null) {
  try {
    const user = await User.getById(userId);
    if (!user) return null;

    const frozen = await P2PMarket.getFrozenBalances(userId);

    const payload = {
      userId: Number(user.id),
      depositBalance: Number(user.deposit_account_balance || 0),
      withdrawalBalance: Number(user.withdrawal_account_balance || 0),
      bonusBalance: Number(user.bonus_account_balance || 0),
      tokenBalance: Number(user.token_balance || 0),
      frozenUsdt: frozen.frozenUsdt,
      frozenToken: frozen.frozenToken,
      message
    };

    if (ioInstance) {
      ioInstance.to(`user:${userId}`).emit('balance-updated', payload);
      ioInstance.to(`user:${userId}`).emit('deposit-status', {
        type: 'confirmed',
        message
      });
    }
    return payload;
  } catch (err) {
    console.error('[BSCMonitor] Error emitting balance update:', err);
  }
}

async function emitMarketNotification(recipientId, actorId, message) {
  try {
    const cleanMessage = String(message || '').slice(0, 255);
    const actor = actorId ? await User.getById(actorId) : null;
    const notificationId = await Notification.create({
      recipientId,
      actorId,
      type: 'market',
      message: cleanMessage
    });
    
    if (ioInstance) {
      const unreadCount = await Notification.getUnreadCount(recipientId);
      ioInstance.to(`user:${recipientId}`).emit('notification-created', {
        id: notificationId,
        recipient_id: recipientId,
        actor_id: actorId,
        type: 'market',
        message,
        post_id: null,
        share_id: null,
        comment_id: null,
        is_read: 0,
        read_at: null,
        created_at: new Date().toISOString(),
        actor_name: actor ? `${actor.first_name} ${actor.last_name}` : 'TrasX Market',
        actor_username: actor?.username || 'market',
        actor_avatar: actor?.avatar || '/assets/avatar_placeholder.jpg'
      });
      ioInstance.to(`user:${recipientId}`).emit('notification-count-updated', { unreadCount });
    }
  } catch (err) {
    console.error('[BSCMonitor] Error emitting market notification:', err);
  }
}

async function sendDepositReceipt(userId, txHash) {
  try {
    const fullUser = await User.getById(userId);
    const [dRows] = await db.query('SELECT * FROM bsc_deposits WHERE tx_hash = ?', [txHash]);
    if (fullUser && dRows.length > 0) {
      mailer.sendTransactionReceiptEmail(fullUser, dRows[0], 'deposit').catch(emailErr => {
        console.error('[BSCMonitor] Failed to send receipt email for deposit tx:', txHash, emailErr);
      });
    }
  } catch (err) {
    console.error('[BSCMonitor] Failed to trigger deposit receipt email:', err);
  }
}

async function monitorDeposits() {
  try {
    // 1. Get users with configured wallet addresses
    const [users] = await db.query(
      'SELECT id, wallet_address FROM users WHERE wallet_address IS NOT NULL AND wallet_address != ""'
    );
    if (users.length === 0) return;

    const userMap = new Map();
    users.forEach(u => {
      userMap.set(u.wallet_address.toLowerCase().trim(), u.id);
    });

    // 2. Fetch token transfers from BSCScan
    const apiKey = process.env.BSCSCAN_API_KEY || '';
    const url = `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${USDT_CONTRACT}&address=${PLATFORM_WALLET}&page=1&offset=100&sort=desc&apikey=${apiKey}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== '1' || !Array.isArray(data.result)) {
      // BSCScan returns status "0" with msg "No transactions found" if there are none, which is normal
      if (data.message !== 'No transactions found') {
        console.warn('[BSCMonitor] BSCScan API warning:', data.message || data);
      }
      return;
    }

    const txs = data.result;

    for (const tx of txs) {
      const fromAddr = tx.from.toLowerCase().trim();
      const toAddr = tx.to.toLowerCase().trim();
      
      // Make sure the destination is our platform wallet
      if (toAddr !== PLATFORM_WALLET.toLowerCase()) continue;

      // Check if from matches a registered user wallet address
      const userId = userMap.get(fromAddr);
      if (!userId) continue;

      const txHash = tx.hash;
      const confirmations = parseInt(tx.confirmations || '0', 10);
      const valueWei = tx.value;
      const blockNumber = parseInt(tx.blockNumber || '0', 10);
      // USDT has 18 decimals on BSC mainnet
      const amountUsdt = parseFloat(valueWei) / 1e18; 

      if (isNaN(amountUsdt) || amountUsdt <= 0) continue;

      // 3. Check if transaction already processed
      const [existing] = await db.query(
        'SELECT * FROM bsc_deposits WHERE tx_hash = ?',
        [txHash]
      );

      if (existing.length === 0) {
        // New transaction!
        const isConfirmed = confirmations >= REQUIRED_CONFIRMATIONS;
        const status = isConfirmed ? 'confirmed' : 'pending';
        const creditedAt = isConfirmed ? new Date() : null;

        await db.query(
          `INSERT INTO bsc_deposits 
           (user_id, tx_hash, from_address, to_address, amount_wei, amount_usdt, token_symbol, block_number, confirmations, status, credited_at)
           VALUES (?, ?, ?, ?, ?, ?, 'USDT', ?, ?, ?, ?)`,
          [userId, txHash, tx.from, tx.to, valueWei, amountUsdt, blockNumber, confirmations, status, creditedAt]
        );

        if (isConfirmed) {
          // Credit user balance
          await db.query(
            'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
            [amountUsdt, userId]
          );
          
          await emitMarketNotification(userId, null, `Votre dépôt de ${amountUsdt.toFixed(2)} USDT (BEP-20) a été confirmé.`);
          await emitRealtimeBalanceUpdate(userId, `Dépôt de ${amountUsdt.toFixed(2)} USDT confirmé !`);
          sendDepositReceipt(userId, txHash);
        } else {
          // Notify pending deposit
          if (ioInstance) {
            ioInstance.to(`user:${userId}`).emit('deposit-status', {
              type: 'pending',
              txHash,
              confirmations,
              required: REQUIRED_CONFIRMATIONS,
              amount: amountUsdt,
              message: `Dépôt de ${amountUsdt.toFixed(2)} USDT détecté (${confirmations}/${REQUIRED_CONFIRMATIONS} confirmations)`
            });
          }
        }
      } else {
        // Tx exists, check if pending and ready to be confirmed
        const currentTx = existing[0];
        if (currentTx.status === 'pending') {
          const isConfirmed = confirmations >= REQUIRED_CONFIRMATIONS;
          
          if (isConfirmed) {
            await db.query(
              `UPDATE bsc_deposits 
               SET status = 'confirmed', confirmations = ?, block_number = ?, credited_at = NOW() 
               WHERE id = ?`,
              [confirmations, blockNumber, currentTx.id]
            );

            await db.query(
              'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
              [currentTx.amount_usdt, currentTx.user_id]
            );

            await emitMarketNotification(currentTx.user_id, null, `Votre dépôt de ${Number(currentTx.amount_usdt).toFixed(2)} USDT (BEP-20) a été confirmé.`);
            await emitRealtimeBalanceUpdate(currentTx.user_id, `Dépôt de ${Number(currentTx.amount_usdt).toFixed(2)} USDT confirmé !`);
            sendDepositReceipt(currentTx.user_id, currentTx.tx_hash);
          } else if (confirmations !== currentTx.confirmations) {
            // Update confirmations count
            await db.query(
              'UPDATE bsc_deposits SET confirmations = ?, block_number = ? WHERE id = ?',
              [confirmations, blockNumber, currentTx.id]
            );

            if (ioInstance) {
              ioInstance.to(`user:${currentTx.user_id}`).emit('deposit-status', {
                type: 'pending',
                txHash,
                confirmations,
                required: REQUIRED_CONFIRMATIONS,
                amount: currentTx.amount_usdt,
                message: `Dépôt en attente : ${confirmations}/${REQUIRED_CONFIRMATIONS} confirmations`
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[BSCMonitor] Error in monitor loop:', err);
  }
}

function start(io) {
  ioInstance = io;
  if (pollingInterval) clearInterval(pollingInterval);
  
  // Run once immediately, then every 15 seconds
  monitorDeposits();
  pollingInterval = setInterval(monitorDeposits, 15000);
  console.log('[BSCMonitor] Service started (polling every 15s)');
}

function stop() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  console.log('[BSCMonitor] Service stopped');
}

module.exports = {
  start,
  stop,
  triggerCheck: monitorDeposits
};
