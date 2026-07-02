const db = require('../config/db');
const User = require('../models/User');
const Notification = require('../models/Notification');
const P2PMarket = require('../models/P2PMarket');
const mailer = require('./mailer');
const { getNumberSetting, setSetting } = require('./appSettings');
const { ethers } = require('ethers');

let ioInstance = null;
let pollTimer = null;
let rpcProvider = null;
let rpcProviderIndex = 0;
let wsProvider = null;
let wsSubscriptionBound = false;
let serviceStarted = false;
let cycleRunning = false;

// Public BSC RPC endpoints - ordered by reliability for eth_getLogs
const BSC_RPC_URLS = [
  process.env.BSC_PROVIDER_URL || process.env.BSC_RPC_URL || 'https://1rpc.io/bnb',
  'https://1rpc.io/bnb',
  'https://bsc.publicnode.com',
];


const PLATFORM_WALLET = (process.env.PLATFORM_WALLET_ADDRESS || process.env.BSC_CENTRAL_WALLET || '0x4e6C4a06F01C3B46704969bBEc0da61FE03BC9A6').trim();
const USDT_CONTRACT = (process.env.BSC_USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955').trim();
const REQUIRED_CONFIRMATIONS = Math.max(1, Number.parseInt(process.env.BSC_DEPOSIT_CONFIRMATIONS || '12', 10) || 12);
const POLL_INTERVAL_MS = Math.max(3000, Number.parseInt(process.env.BSC_DEPOSIT_POLL_INTERVAL_MS || '6000', 10) || 6000);
// 50 blocks max per request to stay within publicnode.com free tier limits
const BLOCK_BATCH_SIZE = Math.max(10, Math.min(50, Number.parseInt(process.env.BSC_DEPOSIT_BLOCK_BATCH_SIZE || '50', 10) || 50));
const INTER_BATCH_DELAY_MS = Math.max(300, Number.parseInt(process.env.BSC_DEPOSIT_INTER_BATCH_DELAY_MS || '500', 10) || 500);
const REORG_BUFFER = Math.max(2, Number.parseInt(process.env.BSC_DEPOSIT_REORG_BUFFER || '6', 10) || 6);
// 500 blocks on startup (~2.5 min of BSC history), then only new blocks each cycle (~10-20 blocks)
const INITIAL_BACKFILL_BLOCKS = Math.max(0, Number.parseInt(process.env.BSC_DEPOSIT_INITIAL_BACKFILL_BLOCKS || '500', 10));
const CURSOR_SETTING_KEY = 'bsc_deposit_last_scanned_block';
const USDT_DECIMALS = 18;

const transferInterface = new ethers.utils.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);
const TRANSFER_TOPIC = transferInterface.getEventTopic('Transfer');
const PLATFORM_WALLET_TOPIC = ethers.utils.hexZeroPad(PLATFORM_WALLET, 32);
const DEPOSIT_LOG_FILTER = {
  address: USDT_CONTRACT,
  topics: [TRANSFER_TOPIC, null, PLATFORM_WALLET_TOPIC]
};

function getRpcProvider() {
  if (!rpcProvider) {
    const providerUrl = BSC_RPC_URLS[rpcProviderIndex % BSC_RPC_URLS.length];
    rpcProvider = new ethers.providers.JsonRpcProvider(providerUrl);
  }
  return rpcProvider;
}

// Rotate to next RPC endpoint on rate-limit errors
function rotateRpcProvider() {
  rpcProvider = null;
  rpcProviderIndex = (rpcProviderIndex + 1) % BSC_RPC_URLS.length;
  const newUrl = BSC_RPC_URLS[rpcProviderIndex];
  console.warn(`[BSCMonitor] Rotating RPC to: ${newUrl}`);
  return getRpcProvider();
}

function isRateLimitError(err) {
  const msg = (err && typeof err.message === 'string') ? err.message : '';
  const body = (err && typeof err.body === 'string') ? err.body : '';
  return (
    (err && err.code === -32005) ||
    (err && err.error && err.error.code === -32005) ||
    msg.includes('limit exceeded') ||
    msg.includes('rate limit') ||
    // publicnode.com 403 "Archive requests require a personal token"
    (err && err.status === 403) ||
    body.includes('Archive requests') ||
    msg.includes('bad response') && (err && err.status === 403)
  );
}

function getWsProvider() {
  if (wsProvider) return wsProvider;

  const explicitWsUrl = (process.env.BSC_WS_PROVIDER_URL || '').trim();
  const fallbackUrl = (process.env.BSC_PROVIDER_URL || '').trim();
  const wsUrl = explicitWsUrl || (/^wss?:\/\//i.test(fallbackUrl) ? fallbackUrl : '');
  if (!wsUrl) return null;

  wsProvider = new ethers.providers.WebSocketProvider(wsUrl);
  return wsProvider;
}

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
        message: cleanMessage,
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
    const [rows] = await db.query(
      'SELECT * FROM bsc_deposits WHERE tx_hash = ? ORDER BY id DESC LIMIT 1',
      [txHash]
    );

    if (fullUser && rows.length > 0) {
      mailer.sendTransactionReceiptEmail(fullUser, rows[0], 'deposit').catch((emailErr) => {
        console.error('[BSCMonitor] Failed to send receipt email for deposit tx:', txHash, emailErr);
      });
    }
  } catch (err) {
    console.error('[BSCMonitor] Failed to trigger deposit receipt email:', err);
  }
}

function scheduleNextCycle(delayMs = POLL_INTERVAL_MS) {
  if (!serviceStarted) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    runMonitorCycle('poll').catch((err) => {
      console.error('[BSCMonitor] Poll cycle error:', err);
    });
  }, delayMs);
}

function buildUserWalletMap(users) {
  const userMap = new Map();
  for (const user of users) {
    const normalized = String(user.wallet_address || '').trim().toLowerCase();
    if (!normalized) continue;
    userMap.set(normalized, Number(user.id));
  }
  return userMap;
}

async function getStartBlock(currentBlock) {
  const storedCursor = await getNumberSetting(CURSOR_SETTING_KEY, -1);
  if (storedCursor >= 0) {
    // If the cursor is stale (> 1000 blocks behind tip), reset it to avoid archive requests
    const blocksBehind = currentBlock - storedCursor;
    if (blocksBehind > 1000) {
      console.warn(`[BSCMonitor] Stale cursor detected (${blocksBehind} blocks behind). Resetting to current-${INITIAL_BACKFILL_BLOCKS}.`);
      await setSetting(CURSOR_SETTING_KEY, currentBlock - INITIAL_BACKFILL_BLOCKS);
      return Math.max(0, currentBlock - INITIAL_BACKFILL_BLOCKS);
    }
    return Math.max(0, Math.min(currentBlock, storedCursor) - REORG_BUFFER + 1);
  }
  return Math.max(0, currentBlock - INITIAL_BACKFILL_BLOCKS);
}

async function emitPendingDeposit(userId, txHash, confirmations, amountUsdt) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit('deposit-status', {
    type: 'pending',
    txHash,
    confirmations,
    required: REQUIRED_CONFIRMATIONS,
    amount: amountUsdt,
    message: `Dépôt de ${Number(amountUsdt).toFixed(2)} USDT détecté (${confirmations}/${REQUIRED_CONFIRMATIONS} confirmations)`
  });
}

async function confirmDeposit(existingDeposit, confirmations, blockNumber) {
  const [updateResult] = await db.query(
    `UPDATE bsc_deposits
     SET status = 'confirmed', confirmations = ?, block_number = ?, credited_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [confirmations, blockNumber, existingDeposit.id]
  );

  if (!updateResult || updateResult.affectedRows === 0) {
    return false;
  }

  await db.query(
    'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
    [existingDeposit.amount_usdt, existingDeposit.user_id]
  );

  const amount = Number(existingDeposit.amount_usdt || 0);
  await emitMarketNotification(
    existingDeposit.user_id,
    null,
    `Votre dépôt de ${amount.toFixed(2)} USDT (BEP-20) a été confirmé.`
  );
  await emitRealtimeBalanceUpdate(
    existingDeposit.user_id,
    `Dépôt de ${amount.toFixed(2)} USDT confirmé !`
  );
  await sendDepositReceipt(existingDeposit.user_id, existingDeposit.tx_hash);
  return true;
}

async function insertOrUpdateDepositRecord(deposit) {
  const [existingRows] = await db.query(
    `SELECT id, user_id, tx_hash, amount_usdt, confirmations, status
     FROM bsc_deposits
     WHERE tx_hash = ? AND log_index = ?
     LIMIT 1`,
    [deposit.txHash, deposit.logIndex]
  );

  const isConfirmed = deposit.confirmations >= REQUIRED_CONFIRMATIONS;

  if (existingRows.length === 0) {
    await db.query(
      `INSERT INTO bsc_deposits
       (user_id, tx_hash, log_index, from_address, to_address, amount_wei, amount_usdt, token_symbol, block_number, confirmations, status, credited_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'USDT', ?, ?, ?, ?)`,
      [
        deposit.userId,
        deposit.txHash,
        deposit.logIndex,
        deposit.fromAddress,
        deposit.toAddress,
        deposit.amountWei,
        deposit.amountUsdt,
        deposit.blockNumber,
        deposit.confirmations,
        isConfirmed ? 'confirmed' : 'pending',
        isConfirmed ? new Date() : null
      ]
    );

    if (isConfirmed) {
      await db.query(
        'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
        [deposit.amountUsdt, deposit.userId]
      );
      await emitMarketNotification(
        deposit.userId,
        null,
        `Votre dépôt de ${deposit.amountUsdt.toFixed(2)} USDT (BEP-20) a été confirmé.`
      );
      await emitRealtimeBalanceUpdate(
        deposit.userId,
        `Dépôt de ${deposit.amountUsdt.toFixed(2)} USDT confirmé !`
      );
      await sendDepositReceipt(deposit.userId, deposit.txHash);
    } else {
      await emitPendingDeposit(deposit.userId, deposit.txHash, deposit.confirmations, deposit.amountUsdt);
    }
    return;
  }

  const existingDeposit = existingRows[0];
  if (existingDeposit.status !== 'pending') {
    return;
  }

  if (isConfirmed) {
    await confirmDeposit(existingDeposit, deposit.confirmations, deposit.blockNumber);
    return;
  }

  if (Number(existingDeposit.confirmations || 0) !== deposit.confirmations) {
    await db.query(
      'UPDATE bsc_deposits SET confirmations = ?, block_number = ? WHERE id = ?',
      [deposit.confirmations, deposit.blockNumber, existingDeposit.id]
    );
    await emitPendingDeposit(existingDeposit.user_id, existingDeposit.tx_hash, deposit.confirmations, existingDeposit.amount_usdt);
  }
}

async function syncDepositLogs(userMap, currentBlock) {
  const scanEndBlock = Math.max(0, currentBlock - REORG_BUFFER);
  const fromBlock = await getStartBlock(scanEndBlock);
  if (fromBlock > scanEndBlock) {
    return;
  }

  // Dual-path support: Etherscan API V2 (if API key is present) with automatic fallback to RPC
  const etherscanKey = (process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY || '').trim();
  if (etherscanKey) {
    try {
      const url = `https://api.etherscan.io/v2/api` +
        `?chainid=56` +
        `&module=account` +
        `&action=tokentx` +
        `&contractaddress=${USDT_CONTRACT}` +
        `&address=${PLATFORM_WALLET}` +
        `&startblock=${fromBlock}` +
        `&endblock=${scanEndBlock}` +
        `&sort=asc` +
        `&apikey=${etherscanKey}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.status === '1' && Array.isArray(data.result)) {
        console.log(`[BSCMonitor] Polled ${data.result.length} transactions via Etherscan API V2`);
        for (const tx of data.result) {
          if (tx.to.toLowerCase() !== PLATFORM_WALLET.toLowerCase()) continue;

          const fromAddress = String(tx.from || '').toLowerCase();
          const userId = userMap.get(fromAddress);
          if (!userId) continue;

          const amountUsdt = Number(ethers.utils.formatUnits(tx.value, USDT_DECIMALS));
          if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) continue;

          const blockNumber = Number(tx.blockNumber || 0);
          const confirmations = Number(tx.confirmations || 0);
          const logIndex = Number(tx.logIndex || 0);

          await insertOrUpdateDepositRecord({
            userId,
            txHash: tx.hash,
            logIndex,
            fromAddress: tx.from,
            toAddress: tx.to,
            amountWei: tx.value.toString(),
            amountUsdt,
            blockNumber,
            confirmations
          });
        }
        await setSetting(CURSOR_SETTING_KEY, scanEndBlock);
        return; // Success, bypass RPC fallback
      } else {
        console.warn(`[BSCMonitor] Etherscan API V2 returned status ${data.status} (${data.result || data.message}). Falling back to RPC...`);
      }
    } catch (etherscanErr) {
      console.warn('[BSCMonitor] Etherscan API V2 call failed. Falling back to RPC...', etherscanErr.message || etherscanErr);
    }
  }

  let provider = getRpcProvider();
  let batchesProcessed = 0;

  for (let batchStart = fromBlock; batchStart <= scanEndBlock; batchStart += BLOCK_BATCH_SIZE) {
    const batchEnd = Math.min(scanEndBlock, batchStart + BLOCK_BATCH_SIZE - 1);

    if (batchesProcessed > 0 && INTER_BATCH_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, INTER_BATCH_DELAY_MS));
    }

    let logs;
    try {
      logs = await provider.getLogs({
        ...DEPOSIT_LOG_FILTER,
        fromBlock: batchStart,
        toBlock: batchEnd
      });
    } catch (batchErr) {
      console.warn(`[BSCMonitor] Query failed for blocks ${batchStart}-${batchEnd} on ${provider.connection.url}. Rotating RPC and retrying... Error: ${batchErr.message || batchErr}`);
      provider = rotateRpcProvider();
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const newCurrentBlock = await provider.getBlockNumber();
        const adjustedEnd = Math.min(batchEnd, newCurrentBlock);
        if (batchStart <= adjustedEnd) {
          logs = await provider.getLogs({
            ...DEPOSIT_LOG_FILTER,
            fromBlock: batchStart,
            toBlock: adjustedEnd
          });
        } else {
          logs = [];
        }
      } catch (retryErr) {
        console.error(`[BSCMonitor] Retry also failed for blocks ${batchStart}-${batchEnd} on ${provider.connection.url}. Skipping batch:`, retryErr.message || retryErr);
        batchesProcessed++;
        continue;
      }
    }

    logs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.logIndex - b.logIndex;
    });

    for (const log of logs) {
      const parsed = transferInterface.parseLog(log);
      const fromAddress = String(parsed.args.from || '').toLowerCase();
      const userId = userMap.get(fromAddress);
      if (!userId) continue;

      const amountUsdt = Number(ethers.utils.formatUnits(parsed.args.value, USDT_DECIMALS));
      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) continue;

      const blockNumber = Number(log.blockNumber || 0);
      const confirmations = Math.max(0, currentBlock - blockNumber + 1);

      await insertOrUpdateDepositRecord({
        userId,
        txHash: log.transactionHash,
        logIndex: Number(log.logIndex || 0),
        fromAddress: parsed.args.from,
        toAddress: parsed.args.to,
        amountWei: parsed.args.value.toString(),
        amountUsdt,
        blockNumber,
        confirmations
      });
    }
    batchesProcessed++;
  }

  await setSetting(CURSOR_SETTING_KEY, scanEndBlock);
}


async function refreshPendingDeposits(currentBlock) {
  const provider = getRpcProvider();
  const [pendingRows] = await db.query(
    `SELECT id, user_id, tx_hash, log_index, amount_usdt, confirmations, status
     FROM bsc_deposits
     WHERE status = 'pending'
     ORDER BY id ASC`
  );

  for (const pendingDeposit of pendingRows) {
    try {
      const receipt = await provider.getTransactionReceipt(pendingDeposit.tx_hash);
      if (!receipt || !receipt.blockNumber) continue;

      const receiptLog = Array.isArray(receipt.logs)
        ? receipt.logs.find((log) =>
            String(log.transactionHash || '').toLowerCase() === String(pendingDeposit.tx_hash || '').toLowerCase() &&
            String(log.address || '').toLowerCase() === String(USDT_CONTRACT || '').toLowerCase() &&
            Number(log.logIndex || -1) === Number(pendingDeposit.log_index || 0)
          )
        : null;

      const blockNumber = Number(receiptLog?.blockNumber || receipt.blockNumber || 0);
      const confirmations = Math.max(0, currentBlock - blockNumber + 1);

      if (confirmations >= REQUIRED_CONFIRMATIONS) {
        await confirmDeposit(pendingDeposit, confirmations, blockNumber);
        continue;
      }

      if (Number(pendingDeposit.confirmations || 0) !== confirmations) {
        await db.query(
          'UPDATE bsc_deposits SET confirmations = ?, block_number = ? WHERE id = ?',
          [confirmations, blockNumber, pendingDeposit.id]
        );
        await emitPendingDeposit(pendingDeposit.user_id, pendingDeposit.tx_hash, confirmations, pendingDeposit.amount_usdt);
      }
    } catch (pendingErr) {
      console.warn(`[BSCMonitor] Failed to check pending deposit status for tx ${pendingDeposit.tx_hash}:`, pendingErr.message || pendingErr);
    }
  }
}

async function runMonitorCycle(reason = 'manual') {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    const provider = getRpcProvider();
    const currentBlock = await provider.getBlockNumber();
    const [users] = await db.query(
      'SELECT id, wallet_address FROM users WHERE wallet_address IS NOT NULL AND wallet_address != ""'
    );
    const userMap = buildUserWalletMap(users);

    if (userMap.size > 0) {
      await syncDepositLogs(userMap, currentBlock);
    }

    await refreshPendingDeposits(currentBlock);

    if (reason === 'startup') {
      console.log('[BSCMonitor] Deposit monitor synced with on-chain logs.');
    }
  } catch (err) {
    console.error(`[BSCMonitor] Error during ${reason} cycle:`, err);
  } finally {
    cycleRunning = false;
    scheduleNextCycle();
  }
}

async function handleIncomingWsLog() {
  await runMonitorCycle('ws');
}

function bindWsSubscription() {
  if (wsSubscriptionBound) return;

  try {
    const provider = getWsProvider();
    if (!provider) return;

    provider.on(DEPOSIT_LOG_FILTER, handleIncomingWsLog);
    wsSubscriptionBound = true;
    console.log('[BSCMonitor] WebSocket subscription enabled for live deposit detection.');
  } catch (err) {
    wsProvider = null;
    wsSubscriptionBound = false;
    console.warn('[BSCMonitor] WebSocket provider unavailable, continuing with RPC polling only:', err.message || err);
  }
}

function start(io) {
  ioInstance = io;
  serviceStarted = true;

  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  bindWsSubscription();
  runMonitorCycle('startup').catch((err) => {
    console.error('[BSCMonitor] Failed to start monitor:', err);
  });
  console.log(`[BSCMonitor] Service started (RPC polling every ${POLL_INTERVAL_MS}ms, confirmations required: ${REQUIRED_CONFIRMATIONS})`);
}

function stop() {
  serviceStarted = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  if (wsProvider && wsSubscriptionBound) {
    try {
      wsProvider.off(DEPOSIT_LOG_FILTER, handleIncomingWsLog);
    } catch (err) {
      console.warn('[BSCMonitor] Failed to detach WebSocket listener:', err.message || err);
    }
  }

  wsSubscriptionBound = false;
  console.log('[BSCMonitor] Service stopped');
}

async function triggerCheck() {
  await runMonitorCycle('manual');
}

module.exports = {
  start,
  stop,
  triggerCheck,
  getRpcProvider,
  rotateRpcProvider
};
