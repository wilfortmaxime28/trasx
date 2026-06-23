// Server entry point - version 155
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const feedController = require('./controllers/feedController');
const HashtagController = require('./controllers/hashtagController');
const Post = require('./models/Post');
const HiddenPost = require('./models/HiddenPost');
const PostReport = require('./models/PostReport');
const PostShare = require('./models/PostShare');
const Comment = require('./models/Comment');
const Reel = require('./models/Reel');
const Message = require('./models/Message');
const Notification = require('./models/Notification');
const EventTicket = require('./models/EventTicket');
const User = require('./models/User');
const Admin = require('./models/Admin');
const Ad = require('./models/Ad');
const Challenge = require('./models/Challenge');
const P2PMarket = require('./models/P2PMarket');
const PlatformRevenue = require('./models/PlatformRevenue');
const db = require('./config/db');
const installController = require('./controllers/installController');
const presence = require('./utils/presence');
const { createTranslator, createSourceTextTranslator, normalizeLocale, SUPPORTED_LOCALES, flattenTranslations, flattenSourceTextTranslations } = require('./utils/i18n');
const { getNumberSetting } = require('./utils/appSettings');
const { isNewUserWithinWindow, computePromoDailyTarget } = require('./utils/promoReach');
const gamesManager = require('./utils/gamesManager');
const QRCode = require('qrcode');
const bscMonitor = require('./utils/bscMonitor');
const mailer = require('./utils/mailer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.set('io', io);

const TRADE_PRICE_MIN = 2;
const TRADE_PRICE_MAX = 20;
const GAME_ROUND_TRANSITION_DELAY_MS = 3500;

async function emitRealtimeBalanceUpdate(userId, message = null) {
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

  io.to(`user:${userId}`).emit('balance-updated', payload);
  return payload;
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
    const unreadCount = await Notification.getUnreadCount(recipientId);

    io.to(`user:${recipientId}`).emit('notification-created', {
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
    io.to(`user:${recipientId}`).emit('notification-count-updated', { unreadCount });
  } catch (err) {
    console.error('Error emitting market notification:', err);
  }
}

let postBackgroundSchemaPromise = null;
async function ensurePostBackgroundSchema() {
  if (!postBackgroundSchemaPromise) {
    postBackgroundSchemaPromise = (async () => {
      const [tableExists] = await db.query("SHOW TABLES LIKE 'users'");
      if (!tableExists || tableExists.length === 0) {
        console.log('Users table does not exist yet. Skipping post_backgrounds table check.');
        postBackgroundSchemaPromise = null;
        return;
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS post_backgrounds (
          id INT AUTO_INCREMENT PRIMARY KEY,
          image_url VARCHAR(255) NOT NULL,
          is_paid TINYINT(1) DEFAULT 0,
          price DECIMAL(15,2) DEFAULT 0.00,
          creator_user_id INT NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      const [creatorColumnRows] = await db.query('SHOW COLUMNS FROM post_backgrounds LIKE ?', ['creator_user_id']);
      if (!creatorColumnRows || creatorColumnRows.length === 0) {
        await db.query('ALTER TABLE post_backgrounds ADD COLUMN creator_user_id INT NULL DEFAULT NULL AFTER price');
      }
    })().catch((error) => {
      postBackgroundSchemaPromise = null;
      throw error;
    });
  }

  return postBackgroundSchemaPromise;
}

let bscDepositsSchemaPromise = null;
async function ensureBscDepositsSchema() {
  if (!bscDepositsSchemaPromise) {
    bscDepositsSchemaPromise = (async () => {
      const [tableExists] = await db.query("SHOW TABLES LIKE 'users'");
      if (!tableExists || tableExists.length === 0) {
        console.log('Users table does not exist yet. Skipping bsc_deposits table check.');
        bscDepositsSchemaPromise = null;
        return;
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS bsc_deposits (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          tx_hash VARCHAR(66) NOT NULL UNIQUE,
          from_address VARCHAR(42) NOT NULL,
          to_address VARCHAR(42) NOT NULL,
          amount_wei VARCHAR(40) NOT NULL,
          amount_usdt DECIMAL(18,6) NOT NULL,
          token_symbol VARCHAR(20) DEFAULT 'USDT',
          block_number INT DEFAULT NULL,
          confirmations INT DEFAULT 0,
          status ENUM('pending','confirmed','failed') DEFAULT 'pending',
          credited_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_bsc_deposits_status (status),
          INDEX idx_bsc_deposits_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    })().catch((error) => {
      bscDepositsSchemaPromise = null;
      throw error;
    });
  }
  return bscDepositsSchemaPromise;
}

let withdrawalSchemaPromise = null;
async function ensureWithdrawalsSchema() {
  if (!withdrawalSchemaPromise) {
    withdrawalSchemaPromise = (async () => {
      const [tableExists] = await db.query("SHOW TABLES LIKE 'users'");
      if (!tableExists || tableExists.length === 0) {
        console.log('Users table does not exist yet. Skipping bsc_withdrawals table check.');
        withdrawalSchemaPromise = null;
        return;
      }

      // 1. Add wallet_address_updated_at to users if not exists
      const [addrUpdatedRows] = await db.query('SHOW COLUMNS FROM users LIKE ?', ['wallet_address_updated_at']);
      if (!addrUpdatedRows || addrUpdatedRows.length === 0) {
        await db.query('ALTER TABLE users ADD COLUMN wallet_address_updated_at TIMESTAMP NULL DEFAULT NULL AFTER wallet_address');
      }

      // 2. Add withdrawal_pin to users if not exists
      const [pinRows] = await db.query('SHOW COLUMNS FROM users LIKE ?', ['withdrawal_pin']);
      if (!pinRows || pinRows.length === 0) {
        await db.query('ALTER TABLE users ADD COLUMN withdrawal_pin VARCHAR(255) NULL DEFAULT NULL AFTER wallet_address_updated_at');
      }

      // 3. Create bsc_withdrawals table
      await db.query(`
        CREATE TABLE IF NOT EXISTS bsc_withdrawals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          tx_hash VARCHAR(66) DEFAULT NULL,
          recipient_address VARCHAR(42) NOT NULL,
          amount_usdt DECIMAL(18,6) NOT NULL,
          fee_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
          net_amount_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
          gas_cost_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
          status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
          error_message TEXT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_bsc_withdrawals_user (user_id),
          INDEX idx_bsc_withdrawals_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Add columns if table already exists without them
      const [feeCols] = await db.query('SHOW COLUMNS FROM bsc_withdrawals LIKE ?', ['fee_usdt']);
      if (!feeCols || feeCols.length === 0) {
        await db.query('ALTER TABLE bsc_withdrawals ADD COLUMN fee_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000 AFTER amount_usdt');
      }
      const [netCols] = await db.query('SHOW COLUMNS FROM bsc_withdrawals LIKE ?', ['net_amount_usdt']);
      if (!netCols || netCols.length === 0) {
        await db.query('ALTER TABLE bsc_withdrawals ADD COLUMN net_amount_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000 AFTER fee_usdt');
      }
      const [gasCols] = await db.query('SHOW COLUMNS FROM bsc_withdrawals LIKE ?', ['gas_cost_usdt']);
      if (!gasCols || gasCols.length === 0) {
        await db.query('ALTER TABLE bsc_withdrawals ADD COLUMN gas_cost_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000 AFTER net_amount_usdt');
      }
    })().catch((error) => {
      withdrawalSchemaPromise = null;
      throw error;
    });
  }
  return withdrawalSchemaPromise;
}

function pickRandomInteger(min, max) {
  const safeMin = Math.ceil(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function roundToDecimals(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function chooseNextTradePrice(currentPriceRaw) {
  const currentPrice = Math.max(TRADE_PRICE_MIN, Math.min(TRADE_PRICE_MAX, Math.round(Number(currentPriceRaw) || TRADE_PRICE_MIN)));
  const higherValues = [];
  const lowerValues = [];

  for (let price = TRADE_PRICE_MIN; price <= TRADE_PRICE_MAX; price += 1) {
    if (price > currentPrice) {
      higherValues.push(price);
    } else if (price < currentPrice) {
      lowerValues.push(price);
    }
  }

  const buckets = [];
  if (higherValues.length > 0) buckets.push({ type: 'increase', weight: 70, values: higherValues });
  if (lowerValues.length > 0) buckets.push({ type: 'decrease', weight: 30, values: lowerValues });

  if (buckets.length === 0) {
    return currentPrice;
  }

  const totalWeight = buckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  let cursor = Math.random() * totalWeight;
  let selectedBucket = buckets[0];

  for (const bucket of buckets) {
    cursor -= bucket.weight;
    if (cursor <= 0) {
      selectedBucket = bucket;
      break;
    }
  }

  const chosenValues = selectedBucket?.values?.length ? selectedBucket.values : [];
  if (chosenValues.length === 0) {
    return currentPrice;
  }

  return chosenValues[pickRandomInteger(0, chosenValues.length - 1)];
}

// Configuration d'EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('view cache');

// Fichiers statiques
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assets', 'trasx-logo-mark.png'));
});

// Route spéciale pour l'icône de profil par défaut (avatar manquant)
app.get('/assets/avatar_placeholder.jpg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="#334155" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect width="24" height="24" fill="#1e293b" stroke="none" />
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  `);
});

app.use('/js/client.js', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/tfjs', express.static(path.join(__dirname, 'node_modules/@tensorflow/tfjs/dist')));
app.use('/vendor/face-api', express.static(path.join(__dirname, 'node_modules/face-api.js/dist')));
app.use('/vendor/tesseract', express.static(path.join(__dirname, 'node_modules/tesseract.js/dist')));
app.use('/vendor/tesseract-core', express.static(path.join(__dirname, 'node_modules/tesseract.js-core')));
app.use('/vendor/tesseract-lang-eng', express.static(path.join(__dirname, 'node_modules/@tesseract.js-data/eng/4.0.0')));
app.use('/models/face-api', express.static(path.join(__dirname, 'public/models/face-api')));

// Parser pour le contenu JSON et formulaires
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const locale = normalizeLocale(req.session?.locale || 'en');
  res.locals.locale = locale;
  res.locals.t = createTranslator(locale);
  res.locals.tText = createSourceTextTranslator(locale);
  res.locals.clientTranslations = flattenTranslations(locale);
  res.locals.clientSourceTextTranslations = flattenSourceTextTranslations(locale);
  res.locals.supportedLocales = SUPPORTED_LOCALES;
  res.locals.formatNumber = (num) => {
    num = Number(num) || 0;
    if (num >= 1000000) {
      const formatted = (num / 1000000).toFixed(1);
      return (formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted) + 'M';
    }
    if (num >= 1000) {
      const formatted = (num / 1000).toFixed(1);
      return (formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted) + 'k';
    }
    return String(num);
  };
  next();
});

// Session
const session = require('express-session');
const sessionMiddleware = session({
  secret: 'weshare_super_secret_key_123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

// Middleware d'interception d'installation (redirige si pas installé)
app.use(async (req, res, next) => {
  const parsedUrl = req.path;
  
  if (
    parsedUrl.startsWith('/install') ||
    parsedUrl.startsWith('/api/install') ||
    parsedUrl.startsWith('/css/') ||
    parsedUrl.startsWith('/js/') ||
    parsedUrl.startsWith('/assets/') ||
    parsedUrl.startsWith('/favicon.ico') ||
    parsedUrl.startsWith('/vendor/') ||
    parsedUrl.startsWith('/sec-login-9x2k-token')
  ) {
    return next();
  }
  
  const installed = await installController.checkIsInstalled();
  if (!installed) {
    return res.redirect('/install');
  }
  
  next();
});

// Routes d'installation
app.get('/install', installController.getInstallPage);
app.post('/api/install/test', installController.testDbConnection);
app.post('/api/install/setup', installController.performInstall);

// Token verification routes for secret admin login (2FA)
const adminAuthController = require('./controllers/adminAuthController');
app.get('/sec-login-9x2k-token/:token', adminAuthController.getVerifyToken);
app.post('/sec-login-9x2k-token/:token', adminAuthController.postVerifyToken);

// Routes Auth
const authRoutes = require('./routes/authRoutes');
app.use('/auth', authRoutes);

// Routes Auth Administrateur (doit être avant requireAuth global)
const adminRoutes = require('./routes/adminRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const profileRoutes = require('./routes/profileRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const eventsRoutes = require('./routes/eventsRoutes');
const statusRoutes = require('./routes/statusRoutes');

// Routes Admin (doit être avant requireAuth global)
app.use('/backoffice-sec-9x2k', adminAuthRoutes);
app.use('/admin', adminRoutes); // Dashboard Admin protégé

// Public share landing route - accessible without auth
app.get('/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const share = await PostShare.getByToken(token);
    if (!share) {
      return res.status(404).send('Share link not found.');
    }

    const post = await Post.getById(share.post_id, 0);
    if (!post) {
      return res.status(404).send('Post not found.');
    }

    const shareClicked = await PostShare.markClicked(token);
    if (shareClicked && Number(post.user_id) !== Number(share.sharer_id)) {
      const sharer = await User.getById(share.sharer_id);
      const recipientId = Number(post.user_id);
      const message = `${sharer.first_name} ${sharer.last_name} shared your post.`;
      const notificationId = await Notification.create({
        recipientId,
        actorId: share.sharer_id,
        type: 'share',
        message,
        postId: post.id,
        shareId: share.id
      });
      const unreadCount = await Notification.getUnreadCount(recipientId);
      io.to(`user:${recipientId}`).emit('notification-created', {
        id: notificationId,
        recipient_id: recipientId,
        actor_id: share.sharer_id,
        type: 'share',
        message,
        post_id: post.id,
        share_id: share.id,
        comment_id: null,
        is_read: 0,
        read_at: null,
        created_at: new Date().toISOString(),
        actor_name: `${sharer.first_name} ${sharer.last_name}`,
        actor_username: sharer.username,
        actor_avatar: sharer.avatar
      });
      io.to(`user:${recipientId}`).emit('notification-count-updated', { unreadCount });
    }

    if (shareClicked) {
      const sharesCount = await PostShare.getClickedCount(post.id);
      io.emit('post-shared', { postId: post.id, shares_count: sharesCount });
    }

    const sharerDisplayName = req.query.name || share.sharer_name;
    const sharerUsername = req.query.from || share.sharer_username;

    res.render('share', {
      post,
      share,
      shareToken: token,
      sharerDisplayName,
      sharerUsername,
      sharePlatform: req.query.platform || share.platform || null
    });
  } catch (err) {
    console.error('Share token error:', err);
    res.status(500).send('Error while opening the share link.');
  }
});

app.get('/events/tickets/:code', async (req, res) => {
  try {
    const ticket = await EventTicket.getByCode(req.params.code);
    if (!ticket) {
      return res.status(404).send('Ticket not found.');
    }

    const locale = normalizeLocale(req.session?.locale || 'en');
    const ticketDownloadUrl = ticket.ticket_asset_url || null;
    res.render('eventTicket', {
      ticket,
      ticketDownloadUrl,
      locale,
      t: createTranslator(locale)
    });
  } catch (err) {
    console.error('Event ticket route error:', err);
    res.status(500).send('Error while opening the ticket.');
  }
});

// Middleware Auth global pour toutes les routes utilisateur (après /auth et admin)
const { requireAuth } = require('./middleware/authMiddleware');
app.use(requireAuth);

// Route principale
app.get('/', feedController.getFeed);
app.get('/api/feed/birthdays', feedController.getBirthdayCards);

// Route Profile
app.use('/profile', profileRoutes);
app.use('/settings', settingsRoutes);
app.use('/events', eventsRoutes);
app.use('/statuses', statusRoutes);

// Routes API Hashtags
app.get('/api/hashtags', requireAuth, HashtagController.getAll);
app.get('/api/hashtags/check', requireAuth, HashtagController.check);
app.post('/api/hashtags/create', requireAuth, HashtagController.create);

app.get('/api/posts/:postId', requireAuth, async (req, res) => {
  try {
    const currentUserId = Number(req.session.userId);
    const postId = Number(req.params.postId);
    const post = await Post.getById(postId, currentUserId);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Publication introuvable.' });
    }
    const participants = await Challenge.getParticipants(postId);
    return res.json({ success: true, post, participants });
  } catch (error) {
    console.error('Error fetching post:', error);
    return res.status(500).json({ success: false, error: 'Impossible de récupérer les détails du challenge.' });
  }
});

app.post('/api/challenges/:postId/participate', requireAuth, async (req, res) => {
  try {
    const currentUserId = Number(req.session.userId);
    const postId = Number(req.params.postId);
    const photoUrl = req.body?.photoUrl || null;

    const post = await Post.getById(postId, currentUserId);
    if (!post || !post.challenge_type) {
      return res.status(404).json({ success: false, error: 'Challenge introuvable.' });
    }

    const participants = await Challenge.getParticipants(postId);
    const acceptedCount = participants.filter((p) => p.status === 'accepted').length;

    if (post.challenge_type === 'miss') {
      return res.status(400).json({ success: false, error: 'La participation au challenge miss est geree uniquement par le createur.' });
    }

    if (post.challenge_type === 'beauty') {
      if (acceptedCount >= 2) {
        return res.status(400).json({ success: false, error: 'Ce challenge de beauté est déjà complet (maximum 2 participants).' });
      }
      if (!photoUrl) {
        return res.status(400).json({ success: false, error: 'Une photo est requise pour participer à ce challenge de beauté.' });
      }
    }

    if (post.challenge_entry_mode === 'invite_only') {
      const existingInvite = participants.find((participant) => Number(participant.user_id) === currentUserId);
      if (!existingInvite) {
        return res.status(403).json({ success: false, error: 'Ce challenge est sur invitation uniquement.' });
      }
      await Challenge.updateParticipantStatus({ postId, userId: currentUserId, status: 'accepted', photoUrl });
    } else {
      await Challenge.addParticipant({ postId, userId: currentUserId, invitedByUserId: post.user_id, status: 'accepted', photoUrl });
    }

    const updatedParticipants = await Challenge.getParticipants(postId);
    io.emit('challenge-updated', { postId, participants: updatedParticipants });
    return res.json({ success: true, participants: updatedParticipants });
  } catch (error) {
    console.error('Challenge participate error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de participer au challenge.' });
  }
});

app.post('/api/challenges/:postId/respond', requireAuth, async (req, res) => {
  try {
    const currentUserId = Number(req.session.userId);
    const postId = Number(req.params.postId);
    const action = String(req.body?.action || '').toLowerCase();
    const photoUrl = req.body?.photoUrl || null;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Action invalide.' });
    }

    const post = await Post.getById(postId, currentUserId);
    if (!post || !post.challenge_type) {
      return res.status(404).json({ success: false, error: 'Challenge introuvable.' });
    }

    if (post.challenge_type === 'miss') {
      return res.status(400).json({ success: false, error: 'Les participants du challenge miss n ont pas besoin de confirmer leur invitation.' });
    }

    if (action === 'accept') {
      const participants = await Challenge.getParticipants(postId);
      const acceptedCount = participants.filter((p) => p.status === 'accepted').length;

      if (post.challenge_type === 'beauty') {
        if (acceptedCount >= 2) {
          return res.status(400).json({ success: false, error: 'Ce challenge de beauté est déjà complet (maximum 2 participants).' });
        }
        if (!photoUrl) {
          return res.status(400).json({ success: false, error: 'Une photo est requise pour accepter ce challenge de beauté.' });
        }
      }
    }

    await Challenge.updateParticipantStatus({
      postId,
      userId: currentUserId,
      status: action === 'accept' ? 'accepted' : 'rejected',
      photoUrl
    });

    const updatedParticipants = await Challenge.getParticipants(postId);
    io.emit('challenge-updated', { postId, participants: updatedParticipants });
    return res.json({ success: true, participants: updatedParticipants });
  } catch (error) {
    console.error('Challenge respond error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de repondre a cette invitation.' });
  }
});

app.post('/api/challenges/:postId/vote', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = Number(req.session.userId);
    const postId = Number(req.params.postId);
    const participantUserId = Number(req.body?.participantUserId);
    const post = await Post.getById(postId, currentUserId);
    if (!post || !post.challenge_type) {
      connection.release();
      return res.status(404).json({ success: false, error: 'Challenge introuvable.' });
    }

    if (post.challenge_end_date && new Date(post.challenge_end_date) < new Date()) {
      connection.release();
      return res.status(400).json({ success: false, error: 'Ce challenge a expiré, les votes sont terminés.' });
    }

    const participants = await Challenge.getParticipants(postId, connection);
    const targetParticipant = participants.find((participant) => Number(participant.user_id) === participantUserId && participant.status === 'accepted');
    if (!targetParticipant) {
      await connection.release();
      return res.status(400).json({ success: false, error: 'Participant introuvable.' });
    }

    const voteMode = String(post.challenge_vote_mode || 'free');
    const votePrice = Math.max(0, Number(post.challenge_vote_price || 0));

    // Vérifier si l'utilisateur a déjà voté dans ce challenge (seulement pour les votes gratuits !)
    if (voteMode === 'free') {
      const [existingVotes] = await connection.query(
        'SELECT id FROM challenge_votes WHERE post_id = ? AND voter_user_id = ?',
        [postId, currentUserId]
      );
      if (existingVotes.length > 0) {
        connection.release();
        return res.status(400).json({ success: false, error: 'Vous avez déjà voté dans ce challenge.' });
      }
    }

    await connection.beginTransaction();

    if (voteMode === 'paid' && votePrice > 0) {
      const [userRows] = await connection.query(
        'SELECT deposit_account_balance FROM users WHERE id = ? FOR UPDATE',
        [currentUserId]
      );
      const balance = Number(userRows[0]?.deposit_account_balance || 0);
      if (balance < votePrice) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ success: false, error: 'Solde insuffisant pour voter.' });
      }

      await connection.query(
        'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
        [votePrice, currentUserId]
      );

      let creatorShare = 0;
      let participantShare = 0;
      let participantRecipientUserId = null;

      if (post.challenge_type === 'vote') {
        creatorShare = roundToDecimals(votePrice * 0.20, 2);
        participantShare = roundToDecimals(votePrice - creatorShare, 2);
        participantRecipientUserId = participantUserId;
      } else {
        const acceptedParticipants = participants.filter((participant) => participant.status === 'accepted');
        const isInviteOnlyChallenge = String(post.challenge_entry_mode || '') === 'invite_only';
        const isMissChallenge = String(post.challenge_type || '') === 'miss';
        const allToCreator = isInviteOnlyChallenge || isMissChallenge;
        creatorShare = allToCreator
          ? roundToDecimals(votePrice, 2)
          : roundToDecimals(votePrice * (Number(post.challenge_creator_share_percent || 30) / 100), 2);
        const participantPool = allToCreator ? 0 : roundToDecimals(votePrice - creatorShare, 2);
        participantShare = !allToCreator && acceptedParticipants.length > 0
          ? roundToDecimals(participantPool / acceptedParticipants.length, 2)
          : 0;
      }

      if (creatorShare > 0) {
        await connection.query(
          'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
          [creatorShare, post.user_id]
        );
      }

      if (participantShare > 0) {
        if (post.challenge_type === 'vote') {
          await connection.query(
            'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
            [participantShare, participantRecipientUserId]
          );
        } else {
          const acceptedParticipants = participants.filter((participant) => participant.status === 'accepted');
          for (const participant of acceptedParticipants) {
            await connection.query(
              'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
              [participantShare, participant.user_id]
            );
          }
        }
      }
    }

    await Challenge.createVote({
      postId,
      voterUserId: currentUserId,
      participantUserId,
      amount: voteMode === 'paid' ? votePrice : 0,
      connection
    });

    await connection.commit();
    const updatedParticipants = await Challenge.getParticipants(postId);
    io.emit('challenge-updated', { postId, participants: updatedParticipants });
    connection.release();
    return res.json({ success: true, participants: updatedParticipants });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    connection.release();
    console.error('Challenge vote error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de voter pour le moment.' });
  }
});

app.post('/api/posts/:postId/shares', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const postId = parseInt(req.params.postId, 10);
    const { channel = 'social', platform = null, recipientUserId = null } = req.body || {};

    if (!currentUserId || !postId) {
      return res.status(400).json({ error: 'Invalid share data.' });
    }

    const post = await Post.getById(postId, currentUserId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const share = await PostShare.create({
      postId,
      sharerId: currentUserId,
      recipientUserId: recipientUserId ? parseInt(recipientUserId, 10) : null,
      channel,
      platform
    });

    const currentUser = await User.getById(currentUserId);
    const shareUrl = `${req.protocol}://${req.get('host')}/share/${share.shareToken}?from=${encodeURIComponent(currentUser.username)}&name=${encodeURIComponent(`${currentUser.first_name} ${currentUser.last_name}`)}&by=${currentUser.id}&post=${postId}&channel=${encodeURIComponent(channel)}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}`;

    res.json({
      shareUrl,
      shareToken: share.shareToken
    });
  } catch (err) {
    console.error('Share create error:', err);
    res.status(500).json({ error: 'Unable to create the share link.' });
  }
});

app.post('/api/posts/:postId/hide', requireAuth, async (req, res) => {
  try {
    const currentUserId = Number(req.session.userId || 0);
    const postId = Number(req.params.postId || 0);

    if (!postId) {
      return res.status(400).json({ success: false, error: 'Post introuvable.' });
    }

    const post = await Post.getById(postId, currentUserId);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Ce post est introuvable.' });
    }

    await HiddenPost.hide(currentUserId, postId);
    return res.json({ success: true, message: 'Post masque. Vous pouvez le restaurer depuis les parametres.' });
  } catch (error) {
    console.error('Hide post error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de masquer ce post pour le moment.' });
  }
});

app.post('/api/posts/:postId/unhide', requireAuth, async (req, res) => {
  try {
    const currentUserId = Number(req.session.userId || 0);
    const postId = Number(req.params.postId || 0);

    if (!postId) {
      return res.status(400).json({ success: false, error: 'Post introuvable.' });
    }

    await HiddenPost.unhide(currentUserId, postId);
    return res.json({ success: true, message: 'Post restaure dans votre feed.' });
  } catch (error) {
    console.error('Unhide post error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de restaurer ce post pour le moment.' });
  }
});

app.post('/api/posts/:postId/report', requireAuth, async (req, res) => {
  try {
    const reporterId = Number(req.session.userId || 0);
    const postId = Number(req.params.postId || 0);
    const reason = String(req.body?.reason || '').trim();
    const details = String(req.body?.details || '').trim();

    const allowedReasons = new Set([
      'spam',
      'fake-news',
      'hate-speech',
      'harassment',
      'violence',
      'nudity',
      'child-safety',
      'self-harm',
      'scam',
      'impersonation',
      'privacy',
      'copyright',
      'illegal-goods',
      'terrorism',
      'other'
    ]);

    if (!postId) {
      return res.status(400).json({ success: false, error: 'Post introuvable.' });
    }

    if (!allowedReasons.has(reason)) {
      return res.status(400).json({ success: false, error: 'Motif de signalement invalide.' });
    }

    if (reason === 'other' && details.length < 8) {
      return res.status(400).json({ success: false, error: 'Veuillez preciser votre motif dans le champ de details.' });
    }

    const post = await Post.getById(postId, reporterId);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Ce post n’existe plus.' });
    }

    if (Number(post.user_id) === reporterId) {
      return res.status(400).json({ success: false, error: 'Vous ne pouvez pas signaler votre propre post.' });
    }

    await PostReport.createOrUpdate({
      postId,
      reporterId,
      reason,
      details: details || null
    });

    return res.json({ success: true, message: 'Merci. Votre signalement a bien ete envoye.' });
  } catch (error) {
    console.error('Post report error:', error);
    return res.status(500).json({ success: false, error: 'Une erreur est survenue pendant le signalement du post.' });
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const [notifications, unreadCount] = await Promise.all([
      Notification.getRecentForUser(currentUserId, 12),
      Notification.getUnreadCount(currentUserId)
    ]);

    res.json({
      notifications,
      unreadCount
    });
  } catch (err) {
    console.error('Notifications API error:', err);
    res.status(500).json({ error: 'Unable to load notifications.' });
  }
});

app.get('/api/p2p/snapshot', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const snapshot = await P2PMarket.getSnapshot(currentUserId);
    res.json({ success: true, ...snapshot });
  } catch (error) {
    console.error('P2P snapshot error:', error);
    res.status(500).json({ success: false, error: 'Impossible de charger le marche P2P.' });
  }
});

app.get('/api/p2p/orders/:orderId/messages', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const messages = await P2PMarket.getOrderMessages(req.params.orderId, currentUserId);
    res.json({ success: true, messages });
  } catch (error) {
    console.error('P2P get order messages error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible de charger cette conversation P2P.' });
  }
});

app.post('/api/p2p/offers', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = req.session.userId;
    await connection.beginTransaction();

    const offerId = await P2PMarket.createOffer(currentUserId, {
      offerType: req.body?.offer_type,
      assetCode: req.body?.asset_code,
      currencyCode: req.body?.currency_code,
      price: req.body?.price,
      usdRate: req.body?.usd_rate,
      totalAmount: req.body?.total_amount,
      minAmount: req.body?.min_amount,
      maxAmount: req.body?.max_amount,
      paymentMethods: req.body?.payment_methods,
      paymentAccountName: req.body?.payment_account_name,
      paymentAccountNumber: req.body?.payment_account_number,
      terms: req.body?.terms
    }, connection);

    await connection.commit();

    await emitRealtimeBalanceUpdate(currentUserId, 'Annonce P2P creee avec succes.');

    res.json({ success: true, offerId, message: 'Annonce P2P creee avec succes.' });
  } catch (error) {
    await connection.rollback();
    console.error('P2P create offer error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible de creer l annonce P2P.' });
  } finally {
    connection.release();
  }
});

app.post('/api/p2p/offers/:offerId/order', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = req.session.userId;
    await connection.beginTransaction();

    const result = await P2PMarket.createOrder(currentUserId, {
      offerId: req.params.offerId,
      amount: req.body?.amount
    }, connection);

    await connection.commit();

    const actor = await User.getById(currentUserId);
    const actorName = actor ? `${actor.first_name} ${actor.last_name}` : 'Un utilisateur';
    const roleLabel = result.offerType === 'sell' ? 'achat' : 'vente';
    const isToken = result.assetCode === 'TOKEN';
    const formattedAmount = isToken ? result.amount.toFixed(4).replace(/\.?0+$/, '') : result.amount.toFixed(2);
    const assetLabel = isToken ? 'Token' : 'USDT';

    await emitMarketNotification(
      result.offerOwnerId,
      currentUserId,
      `${actorName} a ouvert un ordre P2P de ${roleLabel} pour ${formattedAmount} ${assetLabel}.`
    );
    await emitMarketNotification(
      currentUserId,
      null,
      `Votre ordre P2P de ${roleLabel} pour ${formattedAmount} ${assetLabel} a bien ete cree.`
    );

    if (result.offerType === 'buy') {
      await emitRealtimeBalanceUpdate(currentUserId, null);
    }

    res.json({ success: true, orderId: result.orderId, message: 'Ordre P2P cree avec succes.' });
  } catch (error) {
    await connection.rollback();
    console.error('P2P create order error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible d ouvrir cet ordre P2P.' });
  } finally {
    connection.release();
  }
});

app.post('/api/p2p/offers/:offerId/close', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = req.session.userId;
    await connection.beginTransaction();

    const result = await P2PMarket.closeOffer(req.params.offerId, currentUserId, connection);

    await connection.commit();

    const isToken = result.assetCode === 'TOKEN';
    const formattedAmount = isToken ? result.refundedAmount.toFixed(4).replace(/\.?0+$/, '') : result.refundedAmount.toFixed(2);
    const assetLabel = isToken ? 'Token' : 'USDT';
    const destinationLabel = isToken ? 'solde de Token' : 'depot';

    await emitRealtimeBalanceUpdate(
      currentUserId,
      result.refundedAmount > 0
        ? `Annonce fermee. ${formattedAmount} ${assetLabel} ont ete credites sur votre ${destinationLabel}.`
        : 'Annonce fermee.'
    );

    res.json({ success: true, refundedAmount: result.refundedAmount, message: 'Annonce fermee avec succes.' });
  } catch (error) {
    await connection.rollback();
    console.error('P2P close offer error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible de fermer cette annonce.' });
  } finally {
    connection.release();
  }
});

app.post('/api/p2p/orders/:orderId/pay', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = req.session.userId;
    await connection.beginTransaction();

    const result = await P2PMarket.markOrderPaid(
      req.params.orderId,
      currentUserId,
      req.body?.payment_note,
      connection
    );

    await connection.commit();

    const actor = await User.getById(currentUserId);
    const actorName = actor ? `${actor.first_name} ${actor.last_name}` : 'L acheteur';
    const isToken = result.assetCode === 'TOKEN';
    const formattedAmount = isToken ? result.amount.toFixed(4).replace(/\.?0+$/, '') : result.amount.toFixed(2);
    const assetLabel = isToken ? 'Token' : 'USDT';

    await emitMarketNotification(
      result.sellerUserId,
      currentUserId,
      `${actorName} a marque comme paye votre ordre P2P de ${formattedAmount} ${assetLabel}.`
    );
    await emitMarketNotification(
      result.buyerUserId,
      null,
      `Vous avez marque comme paye votre ordre P2P de ${formattedAmount} ${assetLabel}.`
    );

    res.json({ success: true, message: 'Paiement confirme. Attendez la liberation des fonds.' });
  } catch (error) {
    await connection.rollback();
    console.error('P2P pay order error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible de confirmer ce paiement.' });
  } finally {
    connection.release();
  }
});

app.post('/api/p2p/orders/:orderId/release', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = req.session.userId;
    await connection.beginTransaction();

    const result = await P2PMarket.releaseOrder(req.params.orderId, currentUserId, connection);

    await connection.commit();

    const isToken = result.assetCode === 'TOKEN';
    const formattedAmount = isToken ? result.amount.toFixed(4).replace(/\.?0+$/, '') : result.amount.toFixed(2);
    const assetLabel = isToken ? 'Token' : 'USDT';
    const destinationLabel = isToken ? 'solde de Token' : 'compte de depot';

    await emitRealtimeBalanceUpdate(result.buyerUserId, `Ordre P2P libere : +${formattedAmount} ${assetLabel} sur votre ${destinationLabel}.`);

    const actor = await User.getById(currentUserId);
    const actorName = actor ? `${actor.first_name} ${actor.last_name}` : 'Le vendeur';
    await emitMarketNotification(
      result.buyerUserId,
      currentUserId,
      `${actorName} a libere ${formattedAmount} ${assetLabel} sur votre ordre P2P.`
    );
    await emitMarketNotification(
      result.sellerUserId,
      null,
      `Vous avez libere ${formattedAmount} ${assetLabel} sur cet ordre P2P.`
    );

    res.json({ success: true, message: 'Les fonds ont ete liberes avec succes.' });
  } catch (error) {
    await connection.rollback();
    console.error('P2P release order error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible de liberer cet ordre.' });
  } finally {
    connection.release();
  }
});

app.post('/api/p2p/orders/:orderId/cancel', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = req.session.userId;
    await connection.beginTransaction();

    const result = await P2PMarket.cancelOrder(
      req.params.orderId,
      currentUserId,
      req.body?.cancel_reason,
      connection
    );

    await connection.commit();

    const isToken = result.assetCode === 'TOKEN';
    const formattedAmount = isToken ? result.amount.toFixed(4).replace(/\.?0+$/, '') : result.amount.toFixed(2);
    const assetLabel = isToken ? 'Token' : 'USDT';

    if (result.offerType === 'buy') {
      const destinationLabel = isToken ? 'solde de Token' : 'compte de depot';
      await emitRealtimeBalanceUpdate(result.sellerUserId, `Ordre P2P annule. Les fonds bloques ont ete recredites sur votre ${destinationLabel}.`);
    }

    const actor = await User.getById(currentUserId);
    const actorName = actor ? `${actor.first_name} ${actor.last_name}` : 'Un utilisateur';
    const recipientId = Number(currentUserId) === Number(result.buyerUserId) ? result.sellerUserId : result.buyerUserId;
    await emitMarketNotification(
      recipientId,
      currentUserId,
      `${actorName} a annule un ordre P2P de ${formattedAmount} ${assetLabel}.`
    );
    await emitMarketNotification(
      currentUserId,
      null,
      `Vous avez annule un ordre P2P de ${formattedAmount} ${assetLabel}.`
    );

    res.json({ success: true, message: 'Ordre P2P annule avec succes.' });
  } catch (error) {
    await connection.rollback();
    console.error('P2P cancel order error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible d annuler cet ordre.' });
  } finally {
    connection.release();
  }
});

app.post('/api/p2p/orders/:orderId/dispute', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const currentUserId = req.session.userId;
    await connection.beginTransaction();

    const result = await P2PMarket.disputeOrder(
      req.params.orderId,
      currentUserId,
      req.body?.payment_note,
      connection
    );

    await connection.commit();

    const isToken = result.assetCode === 'TOKEN';
    const formattedAmount = isToken ? result.amount.toFixed(4).replace(/\.?0+$/, '') : result.amount.toFixed(2);
    const assetLabel = isToken ? 'Token' : 'USDT';

    const actor = await User.getById(currentUserId);
    const actorName = actor ? `${actor.first_name} ${actor.last_name}` : 'Un utilisateur';
    const recipientId = Number(currentUserId) === Number(result.buyerUserId) ? result.sellerUserId : result.buyerUserId;
    await emitMarketNotification(
      recipientId,
      currentUserId,
      `${actorName} a ouvert un litige P2P pour ${formattedAmount} ${assetLabel}.`
    );
    await emitMarketNotification(
      currentUserId,
      null,
      `Votre litige P2P pour ${formattedAmount} ${assetLabel} a ete enregistre.`
    );

    res.json({ success: true, message: 'Litige ouvert. Un administrateur pourra le traiter.' });
  } catch (error) {
    await connection.rollback();
    console.error('P2P dispute order error:', error);
    res.status(400).json({ success: false, error: error.message || 'Impossible d ouvrir le litige.' });
  } finally {
    connection.release();
  }
});

async function fetchBnbPrice() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
    const data = await res.json();
    const price = parseFloat(data.price);
    if (!isNaN(price) && price > 0) {
      return price;
    }
  } catch (err) {
    console.error('[BNBPrice] Failed to fetch BNB price from Binance:', err);
  }
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
    const data = await res.json();
    const price = parseFloat(data.binancecoin?.usd);
    if (!isNaN(price) && price > 0) {
      return price;
    }
  } catch (err) {
    console.error('[BNBPrice] Failed to fetch BNB price from CoinGecko:', err);
  }
  return 600.0; // standard fallback
}

function getCleanErrorMessage(err) {
  if (!err) return 'Erreur on-chain';
  
  let msg = '';
  if (typeof err === 'string') {
    msg = err;
  } else if (err.reason) {
    msg = err.reason;
  } else if (err.message) {
    msg = err.message;
  } else {
    msg = 'Erreur inconnue';
  }

  if (err.error && err.error.message) {
    msg = err.error.message;
  }

  const lower = msg.toLowerCase();
  if (lower.includes('insufficient funds') || lower.includes('insufficient_funds') || lower.includes('transfer amount exceeds balance')) {
    return 'Fonds insuffisants dans le portefeuille de la plateforme (BNB ou USDT).';
  }
  if (lower.includes('user rejected') || lower.includes('user_rejected')) {
    return 'La transaction a été rejetée.';
  }
  if (lower.includes('gas too low') || lower.includes('intrinsic gas too low') || lower.includes('out of gas')) {
    return 'Limite de gaz insuffisante (BNB insuffisant).';
  }

  try {
    if (err.body) {
      const parsedBody = JSON.parse(err.body);
      if (parsedBody && parsedBody.error && parsedBody.error.message) {
        const bodyMsg = parsedBody.error.message.toLowerCase();
        if (bodyMsg.includes('insufficient funds') || bodyMsg.includes('insufficient_funds')) {
          return 'Fonds insuffisants dans le portefeuille (BNB ou USDT).';
        }
        return parsedBody.error.message.slice(0, 150);
      }
    }
  } catch (e) {}

  if (msg.includes('See: https://links.ethers.org')) {
    msg = msg.split('See: https://links.ethers.org')[0].trim();
  }
  if (msg.includes('(error=')) {
    msg = msg.split('(error=')[0].trim();
  }
  if (msg.includes('error=')) {
    msg = msg.split('error=')[0].trim();
  }

  return msg.slice(0, 150) || 'Erreur on-chain';
}

const { ethers } = require('ethers');

async function executeBlockchainWithdrawal(userId, logId, recipientAddress, amountUsdt, netAmountUsdt) {
  try {
    const privateKey = process.env.PLATFORM_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("Clé privée de la plateforme (PLATFORM_PRIVATE_KEY) non configurée dans le fichier .env.");
    }
    
    const providerUrl = process.env.BSC_PROVIDER_URL || 'https://bsc-dataseed.binance.org/';
    const provider = new ethers.providers.JsonRpcProvider(providerUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    
    const usdtContractAddress = '0x55d398326f99059fF775485246999027B3197955'; // USDT contract on BSC
    const usdtAbi = ['function transfer(address to, uint256 amount) returns (bool)'];
    const contract = new ethers.Contract(usdtContractAddress, usdtAbi, signer);
    
    // USDT BEP-20 uses 18 decimals on BSC mainnet
    const amountWei = ethers.utils.parseUnits(netAmountUsdt.toFixed(18), 18);
    
    // Send transaction
    const tx = await contract.transfer(recipientAddress, amountWei);
    
    // Update withdrawal log with hash
    await db.query(
      'UPDATE bsc_withdrawals SET tx_hash = ? WHERE id = ?',
      [tx.hash, logId]
    );
    
    // Wait for 1 confirmation
    const receipt = await tx.wait(1);
    
    if (receipt.status === 1) {
      // Calculate actual gas fee in USDT
      let gasCostUsdt = 0.0;
      try {
        const gasUsed = receipt.gasUsed;
        const effectiveGasPrice = receipt.effectiveGasPrice;
        if (gasUsed && effectiveGasPrice) {
          const gasCostWei = gasUsed.mul(effectiveGasPrice);
          const gasCostBnb = parseFloat(ethers.utils.formatEther(gasCostWei));
          const bnbPrice = await fetchBnbPrice();
          gasCostUsdt = Number((gasCostBnb * bnbPrice).toFixed(6));
          console.log(`[BSCWithdrawal] Gas Used: ${gasUsed.toString()}, Gas Price: ${ethers.utils.formatUnits(effectiveGasPrice, 'gwei')} gwei, Gas Cost BNB: ${gasCostBnb}, BNB Price: $${bnbPrice}, Gas Cost USDT: $${gasCostUsdt}`);
        }
      } catch (gasErr) {
        console.error('[BSCWithdrawal] Failed to calculate gas fee in USD:', gasErr);
      }

      // Transaction succeeded!
      await db.query(
        "UPDATE bsc_withdrawals SET status = 'completed', gas_cost_usdt = ? WHERE id = ?",
        [gasCostUsdt, logId]
      );
      
      // Credit primary admin's withdrawal fees balance (subtracting gas fee from 30% gross fee)
      const feeVal = Number((amountUsdt - netAmountUsdt).toFixed(6));
      const netAdminFee = Number(Math.max(0, feeVal - gasCostUsdt).toFixed(6));
      
      const admin = await Admin.getPrimaryAdmin();
      if (admin && feeVal > 0) {
        await db.query(
          'UPDATE admins SET withdrawal_fees_balance = COALESCE(withdrawal_fees_balance, 0) + ? WHERE id = ?',
          [netAdminFee, admin.id]
        );
        await PlatformRevenue.recordUsd({
          amount: netAdminFee,
          entryType: 'withdrawal_fee',
          payerUserId: userId,
          referenceId: String(logId),
          note: `Frais de retrait de 30% sur le retrait #${logId} (Brut: ${amountUsdt.toFixed(2)} USDT, frais de gaz déduits : ${gasCostUsdt.toFixed(4)} USDT)`
        });
      }
      
      await emitMarketNotification(userId, null, `Votre retrait de ${amountUsdt.toFixed(2)} USDT (Net reçu : ${netAmountUsdt.toFixed(2)} USDT après 30% de frais) a été envoyé avec succès. Hash: ${tx.hash}`);
      await emitRealtimeBalanceUpdate(userId, `Retrait de ${amountUsdt.toFixed(2)} USDT complété !`);

      // Send transaction receipt email in background
      try {
        const fullUser = await User.getById(userId);
        const [wRows] = await db.query('SELECT * FROM bsc_withdrawals WHERE id = ?', [logId]);
        if (fullUser && wRows.length > 0) {
          mailer.sendTransactionReceiptEmail(fullUser, wRows[0], 'withdrawal').catch(emailErr => {
            console.error('[BSCWithdrawal] Failed to send receipt email for withdrawal log:', logId, emailErr);
          });
        }
      } catch (emailTriggerErr) {
        console.error('[BSCWithdrawal] Failed to trigger receipt email:', emailTriggerErr);
      }
      
      // Emit withdrawal status to socket
      io.to(`user:${userId}`).emit('withdrawal-status', {
        type: 'completed',
        amount: amountUsdt,
        netAmount: netAmountUsdt,
        txHash: tx.hash,
        message: `Retrait de ${amountUsdt.toFixed(2)} USDT (Reçu : ${netAmountUsdt.toFixed(2)} USDT après frais) envoyé avec succès !`
      });
    } else {
      throw new Error("La transaction blockchain a échoué (receipt status 0).");
    }
  } catch (err) {
    console.error(`[BSCWithdrawal] On-chain transfer failed for log ${logId}:`, err);
    
    const cleanReason = getCleanErrorMessage(err);
    
    // 1. Refund user's balance
    try {
      await db.query(
        'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
        [amountUsdt, userId]
      );
    } catch (refundErr) {
      console.error(`[BSCWithdrawal] Refund failed for user ${userId}, log ${logId}:`, refundErr);
    }
    
    // 2. Update log to failed (storing cleanReason in error_message to simplify transaction history)
    try {
      await db.query(
        "UPDATE bsc_withdrawals SET status = 'failed', error_message = ? WHERE id = ?",
        [cleanReason, logId]
      );
    } catch (dbErr) {
      console.error(`[BSCWithdrawal] Failed to update bsc_withdrawals for log ${logId}:`, dbErr);
    }
    
    // 3. Emit notification
    try {
      await emitMarketNotification(userId, null, `Votre retrait de ${amountUsdt.toFixed(2)} USDT a échoué et le solde a été restitué. Raison: ${cleanReason}`);
    } catch (notifErr) {
      console.error(`[BSCWithdrawal] Failed to emit market notification for user ${userId}:`, notifErr);
    }
    
    // 4. Emit balance update
    try {
      await emitRealtimeBalanceUpdate(userId, `Retrait échoué : ${cleanReason}`);
    } catch (balErr) {
      console.error(`[BSCWithdrawal] Failed to emit balance update for user ${userId}:`, balErr);
    }
    
    // 5. Emit status to socket
    try {
      io.to(`user:${userId}`).emit('withdrawal-status', {
        type: 'failed',
        amount: amountUsdt,
        error: cleanReason,
        message: `Le retrait a échoué. Votre solde a été restitué.`
      });
    } catch (socketErr) {
      console.error(`[BSCWithdrawal] Failed to emit socket withdrawal-status for user ${userId}:`, socketErr);
    }
  }
}

app.post('/api/wallet/address', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { walletAddress } = req.body;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ success: false, error: 'Format d\'adresse BEP-20 invalide.' });
    }


    // Check if already updated in the last 7 days
    const user = await User.getById(userId);
    if (user && user.wallet_address && user.wallet_address_updated_at) {
      const lastUpdated = new Date(user.wallet_address_updated_at).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastUpdated < sevenDaysMs) {
        const nextAvailableDate = new Date(lastUpdated + sevenDaysMs);
        const remainingDays = Math.ceil((nextAvailableDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        return res.status(400).json({
          success: false,
          error: `Vous ne pouvez modifier votre adresse de portefeuille qu'une fois tous les 7 jours. Réessayez dans ${remainingDays} jour(s).`
        });
      }
    }

    await db.query(
      'UPDATE users SET wallet_address = ?, wallet_address_updated_at = NOW() WHERE id = ?',
      [walletAddress.trim(), userId]
    );
    
    // Proactively trigger a check just in case there are pending transfers
    bscMonitor.triggerCheck();
    
    res.json({ success: true, walletAddress });
  } catch (err) {
    console.error('Error saving wallet address:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'enregistrement de l\'adresse.' });
  }
});

app.get('/api/wallet/deposit-info', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await User.getById(userId);
    let platformWallet = '0x4e6C4a06F01C3B46704969bBEc0da61FE03BC9A6';
    let qrDataUrl = null;

    const minWithdrawalAmount = await getNumberSetting('min_withdrawal_amount', 50);
    const withdrawalFeePercent = await getNumberSetting('withdrawal_fee_percent', 30);
    
    // Check if this is the user's first withdrawal
    const [withdrawalCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM bsc_withdrawals WHERE user_id = ? AND status != 'failed'",
      [userId]
    );
    const isFirstWithdrawal = (withdrawalCountRows[0]?.count || 0) === 0;

    // Check if user has passed KYC
    const [kycRows] = await db.query(
      "SELECT id FROM kyc_requests WHERE user_id = ? AND request_type = 'withdrawal' AND status = 'approved' LIMIT 1",
      [userId]
    );
    const hasPassedKyc = kycRows.length > 0;
    
    // Generate QR code data URL
    qrDataUrl = await QRCode.toDataURL(platformWallet, {
      width: 200,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      platformWallet,
      qrDataUrl,
      userWallet: user?.wallet_address || null,
      walletAddressUpdatedAt: user?.wallet_address_updated_at || null,
      hasPin: !!user?.withdrawal_pin,
      withdrawalBalance: user?.withdrawal_account_balance || 0,
      minWithdrawalAmount,
      withdrawalFeePercent,
      isFirstWithdrawal,
      hasPassedKyc
    });
  } catch (err) {
    console.error('Error getting deposit info:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la récupération des détails de dépôt.' });
  }
});

const KycRequest = require('./models/KycRequest');
const { evaluateEventKycSubmission } = require('./utils/kycAi');
const { createWorker } = require('tesseract.js');
const TESSERACT_ENG_PATH = path.dirname(require.resolve('@tesseract.js-data/eng/package.json')) + '/4.0.0';
let withdrawOcrWorkerPromise = null;

async function getWithdrawOcrWorker() {
  if (!withdrawOcrWorkerPromise) {
    withdrawOcrWorkerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        langPath: TESSERACT_ENG_PATH,
        logger: () => {}
      });
      return worker;
    })();
  }
  return withdrawOcrWorkerPromise;
}

async function extractWithdrawOcrText(filePath) {
  const worker = await getWithdrawOcrWorker();
  const result = await worker.recognize(filePath);
  return String(result?.data?.text || '').trim();
}

function parseWithdrawDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

async function saveWithdrawSelfie(dataUrl, directoryPath, prefix = 'selfie') {
  const parsed = parseWithdrawDataUrl(dataUrl);
  if (!parsed) return null;
  
  const fsPromises = require('fs').promises;
  await fsPromises.mkdir(directoryPath, { recursive: true });
  const extension = parsed.mimeType.split('/')[1] || 'bin';
  const fileName = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`;
  const filePath = path.join(directoryPath, fileName);
  await fsPromises.writeFile(filePath, Buffer.from(parsed.base64, 'base64'));

  return {
    fileName,
    filePath,
    fileUrl: `/uploads/withdrawals/kyc/selfies/${fileName}`,
    mimeType: parsed.mimeType,
    size: Buffer.byteLength(parsed.base64, 'base64')
  };
}

const withdrawKycUploadDir = path.join(__dirname, 'public/uploads/withdrawals/kyc');
const withdrawKycSelfieDir = path.join(__dirname, 'public/uploads/withdrawals/kyc/selfies');

const withdrawKycStorage = multer.diskStorage({
  destination(req, file, cb) {
    const fs = require('fs');
    if (!fs.existsSync(withdrawKycUploadDir)) {
      fs.mkdirSync(withdrawKycUploadDir, { recursive: true });
    }
    cb(null, withdrawKycUploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const original = (file.originalname || 'withdraw-kyc-document').replace(/\s+/g, '-');
    const parts = original.split('.');
    const ext = parts.length > 1 ? parts.pop() : (file.mimetype.split('/')[1] || 'bin');
    cb(null, `withdraw-kyc-${uniqueSuffix}.${ext.toLowerCase().trim()}`);
  }
});

const uploadWithdrawKycDocument = multer({
  storage: withdrawKycStorage,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

app.post('/api/wallet/withdraw-kyc', requireAuth, uploadWithdrawKycDocument.single('identity_document'), async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const currentUser = await User.getById(currentUserId);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: 'Non autorisé.' });
    }

    const selfieImageData = String(req.body?.selfie_image_data || '').trim();
    if (!selfieImageData.startsWith('data:image/')) {
      return res.status(400).json({ success: false, error: 'Veuillez prendre une photo avec votre caméra.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Veuillez téléverser votre document d\'identité.' });
    }

    // Check if document or user information has already been used by another account
    const fullName = `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim();
    const normalizeDateToIso = require('./utils/dateUtils').normalizeDateToIso;
    const dobVal = normalizeDateToIso(currentUser.dob) || '';

    const [duplicateRows] = await db.query(
      `SELECT user_id, id FROM kyc_requests 
       WHERE user_id != ? 
         AND status IN ('pending', 'approved', 'rejected')
         AND (
           (document_name = ? AND document_size = ?)
           OR (submitted_full_name = ? AND submitted_dob = ?)
           OR (submitted_email = ?)
         )
       LIMIT 1`,
      [currentUserId, req.file.originalname, req.file.size, fullName, dobVal, currentUser.email]
    );
    
    let isDuplicate = duplicateRows.length > 0;
    let otherUserId = duplicateRows.length > 0 ? duplicateRows[0].user_id : null;

    if (!isDuplicate && dobVal) {
      const [duplicateUserRows] = await db.query(
        `SELECT id FROM users 
         WHERE id != ? 
           AND first_name = ? 
           AND last_name = ? 
           AND dob = ? 
         LIMIT 1`,
        [currentUserId, currentUser.first_name, currentUser.last_name, dobVal]
      );
      if (duplicateUserRows.length > 0) {
        isDuplicate = true;
        otherUserId = duplicateUserRows[0].id;
      }
    }
    
    if (isDuplicate && otherUserId) {
      // Automatically block both accounts
      await User.updateStatus(currentUserId, 'Blocked');
      await User.updateStatus(otherUserId, 'Blocked');
      
      // Grant dispute permission ONLY to the other (original) account
      await db.query('UPDATE users SET allow_dispute = 1 WHERE id = ?', [otherUserId]);
      await db.query('UPDATE users SET allow_dispute = 0 WHERE id = ?', [currentUserId]);
      
      // Clear session of current user
      req.session.destroy();
      
      return res.json({
        success: false,
        duplicateBlocked: true,
        error: "Votre compte a été bloqué pour cause de conflit de KYC avec un autre utilisateur."
      });
    }

    const submission = {
      full_name: fullName,
      username: String(currentUser.username || '').trim(),
      email: String(currentUser.email || '').trim(),
      country: String(currentUser.country || '').trim(),
      dob: dobVal
    };

    console.log(`[WithdrawKYC] Starting verification for user ${currentUserId}`);
    const ocrText = await extractWithdrawOcrText(req.file.path);
    const faceMatchDistance = Number(req.body?.face_match_distance);
    const savedSelfie = await saveWithdrawSelfie(selfieImageData, withdrawKycSelfieDir, `selfie-${currentUserId}`);

    const evaluation = evaluateEventKycSubmission(
      currentUser,
      submission,
      req.file,
      {
        ocrText,
        faceMatchDistance,
        selfieFile: savedSelfie,
        documentText: ocrText
      }
    );

    const isApproved = evaluation.approved;
    
    // Save to kyc_requests table
    await KycRequest.ensureSchema();
    
    // Check if there is already a record for this user and type
    const [existingKyc] = await db.query(
      'SELECT id FROM kyc_requests WHERE user_id = ? AND request_type = "withdrawal" LIMIT 1',
      [currentUserId]
    );

    if (existingKyc.length > 0) {
      await db.query(
        `UPDATE kyc_requests 
         SET status = ?, 
             submitted_full_name = ?, 
             submitted_username = ?, 
             submitted_email = ?, 
             submitted_country = ?, 
             submitted_dob = ?, 
             document_url = ?, 
             document_name = ?, 
             document_type = ?, 
             document_size = ?, 
             selfie_url = ?, 
             selfie_name = ?, 
             selfie_type = ?, 
             selfie_size = ?, 
             verification_score = ?, 
             face_match_score = ?, 
             verification_notes = ?, 
             ai_provider = ?, 
             ai_model = ?, 
             ocr_text_excerpt = ?, 
             ocr_detected_dates = ?, 
             ocr_selected_dob = ?, 
             ocr_selected_dob_reason = ?, 
             verified_by_ai = ?,
             reviewed_at = NOW()
         WHERE id = ?`,
        [
          isApproved ? 'approved' : 'rejected',
          submission.full_name,
          submission.username,
          submission.email,
          submission.country,
          submission.dob ? new Date(submission.dob) : null,
          req.file ? `/uploads/withdrawals/kyc/${req.file.filename}` : null,
          req.file ? req.file.originalname : null,
          req.file ? req.file.mimetype : null,
          req.file ? req.file.size : null,
          savedSelfie ? savedSelfie.fileUrl : null,
          savedSelfie ? savedSelfie.fileName : null,
          savedSelfie ? savedSelfie.mimeType : null,
          savedSelfie ? savedSelfie.size : null,
          evaluation.score,
          evaluation.faceMatchScore,
          evaluation.summary,
          evaluation.aiProvider,
          evaluation.aiModel,
          evaluation.ocrTextExcerpt,
          JSON.stringify(evaluation.ocrDetectedDates || []),
          evaluation.ocrSelectedDob,
          evaluation.ocrSelectedDobReason,
          isApproved ? 1 : 0,
          existingKyc[0].id
        ]
      );
    } else {
      await db.query(
        `INSERT INTO kyc_requests (
          user_id, request_type, status, payment_status, submitted_full_name, submitted_username, 
          submitted_email, submitted_country, submitted_dob, document_url, document_name, 
          document_type, document_size, selfie_url, selfie_name, selfie_type, selfie_size, 
          verification_score, face_match_score, verification_notes, ai_provider, ai_model, 
          ocr_text_excerpt, ocr_detected_dates, ocr_selected_dob, ocr_selected_dob_reason, 
          verified_by_ai, reviewed_at
        ) VALUES (?, 'withdrawal', ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          currentUserId,
          isApproved ? 'approved' : 'rejected',
          submission.full_name,
          submission.username,
          submission.email,
          submission.country,
          submission.dob ? new Date(submission.dob) : null,
          req.file ? `/uploads/withdrawals/kyc/${req.file.filename}` : null,
          req.file ? req.file.originalname : null,
          req.file ? req.file.mimetype : null,
          req.file ? req.file.size : null,
          savedSelfie ? savedSelfie.fileUrl : null,
          savedSelfie ? savedSelfie.fileName : null,
          savedSelfie ? savedSelfie.mimeType : null,
          savedSelfie ? savedSelfie.size : null,
          evaluation.score,
          evaluation.faceMatchScore,
          evaluation.summary,
          evaluation.aiProvider,
          evaluation.aiModel,
          evaluation.ocrTextExcerpt,
          JSON.stringify(evaluation.ocrDetectedDates || []),
          evaluation.ocrSelectedDob,
          evaluation.ocrSelectedDobReason,
          isApproved ? 1 : 0
        ]
      );
    }

    if (isApproved) {
      res.json({ success: true, message: 'Félicitations, votre KYC de retrait a été vérifié et approuvé instantanément par l\'IA.' });
    } else {
      res.status(400).json({ success: false, error: 'Échec de la validation du document par l\'IA. Raisons : ' + evaluation.reasons.join(', ') });
    }
  } catch (err) {
    console.error('[WithdrawKYC] Error:', err);
    res.status(500).json({ success: false, error: 'Une erreur est survenue lors de la vérification instantanée du KYC.' });
  }
});

app.post('/api/wallet/setup-pin', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { pin } = req.body;
    if (!pin || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'Le code secret de retrait doit contenir exactement 6 chiffres.' });
    }
    
    const bcrypt = require('bcryptjs');
    const hashedPin = await bcrypt.hash(pin, 10);
    
    await db.query('UPDATE users SET withdrawal_pin = ? WHERE id = ?', [hashedPin, userId]);
    res.json({ success: true, message: 'Code secret de retrait configuré avec succès.' });
  } catch (err) {
    console.error('Error setting withdrawal pin:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la configuration du code secret.' });
  }
});

app.post('/api/wallet/withdraw', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const userId = req.session.userId;
    const { amount, pin } = req.body;
    
    const amountVal = parseFloat(amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      return res.status(400).json({ success: false, error: 'Montant de retrait invalide.' });
    }
    
    const minWithdrawalAmount = await getNumberSetting('min_withdrawal_amount', 50);
    const withdrawalFeePercent = await getNumberSetting('withdrawal_fee_percent', 30);
    
    if (amountVal < minWithdrawalAmount) {
      return res.status(400).json({ success: false, error: `Le montant de retrait minimum requis est de ${minWithdrawalAmount.toFixed(2)} $.` });
    }
    
    if (!pin || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'Code secret de retrait invalide.' });
    }
    
    await connection.beginTransaction();
    
    const [userRows] = await connection.query(
      'SELECT id, withdrawal_account_balance, wallet_address, withdrawal_pin, certification_type FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    const user = userRows[0];
    
    if (!user) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    // Check if this is the user's first withdrawal
    const [withdrawalCountRows] = await connection.query(
      "SELECT COUNT(*) AS count FROM bsc_withdrawals WHERE user_id = ? AND status != 'failed'",
      [userId]
    );
    const isFirstWithdrawal = (withdrawalCountRows[0]?.count || 0) === 0;

    if (isFirstWithdrawal) {
      // Check if user has passed KYC
      const [kycRows] = await connection.query(
        "SELECT id FROM kyc_requests WHERE user_id = ? AND request_type = 'withdrawal' AND status = 'approved' LIMIT 1",
        [userId]
      );
      const hasPassedKyc = kycRows.length > 0;

      if (!hasPassedKyc) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: "Veuillez d'abord passer votre KYC avant d'effectuer votre premier retrait."
        });
      }
    }
    
    if (!user.wallet_address) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Veuillez configurer votre adresse de portefeuille avant de demander un retrait.' });
    }
    
    if (!user.withdrawal_pin) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Veuillez configurer votre code secret de retrait avant de continuer.' });
    }
    
    const bcrypt = require('bcryptjs');
    const pinMatch = await bcrypt.compare(pin, user.withdrawal_pin);
    if (!pinMatch) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Code secret de retrait incorrect.' });
    }
    
    const userBal = parseFloat(user.withdrawal_account_balance || 0);
    if (amountVal > userBal) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Solde de retrait insuffisant.' });
    }
    
    const feeVal = amountVal * (withdrawalFeePercent / 100);
    const netVal = amountVal - feeVal;
    
    await connection.query(
      'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance - ? WHERE id = ?',
      [amountVal, userId]
    );
    
    const [insertRes] = await connection.query(
      `INSERT INTO bsc_withdrawals (user_id, recipient_address, amount_usdt, fee_usdt, net_amount_usdt, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [userId, user.wallet_address, amountVal, feeVal, netVal]
    );
    const withdrawalLogId = insertRes.insertId;
    
    await connection.commit();
    connection.release();
    
    await emitRealtimeBalanceUpdate(userId, 'Retrait en cours de traitement...');
    
    executeBlockchainWithdrawal(userId, withdrawalLogId, user.wallet_address, amountVal, netVal)
      .catch((err) => {
        console.error('[WithdrawalEndpoint] Unhandled error during async blockchain withdrawal execution:', err);
      });
    
    res.json({
      success: true,
      message: 'Demande de retrait enregistrée et en cours d\'envoi sur la blockchain BSC.',
      withdrawalLogId
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Withdrawal endpoint error:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la tentative de retrait.' });
  }
});

app.get('/api/withdrawals/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const [rows] = await db.query(
      'SELECT * FROM bsc_withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    res.json({ success: true, withdrawals: rows });
  } catch (err) {
    console.error('Error getting withdrawal history:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la récupération de l\'historique.' });
  }
});

app.get('/api/deposits/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const [rows] = await db.query(
      'SELECT * FROM bsc_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    res.json({ success: true, deposits: rows });
  } catch (err) {
    console.error('Error getting deposit history:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la récupération de l\'historique.' });
  }
});

// Routes API Backgrounds
app.get('/api/backgrounds', requireAuth, async (req, res) => {
  try {
    const db = require('./config/db');
    await ensurePostBackgroundSchema();
    const [rows] = await db.query('SELECT * FROM post_backgrounds ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('Erreur API backgrounds:', err);
    res.status(500).json({ error: 'Failed to fetch backgrounds' });
  }
});

// ── Route API Recherche Globale (posts depuis la DB) ──
app.get('/api/search', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const rawQ = String(req.query.q || '').trim();
    if (!rawQ || rawQ.length < 2) {
      return res.json({ users: [], posts: [] });
    }
    const q = `%${rawQ}%`;

    // Search posts
    const [postRows] = await db.query(
      `SELECT p.*,
              u.first_name, u.last_name, u.username, u.avatar, u.certification_type,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
              (SELECT COUNT(*) FROM post_shares ps WHERE ps.post_id = p.id AND ps.clicked_at IS NOT NULL) AS shares_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.content LIKE ?
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [q]
    );

    const posts = postRows.map(p => {
      const mediaUrl = p.image_url || p.image_url_2 || p.image_url_3 || p.image_url_4 || null;
      return {
        id: p.id,
        user_id: p.user_id,
        content: p.content,
        image_url: p.image_url,
        image_url_2: p.image_url_2,
        image_url_3: p.image_url_3,
        image_url_4: p.image_url_4,
        media_type: p.media_type,
        bg_image_url: p.bg_image_url,
        text_color: p.text_color,
        text_alignment: p.text_alignment,
        text_position: p.text_position,
        text_font: p.text_font,
        text_size: p.text_size,
        is_trade: p.is_trade,
        trade_price: p.trade_price,
        last_possession_user_id: p.last_possession_user_id,
        next_trade_payout_admin: p.next_trade_payout_admin,
        challenge_type: p.challenge_type,
        challenge_title: p.challenge_title,
        challenge_entry_mode: p.challenge_entry_mode,
        challenge_vote_mode: p.challenge_vote_mode,
        challenge_vote_price: p.challenge_vote_price,
        challenge_invited_user_id: p.challenge_invited_user_id,
        challenge_creator_share_percent: p.challenge_creator_share_percent,
        challenge_participant_share_percent: p.challenge_participant_share_percent,
        challenge_end_date: p.challenge_end_date,
        is_live: p.is_live,
        live_url: p.live_url,
        live_price: p.live_price,
        live_status: p.live_status,
        created_at: p.created_at,
        thumbnail_url: p.thumbnail_url,
        allow_download: p.allow_download,
        
        author_name: `${p.first_name} ${p.last_name}`.trim(),
        author_username: p.username,
        author_avatar: p.avatar || '/assets/avatar_placeholder.jpg',
        author_certification_type: p.certification_type || null,
        likes_count: Number(p.likes_count || 0),
        comments_count: Number(p.comments_count || 0),
        shares_count: Number(p.shares_count || 0),
        
        mediaUrl,
        createdAt: p.created_at,
        likesCount: Number(p.likes_count || 0),
        commentsCount: Number(p.comments_count || 0),
        author: {
          id: p.user_id,
          name: `${p.first_name} ${p.last_name}`.trim(),
          username: p.username,
          avatar: p.avatar || '/assets/avatar_placeholder.jpg',
          certType: p.certification_type || null
        }
      };
    });

    res.json({ users: [], posts });
  } catch (err) {
    console.error('[API /search] Error:', err);
    res.status(500).json({ error: 'Search failed', users: [], posts: [] });
  }
});

// Routes API Users (Search for mentions or online opponents)

app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    let query = req.query.q || '';
    const onlineOnly = req.query.onlineOnly === 'true';
    if (query.startsWith('@')) {
      query = query.substring(1);
    }
    let users = [];
    if (!query.trim()) {
      if (!onlineOnly) {
        return res.json([]);
      }
      users = await User.listForOpponentSearch(60);
    } else {
      users = await User.search(query);
    }
    if (onlineOnly) {
      const presence = require('./utils/presence');
      users = users.filter(u => presence.isUserOnline(u.id));
    }
    res.json(users);
  } catch (err) {
    console.error('Erreur API search users:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Route to get the current user's balance in real-time
app.get('/api/users/balance', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const [rows] = await db.execute(
      'SELECT deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ?',
      [userId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }
    const user = rows[0];
    const frozen = await P2PMarket.getFrozenBalances(userId);
    res.json({
      success: true,
      depositBalance: Number(user.deposit_account_balance || 0),
      withdrawalBalance: Number(user.withdrawal_account_balance || 0),
      bonusBalance: Number(user.bonus_account_balance || 0),
      tokenBalance: Number(user.token_balance || 0),
      frozenUsdt: frozen.frozenUsdt,
      frozenToken: frozen.frozenToken
    });
  } catch (err) {
    console.error('Erreur API balance:', err);
    res.status(500).json({ success: false, error: 'Impossible de recuperer le solde.' });
  }
});

app.post('/api/users/:targetUserId/follow', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const normalizedTargetId = parseInt(req.params.targetUserId, 10);

    if (!currentUserId) {
      return res.status(401).json({ success: false, error: 'Session expirée. Reconnectez-vous.' });
    }
    if (!normalizedTargetId || Number(normalizedTargetId) === Number(currentUserId)) {
      return res.status(400).json({ success: false, error: 'Action impossible sur ce profil.' });
    }

    const targetUser = await User.getById(normalizedTargetId);
    const actorUser = await User.getById(currentUserId);
    if (!targetUser || !actorUser) {
      return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const followResult = await User.toggleFollow(currentUserId, normalizedTargetId);
    const actorName = `${actorUser.first_name} ${actorUser.last_name}`;
    const targetName = `${targetUser.first_name} ${targetUser.last_name}`;

    if (followResult.followed) {
      const notificationId = await Notification.create({
        recipientId: normalizedTargetId,
        actorId: currentUserId,
        type: 'follow',
        message: `${actorName} now follows you.`
      });
      const unreadCount = await Notification.getUnreadCount(normalizedTargetId);
      io.to(`user:${normalizedTargetId}`).emit('notification-created', {
        id: notificationId,
        recipient_id: normalizedTargetId,
        actor_id: currentUserId,
        type: 'follow',
        message: `${actorName} now follows you.`,
        post_id: null,
        share_id: null,
        comment_id: null,
        is_read: 0,
        read_at: null,
        created_at: new Date().toISOString(),
        actor_name: actorName,
        actor_username: actorUser.username,
        actor_avatar: actorUser.avatar || '/assets/avatar_placeholder.jpg'
      });
      io.to(`user:${normalizedTargetId}`).emit('notification-count-updated', { unreadCount });
    }

    const payload = {
      actorId: currentUserId,
      targetId: normalizedTargetId,
      actorName,
      targetName,
      targetAvatar: targetUser.avatar,
      isFollowing: followResult.followed,
      followersCount: followResult.followersCount,
      followingCount: followResult.followingCount
    };

    io.to(`user:${currentUserId}`).emit('follow-state-updated', payload);
    io.to(`user:${normalizedTargetId}`).emit('follow-state-updated', payload);

    res.json({
      success: true,
      isFollowing: followResult.followed,
      followersCount: followResult.followersCount,
      followingCount: followResult.followingCount
    });
  } catch (err) {
    console.error('Follow API error:', err);
    res.status(500).json({ success: false, error: 'Impossible de mettre à jour cet abonnement.' });
  }
});

app.post('/api/message-requests/:requesterId/:action', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const requesterId = parseInt(req.params.requesterId, 10);
    const action = String(req.params.action || '').toLowerCase();
    const status = action === 'accept' ? 'accepted' : (action === 'decline' ? 'declined' : null);

    if (!currentUserId || !requesterId || !status || requesterId === Number(currentUserId)) {
      return res.status(400).json({ success: false, error: 'Demande de message invalide.' });
    }

    const updated = await Message.updateMessageRequestStatus(currentUserId, requesterId, status);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Demande de message introuvable.' });
    }

    io.to(`user:${currentUserId}`).emit('message-request-updated', {
      requesterId,
      recipientId: currentUserId,
      status
    });
    io.to(`user:${requesterId}`).emit('message-request-updated', {
      requesterId,
      recipientId: currentUserId,
      status
    });

    res.json({ success: true, requesterId, status });
  } catch (err) {
    console.error('Message request update error:', err);
    res.status(500).json({ success: false, error: 'Impossible de traiter cette demande.' });
  }
});

// API Historique des messages
app.get('/api/messages/:contactId', async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const contactId = parseInt(req.params.contactId, 10);
    const history = await Message.getHistoryBetween(currentUserId, contactId);
    res.json(history);
  } catch (err) {
    console.error('Erreur API messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// multer is imported at the top of the file
const fs = require('fs');

const messageUploadDir = path.join(__dirname, 'public/uploads/messages');
if (!fs.existsSync(messageUploadDir)) {
  fs.mkdirSync(messageUploadDir, { recursive: true });
}

const messageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, messageUploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const original = (file.originalname || 'file').replace(/\s+/g, '-');
    const parts = original.split('.');
    const ext = parts.length > 1 ? parts.pop() : (file.mimetype.split('/')[1] || 'bin');
    cb(null, `message-${uniqueSuffix}.${ext.toLowerCase().trim()}`);
  }
});

const uploadMessageMedia = multer({
  storage: messageStorage,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

app.post('/api/messages/upload-media', requireAuth, uploadMessageMedia.fields([
  { name: 'file', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), (req, res) => {
  const file = req.files?.file?.[0] || req.files?.audio?.[0] || null;
  if (!file) {
    return res.status(400).json({ error: 'No file received.' });
  }

  const attachmentUrl = '/uploads/messages/' + file.filename;
  const attachmentName = file.originalname || file.filename;
  const attachmentSize = file.size;
  const mime = file.mimetype || '';
  let attachmentType = 'file';
  if (mime.startsWith('image/')) attachmentType = 'image';
  else if (mime.startsWith('video/')) attachmentType = 'video';
  else if (mime.startsWith('audio/')) attachmentType = 'audio';
  else if (mime === 'application/pdf') attachmentType = 'file';

  const sizeLimits = {
    image: 25 * 1024 * 1024,
    video: 100 * 1024 * 1024,
    audio: 25 * 1024 * 1024,
    file: 25 * 1024 * 1024
  };
  const maxAllowedSize = sizeLimits[attachmentType] || sizeLimits.file;
  if (attachmentSize > maxAllowedSize) {
    try {
      fs.unlinkSync(path.join(messageUploadDir, file.filename));
    } catch (unlinkErr) {
      console.error('Failed to cleanup oversized message file:', unlinkErr);
    }
    return res.status(413).json({
      error: attachmentType === 'video'
        ? 'Video files must not exceed 100 MB.'
        : 'Files must not exceed 25 MB.'
    });
  }

  res.json({
    attachmentUrl,
    attachmentName,
    attachmentSize,
    attachmentType,
    mime
  });
});

app.post('/api/p2p/orders/upload-proof', requireAuth, uploadMessageMedia.single('image'), (req, res) => {
  const file = req.file || null;
  if (!file) {
    return res.status(400).json({ success: false, error: 'Aucune image recue.' });
  }

  if (!(file.mimetype || '').startsWith('image/')) {
    try {
      fs.unlinkSync(path.join(messageUploadDir, file.filename));
    } catch (unlinkErr) {
      console.error('Failed to cleanup invalid P2P proof image:', unlinkErr);
    }
    return res.status(400).json({ success: false, error: 'Seules les images de preuve sont acceptees.' });
  }

  if (Number(file.size || 0) > 10 * 1024 * 1024) {
    try {
      fs.unlinkSync(path.join(messageUploadDir, file.filename));
    } catch (unlinkErr) {
      console.error('Failed to cleanup oversized P2P proof image:', unlinkErr);
    }
    return res.status(413).json({ success: false, error: 'L image de preuve ne doit pas depasser 10 MB.' });
  }

  res.json({
    success: true,
    imageUrl: '/uploads/messages/' + file.filename,
    imageName: file.originalname || file.filename
  });
});

const uploadDir = path.join(__dirname, 'public/uploads/comments');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const rawExt = (file.mimetype.split('/')[1] || 'webm').split(';')[0].trim();
    const ext = rawExt || 'webm';
    cb(null, 'voice-' + uniqueSuffix + '.' + ext);
  }
});

const upload = multer({ storage: storage });

app.post('/api/comments/upload-voice', requireAuth, upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file received.' });
  }
  const voiceUrl = '/uploads/comments/' + req.file.filename;
  res.json({ voiceUrl });
});

// Configuration de multer pour les médias de posts
const postUploadDir = path.join(__dirname, 'public/uploads/posts');
if (!fs.existsSync(postUploadDir)) {
  fs.mkdirSync(postUploadDir, { recursive: true });
}

const postStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, postUploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const parts = file.originalname.split('.');
    const ext = parts.length > 1 ? parts[parts.length - 1] : (file.mimetype.split('/')[1] || 'bin');
    cb(null, 'post-' + uniqueSuffix + '.' + ext.toLowerCase().trim());
  }
});

const uploadPostMedia = multer({ 
  storage: postStorage,
  limits: {
    fileSize: 150 * 1024 * 1024 // 150 MB
  }
});

const uploadPostMediaHandler = uploadPostMedia.fields([
  { name: 'media', maxCount: 4 },
  { name: 'thumbnail', maxCount: 1 }
]);

app.post('/api/posts/upload-media', requireAuth, (req, res) => {
  uploadPostMediaHandler(req, res, async (err) => {
    if (err) {
      console.error('Post media upload error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'Le fichier depasse la limite autorisee. Maximum 10 Mo pour une image et 150 Mo pour une video.'
        });
      }
      return res.status(400).json({
        error: err.message || 'Impossible de telecharger ce media pour le moment.'
      });
    }

    const mediaFiles = req.files && req.files.media ? req.files.media : [];
    const thumbnailFile = req.files && req.files.thumbnail ? req.files.thumbnail[0] : null;

    if (mediaFiles.length === 0) {
      return res.status(400).json({ error: 'No media file received.' });
    }

    let mediaType = 'image';
    if (mediaFiles[0].mimetype.startsWith('video/')) {
      mediaType = 'video';
      if (mediaFiles.length > 1) {
        for (const file of mediaFiles) {
          try { fs.unlinkSync(file.path); } catch (e) {}
        }
        if (thumbnailFile) { try { fs.unlinkSync(thumbnailFile.path); } catch (e) {} }
        return res.status(400).json({ error: 'Only one video file is allowed.' });
      }
    }

    // Import optimizer helper
    const mediaOptimizer = require('./utils/mediaOptimizer');

    const uploadedUrls = [];
    let computedThumbnailUrl = null;

    try {
      // Optimize the main media files
      for (const file of mediaFiles) {
        const mimetype = file.mimetype;
        const isVideo = mimetype.startsWith('video/');
        const isImage = mimetype.startsWith('image/');

        if (!isVideo && !isImage) {
          throw new Error('Unsupported file type. Only images or videos are allowed.');
        }

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        
        if (isImage) {
          const optFilename = 'opt-post-' + uniqueSuffix + '.webp';
          const optPath = path.join(postUploadDir, optFilename);
          
          // 1. Optimize image to WebP
          await mediaOptimizer.optimizeImage(file.path, optPath);

          // 2. Generate a WebP thumbnail if not already computed
          if (!computedThumbnailUrl) {
            const thumbFilename = 'thumb-post-' + uniqueSuffix + '.webp';
            const thumbPath = path.join(postUploadDir, thumbFilename);
            await mediaOptimizer.generateImageThumbnail(file.path, thumbPath);
            computedThumbnailUrl = '/uploads/posts/' + thumbFilename;
          }

          uploadedUrls.push('/uploads/posts/' + optFilename);

          // Delete original uploaded file
          try { fs.unlinkSync(file.path); } catch (e) {}
        } else if (isVideo) {
          const optFilename = 'opt-post-' + uniqueSuffix + '.mp4';
          const optPath = path.join(postUploadDir, optFilename);

          // 1. Compress and optimize video
          await mediaOptimizer.optimizeVideo(file.path, optPath);

          // 2. Generate a video thumbnail if no user thumbnail was uploaded
          if (!thumbnailFile) {
            const thumbFilename = 'thumb-post-' + uniqueSuffix + '.webp';
            const thumbPath = path.join(postUploadDir, thumbFilename);
            await mediaOptimizer.generateVideoThumbnail(optPath, thumbPath);
            computedThumbnailUrl = '/uploads/posts/' + thumbFilename;
          }

          uploadedUrls.push('/uploads/posts/' + optFilename);

          // Delete original uploaded file
          try { fs.unlinkSync(file.path); } catch (e) {}
        }
      }

      // If user uploaded a custom thumbnail, optimize it to WebP
      if (thumbnailFile) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const optThumbFilename = 'opt-thumb-' + uniqueSuffix + '.webp';
        const optThumbPath = path.join(postUploadDir, optThumbFilename);
        
        await mediaOptimizer.generateImageThumbnail(thumbnailFile.path, optThumbPath);
        computedThumbnailUrl = '/uploads/posts/' + optThumbFilename;

        // Delete user's original uploaded thumbnail file
        try { fs.unlinkSync(thumbnailFile.path); } catch (e) {}
      }

      return res.json({ mediaUrls: uploadedUrls, mediaType, thumbnailUrl: computedThumbnailUrl });
    } catch (optErr) {
      console.error('Media optimization failed:', optErr);
      
      // Cleanup files on error
      for (const file of mediaFiles) {
        try { fs.unlinkSync(file.path); } catch (e) {}
      }
      if (thumbnailFile) {
        try { fs.unlinkSync(thumbnailFile.path); } catch (e) {}
      }
      return res.status(500).json({ error: 'Failed to process and optimize the uploaded files.' });
    }
  });
});

// Configuration de multer pour les publicités
const adUploadDir = path.join(__dirname, 'public/uploads/ads');
if (!fs.existsSync(adUploadDir)) {
  fs.mkdirSync(adUploadDir, { recursive: true });
}

const adStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, adUploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const parts = file.originalname.split('.');
    const ext = parts.length > 1 ? parts[parts.length - 1] : (file.mimetype.split('/')[1] || 'bin');
    cb(null, 'ad-' + uniqueSuffix + '.' + ext.toLowerCase().trim());
  }
});

const uploadAdMedia = multer({
  storage: adStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit for ads
  }
});

app.post('/api/ads/create', requireAuth, uploadAdMedia.single('image'), async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const { title, description, ad_url, days, send_notification, show_in_feed } = req.body || {};
    
    if (!title || !description || !ad_url || !days) {
      return res.status(400).json({ error: 'Tous les champs (titre, description, URL, jours) sont requis.' });
    }
    
    const parsedDays = parseInt(days, 10);
    if (isNaN(parsedDays) || parsedDays < 1) {
      return res.status(400).json({ error: 'La durée doit être d\'au moins 1 jour.' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Une image publicitaire est requise.' });
    }
    
    const wantsNotification = send_notification === 'on' || send_notification === 'true' || send_notification === true;
    const wantsShowInFeed = show_in_feed === 'on' || show_in_feed === 'true' || show_in_feed === true;
    
    const basePrice = parsedDays * 5.00;
    const additionalPrice = (wantsNotification ? 1.00 : 0.00) + (wantsShowInFeed ? 1.00 : 0.00);
    const totalPrice = basePrice + additionalPrice;
    
    // Check user balance
    const [userRows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [currentUserId]);
    const availableBalance = userRows.length > 0 ? parseFloat(userRows[0].deposit_account_balance || 0) : 0;
    if (userRows.length === 0 || availableBalance < totalPrice) {
      // Remove uploaded file since transaction failed
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.error('Failed to unlink ad file:', unlinkErr);
      }
      return res.status(400).json({
        error: `Solde de dépôt insuffisant pour créer cette publicité. Requis : $${totalPrice.toFixed(2)}, disponible : $${availableBalance.toFixed(2)}.`
      });
    }
    
    // Deduct price from user's deposit balance
    await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [totalPrice, currentUserId]);

    await Admin.ensureSchema();
    const primaryAdmin = await Admin.getPrimaryAdmin();
    if (!primaryAdmin) {
      throw new Error('Aucun compte administrateur principal n’est disponible pour recevoir les frais publicitaires.');
    }

    await Admin.addAdsFeesBalance(primaryAdmin.id, totalPrice, db);
    await PlatformRevenue.recordUsd({
      amount: totalPrice,
      entryType: 'ad_creation_fee',
      payerUserId: currentUserId,
      note: `Ad purchase for ${parsedDays} day(s)`
    });
    
    const imageUrl = '/uploads/ads/' + req.file.filename;
    
    const adId = await Ad.create({
      userId: currentUserId,
      title,
      description,
      imageUrl,
      adUrl: ad_url,
      days: parsedDays,
      totalPrice,
      sendNotification: wantsNotification ? 1 : 0,
      showInFeed: wantsShowInFeed ? 1 : 0
    });

    // Create notifications in database and emit them in real-time
    if (wantsNotification) {
      (async () => {
        try {
          const users = await User.getAll();
          const actor = await User.getById(currentUserId);
          const actorName = actor ? `${actor.first_name} ${actor.last_name}` : 'TrasX';
          const actorUsername = actor?.username || 'trasx';
          const actorAvatar = actor?.avatar || '/assets/avatar_placeholder.jpg';

          for (const u of users) {
            // Create notification in database
            const notificationId = await Notification.create({
              recipientId: u.id,
              actorId: currentUserId,
              type: 'ad-published',
              message: `Nouvelle publicité : "${title}" - ${description}`,
              adUrl: ad_url,
              adImageUrl: imageUrl
            });

            const unreadCount = await Notification.getUnreadCount(u.id);

            // Emit real-time notification
            io.to(`user:${u.id}`).emit('notification-created', {
              id: notificationId,
              recipient_id: u.id,
              actor_id: currentUserId,
              type: 'ad-published',
              message: `Nouvelle publicité : "${title}" - ${description}`,
              post_id: null,
              share_id: null,
              comment_id: null,
              ad_url: ad_url,
              ad_image_url: imageUrl,
              is_read: 0,
              read_at: null,
              created_at: new Date().toISOString(),
              actor_name: actorName,
              actor_username: actorUsername,
              actor_avatar: actorAvatar
            });

            io.to(`user:${u.id}`).emit('notification-count-updated', { unreadCount });
          }
        } catch (notifyErr) {
          console.error('Failed to broadcast ad notifications:', notifyErr);
        }
      })();
    }

    const adPublisher = await User.getById(currentUserId);

    // Also emit a real-time event to update the slideshow/feed for all connected clients.
    io.emit('ad-published', {
      id: adId,
      title,
      description,
      image_url: imageUrl,
      ad_url: ad_url,
      show_in_feed: wantsShowInFeed ? 1 : 0,
      username: adPublisher?.username || '',
      first_name: adPublisher?.first_name || '',
      last_name: adPublisher?.last_name || '',
      avatar: adPublisher?.avatar || '/assets/avatar_placeholder.jpg',
      created_at: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'La publicité a été créée et publiée avec succès !', adId });
  } catch (err) {
    console.error('Ad creation error:', err);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {}
    }
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la création de la publicité.' });
  }
});

// Domino game state sanitization to prevent cheating
const sanitizeGame = (game, userId) => {
  if (!game) return null;
  const sanitizedCopy = { ...game };
  delete sanitizedCopy.inviteTimeoutId;
  if (sanitizedCopy.gameType !== 'domino') return sanitizedCopy;

  const sanitized = {
    id: game.id,
    gameType: game.gameType,
    mode: game.mode,
    opponentType: game.opponentType,
    status: game.status,
    player1: game.player1,
    player2: game.player2,
    table: game.table,
    leftEnd: game.leftEnd,
    rightEnd: game.rightEnd,
    currentPlayer: game.currentPlayer,
    winner: game.winner,
    spectators: game.spectators,
    createdAt: game.createdAt,
    winningStones: game.winningStones,
    lastMove: game.lastMove,
    rounds: game.rounds,
    currentRound: game.currentRound,
    roundWins: game.roundWins,
    liveMode: game.liveMode,
    livePrice: game.livePrice
  };

  sanitized.player1HandCount = game.player1Hand ? game.player1Hand.length : 0;
  sanitized.player2HandCount = game.player2Hand ? game.player2Hand.length : 0;
  sanitized.boneyardCount = game.boneyard ? game.boneyard.length : 0;

  const isPlayer1 = game.player1 && String(game.player1.id) === String(userId);
  const isPlayer2 = game.player2 && String(game.player2.id) === String(userId);

  if (isPlayer1) {
    sanitized.player1Hand = game.player1Hand;
  } else if (isPlayer2) {
    sanitized.player2Hand = game.player2Hand;
  }
  
  return sanitized;
};

const broadcastGameState = async (gameId, botMove = null) => {
  const game = gamesManager.games[gameId];
  if (!game) return;

  const sockets = await io.in(`game:${gameId}`).fetchSockets();
  for (const s of sockets) {
    const userId = s.request.session?.userId;
    s.emit('game-state-updated', {
      game: sanitizeGame(game, userId),
      botMove
    });
  }
};

const broadcastGameStarted = async (gameId) => {
  const game = gamesManager.games[gameId];
  if (!game) return;

  const roomNames = [`game:${gameId}`];
  if (game.player1?.id) {
    roomNames.push(`user:${game.player1.id}`);
  }
  if (game.player2?.id) {
    roomNames.push(`user:${game.player2.id}`);
  }

  const socketMap = new Map();
  for (const roomName of roomNames) {
    const roomSockets = await io.in(roomName).fetchSockets();
    for (const s of roomSockets) {
      if (!socketMap.has(s.id)) {
        socketMap.set(s.id, s);
      }
    }
  }

  for (const s of socketMap.values()) {
    const userId = s.request.session?.userId;
    s.emit('game-started', sanitizeGame(game, userId));
  }
};

const scheduleNextGameRound = async (gameId) => {
  setTimeout(async () => {
    try {
      const nextRoundGame = gamesManager.startNextRound(gameId);
      if (!nextRoundGame) return;

      await broadcastGameState(gameId, null);

      const nextPlayer = nextRoundGame.currentPlayer === 1 ? nextRoundGame.player1 : nextRoundGame.player2;
      if (nextPlayer && nextPlayer.isBot) {
        const delay = 1200 + Math.random() * 1000;
        setTimeout(async () => {
          try {
            const botResult = await gamesManager.makeBotMove(gameId);
            if (botResult && botResult.success) {
              await broadcastGameState(gameId, botResult.botMove || null);

              if (botResult.finished) {
                io.to(`game:${gameId}`).emit('game-over', {
                  winnerId: botResult.winnerId,
                  winningStones: botResult.winningStones,
                  isForfeit: botResult.isForfeit || false
                });
                io.emit('game-list-updated', gamesManager.getLiveGames());
              } else if (botResult.roundWinnerId) {
                io.to(`game:${gameId}`).emit('game-round-over', {
                  roundWinnerId: botResult.roundWinnerId,
                  winningStones: botResult.winningStones,
                  nextRound: botResult.nextRound,
                  roundWins: botResult.game.roundWins,
                  delayMs: GAME_ROUND_TRANSITION_DELAY_MS
                });
                scheduleNextGameRound(gameId);
              }
            }
          } catch (botErr) {
            console.error('Error during delayed bot move after next round start:', botErr);
          }
        }, delay);
      }
    } catch (err) {
      console.error('Error while starting next game round:', err);
    }
  }, GAME_ROUND_TRANSITION_DELAY_MS);
};

// Gestion Socket.io
io.on('connection', (socket) => {
  const session = socket.request.session;
  console.log('Un utilisateur s\'est connecté :', socket.id, 'User ID:', session?.userId);

  if (session?.userId) {
    socket.join(`user:${session.userId}`);
    presence.markUserOnline(session.userId).then((state) => {
      io.emit('presence-updated', {
        userId: Number(session.userId),
        isOnline: state.isOnline,
        lastSeenAt: state.lastSeenAt ? new Date(state.lastSeenAt).toISOString() : null,
        presenceText: presence.getPresenceText(true, state.lastSeenAt)
      });
    }).catch((err) => {
      console.error('Presence online error:', err);
    });
  }

  const emitNotificationForUser = async (recipientId, notificationData) => {
    if (!recipientId) return null;
    const notificationId = await Notification.create(notificationData);
    const actor = await User.getById(notificationData.actorId);
    const actorName = actor
      ? `${actor.first_name} ${actor.last_name}`
      : (notificationData.actorName || 'TrasX');
    const actorUsername = actor?.username || notificationData.actorUsername || 'trasx';
    const actorAvatar = actor?.avatar || notificationData.actorAvatar || '/assets/avatar_placeholder.jpg';
    const unreadCount = await Notification.getUnreadCount(recipientId);
    const payload = {
      id: notificationId,
      recipient_id: recipientId,
      actor_id: notificationData.actorId,
      type: notificationData.type,
      message: notificationData.message,
      post_id: notificationData.postId || null,
      share_id: notificationData.shareId || null,
      comment_id: notificationData.commentId || null,
      is_read: 0,
      read_at: null,
      created_at: new Date().toISOString(),
      actor_name: actorName,
      actor_username: actorUsername,
      actor_avatar: actorAvatar
    };
    io.to(`user:${recipientId}`).emit('notification-created', payload);
    io.to(`user:${recipientId}`).emit('notification-count-updated', { unreadCount });
    return payload;
  };

  const emitFollowState = (payload) => {
    if (!payload) return;
    io.to(`user:${payload.actorId}`).emit('follow-state-updated', payload);
    io.to(`user:${payload.targetId}`).emit('follow-state-updated', payload);
  };

  socket.on('p2p-order-message-send', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        throw new Error('Session expiree. Reconnectez-vous.');
      }

      const orderId = parseInt(data?.orderId, 10);
      if (!orderId) {
        throw new Error('Ordre P2P invalide.');
      }

      const { order, message } = await P2PMarket.createOrderMessage(orderId, currentUserId, {
        content: data?.content,
        imageUrl: data?.imageUrl,
        imageName: data?.imageName
      });

      const payload = {
        success: true,
        orderId,
        message
      };

      io.to(`user:${order.buyer_user_id}`).emit('p2p-order-message-received', payload);
      io.to(`user:${order.seller_user_id}`).emit('p2p-order-message-received', payload);

      const recipientUserId = Number(currentUserId) === Number(order.buyer_user_id)
        ? Number(order.seller_user_id)
        : Number(order.buyer_user_id);
      const sender = await User.getById(currentUserId);
      const senderName = sender ? `${sender.first_name} ${sender.last_name}` : 'Un utilisateur';
      const messagePreview = String(message.content || '').trim();
      const chatNotificationMessage = messagePreview
        ? `${senderName} vous a envoye un message dans le chat P2P : ${messagePreview.slice(0, 90)}`
        : `${senderName} vous a envoye une preuve image dans le chat P2P.`;

      await emitNotificationForUser(recipientUserId, {
        recipientId: recipientUserId,
        actorId: currentUserId,
        type: 'market',
        message: chatNotificationMessage
      });

      if (typeof ack === 'function') {
        ack(payload);
      }
    } catch (err) {
      console.error('P2P order message send error:', err);
      if (typeof ack === 'function') {
        ack({ success: false, error: err.message || 'Impossible d envoyer ce message P2P.' });
      }
    }
  });

  const buildConversationPayload = (viewerId, partnerUser, content, senderId, receiverId, isOutgoing, followingIds = [], followerIds = [], requestStatus = null) => {
    const partnerId = Number(partnerUser?.id || (isOutgoing ? receiverId : senderId));
    const isFollowing = followingIds.includes(partnerId);
    const isFollowedBy = followerIds.includes(partnerId);
    const isMutual = isFollowing && isFollowedBy;
    const canManageRequest = !isOutgoing && requestStatus === 'pending';
    const category = canManageRequest ? 'requests' : 'general';
    const partnerIsOnline = presence.isUserOnline(partnerId);
    const partnerPresenceText = presence.getPresenceText(partnerIsOnline, partnerUser?.last_seen_at || null);
    return {
      contactId: partnerId,
      contactName: partnerUser ? `${partnerUser.first_name} ${partnerUser.last_name}` : 'Conversation',
      contactUsername: partnerUser?.username || '',
      contactAvatar: partnerUser?.avatar || '/assets/avatar_placeholder.jpg',
      preview: content,
      timeText: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      category,
      isFollowing,
      isFollowedBy,
      isMutual,
      requestStatus,
      canManageRequest,
      isOnline: partnerIsOnline,
      presenceText: partnerPresenceText
    };
  };

  const getSocketBaseUrl = () => {
    const protocol = socket.request.headers['x-forwarded-proto'] || 'http';
    const host = socket.request.headers.host;
    return `${protocol}://${host}`;
  };

  // 1. Créer une publication en temps réel
  socket.on('post-create', async (data, callback) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        if (typeof callback === 'function') callback({ success: false, error: 'Session expirée. Veuillez vous reconnecter.' });
        return;
      }
      const { content, paidHashtags, bgImageUrl, textColor, textAlignment, textPosition, textFont, textSize, isTrade, mediaUrl, mediaUrls, mediaType, thumbnailUrl, allowDownload, challengeConfig, isLive, liveUrl, livePrice } = data;
      const finalContent = content || '';
      const hasContent = finalContent.trim().length > 0;
      if (!hasContent && !mediaUrl && (!mediaUrls || mediaUrls.length === 0) && !challengeConfig) {
        if (typeof callback === 'function') callback({ success: false, error: 'Empty post content' });
        return;
      }

      const db = require('./config/db');
      const currentUser = await User.getById(currentUserId);
      if (!currentUser) {
        if (typeof callback === 'function') callback({ success: false, error: 'Utilisateur introuvable.' });
        return;
      }
      let paidBackgroundPriceUsed = 0;
      let paidHashtagCountUsed = 0;
      let postBaseIncrement = 0;

      // Process paid background financial transfer if applicable
      if (bgImageUrl) {
        await ensurePostBackgroundSchema();
        const [bgRows] = await db.query('SELECT * FROM post_backgrounds WHERE image_url = ?', [bgImageUrl]);
        if (bgRows.length > 0 && bgRows[0].is_paid) {
          const price = parseFloat(bgRows[0].price);
          paidBackgroundPriceUsed = Number.isFinite(price) ? price : 0;
          
          // Check if user has enough deposit balance
          const [userRows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [currentUserId]);
          if (userRows.length === 0 || parseFloat(userRows[0].deposit_account_balance) < price) {
            socket.emit('post-create-error', { error: 'Insufficient balance to use this background.' });
            return;
          }
          
          // Deduct from user's deposit balance
          await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [price, currentUserId]);
          const creatorUserId = Number(bgRows[0].creator_user_id || 0);
          if (creatorUserId > 0) {
            await db.execute(
              'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
              [price, creatorUserId]
            );
            await emitNotificationForUser(creatorUserId, {
              recipientId: creatorUserId,
              actorId: currentUserId,
              type: 'share',
              message: `a utilise votre background premium et ${price.toFixed(2)}$ ont ete ajoutes a votre compte de retrait.`
            });
          } else {
            const admin = await Admin.getPrimaryAdmin();
            if (!admin) {
              socket.emit('post-create-error', { error: 'No admin account is available to receive this background payment.' });
              return;
            }
            await db.execute('UPDATE admins SET balance = COALESCE(balance, 0) + ? WHERE id = ?', [price, admin.id]);
            await PlatformRevenue.recordUsd({
              amount: price,
              entryType: 'paid_background_fee',
              payerUserId: currentUserId,
              referenceId: bgRows[0].id ? `background:${bgRows[0].id}` : null,
              note: 'Paid post background purchase'
            });
          }

          const paidBackgroundViewBonusPerDollar = await getNumberSetting('paid_background_view_bonus_per_dollar', 100);
          postBaseIncrement += Math.round(Math.max(0, paidBackgroundPriceUsed) * Math.max(0, Number(paidBackgroundViewBonusPerDollar || 0)));
        }
      }

      // Process paid hashtags financial transfers
      if (paidHashtags && paidHashtags.length > 0) {
        for (const tag of paidHashtags) {
          const price = parseFloat(tag.price);
          const creatorId = Number(tag.creator_id);
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(creatorId)) {
            continue;
          }
          paidHashtagCountUsed += 1;

          const [payerRows] = await db.query(
            'SELECT deposit_account_balance FROM users WHERE id = ? LIMIT 1',
            [currentUserId]
          );
          const payerBalance = Number(payerRows[0]?.deposit_account_balance || 0);
          if (payerBalance < price) {
            socket.emit('post-create-error', { error: `Solde insuffisant pour utiliser le hashtag premium #${tag.name}.` });
            return;
          }

          await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [price, currentUserId]);
          await db.execute('UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?', [price, creatorId]);
          await emitNotificationForUser(creatorId, {
            recipientId: creatorId,
            actorId: currentUserId,
            type: 'share',
            message: `a utilise votre hashtag premium #${tag.name} et ${price.toFixed(2)}$ ont ete ajoutes a votre compte de retrait.`
          });
        }
      }

      // Process Trade Post setup
      let finalIsTrade = 0;
      let finalTradePrice = null;
      let finalLastPossessionUserId = null;

      if (isTrade === true || isTrade === 'true' || isTrade === 1 || isTrade === '1') {
        const [userRows] = await db.query('SELECT token_balance FROM users WHERE id = ?', [currentUserId]);
        if (userRows.length === 0 || parseFloat(userRows[0].token_balance) < 5) {
          socket.emit('post-create-error', { error: 'Insufficient token balance to create a trade post. You need 5 tokens.' });
          return;
        }
        await db.execute('UPDATE users SET token_balance = token_balance - 5 WHERE id = ?', [currentUserId]);
        await PlatformRevenue.recordTokens({
          amountTokens: 5,
          entryType: 'trade_post_creation_fee',
          payerUserId: currentUserId,
          note: 'Trade post creation fee'
        });
        finalIsTrade = 1;
        finalTradePrice = Math.floor(Math.random() * 19) + 2;
        finalLastPossessionUserId = currentUserId;
      }

      const finalMediaUrls = mediaUrls || (mediaUrl ? [mediaUrl] : []);
      const imageUrl = finalMediaUrls[0] || null;
      const imageUrl2 = finalMediaUrls[1] || null;
      const imageUrl3 = finalMediaUrls[2] || null;
      const imageUrl4 = finalMediaUrls[3] || null;
      const promoWindowDays = await getNumberSetting('new_user_promo_days', 30);
      const paidHashtagViewBonus = await getNumberSetting('paid_hashtag_view_bonus', 50);
      postBaseIncrement += paidHashtagCountUsed * Math.max(0, Number(paidHashtagViewBonus || 0));
      const currentPostBase = Number(currentUser.promo_post_daily_base || await getNumberSetting('new_user_daily_view_base', 1000));
      const updatedPostBase = Math.max(0, currentPostBase + postBaseIncrement);
      if (postBaseIncrement > 0) {
        await db.execute('UPDATE users SET promo_post_daily_base = ? WHERE id = ?', [updatedPostBase, currentUserId]);
        currentUser.promo_post_daily_base = updatedPostBase;
      }
      const promoDailyTarget = computePromoDailyTarget({
        isEligibleNewUser: isNewUserWithinWindow(currentUser.created_at, promoWindowDays),
        baseDailyViews: updatedPostBase,
        paidHashtagCount: 0,
        paidHashtagViewBonus: 0,
        paidBackgroundPrice: 0,
        paidBackgroundViewBonusPerDollar: 0
      });

      let normalizedChallengeConfig = null;
      if (challengeConfig && challengeConfig.type) {
        const cType = String(challengeConfig.type || '').trim().toLowerCase();
        
        const rawEndDateStr = challengeConfig.challengeEndDate || challengeConfig.endDate || challengeConfig.challenge_end_date || null;
        let finalEndDate = null;
        if (rawEndDateStr) {
          const parsedEnd = new Date(rawEndDateStr);
          if (isNaN(parsedEnd.getTime()) || parsedEnd <= new Date()) {
            socket.emit('post-create-error', { error: 'La date de fin doit être dans le futur.' });
            return;
          }
          finalEndDate = parsedEnd;
        }

        const creatorSharePercent = cType === 'vote' ? 20 : 30;
        const participantSharePercent = cType === 'vote' ? 80 : 70;
        const normalizedParticipantEntries = Array.isArray(challengeConfig.participantEntries)
          ? challengeConfig.participantEntries
            .map((entry) => ({
              userId: Number(entry?.userId || entry?.id || 0),
              username: String(entry?.username || '').trim(),
              photoUrl: entry?.photoUrl || null
            }))
            .filter((entry) => entry.userId > 0)
          : [];
        normalizedChallengeConfig = {
          type: cType,
          title: String(challengeConfig.title || '').trim() || `Challenge ${cType}`,
          entryMode: cType === 'miss'
            ? 'invite_only'
            : String(challengeConfig.entryMode || 'open').trim().toLowerCase(),
          voteMode: String(challengeConfig.voteMode || 'free').trim().toLowerCase(),
          votePrice: Math.max(0, Number(challengeConfig.votePrice || 0)),
          invitedUserId: challengeConfig.invitedUserId ? Number(challengeConfig.invitedUserId) : null,
          participants: Array.isArray(challengeConfig.participants) ? challengeConfig.participants.map(Number).filter(id => id > 0) : [],
          participantEntries: normalizedParticipantEntries,
          creatorPhotoUrl: challengeConfig.creatorPhotoUrl || null,
          creatorParticipates: challengeConfig.creatorParticipates === true,
          creatorSharePercent,
          participantSharePercent,
          challengeEndDate: finalEndDate
        };
      }

      if (normalizedChallengeConfig && normalizedChallengeConfig.type === 'vote' && normalizedChallengeConfig.participants.length < 2) {
        socket.emit('post-create-error', { error: 'Un challenge de vote exige au moins deux participants.' });
        return;
      }

      if (normalizedChallengeConfig && normalizedChallengeConfig.type === 'miss') {
        const currentUser = await User.getById(currentUserId);
        const certificationType = String(currentUser?.certification_type || 'None').trim();
        if (!certificationType || certificationType === 'None') {
          socket.emit('post-create-error', { error: 'Seuls les comptes certifies peuvent creer un challenge miss.' });
          return;
        }
      }

      if (normalizedChallengeConfig && normalizedChallengeConfig.type === 'miss' && normalizedChallengeConfig.participantEntries.length < 2) {
        socket.emit('post-create-error', { error: 'Un challenge miss exige au moins deux participantes.' });
        return;
      }

      const postId = await Post.create(
        currentUserId, 
        finalContent, 
        imageUrl, 
        bgImageUrl, 
        textColor, 
        textAlignment, 
        textPosition, 
        textFont, 
        textSize,
        finalIsTrade,
        finalTradePrice,
        finalLastPossessionUserId,
        mediaType || null,
        thumbnailUrl || null,
        allowDownload !== undefined ? allowDownload : 1,
        imageUrl2,
        imageUrl3,
        imageUrl4,
        promoDailyTarget,
        paidHashtagCountUsed,
        paidBackgroundPriceUsed,
        normalizedChallengeConfig,
        isLive ? 1 : 0,
        liveUrl || null,
        Number(livePrice || 0)
      );

      if (normalizedChallengeConfig) {
        if (normalizedChallengeConfig.type === 'vote') {
          if (normalizedChallengeConfig.participants.length > 0) {
            for (const participantId of normalizedChallengeConfig.participants) {
              await Challenge.addParticipant({
                postId,
                userId: participantId,
                invitedByUserId: currentUserId,
                status: 'accepted'
              });

              if (Number(participantId) !== Number(currentUserId)) {
                await emitNotificationForUser(participantId, {
                  recipientId: participantId,
                  actorId: currentUserId,
                  type: 'mention',
                  message: `vous participez au challenge de vote "${normalizedChallengeConfig.title}".`,
                  postId
                });
              }
            }
          }
        } else if (normalizedChallengeConfig.type === 'miss') {
          if (normalizedChallengeConfig.participantEntries.length > 0) {
            for (const participantEntry of normalizedChallengeConfig.participantEntries) {
              await Challenge.addParticipant({
                postId,
                userId: participantEntry.userId,
                invitedByUserId: currentUserId,
                status: 'accepted',
                photoUrl: participantEntry.photoUrl || null
              });

              if (Number(participantEntry.userId) !== Number(currentUserId)) {
                await emitNotificationForUser(Number(participantEntry.userId), {
                  recipientId: Number(participantEntry.userId),
                  actorId: currentUserId,
                  type: 'mention',
                  message: `vous participez automatiquement au challenge miss "${normalizedChallengeConfig.title}".`,
                  postId
                });
              }
            }
          }
        } else {
          const creatorParticipates = normalizedChallengeConfig.creatorParticipates;
          const shouldAddCreator = normalizedChallengeConfig.type === 'beauty' ? creatorParticipates : true;

          if (shouldAddCreator) {
            await Challenge.addParticipant({
              postId,
              userId: currentUserId,
              invitedByUserId: currentUserId,
              status: 'accepted',
              photoUrl: normalizedChallengeConfig.creatorPhotoUrl || null
            });
          }

          if (normalizedChallengeConfig.entryMode === 'invite_only' && Number.isFinite(normalizedChallengeConfig.invitedUserId) && Number(normalizedChallengeConfig.invitedUserId) > 0 && Number(normalizedChallengeConfig.invitedUserId) !== Number(currentUserId)) {
            await Challenge.addParticipant({
              postId,
              userId: normalizedChallengeConfig.invitedUserId,
              invitedByUserId: currentUserId,
              status: 'pending'
            });

            await emitNotificationForUser(Number(normalizedChallengeConfig.invitedUserId), {
              recipientId: Number(normalizedChallengeConfig.invitedUserId),
              actorId: currentUserId,
              type: 'mention',
              message: `vous a invite a participer au challenge "${normalizedChallengeConfig.title}".`,
              postId
            });
          }
        }
      }

      // Auto-create hashtags if they don't exist yet in the database
      if (finalContent && finalContent.trim()) {
        const hashtags = [];
        const tagRegex = /(?:^|[^a-zA-Z0-9_])#([a-zA-Z0-9_]+)/g;
        let tagMatch;
        while ((tagMatch = tagRegex.exec(finalContent)) !== null) {
          hashtags.push(tagMatch[1].toLowerCase());
        }
        const uniqueHashtags = [...new Set(hashtags)];
        const Hashtag = require('./models/Hashtag');
        for (const tagName of uniqueHashtags) {
          const existing = await Hashtag.getByName(tagName);
          if (!existing) {
            await Hashtag.create(tagName, currentUserId, 0, 0.00);
          }
        }

        // Send real-time notifications for mentions
        const mentions = [];
        const mentionRegex = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g;
        let mMatch;
        while ((mMatch = mentionRegex.exec(finalContent)) !== null) {
          mentions.push(mMatch[1].toLowerCase());
        }
        const uniqueMentions = [...new Set(mentions)];
        for (const username of uniqueMentions) {
          const targetUser = await User.getByUsername(username);
          if (targetUser && Number(targetUser.id) !== Number(currentUserId)) {
            const actorUser = await User.getById(currentUserId);
            const actorName = actorUser ? `${actorUser.first_name} ${actorUser.last_name}` : 'TrasX';
            const recipientLocale = targetUser.preferred_language || 'fr';
            const tText = createSourceTextTranslator(recipientLocale);
            const actionText = tText('vous a mentionné dans une publication.');
            const messageText = `${actorName} ${actionText}`;
            await emitNotificationForUser(Number(targetUser.id), {
              recipientId: Number(targetUser.id),
              actorId: currentUserId,
              type: 'mention',
              message: messageText,
              postId
            });
          }
        }
      }

      const post = await Post.getById(postId, currentUserId);
      if (post?.challenge_type) {
        post.challenge_participants = await Challenge.getParticipants(postId);
      }

      // Diffuser le nouveau post à tous les clients
      io.emit('post-created', post);
      if (typeof callback === 'function') {
        callback({ success: true, postId });
      }
    } catch (err) {
      console.error('Erreur post-create:', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message || 'Failed to create post' });
      }
    }
  });

  // 1b. Débloquer une diffusion en direct payante
  socket.on('unlock-live-stream', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        socket.emit('live-stream-error', { message: 'Session expirée. Veuillez vous reconnecter.' });
        return;
      }

      const postId = parseInt(data?.postId, 10);
      if (!postId) {
        socket.emit('live-stream-error', { message: 'ID de publication invalide.' });
        return;
      }

      const post = await Post.getById(postId, currentUserId);
      if (!post || !post.is_live) {
        socket.emit('live-stream-error', { message: 'Cette publication n\'est pas un live stream.' });
        return;
      }

      if (post.live_status === 'ended') {
        socket.emit('live-stream-error', { message: 'Cette diffusion est déjà terminée.' });
        return;
      }

      if (Number(post.live_price) <= 0 || post.is_live_unlocked) {
        socket.emit('live-stream-unlocked', { postId, liveUrl: post.live_url, balance: 0 });
        return;
      }

      const [userRows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [currentUserId]);
      const availableBalance = userRows.length > 0 ? parseFloat(userRows[0].deposit_account_balance || 0) : 0;
      const price = parseFloat(post.live_price);

      if (availableBalance < price) {
        socket.emit('live-stream-error', { message: `Solde insuffisant. Requis : ${price.toFixed(2)}$, disponible : ${availableBalance.toFixed(2)}$` });
        return;
      }

      // Deduct balance from viewer
      await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [price, currentUserId]);

      // Add balance to stream creator (withdrawal balance)
      await db.execute('UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?', [price, post.user_id]);

      // Insert unlock record
      await db.execute('INSERT IGNORE INTO live_unlocks (user_id, post_id) VALUES (?, ?)', [currentUserId, postId]);

      // Record platform revenue
      await PlatformRevenue.recordUsd({
        amount: price,
        entryType: 'live_stream_unlock_fee',
        payerUserId: currentUserId,
        referenceId: `post:${postId}`,
        note: `Unlock live stream by ${currentUserId}`
      });

      const [updatedUserRows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [currentUserId]);
      const newBalance = updatedUserRows.length > 0 ? parseFloat(updatedUserRows[0].deposit_account_balance || 0) : 0;

      // Notify the streamer
      await emitNotificationForUser(post.user_id, {
        recipientId: post.user_id,
        actorId: currentUserId,
        type: 'share',
        message: `a débloqué votre live stream pour ${price.toFixed(2)}$.`
      });

      socket.emit('live-stream-unlocked', { postId, liveUrl: post.live_url, balance: newBalance });
    } catch (err) {
      console.error('Error unlocking live stream:', err);
      socket.emit('live-stream-error', { message: 'Une erreur interne est survenue lors du déblocage.' });
    }
  });

  // 1c. Terminer une diffusion en direct
  socket.on('end-live-stream', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        socket.emit('live-stream-error', { message: 'Session expirée. Veuillez vous reconnecter.' });
        return;
      }

      const postId = parseInt(data?.postId, 10);
      if (!postId) {
        socket.emit('live-stream-error', { message: 'ID de publication invalide.' });
        return;
      }

      const post = await Post.getById(postId, currentUserId);
      if (!post) {
        socket.emit('live-stream-error', { message: 'Publication introuvable.' });
        return;
      }

      const isAdmin = session.isAdmin || false;
      if (Number(post.user_id) !== Number(currentUserId) && !isAdmin) {
        socket.emit('live-stream-error', { message: 'Vous n\'êtes pas autorisé à terminer cette diffusion.' });
        return;
      }

      await db.execute('UPDATE posts SET live_status = \'ended\' WHERE id = ?', [postId]);

      io.emit('live-stream-ended', { postId });
    } catch (err) {
      console.error('Error ending live stream:', err);
      socket.emit('live-stream-error', { message: 'Une erreur interne est survenue.' });
    }
  });

  socket.on('challenge-update', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        socket.emit('challenge-update-error', { error: 'Session expirée. Veuillez vous reconnecter.' });
        return;
      }

      const { postId, title, price, endDate, participants, participantEntries, creatorPhotoUrl, creatorParticipates, invitedUserId } = data;
      if (!postId) {
        socket.emit('challenge-update-error', { error: 'Identifiant du post manquant.' });
        return;
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Fetch post and lock it for update
        const [postRows] = await connection.query('SELECT * FROM posts WHERE id = ? FOR UPDATE', [postId]);
        const post = postRows[0];
        if (!post) {
          await connection.rollback();
          socket.emit('challenge-update-error', { error: 'Challenge introuvable.' });
          return;
        }

        // 2. Validate ownership
        if (Number(post.user_id) !== Number(currentUserId)) {
          await connection.rollback();
          socket.emit('challenge-update-error', { error: 'Vous n\'êtes pas le créateur de ce challenge.' });
          return;
        }

        // 3. Check expiration
        if (post.challenge_end_date && new Date(post.challenge_end_date) <= new Date()) {
          await connection.rollback();
          socket.emit('challenge-update-error', { error: 'Ce challenge est déjà terminé et ne peut plus être modifié.' });
          return;
        }

        // 4. End date validation (must be in the future if provided)
        let finalEndDate = null;
        if (endDate) {
          const parsedEnd = new Date(endDate);
          if (parsedEnd <= new Date()) {
            await connection.rollback();
            socket.emit('challenge-update-error', { error: 'La date de fin doit être dans le futur.' });
            return;
          }
          finalEndDate = parsedEnd;
        }

        const type = post.challenge_type;
        const entryMode = post.challenge_entry_mode;

        // Challenge type specific validations
        if (type === 'vote') {
          if (!participants || participants.length < 2) {
            await connection.rollback();
            socket.emit('challenge-update-error', { error: 'Un challenge de vote exige au moins deux participants.' });
            return;
          }
        } else if (type === 'miss') {
          const currentUser = await User.getById(currentUserId);
          const certificationType = String(currentUser?.certification_type || 'None').trim();
          if (!certificationType || certificationType === 'None') {
            await connection.rollback();
            socket.emit('challenge-update-error', { error: 'Seuls les comptes certifies peuvent creer un challenge miss.' });
            return;
          }
          if (!participantEntries || participantEntries.length < 2) {
            await connection.rollback();
            socket.emit('challenge-update-error', { error: 'Un challenge miss exige au moins deux participantes.' });
            return;
          }
          if (participantEntries.some(e => !e.photoUrl)) {
            await connection.rollback();
            socket.emit('challenge-update-error', { error: 'Veuillez ajouter une photo pour chaque participante.' });
            return;
          }
        } else {
          // beauty or other
          if (entryMode === 'invite_only' && !invitedUserId) {
            await connection.rollback();
            socket.emit('challenge-update-error', { error: 'Choisissez la personne à inviter.' });
            return;
          }
          if (type === 'beauty' && creatorParticipates && !creatorPhotoUrl) {
            await connection.rollback();
            socket.emit('challenge-update-error', { error: 'Veuillez choisir votre photo pour participer.' });
            return;
          }
        }

        // 5. Update posts table challenge details
        await connection.query(
          `UPDATE posts 
           SET challenge_title = ?, 
               challenge_vote_price = ?, 
               challenge_end_date = ?,
               challenge_invited_user_id = ?
           WHERE id = ?`,
          [
            title || `${type} challenge`,
            Number(price || 0),
            finalEndDate,
            (type !== 'vote' && type !== 'miss' && invitedUserId) ? Number(invitedUserId) : null,
            postId
          ]
        );

        // 6. Sync participants table
        // Delete current participants
        await connection.query('DELETE FROM challenge_participants WHERE post_id = ?', [postId]);

        // Insert new/updated participants list
        if (type === 'vote') {
          for (const pId of participants) {
            await Challenge.addParticipant({
              postId,
              userId: Number(pId),
              invitedByUserId: currentUserId,
              status: 'accepted',
              connection
            });
          }
        } else if (type === 'miss') {
          for (const entry of participantEntries) {
            await Challenge.addParticipant({
              postId,
              userId: Number(entry.userId),
              invitedByUserId: currentUserId,
              status: 'accepted',
              photoUrl: entry.photoUrl,
              connection
            });
          }
        } else {
          // beauty or other
          const shouldAddCreator = type === 'beauty' ? creatorParticipates : true;
          if (shouldAddCreator) {
            await Challenge.addParticipant({
              postId,
              userId: currentUserId,
              invitedByUserId: currentUserId,
              status: 'accepted',
              photoUrl: type === 'beauty' ? creatorPhotoUrl : null,
              connection
            });
          }

          if (entryMode === 'invite_only' && invitedUserId && Number(invitedUserId) !== Number(currentUserId)) {
            await Challenge.addParticipant({
              postId,
              userId: Number(invitedUserId),
              invitedByUserId: currentUserId,
              status: 'pending',
              connection
            });

            await emitNotificationForUser(Number(invitedUserId), {
              recipientId: Number(invitedUserId),
              actorId: currentUserId,
              type: 'mention',
              message: `vous a invité à participer au challenge "${title}".`,
              postId
            });
          }
        }

        await connection.commit();

        // 7. Fetch updated post details with participants and broadcast to all clients
        const updatedPost = await Post.getById(postId, currentUserId);
        if (updatedPost) {
          const updatedParticipants = await Challenge.getParticipants(postId);
          updatedPost.challenge_participants = updatedParticipants;
          io.emit('challenge-updated', { postId, post: updatedPost, participants: updatedParticipants });
        }

      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('Erreur challenge-update:', error);
      socket.emit('challenge-update-error', { error: 'Une erreur interne est survenue lors de la modification.' });
    }
  });

  // 1.5 Action de rachat de publication (Trade Post)
  socket.on('post-trade-action', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        socket.emit('post-trade-error', { error: 'Session expiree. Rechargez la page puis reconnectez-vous.' });
        return;
      }
      const { postId } = data;
      if (!postId) {
        socket.emit('post-trade-error', { error: 'Post introuvable pour ce trade.' });
        return;
      }
      const numericPostId = Number.parseInt(postId, 10);
      if (!Number.isFinite(numericPostId)) {
        socket.emit('post-trade-error', { error: 'Identifiant de post invalide.' });
        return;
      }

      const tokenPriceUsdRaw = await getNumberSetting('token_price_usd', 0.1);
      const tokenPriceUsd = Number.isFinite(Number(tokenPriceUsdRaw)) && Number(tokenPriceUsdRaw) > 0
        ? Number(tokenPriceUsdRaw)
        : 0.1;

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [postRows] = await connection.query(
          `
            SELECT
              id,
              user_id,
              is_trade,
              trade_price,
              last_possession_user_id,
              COALESCE(next_trade_payout_admin, 0) AS next_trade_payout_admin
            FROM posts
            WHERE id = ?
            FOR UPDATE
          `,
          [numericPostId]
        );
        const post = postRows[0];
        if (!post || !Number(post.is_trade)) {
          await connection.rollback();
          socket.emit('post-trade-error', { error: 'This post cannot be traded.' });
          return;
        }

        const currentOwnerUserId = Number(post.last_possession_user_id || post.user_id);
        if (currentOwnerUserId === Number(currentUserId)) {
          await connection.rollback();
          socket.emit('post-trade-error', { error: 'You already own this post!' });
          return;
        }

        const tradePrice = roundToDecimals(post.trade_price, 2);
        if (!Number.isFinite(tradePrice) || tradePrice < TRADE_PRICE_MIN || tradePrice > TRADE_PRICE_MAX) {
          await connection.rollback();
          socket.emit('post-trade-error', { error: 'Invalid trade price for this post.' });
          return;
        }

        const [buyerRows] = await connection.query(
          'SELECT id, deposit_account_balance, token_balance FROM users WHERE id = ? FOR UPDATE',
          [currentUserId]
        );
        const buyer = buyerRows[0];
        if (!buyer) {
          await connection.rollback();
          socket.emit('post-trade-error', {
            error: 'Impossible de lire votre compte utilisateur pour ce trade. Rechargez la page puis reessayez.'
          });
          return;
        }
        if (Number(buyer.deposit_account_balance || 0) < tradePrice) {
          await connection.rollback();
          const buyerDepositBalance = roundToDecimals(buyer.deposit_account_balance || 0, 2);
          socket.emit('post-trade-error', {
            error: `Solde insuffisant. Ce trade coute $${tradePrice.toFixed(2)} et votre compte de depot contient $${buyerDepositBalance.toFixed(2)}.`,
            requiredAmount: tradePrice,
            currentBalance: buyerDepositBalance,
            postId: numericPostId
          });
          return;
        }

        const payoutToAdmin = Number(post.next_trade_payout_admin || 0) === 1;
        let payoutRecipientType = 'user';
        let payoutRecipientUserId = currentOwnerUserId;
        let payoutRecipientNewWithdrawalBalance = null;

        await connection.query(
          'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
          [tradePrice, currentUserId]
        );

        if (payoutToAdmin) {
          const admin = await Admin.getPrimaryAdmin(connection, { forUpdate: true });
          if (!admin) {
            await connection.rollback();
            socket.emit('post-trade-error', { error: 'No admin account is available to receive this trade.' });
            return;
          }
          await connection.query(
            'UPDATE admins SET balance = COALESCE(balance, 0) + ? WHERE id = ?',
            [tradePrice, admin.id]
          );
          await PlatformRevenue.recordUsd({
            amount: tradePrice,
            entryType: 'post_trade_admin_capture',
            payerUserId: currentUserId,
            referenceId: `post:${numericPostId}`,
            note: 'Trade post payout captured by admin after previous price drop',
            connection
          });
          payoutRecipientType = 'admin';
          payoutRecipientUserId = null;
        } else {
          await connection.query(
            'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
            [tradePrice, currentOwnerUserId]
          );
          const [recipientRows] = await connection.query(
            'SELECT withdrawal_account_balance FROM users WHERE id = ?',
            [currentOwnerUserId]
          );
          payoutRecipientNewWithdrawalBalance = recipientRows[0]?.withdrawal_account_balance ?? null;
        }

        const newPrice = chooseNextTradePrice(tradePrice);
        const priceDropped = Number(newPrice) < Number(tradePrice);
        let tokenBonus = 0;
        if (priceDropped) {
          const diff = Number(tradePrice) - Number(newPrice);
          tokenBonus = roundToDecimals(diff / tokenPriceUsd, 4);
          if (tokenBonus > 0) {
            await connection.query(
              'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
              [tokenBonus, currentUserId]
            );
          }
        }

        await connection.query(
          `
            UPDATE posts
            SET last_possession_user_id = ?,
                trade_price = ?,
                next_trade_payout_admin = ?
            WHERE id = ?
          `,
          [currentUserId, newPrice, priceDropped ? 1 : 0, numericPostId]
        );

        const [newBuyerRows] = await connection.query(
          'SELECT deposit_account_balance, token_balance FROM users WHERE id = ?',
          [currentUserId]
        );

        await connection.commit();

        if (payoutRecipientType === 'user' && Number(payoutRecipientUserId) > 0) {
          await emitNotificationForUser(Number(payoutRecipientUserId), {
            recipientId: Number(payoutRecipientUserId),
            actorId: currentUserId,
            type: 'share',
            message: `a trade votre post et ${tradePrice.toFixed(2)}$ ont ete ajoutes a votre compte de retrait.`,
            postId: numericPostId
          });
        }

        io.emit('post-traded', {
          postId: numericPostId,
          lastPossessionUserId: currentUserId,
          newPrice,
          buyerId: currentUserId,
          buyerNewDepositBalance: newBuyerRows[0]?.deposit_account_balance ?? buyer.deposit_account_balance,
          buyerNewTokenBalance: newBuyerRows[0]?.token_balance ?? buyer.token_balance,
          previousOwnerUserId: currentOwnerUserId,
          payoutRecipientType,
          payoutRecipientUserId,
          payoutRecipientNewWithdrawalBalance,
          tokenBonus,
          priceDropped,
          nextTradePayoutAdmin: priceDropped
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

    } catch (err) {
      console.error('Post trade error:', err);
      socket.emit('post-trade-error', { error: 'An internal error occurred.' });
    }
  });

  socket.on('reel-trade-preview', async (data, callback) => {
    const respond = (payload) => {
      if (typeof callback === 'function') {
        callback(payload);
      }
    };

    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        respond({ success: false, error: 'Session expiree. Rechargez la page puis reconnectez-vous.' });
        return;
      }

      const parsedReelId = parseInt(data?.reelId, 10);
      if (!parsedReelId) {
        respond({ success: false, error: 'Short introuvable pour ce trade.' });
        return;
      }

      const [reelRows] = await db.query(
        `
          SELECT
            id,
            user_id,
            is_trade,
            trade_price,
            last_possession_user_id
          FROM reels
          WHERE id = ?
          LIMIT 1
        `,
        [parsedReelId]
      );
      const reel = reelRows[0];
      if (!reel || !Number(reel.is_trade)) {
        respond({ success: false, error: 'This short cannot be traded.' });
        return;
      }

      const currentOwnerUserId = Number(reel.last_possession_user_id || reel.user_id);
      if (currentOwnerUserId === Number(currentUserId)) {
        respond({ success: false, error: 'You already own this short!' });
        return;
      }

      const tradePrice = roundToDecimals(reel.trade_price, 2);
      if (!Number.isFinite(tradePrice) || tradePrice < TRADE_PRICE_MIN || tradePrice > TRADE_PRICE_MAX) {
        respond({ success: false, error: 'Invalid trade price for this short.' });
        return;
      }

      const [buyerRows] = await db.query(
        'SELECT deposit_account_balance FROM users WHERE id = ? LIMIT 1',
        [currentUserId]
      );
      const buyer = buyerRows[0];
      if (!buyer) {
        respond({ success: false, error: 'Impossible de lire votre compte utilisateur pour ce trade. Rechargez la page puis reessayez.' });
        return;
      }

      const currentBalance = roundToDecimals(buyer.deposit_account_balance || 0, 2);
      if (currentBalance < tradePrice) {
        respond({
          success: false,
          error: `Solde insuffisant. Ce trade coute $${tradePrice.toFixed(2)} et votre compte de depot contient $${currentBalance.toFixed(2)}.`,
          currentBalance,
          tradePrice,
          reelId: parsedReelId
        });
        return;
      }

      respond({
        success: true,
        currentBalance,
        tradePrice,
        reelId: parsedReelId
      });
    } catch (error) {
      console.error('Reel trade preview error:', error);
      respond({ success: false, error: 'Impossible de verifier votre solde pour ce trade.' });
    }
  });

  // 1.6 Action de rachat de short (Trade Short)
  socket.on('reel-trade-action', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        socket.emit('reel-trade-error', { error: 'Session expiree. Rechargez la page puis reconnectez-vous.' });
        return;
      }
      const { reelId } = data;
      const parsedReelId = parseInt(reelId, 10);
      if (!parsedReelId) {
        socket.emit('reel-trade-error', { error: 'Short introuvable pour ce trade.' });
        return;
      }

      const tokenPriceUsdRaw = await getNumberSetting('token_price_usd', 0.1);
      const tokenPriceUsd = Number.isFinite(Number(tokenPriceUsdRaw)) && Number(tokenPriceUsdRaw) > 0
        ? Number(tokenPriceUsdRaw)
        : 0.1;

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [reelRows] = await connection.query(
          `
            SELECT
              id,
              user_id,
              is_trade,
              trade_price,
              last_possession_user_id,
              COALESCE(next_trade_payout_admin, 0) AS next_trade_payout_admin
            FROM reels
            WHERE id = ?
            FOR UPDATE
          `,
          [parsedReelId]
        );
        const reel = reelRows[0];
        if (!reel || !Number(reel.is_trade)) {
          await connection.rollback();
          socket.emit('reel-trade-error', { error: 'This short cannot be traded.' });
          return;
        }

        const currentOwnerUserId = Number(reel.last_possession_user_id || reel.user_id);
        if (currentOwnerUserId === Number(currentUserId)) {
          await connection.rollback();
          socket.emit('reel-trade-error', { error: 'You already own this short!' });
          return;
        }

        const tradePrice = roundToDecimals(reel.trade_price, 2);
        if (!Number.isFinite(tradePrice) || tradePrice < TRADE_PRICE_MIN || tradePrice > TRADE_PRICE_MAX) {
          await connection.rollback();
          socket.emit('reel-trade-error', { error: 'Invalid trade price for this short.' });
          return;
        }

        const [buyerRows] = await connection.query(
          'SELECT id, deposit_account_balance, token_balance FROM users WHERE id = ? FOR UPDATE',
          [currentUserId]
        );
        const buyer = buyerRows[0];
        if (!buyer) {
          await connection.rollback();
          socket.emit('reel-trade-error', {
            error: 'Impossible de lire votre compte utilisateur pour ce trade. Rechargez la page puis reessayez.'
          });
          return;
        }
        if (Number(buyer.deposit_account_balance || 0) < tradePrice) {
          await connection.rollback();
          const buyerDepositBalance = roundToDecimals(buyer.deposit_account_balance || 0, 2);
          socket.emit('reel-trade-error', {
            error: `Solde insuffisant. Ce trade coute $${tradePrice.toFixed(2)} et votre compte de depot contient $${buyerDepositBalance.toFixed(2)}.`,
            requiredAmount: tradePrice,
            currentBalance: buyerDepositBalance,
            reelId: parsedReelId
          });
          return;
        }

        const payoutToAdmin = Number(reel.next_trade_payout_admin || 0) === 1;
        let payoutRecipientType = 'user';
        let payoutRecipientUserId = currentOwnerUserId;
        let payoutRecipientNewWithdrawalBalance = null;

        await connection.query(
          'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
          [tradePrice, currentUserId]
        );

        if (payoutToAdmin) {
          const admin = await Admin.getPrimaryAdmin(connection, { forUpdate: true });
          if (!admin) {
            await connection.rollback();
            socket.emit('reel-trade-error', { error: 'No admin account is available to receive this trade.' });
            return;
          }
          await connection.query(
            'UPDATE admins SET balance = COALESCE(balance, 0) + ? WHERE id = ?',
            [tradePrice, admin.id]
          );
          await PlatformRevenue.recordUsd({
            amount: tradePrice,
            entryType: 'reel_trade_admin_capture',
            payerUserId: currentUserId,
            referenceId: `reel:${parsedReelId}`,
            note: 'Trade short payout captured by admin after previous price drop',
            connection
          });
          payoutRecipientType = 'admin';
          payoutRecipientUserId = null;
        } else {
          await connection.query(
            'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
            [tradePrice, currentOwnerUserId]
          );
          const [recipientRows] = await connection.query(
            'SELECT withdrawal_account_balance FROM users WHERE id = ?',
            [currentOwnerUserId]
          );
          payoutRecipientNewWithdrawalBalance = recipientRows[0]?.withdrawal_account_balance ?? null;
        }

        const newPrice = chooseNextTradePrice(tradePrice);
        const priceDropped = Number(newPrice) < Number(tradePrice);
        let tokenBonus = 0;
        if (priceDropped) {
          const diff = Number(tradePrice) - Number(newPrice);
          tokenBonus = roundToDecimals(diff / tokenPriceUsd, 4);
          if (tokenBonus > 0) {
            await connection.query(
              'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
              [tokenBonus, currentUserId]
            );
          }
        }

        await connection.query(
          `
            UPDATE reels
            SET last_possession_user_id = ?,
                trade_price = ?,
                next_trade_payout_admin = ?
            WHERE id = ?
          `,
          [currentUserId, newPrice, priceDropped ? 1 : 0, parsedReelId]
        );

        const [newBuyerRows] = await connection.query(
          'SELECT deposit_account_balance, token_balance FROM users WHERE id = ?',
          [currentUserId]
        );

        await connection.commit();

        if (payoutRecipientType === 'user' && Number(payoutRecipientUserId) > 0) {
          await emitNotificationForUser(Number(payoutRecipientUserId), {
            recipientId: Number(payoutRecipientUserId),
            actorId: currentUserId,
            type: 'share',
            message: `a trade votre short et ${tradePrice.toFixed(2)}$ ont ete ajoutes a votre compte de retrait.`
          });
        }

        io.emit('reel-traded', {
          reelId: parsedReelId,
          lastPossessionUserId: currentUserId,
          newPrice,
          buyerId: currentUserId,
          buyerNewDepositBalance: newBuyerRows[0]?.deposit_account_balance ?? buyer.deposit_account_balance,
          buyerNewTokenBalance: newBuyerRows[0]?.token_balance ?? buyer.token_balance,
          previousOwnerUserId: currentOwnerUserId,
          payoutRecipientType,
          payoutRecipientUserId,
          payoutRecipientNewWithdrawalBalance,
          tokenBonus,
          priceDropped,
          nextTradePayoutAdmin: priceDropped
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('Reel trade error:', err);
      socket.emit('reel-trade-error', { error: 'An internal error occurred.' });
    }
  });

  // Action de déblocage de Live Premium (YouTube Live)
  socket.on('post-live-unlock', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        socket.emit('post-live-error', { error: 'Session expirée. Veuillez vous reconnecter.' });
        return;
      }
      const { postId } = data;
      if (!postId) {
        socket.emit('post-live-error', { error: 'Publication introuvable.' });
        return;
      }
      const numericPostId = Number.parseInt(postId, 10);
      if (!Number.isFinite(numericPostId)) {
        socket.emit('post-live-error', { error: 'Identifiant de post invalide.' });
        return;
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Fetch post info
        const [postRows] = await connection.query(
          `SELECT id, user_id, is_live, live_price, live_status FROM posts WHERE id = ? FOR UPDATE`,
          [numericPostId]
        );
        const post = postRows[0];
        if (!post || !post.is_live || post.live_status === 'ended') {
          await connection.rollback();
          socket.emit('post-live-error', { error: 'Ce live n\'est plus disponible ou n\'est pas configuré.' });
          return;
        }

        const price = parseFloat(post.live_price || 0);
        if (price <= 0) {
          await connection.rollback();
          socket.emit('post-live-error', { error: 'Ce live est gratuit.' });
          return;
        }

        if (Number(post.user_id) === Number(currentUserId)) {
          await connection.rollback();
          socket.emit('post-live-error', { error: 'Vous êtes l\'auteur de ce live.' });
          return;
        }

        // 2. Check if already unlocked
        const [unlockRows] = await connection.query(
          `SELECT * FROM live_unlocks WHERE user_id = ? AND post_id = ?`,
          [currentUserId, numericPostId]
        );
        if (unlockRows.length > 0) {
          await connection.rollback();
          socket.emit('post-live-error', { error: 'Vous avez déjà débloqué ce live.' });
          return;
        }

        // 3. Get buyer balances
        const [buyerRows] = await connection.query(
          `SELECT id, deposit_account_balance FROM users WHERE id = ? FOR UPDATE`,
          [currentUserId]
        );
        const buyer = buyerRows[0];
        if (!buyer || parseFloat(buyer.deposit_account_balance || 0) < price) {
          await connection.rollback();
          socket.emit('post-live-error', { error: 'Solde insuffisant pour débloquer ce live.' });
          return;
        }

        // 4. Update balances
        // Deduct from buyer
        await connection.query(
          `UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?`,
          [price, currentUserId]
        );
        // Add to creator withdrawal account
        await connection.query(
          `UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?`,
          [price, post.user_id]
        );

        // 5. Save unlock record
        await connection.query(
          `INSERT INTO live_unlocks (user_id, post_id) VALUES (?, ?)`,
          [currentUserId, numericPostId]
        );

        await connection.commit();

        // 6. Get new balance
        const [newBuyerRows] = await db.query(
          `SELECT deposit_account_balance FROM users WHERE id = ?`,
          [currentUserId]
        );
        const newBalance = newBuyerRows[0]?.deposit_account_balance || 0;

        socket.emit('post-live-unlocked', { postId: numericPostId, newBalance });

        // Notify author
        await emitNotificationForUser(Number(post.user_id), {
          recipientId: Number(post.user_id),
          actorId: currentUserId,
          type: 'share',
          message: `a débloqué votre diffusion en direct pour $${price.toFixed(2)}.`,
          postId: numericPostId
        });

      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error unlocking live post:', error);
      socket.emit('post-live-error', { error: 'Une erreur interne est survenue.' });
    }
  });

  // Action pour terminer un live
  socket.on('post-live-end', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      
      const { postId } = data;
      if (!postId) return;
      const numericPostId = Number.parseInt(postId, 10);
      if (!Number.isFinite(numericPostId)) return;

      const [postRows] = await db.query(
        `SELECT id, user_id FROM posts WHERE id = ?`,
        [numericPostId]
      );
      const post = postRows[0];
      if (!post || Number(post.user_id) !== Number(currentUserId)) {
        socket.emit('post-live-error', { error: 'Action non autorisée.' });
        return;
      }

      await db.execute(
        `UPDATE posts SET live_status = 'ended' WHERE id = ?`,
        [numericPostId]
      );

      // Broadcast event to all clients to remove the post
      io.emit('post-ended', { postId: numericPostId });
    } catch (error) {
      console.error('Error ending live:', error);
      socket.emit('post-live-error', { error: 'Une erreur est survenue lors de l\'arrêt du live.' });
    }
  });

  // 2. Aimer (like) une publication en temps réel
  socket.on('post-like', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const { postId } = data;
      
      const result = await Post.toggleLike(currentUserId, postId);
      const post = await Post.getById(postId, currentUserId);
      if (result.liked && post && Number(post.user_id) !== Number(currentUserId)) {
        const actor = await User.getById(currentUserId);
        await emitNotificationForUser(post.user_id, {
          recipientId: post.user_id,
          actorId: currentUserId,
          type: 'like',
          message: `${actor.first_name} ${actor.last_name} liked your post.`,
          postId: post.id
        });
      }
      
      // Emettre l'événement de mise à jour à l'expéditeur et à tout le monde
      socket.emit('like-response', { postId, ...result });
      socket.broadcast.emit('post-liked', { postId, likes_count: result.count });
    } catch (err) {
      console.error('Post like error:', err);
    }
  });

  // 3. Ajouter un signet (bookmark)
  socket.on('post-bookmark', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const { postId } = data;
      
      const result = await Post.toggleBookmark(currentUserId, postId);
      socket.emit('bookmark-response', { postId, ...result });
    } catch (err) {
      console.error('Post bookmark error:', err);
    }
  });

  socket.on('follow-toggle', async (data, callback) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) {
        if (typeof callback === 'function') callback({ success: false, error: 'Session expirée. Reconnectez-vous.' });
        return;
      }

      const { targetUserId } = data || {};
      const normalizedTargetId = parseInt(targetUserId, 10);
      if (!normalizedTargetId || Number(normalizedTargetId) === Number(currentUserId)) {
        if (typeof callback === 'function') callback({ success: false, error: 'Action impossible sur ce profil.' });
        return;
      }

      const targetUser = await User.getById(normalizedTargetId);
      const actorUser = await User.getById(currentUserId);
      if (!targetUser || !actorUser) {
        if (typeof callback === 'function') callback({ success: false, error: 'Utilisateur introuvable.' });
        return;
      }

      const followResult = await User.toggleFollow(currentUserId, normalizedTargetId);
      const actorName = `${actorUser.first_name} ${actorUser.last_name}`;
      const targetName = `${targetUser.first_name} ${targetUser.last_name}`;
      const message = followResult.followed
        ? `${actorName} now follows you.`
        : `${actorName} no longer follows you.`;

      await emitNotificationForUser(normalizedTargetId, {
        recipientId: normalizedTargetId,
        actorId: currentUserId,
        type: 'follow',
        message
      });

      emitFollowState({
        actorId: currentUserId,
        targetId: normalizedTargetId,
        actorName,
        targetName,
        targetAvatar: targetUser.avatar,
        isFollowing: followResult.followed,
        followersCount: followResult.followersCount,
        followingCount: followResult.followingCount
      });

      if (typeof callback === 'function') {
        callback({
          success: true,
          isFollowing: followResult.followed,
          followersCount: followResult.followersCount,
          followingCount: followResult.followingCount
        });
      }
    } catch (err) {
      console.error('Follow toggle error:', err);
      if (typeof callback === 'function') callback({ success: false, error: 'Impossible de mettre à jour cet abonnement.' });
    }
  });

  // 4. Ajouter un commentaire en temps réel
  socket.on('comment-create', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const { postId, content, parentId, voiceUrl, voiceDuration } = data;
      if ((!content || !content.trim()) && !voiceUrl) return;

      const commentId = await Comment.create(
        postId,
        currentUserId,
        content || '',
        parentId || null,
        voiceUrl || null,
        voiceDuration !== undefined && voiceDuration !== null ? parseInt(voiceDuration, 10) : null
      );
      const user = await User.getById(currentUserId);
      const post = await Post.getById(postId, currentUserId);
      const parentComment = parentId ? await Comment.getById(parentId) : null;
      const replyTarget = parentComment ? parentComment.user_id : (post ? post.user_id : null);
      if (replyTarget !== null && replyTarget !== undefined) {
        const postOwner = post ? await User.getById(post.user_id) : null;
        const isOwnPost = post && Number(post.user_id) === Number(currentUserId) && !parentComment;
        const isVoiceReply = !!parentComment?.voice_url;
        const targetName = parentComment ? parentComment.user_name : (postOwner ? `${postOwner.first_name} ${postOwner.last_name}` : '');
        const message = parentComment
          ? (Number(parentComment.user_id) === Number(currentUserId)
              ? (isVoiceReply
                  ? `You replied to your own voice note.`
                  : `You replied to your own text comment.`)
              : `${user.first_name} ${user.last_name} replied to ${isVoiceReply ? 'the voice note' : 'the text comment'} from ${targetName}.`)
          : isOwnPost
            ? (voiceUrl ? `You added a voice note to your post.` : `You commented on your post.`)
            : (voiceUrl ? `${user.first_name} ${user.last_name} added a voice note to your post.` : `${user.first_name} ${user.last_name} commented on your post.`);

        await emitNotificationForUser(replyTarget, {
          recipientId: replyTarget,
          actorId: currentUserId,
          type: 'comment',
          message,
          postId: post ? post.id : null,
          commentId
        });
      }

      // Send real-time notifications for mentions in comment
      if (content && content.trim()) {
        const mentions = [];
        const mentionRegex = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g;
        let mMatch;
        while ((mMatch = mentionRegex.exec(content)) !== null) {
          mentions.push(mMatch[1].toLowerCase());
        }
        const uniqueMentions = [...new Set(mentions)];
        for (const username of uniqueMentions) {
          const targetUser = await User.getByUsername(username);
          // Don't notify the commenter themselves, or if they are already the replyTarget
          if (targetUser && Number(targetUser.id) !== Number(currentUserId) && Number(targetUser.id) !== Number(replyTarget)) {
            const actorUser = await User.getById(currentUserId);
            const actorName = actorUser ? `${actorUser.first_name} ${actorUser.last_name}` : 'TrasX';
            const recipientLocale = targetUser.preferred_language || 'fr';
            const tText = createSourceTextTranslator(recipientLocale);
            const actionText = tText('vous a mentionné dans un commentaire.');
            const messageText = `${actorName} ${actionText}`;
            await emitNotificationForUser(Number(targetUser.id), {
              recipientId: Number(targetUser.id),
              actorId: currentUserId,
              type: 'mention',
              message: messageText,
              postId: postId,
              commentId: commentId
            });
          }
        }
      }

      // Diffuser le commentaire à tout le monde
      io.emit('comment-created', {
        id: commentId,
        postId,
        user_name: user.first_name + ' ' + user.last_name,
        user_avatar: user.avatar,
        user_username: user.username,
        certification_type: user.certification_type || 'None',
        content: content || '',
        parent_id: parentId || null,
        voice_url: voiceUrl || null,
        voice_duration_seconds: voiceDuration !== undefined && voiceDuration !== null ? parseInt(voiceDuration, 10) : null,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('Comment create error:', err);
    }
  });

  // 5. Envoyer un message de chat en temps réel
  socket.on('chat-message', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const {
        receiverId,
        content = '',
        attachmentUrl = null,
        attachmentType = null,
        attachmentName = null,
        attachmentSize = null,
        voiceDurationSeconds = null
      } = data || {};

      const numericReceiverId = parseInt(receiverId, 10);
      if (!numericReceiverId) return;

      const trimmedContent = String(content || '').trim();
      const hasAttachment = !!attachmentUrl;
      if (!trimmedContent && !hasAttachment) return;

      const parsedAttachmentSize = Number.parseInt(attachmentSize, 10);
      const parsedVoiceDuration = Number.parseInt(voiceDurationSeconds, 10);
      const normalizedAttachmentSize = Number.isFinite(parsedAttachmentSize) ? parsedAttachmentSize : null;
      const normalizedVoiceDuration = Number.isFinite(parsedVoiceDuration) ? parsedVoiceDuration : null;

      const [senderFollowingIds, senderFollowerIds, receiverFollowingIds, receiverFollowerIds] = await Promise.all([
        User.getFollowingIds(currentUserId),
        User.getFollowersIds(currentUserId),
        User.getFollowingIds(numericReceiverId),
        User.getFollowersIds(numericReceiverId)
      ]);
      const senderFollowsReceiver = senderFollowingIds.includes(Number(numericReceiverId));
      const messageRequestStatus = senderFollowsReceiver
        ? null
        : await Message.createOrKeepMessageRequest(currentUserId, numericReceiverId);

      const messageId = await Message.create(currentUserId, numericReceiverId, trimmedContent, {
        attachmentUrl: attachmentUrl || null,
        attachmentType: attachmentType || null,
        attachmentName: attachmentName || null,
        attachmentSize: normalizedAttachmentSize,
        voiceDurationSeconds: normalizedVoiceDuration
      });

      const [sender, receiver] = await Promise.all([
        User.getById(currentUserId),
        User.getById(numericReceiverId)
      ]);

      const messagePayload = {
        id: messageId,
        sender_id: currentUserId,
        receiver_id: numericReceiverId,
        content: trimmedContent,
        attachment_url: attachmentUrl || null,
        attachment_type: attachmentType || null,
        attachment_name: attachmentName || null,
        attachment_size: normalizedAttachmentSize,
        voice_duration_seconds: normalizedVoiceDuration,
        delivered_at: null,
        read_at: null,
        created_at: new Date().toISOString(),
        sender_name: sender ? `${sender.first_name} ${sender.last_name}` : '',
        sender_avatar: sender?.avatar || '/assets/avatar_placeholder.jpg',
        sender_username: sender?.username || ''
      };
      const previewText = Message.getPreviewText(messagePayload);
      const receiverIsOnline = presence.isUserOnline(numericReceiverId);
      const deliveredAt = receiverIsOnline ? new Date().toISOString() : null;

      const senderPayload = {
        senderId: currentUserId,
        receiverId: numericReceiverId,
        sender_name: sender ? `${sender.first_name} ${sender.last_name}` : '',
        sender_avatar: sender?.avatar || '/assets/avatar_placeholder.jpg',
        content: trimmedContent,
        messageId,
        attachmentUrl: messagePayload.attachment_url,
        attachmentType: messagePayload.attachment_type,
        attachmentName: messagePayload.attachment_name,
        attachmentSize: messagePayload.attachment_size,
        voiceDurationSeconds: messagePayload.voice_duration_seconds,
        delivered_at: deliveredAt,
        read_at: null,
        messageStatus: 'sent',
        created_at: messagePayload.created_at,
        conversation: {
          ...buildConversationPayload(currentUserId, receiver, previewText, currentUserId, numericReceiverId, true, senderFollowingIds, senderFollowerIds, messageRequestStatus),
          preview: previewText
        }
      };

      const receiverPayload = {
        senderId: currentUserId,
        receiverId: numericReceiverId,
        sender_name: sender ? `${sender.first_name} ${sender.last_name}` : '',
        sender_avatar: sender?.avatar || '/assets/avatar_placeholder.jpg',
        content: trimmedContent,
        messageId,
        attachmentUrl: messagePayload.attachment_url,
        attachmentType: messagePayload.attachment_type,
        attachmentName: messagePayload.attachment_name,
        attachmentSize: messagePayload.attachment_size,
        voiceDurationSeconds: messagePayload.voice_duration_seconds,
        delivered_at: deliveredAt,
        read_at: null,
        messageStatus: 'incoming',
        created_at: messagePayload.created_at,
        conversation: {
          ...buildConversationPayload(numericReceiverId, sender, previewText, currentUserId, numericReceiverId, false, receiverFollowingIds, receiverFollowerIds, messageRequestStatus),
          preview: previewText
        }
      };

      io.to(`user:${currentUserId}`).emit('chat-message-received', senderPayload);
      io.to(`user:${numericReceiverId}`).emit('chat-message-received', receiverPayload);
      if (deliveredAt) {
        await Message.markDelivered(messageId);
        io.to(`user:${currentUserId}`).emit('chat-message-status', {
          messageId,
          status: 'delivered',
          delivered_at: deliveredAt,
          receiverId: numericReceiverId
        });
      }
    } catch (err) {
      console.error('Chat message error:', err);
    }
  });

  // --- Game Invitation System Events ---
  socket.on('game-invitation-notify', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;

      const { recipientId, game, priceType, priceAmount } = data || {};
      const numericRecipientId = parseInt(recipientId, 10);
      if (!numericRecipientId) return;

      const gameNames = {
        domino: 'Domino',
        puissance4: 'Puissance 4',
        connect4: 'Puissance 4',
        gomoku: 'Gomoku',
        tablefootball: 'Football Table',
        chess: 'Echecs',
        echec: 'Echecs',
        echecsmat: 'Echecs'
      };
      const gameLabel = gameNames[String(game || '').toLowerCase()] || game || 'Jeu';
      const priceLabel = priceType === 'paid' ? ` (${priceAmount} $)` : ' (Gratuit)';
      const message = `vous invite à jouer à ${gameLabel}${priceLabel}`;

      await emitNotificationForUser(numericRecipientId, {
        recipientId: numericRecipientId,
        actorId: currentUserId,
        type: 'game',
        message
      });
    } catch (err) {
      console.error('Game invitation notify error:', err);
    }
  });

  socket.on('game-invitation-action', async (data) => {
    try {
      const db = require('./config/db');
      const currentUserId = session.userId;
      if (!currentUserId) return;

      const { messageId, action } = data || {};
      const parsedMsgId = parseInt(messageId, 10);
      if (!parsedMsgId || !['accept', 'decline'].includes(action)) return;

      // 1. Fetch message from DB
      const [messages] = await db.query('SELECT * FROM messages WHERE id = ?', [parsedMsgId]);
      if (!messages || messages.length === 0) return;
      const message = messages[0];

      // 2. Security check: Only the recipient can accept or decline
      if (Number(message.receiver_id) !== currentUserId) return;

      // 3. Parse content
      const content = String(message.content || '').trim();
      let gameData = null;
      try {
        if (content.startsWith('{') && content.endsWith('}')) {
          gameData = JSON.parse(content);
        }
      } catch (err) {
        // ignore JSON parse errors
      }

      if (!gameData || gameData.type !== 'game_invitation') return;
      if (gameData.status !== 'pending') return; // already acted upon or expired

      // 4. Update status
      gameData.status = action === 'accept' ? 'accepted' : 'declined';

      if (action === 'accept') {
        const [senderRows] = await db.query('SELECT id, username, first_name, last_name, avatar FROM users WHERE id = ?', [message.sender_id]);
        const [receiverRows] = await db.query('SELECT id, username, first_name, last_name, avatar FROM users WHERE id = ?', [message.receiver_id]);

        if (senderRows && senderRows.length > 0 && receiverRows && receiverRows.length > 0) {
          let gameType = gameData.game;
          if (gameType === 'puissance4') {
            gameType = 'connect4';
          }
          if (gameType === 'morpion') {
            gameType = 'gomoku';
          }

          try {
            // Create game session
            const game = await gamesManager.createGame(
              senderRows[0].id,
              senderRows[0],
              gameType,
              'player',
              gameData.priceType,
              null,
              gameData.priceAmount
            );

            // Join the receiver to the game
            await gamesManager.joinGame(game.id, receiverRows[0].id, receiverRows[0]);

            // Store game ID in gameData
            gameData.gameId = game.id;

            // Broadcast the updated live games list to all connected clients
            io.emit('game-list-updated', gamesManager.getLiveGames());
          } catch (gameErr) {
            console.error('Error creating/joining game session on invitation accept:', gameErr);
            gameData.status = 'error';
            gameData.error = gameErr.message;
          }
        }
      }

      const newContent = JSON.stringify(gameData);

      // 5. Update DB
      await db.query('UPDATE messages SET content = ? WHERE id = ?', [newContent, parsedMsgId]);

      // 6. Broadcast the updated message state to both users
      const updatePayload = {
        messageId: parsedMsgId,
        senderId: message.sender_id,
        receiverId: message.receiver_id,
        content: newContent
      };

      io.to(`user:${message.sender_id}`).emit('game-invitation-updated', updatePayload);
      io.to(`user:${message.receiver_id}`).emit('game-invitation-updated', updatePayload);

      // 7. Send notification of reply to the sender
      const actionLabel = action === 'accept' ? 'accepté' : 'refusé';
      const gameNames = {
        domino: 'Domino',
        puissance4: 'Puissance 4',
        connect4: 'Puissance 4',
        gomoku: 'Gomoku',
        tablefootball: 'Football Table',
        chess: 'Echecs',
        echec: 'Echecs',
        echecsmat: 'Echecs'
      };
      const gameLabel = gameNames[String(gameData.game || '').toLowerCase()] || gameData.game || 'Jeu';
      const messageText = `a ${actionLabel} votre invitation à jouer à ${gameLabel}`;

      await emitNotificationForUser(Number(message.sender_id), {
        recipientId: Number(message.sender_id),
        actorId: currentUserId,
        type: 'game',
        message: messageText
      });
    } catch (err) {
      console.error('Game invitation action error:', err);
    }
  });

  socket.on('chat-mark-read', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const partnerId = parseInt(data?.partnerId, 10);
      if (!partnerId) return;

      const messageIds = await Message.markConversationRead(partnerId, currentUserId);
      if (messageIds.length > 0) {
        io.to(`user:${partnerId}`).emit('chat-message-status', {
          messageIds,
          status: 'read',
          receiverId: currentUserId
        });
      }

      if (typeof ack === 'function') {
        ack({ success: true, messageIds });
      }
    } catch (err) {
      console.error('Chat mark read error:', err);
      if (typeof ack === 'function') {
        ack({ success: false });
      }
    }
  });

  // --- Reels / Shorts Socket Events ---
  socket.on('reel-like-toggle', async (data) => {
    try {
      const { reelId, isLiked } = data;
      const parsedReelId = parseInt(reelId, 10);
      if (!parsedReelId) return;

      const Reel = require('./models/Reel');
      if (isLiked) {
        await Reel.incrementLikes(parsedReelId);
      } else {
        await Reel.decrementLikes(parsedReelId);
      }

      // Broadcast update to all other connected clients
      const [rows] = await require('./config/db').query('SELECT likes_count FROM reels WHERE id = ?', [parsedReelId]);
      const likesCount = rows[0]?.likes_count || 0;
      io.emit('reel-likes-updated', { reelId: parsedReelId, likesCount });
    } catch (err) {
      console.error('Reel like error:', err);
    }
  });

  socket.on('reel-comments-join', (data) => {
    const { reelId } = data;
    if (reelId) {
      socket.join(`reel:comments:${reelId}`);
    }
  });

  socket.on('reel-comments-leave', (data) => {
    const { reelId } = data;
    if (reelId) {
      socket.leave(`reel:comments:${reelId}`);
    }
  });

  socket.on('reel-comments-fetch', async (data, ack) => {
    try {
      const { reelId } = data;
      const parsedReelId = parseInt(reelId, 10);
      if (!parsedReelId) return ack?.({ success: false, error: 'Invalid Reel ID' });

      const Reel = require('./models/Reel');
      const comments = await Reel.getComments(parsedReelId);
      if (typeof ack === 'function') {
        ack({ success: true, comments });
      }
    } catch (err) {
      console.error('Reel comments fetch error:', err);
      if (typeof ack === 'function') {
        ack({ success: false, error: err.message });
      }
    }
  });

  socket.on('reel-comment-add', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return ack?.({ success: false, error: 'Unauthorized' });

      const { reelId, content, parentId, voiceUrl, voiceDuration } = data;
      const parsedReelId = parseInt(reelId, 10);
      const parsedParentId = parentId ? parseInt(parentId, 10) : null;
      const normalizedContent = content ? String(content).trim() : '';
      if (!parsedReelId || (!normalizedContent && !voiceUrl)) {
        return ack?.({ success: false, error: 'Invalid input' });
      }

      const Reel = require('./models/Reel');
      if (parsedParentId) {
        const parentComment = await Reel.getCommentById(parsedParentId);
        if (!parentComment || Number(parentComment.reel_id) !== Number(parsedReelId)) {
          return ack?.({ success: false, error: 'Invalid reply target' });
        }
      }
      const normalizedVoiceDuration = voiceDuration !== undefined && voiceDuration !== null
        ? parseInt(voiceDuration, 10)
        : null;
      const commentId = await Reel.addComment(parsedReelId, currentUserId, {
        parentId: parsedParentId || null,
        content: normalizedContent,
        voiceUrl: voiceUrl || null,
        voiceDurationSeconds: Number.isFinite(normalizedVoiceDuration) ? normalizedVoiceDuration : null
      });

      const User = require('./models/User');
      const sender = await User.getById(currentUserId);
      const newComment = {
        id: commentId,
        content: normalizedContent,
        parent_id: parsedParentId || null,
        voice_url: voiceUrl || null,
        voice_duration_seconds: Number.isFinite(normalizedVoiceDuration) ? normalizedVoiceDuration : null,
        created_at: new Date().toISOString(),
        first_name: sender.first_name,
        last_name: sender.last_name,
        avatar: sender.avatar,
        username: sender.username,
        certification_type: sender.certification_type || 'None'
      };

      // Broadcast new comment to the reel comments room
      io.to(`reel:comments:${parsedReelId}`).emit('reel-comment-broadcast', { reelId: parsedReelId, comment: newComment });

      // Broadcast comment count update to all clients
      const [rows] = await require('./config/db').query('SELECT comments_count FROM reels WHERE id = ?', [parsedReelId]);
      const commentsCount = rows[0]?.comments_count || 0;
      io.emit('reel-comments-updated', { reelId: parsedReelId, commentsCount });

      if (typeof ack === 'function') {
        ack({ success: true, comment: newComment });
      }
    } catch (err) {
      console.error('Reel comment add error:', err);
      if (typeof ack === 'function') {
        ack({ success: false, error: err.message });
      }
    }
  });

  socket.on('reel-share-add', async (data) => {
    try {
      const { reelId } = data;
      const parsedReelId = parseInt(reelId, 10);
      if (!parsedReelId) return;

      const Reel = require('./models/Reel');
      await Reel.incrementShares(parsedReelId);

      const [rows] = await require('./config/db').query('SELECT shares_count FROM reels WHERE id = ?', [parsedReelId]);
      const sharesCount = rows[0]?.shares_count || 0;
      io.emit('reel-shares-updated', { reelId: parsedReelId, sharesCount });
    } catch (err) {
      console.error('Reel share error:', err);
    }
  });

  socket.on('post-download-action', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const { postId } = data;
      const parsedPostId = parseInt(postId, 10);
      if (!parsedPostId) return;

      // 1. Add direct share
      await PostShare.addDirectShare(parsedPostId, currentUserId);
      const sharesCount = await PostShare.getClickedCount(parsedPostId);
      io.emit('post-shared', { postId: parsedPostId, shares_count: sharesCount });
    } catch (err) {
      console.error('Post download action error:', err);
    }
  });

  socket.on('disconnect', () => {
    if (!session?.userId) return;
    presence.markUserOffline(session.userId).then((state) => {
      if (!state?.changed) return;
      io.emit('presence-updated', {
        userId: Number(session.userId),
        isOnline: false,
        lastSeenAt: state.lastSeenAt ? new Date(state.lastSeenAt).toISOString() : new Date().toISOString(),
        presenceText: presence.getPresenceText(false, state.lastSeenAt)
      });
    }).catch((err) => {
      console.error('Presence offline error:', err);
    });
  });

  socket.on('post-share-create', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const { postId, channel = 'social', platform = null, recipientUserId = null } = data || {};
      const parsedPostId = parseInt(postId, 10);
      if (!parsedPostId) throw new Error('Invalid share data.');

      const post = await Post.getById(parsedPostId, currentUserId);
      if (!post) throw new Error('Post not found.');

      const share = await PostShare.create({
        postId: parsedPostId,
        sharerId: currentUserId,
        recipientUserId: recipientUserId ? parseInt(recipientUserId, 10) : null,
        channel,
        platform
      });

      const currentUser = await User.getById(currentUserId);
      const shareUrl = `${getSocketBaseUrl()}/share/${share.shareToken}?from=${encodeURIComponent(currentUser.username)}&name=${encodeURIComponent(`${currentUser.first_name} ${currentUser.last_name}`)}&by=${currentUser.id}&post=${parsedPostId}&channel=${encodeURIComponent(channel)}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}`;

      if (typeof ack === 'function') {
        ack({ shareUrl, shareToken: share.shareToken });
      }
    } catch (err) {
      console.error('Post share create error:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message || 'Unable to create the share link.' });
      }
    }
  });

  socket.on('notifications-mark-read', async (_data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;

      await Notification.markAllRead(currentUserId);
      io.to(`user:${currentUserId}`).emit('notifications-marked-read', {});
      io.to(`user:${currentUserId}`).emit('notification-count-updated', { unreadCount: 0 });

      if (typeof ack === 'function') {
        ack({ success: true });
      }
    } catch (err) {
      console.error('Notifications mark-read error:', err);
      if (typeof ack === 'function') {
        ack({ error: 'Unable to mark notifications as read.' });
      }
    }
  });

  socket.on('notification-mark-single-read', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      const notificationId = data?.notificationId;
      if (!notificationId) {
        throw new Error('ID de notification manquant');
      }

      await Notification.markSingleRead(notificationId, currentUserId);
      
      const unreadCount = await Notification.getUnreadCount(currentUserId);
      io.to(`user:${currentUserId}`).emit('notification-count-updated', { unreadCount });

      if (typeof ack === 'function') {
        ack({ success: true, unreadCount });
      }
    } catch (err) {
      console.error('Notification mark-single-read error:', err);
      if (typeof ack === 'function') {
        ack({ error: 'Unable to mark notification as read.' });
      }
    }
  });

  // --- REAL-TIME GAMES SOCKET EVENTS ---
  socket.on('games-list-get', (ack) => {
    try {
      if (typeof ack === 'function') {
        ack(gamesManager.getLiveGames());
      }
    } catch (err) {
      console.error('Error on games-list-get:', err);
    }
  });

  socket.on('bots-list-get', async (ack) => {
    try {
      const Bot = require('./models/Bot');
      const bots = await Bot.getAll();
      if (typeof ack === 'function') {
        ack(bots);
      }
    } catch (err) {
      console.error('Error on bots-list-get:', err);
      if (typeof ack === 'function') {
        ack([]);
      }
    }
  });

  socket.on('game-create', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');
      
      const user = await User.getById(currentUserId);
      if (!user) throw new Error('Utilisateur introuvable.');

      const { gameType, opponentType, entryMode, opponentId, betAmount, rounds, liveMode, livePrice } = data || {};
      
      const isP2PInvite = opponentType === 'player' && opponentId && !String(opponentId).startsWith('bot_');

      const game = await gamesManager.createGame(
        currentUserId, user, gameType, opponentType, entryMode, opponentId, betAmount, rounds, liveMode, livePrice
      );
      
      socket.join(`game:${game.id}`);

      if (isP2PInvite) {
        const targetUserId = parseInt(opponentId, 10);
        io.to(`user:${targetUserId}`).emit('game-invite-received', {
          gameId: game.id,
          challenger: {
            id: user.id,
            username: user.username,
            name: user.first_name + ' ' + user.last_name,
            avatar: user.avatar || '/assets/avatar_placeholder.jpg'
          },
          gameType: game.gameType,
          mode: game.mode,
          betAmount: game.betAmount,
          rounds: game.rounds,
          liveMode: game.liveMode,
          livePrice: game.livePrice,
          timeoutMs: 30000
        });

        // Set server-side auto-expiration
        const inviteTimeout = setTimeout(async () => {
          const g = gamesManager.games[game.id];
          if (g && g.status === 'invited') {
            delete gamesManager.games[game.id];
            io.to(`user:${currentUserId}`).emit('game-invite-cancelled', { gameId: game.id, reason: "L'invitation a expiré (sans réponse)." });
            io.to(`user:${targetUserId}`).emit('game-invite-expired', { gameId: game.id });
          }
        }, 30000);
        game.inviteTimeoutId = inviteTimeout;
      } else {
        // Broadcast list updates for public/waiting/bot games
        io.emit('game-list-updated', gamesManager.getLiveGames());
      }

      if (typeof ack === 'function') {
        ack({ success: true, game: sanitizeGame(game, currentUserId) });
      }
    } catch (err) {
      console.error('Error on game-create:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-invite-accept', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');

      const { gameId } = data || {};
      const game = gamesManager.games[gameId];
      if (!game) throw new Error('Invitation introuvable ou expirée.');
      if (game.status !== 'invited') throw new Error('Cette invitation n\'est plus active.');
      if (Number(game.player2.id) !== Number(currentUserId)) throw new Error('Vous n\'êtes pas le destinataire de cette invitation.');

      const isPaid = game.mode === 'paid';
      const betAmount = parseFloat(game.betAmount || 0);

      // Verify balances again at acceptance
      if (isPaid) {
        const [rows1] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [game.player1.id]);
        const balance1 = rows1.length > 0 ? parseFloat(rows1[0].deposit_account_balance || 0) : 0;
        if (balance1 < betAmount) {
          throw new Error("Le solde du challenger est désormais insuffisant.");
        }

        const [rows2] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [currentUserId]);
        const balance2 = rows2.length > 0 ? parseFloat(rows2[0].deposit_account_balance || 0) : 0;
        if (balance2 < betAmount) {
          throw new Error("Votre solde est insuffisant.");
        }

        // Deduct entry fee from BOTH players simultaneously in a transaction
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [betAmount, game.player1.id]);
          await connection.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [betAmount, currentUserId]);
          await connection.commit();
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        } finally {
          connection.release();
        }

        // Notify both players' client-side views to refresh their balance display
        io.to(`user:${game.player1.id}`).emit('balance-updated', { type: 'deposit' });
        io.to(`user:${currentUserId}`).emit('balance-updated', { type: 'deposit' });
      }

      // Clear server timeout
      if (game.inviteTimeoutId) {
        clearTimeout(game.inviteTimeoutId);
        delete game.inviteTimeoutId;
      }

      // Initialize game state (e.g. Domino hands)
      if (game.gameType === 'domino') {
        game.player2Hand = game.boneyard.splice(0, 7);
      }
      game.status = 'playing';
      game.startedAt = Date.now();

      // Join BOTH players' sockets to the game room
      const socketsP1 = await io.in(`user:${game.player1.id}`).fetchSockets();
      for (const s of socketsP1) {
        s.join(`game:${game.id}`);
      }
      const socketsP2 = await io.in(`user:${currentUserId}`).fetchSockets();
      for (const s of socketsP2) {
        s.join(`game:${game.id}`);
      }

      // Notify the room that game has started — personalized per socket (fixes creator not getting room)
      await broadcastGameStarted(game.id);
      
      // Update global live games list
      io.emit('game-list-updated', gamesManager.getLiveGames());

      if (typeof ack === 'function') {
        ack({ success: true, game: sanitizeGame(game, currentUserId) });
      }
    } catch (err) {
      console.error('Error on game-invite-accept:', err);
      // Cancel the invitation in case of failure
      if (data && data.gameId) {
        const game = gamesManager.games[data.gameId];
        if (game && game.status === 'invited') {
          if (game.inviteTimeoutId) clearTimeout(game.inviteTimeoutId);
          delete gamesManager.games[data.gameId];
          io.to(`user:${game.player1.id}`).emit('game-invite-cancelled', { gameId: data.gameId, reason: err.message });
        }
      }
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-invite-decline', (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');

      const { gameId } = data || {};
      const game = gamesManager.games[gameId];
      if (!game) throw new Error('Invitation introuvable ou expirée.');
      if (game.status !== 'invited') throw new Error('Cette invitation n\'est plus active.');
      if (Number(game.player2.id) !== Number(currentUserId)) throw new Error('Non autorisé.');

      // Clear server timeout
      if (game.inviteTimeoutId) {
        clearTimeout(game.inviteTimeoutId);
        delete game.inviteTimeoutId;
      }

      // Delete the game
      delete gamesManager.games[game.id];

      // Notify challenger
      io.to(`user:${game.player1.id}`).emit('game-invite-declined', {
        gameId: game.id,
        reason: "L'adversaire a refusé l'invitation."
      });

      if (typeof ack === 'function') {
        ack({ success: true });
      }
    } catch (err) {
      console.error('Error on game-invite-decline:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-invite-cancel', (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');

      const { gameId } = data || {};
      const game = gamesManager.games[gameId];
      if (!game) throw new Error('Invitation introuvable.');
      if (game.status !== 'invited') throw new Error('Cette invitation n\'est plus active.');
      if (Number(game.player1.id) !== Number(currentUserId)) throw new Error('Non autorisé.');

      // Clear server timeout
      if (game.inviteTimeoutId) {
        clearTimeout(game.inviteTimeoutId);
        delete game.inviteTimeoutId;
      }

      // Notify opponent
      if (game.player2) {
        io.to(`user:${game.player2.id}`).emit('game-invite-cancelled', {
          gameId: game.id,
          reason: "Le challenger a annulé l'invitation."
        });
      }

      // Delete the game
      delete gamesManager.games[game.id];

      if (typeof ack === 'function') {
        ack({ success: true });
      }
    } catch (err) {
      console.error('Error on game-invite-cancel:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-join', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');
      
      const user = await User.getById(currentUserId);
      if (!user) throw new Error('Utilisateur introuvable.');

      const { gameId } = data || {};
      const game = await gamesManager.joinGame(gameId, currentUserId, user);

      socket.join(`game:${game.id}`);

      // Notify the room that game has started
      await broadcastGameStarted(game.id);

      // Broadcast list updates
      io.emit('game-list-updated', gamesManager.getLiveGames());

      if (typeof ack === 'function') {
        ack({ success: true, game: sanitizeGame(game, currentUserId) });
      }
    } catch (err) {
      console.error('Error on game-join:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-room-join', (data) => {
    try {
      const { gameId } = data || {};
      if (gameId) {
        socket.join(`game:${gameId}`);
        const game = gamesManager.games[gameId];
        if (game) {
          const currentUserId = session?.userId;
          if (currentUserId) {
            if (Number(game.player1.id) === Number(currentUserId)) {
              game.player1.socketId = socket.id;
            } else if (game.player2 && Number(game.player2.id) === Number(currentUserId)) {
              game.player2.socketId = socket.id;
            }
          }
        }
      }
    } catch (err) {
      console.error('Error on game-room-join:', err);
    }
  });

  socket.on('webrtc-signal', (data) => {
    const { targetSocketId, signal } = data || {};
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc-signal', {
        senderSocketId: socket.id,
        senderUserId: session?.userId,
        signal
      });
    }
  });

  socket.on('game-webrtc-state', (data) => {
    const { gameId, isCamOn, isMicOn } = data || {};
    const currentUserId = session?.userId;
    if (gameId && currentUserId) {
      const game = gamesManager.games[gameId];
      if (game) {
        let playerSlot = null;
        if (Number(game.player1.id) === Number(currentUserId)) {
          game.player1.isCamOn = isCamOn;
          game.player1.isMicOn = isMicOn;
          game.player1.socketId = socket.id;
          playerSlot = 'p1';
        } else if (game.player2 && Number(game.player2.id) === Number(currentUserId)) {
          game.player2.isCamOn = isCamOn;
          game.player2.isMicOn = isMicOn;
          game.player2.socketId = socket.id;
          playerSlot = 'p2';
        }
        if (playerSlot) {
          io.to(`game:${gameId}`).emit('game-webrtc-state-updated', {
            playerSlot,
            userId: currentUserId,
            isCamOn,
            isMicOn,
            socketId: socket.id
          });
        }
      }
    }
  });

  socket.on('game-send-gift', async (data, ack) => {
    try {
      const db = require('./config/db');
      const senderId = session.userId;
      if (!senderId) throw new Error('Non authentifié.');
      
      const { gameId, recipientId, amount } = data || {};
      const parsedAmount = parseFloat(amount);
      if (!gameId || !recipientId || isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Données invalides.');
      }
      
      if (String(recipientId).startsWith('bot_') || isNaN(parseInt(recipientId, 10))) {
        throw new Error('Vous ne pouvez pas envoyer de cadeau à un robot.');
      }

      if (Number(senderId) === Number(recipientId)) {
        throw new Error('Vous ne pouvez pas vous envoyer un cadeau à vous-même.');
      }
      
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        
        // 1. Verify locked sender balance
        const [senderRows] = await connection.query('SELECT deposit_account_balance, username, first_name, last_name FROM users WHERE id = ? FOR UPDATE', [senderId]);
        if (senderRows.length === 0) throw new Error('Expéditeur introuvable.');
        const sender = senderRows[0];
        const balance = parseFloat(sender.deposit_account_balance || 0);
        
        if (balance < parsedAmount) {
          throw new Error('Solde insuffisant pour envoyer ce cadeau.');
        }
        
        // 2. Verify locked recipient
        const [recipientRows] = await connection.query('SELECT id, username, first_name, last_name FROM users WHERE id = ? FOR UPDATE', [recipientId]);
        if (recipientRows.length === 0) throw new Error('Destinataire introuvable.');
        const recipient = recipientRows[0];
        
        // 3. Update balances
        await connection.query('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [parsedAmount, senderId]);
        await connection.query('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [parsedAmount, recipientId]);
        
        await connection.commit();
        
        const senderName = sender.first_name || sender.last_name ? `${sender.first_name} ${sender.last_name}`.trim() : sender.username;
        const recipientName = recipient.first_name || recipient.last_name ? `${recipient.first_name} ${recipient.last_name}`.trim() : recipient.username;
        
        // 4. Send real-time notification to recipient via socket event & save DB notification
        await emitNotificationForUser(recipientId, {
          recipientId: recipientId,
          actorId: senderId,
          type: 'game',
          message: `vous a envoyé un cadeau de ${parsedAmount.toFixed(2)} $`
        });
        
        io.to(`user:${recipientId}`).emit('game-gift-received', {
          senderName,
          amount: parsedAmount
        });
        
        // 5. Broadcast to the game room chat feed
        io.to(`game:${gameId}`).emit('game-chat-received', {
          senderId: 0,
          senderName: "Système",
          senderUsername: "system",
          avatar: "/assets/avatar_placeholder.jpg",
          content: `🎁 ${senderName} a envoyé un cadeau de ${parsedAmount.toFixed(2)} $ à ${recipientName} !`,
          isSystem: true,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        
        if (typeof ack === 'function') {
          ack({ success: true });
        }
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } catch (err) {
      const isValidationError = [
        'Non authentifié.',
        'Données invalides.',
        'Vous ne pouvez pas envoyer de cadeau à un robot.',
        'Vous ne pouvez pas vous envoyer un cadeau à vous-même.',
        'Expéditeur introuvable.',
        'Solde insuffisant pour envoyer ce cadeau.',
        'Destinataire introuvable.'
      ].includes(err.message);

      if (isValidationError) {
        console.warn(`[Validation Warning] game-send-gift: ${err.message}`);
      } else {
        console.error('Error on game-send-gift:', err);
      }

      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('post-gift-send', async (data, ack) => {
    const done = (payload) => {
      if (typeof ack === 'function') ack(payload);
    };

    try {
      const senderId = session.userId;
      if (!senderId) throw new Error('Session expirée. Reconnectez-vous.');

      const postId = Number.parseInt(data?.postId, 10);
      const amount = Number.parseFloat(data?.amount);
      const giftName = String(data?.giftName || 'Cadeau').trim().slice(0, 80) || 'Cadeau';

      if (!postId || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Données du cadeau invalides.');
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [senderRows] = await connection.query(
          'SELECT id, username, first_name, last_name, avatar, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ? FOR UPDATE',
          [senderId]
        );
        if (!senderRows.length) throw new Error('Expéditeur introuvable.');
        const sender = senderRows[0];

        const [postRows] = await connection.query(
          `SELECT p.id, p.user_id
           FROM posts p
           WHERE p.id = ?
           LIMIT 1
           FOR UPDATE`,
          [postId]
        );
        if (!postRows.length) throw new Error('Publication introuvable.');
        const post = postRows[0];

        const recipientId = Number(post.user_id);
        if (recipientId === Number(senderId)) {
          throw new Error('Vous ne pouvez pas vous envoyer un cadeau a vous-meme.');
        }

        const senderBalance = Number(sender.deposit_account_balance || 0);
        if (senderBalance < amount) {
          throw new Error('Solde de depot insuffisant pour envoyer ce cadeau.');
        }

        const [recipientRows] = await connection.query(
          'SELECT id, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ? FOR UPDATE',
          [recipientId]
        );
        if (!recipientRows.length) throw new Error('Createur de la publication introuvable.');
        const recipient = recipientRows[0];

        await connection.query(
          'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
          [amount, senderId]
        );
        await connection.query(
          'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
          [amount, recipientId]
        );

        const giftCommentContent = `a envoye le cadeau ${giftName} de $${amount.toFixed(2)} sur ce post.`;
        const [commentResult] = await connection.query(
          'INSERT INTO comments (post_id, user_id, content, parent_id, voice_url, voice_duration_seconds) VALUES (?, ?, ?, NULL, NULL, NULL)',
          [postId, senderId, giftCommentContent]
        );

        await connection.commit();

        const senderName = `${sender.first_name || ''} ${sender.last_name || ''}`.trim() || sender.username || 'Utilisateur';
        const newSenderDepositBalance = Number((senderBalance - amount).toFixed(2));
        const newRecipientWithdrawalBalance = Number((Number(recipient.withdrawal_account_balance || 0) + amount).toFixed(2));
        const commentId = commentResult.insertId;
        const createdAt = new Date().toISOString();

        await emitNotificationForUser(recipientId, {
          recipientId,
          actorId: senderId,
          type: 'gift',
          message: `${senderName} vous a envoye le cadeau ${giftName} de $${amount.toFixed(2)} sur votre post.`,
          postId,
          commentId
        });

        io.emit('comment-created', {
          id: commentId,
          postId,
          user_name: senderName,
          user_avatar: sender.avatar || '/assets/avatar_placeholder.jpg',
          user_username: sender.username,
          certification_type: sender.certification_type || 'None',
          content: giftCommentContent,
          parent_id: null,
          voice_url: null,
          voice_duration_seconds: null,
          created_at: createdAt
        });

        io.to(`user:${senderId}`).emit('balance-updated', {
          userId: Number(senderId),
          depositBalance: newSenderDepositBalance,
          withdrawalBalance: Number(sender.withdrawal_account_balance || 0),
          bonusBalance: Number(sender.bonus_account_balance || 0),
          tokenBalance: Number(sender.token_balance || 0),
          message: null
        });

        io.to(`user:${recipientId}`).emit('balance-updated', {
          userId: Number(recipientId),
          withdrawalBalance: newRecipientWithdrawalBalance,
          bonusBalance: Number(recipient.bonus_account_balance || 0),
          tokenBalance: Number(recipient.token_balance || 0),
          message: `${senderName} vous a envoye ${giftName} pour $${amount.toFixed(2)}.`
        });

        io.to(`user:${recipientId}`).emit('post-gift-received', {
          postId,
          senderName,
          giftName,
          amount: Number(amount.toFixed(2))
        });

        done({
          success: true,
          postId,
          giftName,
          amount: Number(amount.toFixed(2)),
          depositBalance: newSenderDepositBalance
        });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } catch (err) {
      const isValidationError = [
        'Session expirée. Reconnectez-vous.',
        'Données du cadeau invalides.',
        'Expéditeur introuvable.',
        'Publication introuvable.',
        'Vous ne pouvez pas vous envoyer un cadeau a vous-meme.',
        'Solde de depot insuffisant pour envoyer ce cadeau.',
        'Createur de la publication introuvable.'
      ].includes(err.message);

      if (isValidationError) {
        console.warn(`[Validation Warning] post-gift-send: ${err.message}`);
      } else {
        console.error('Error on post-gift-send:', err);
      }
      done({ success: false, error: err.message || 'Impossible d envoyer ce cadeau.' });
    }
  });

  socket.on('birthday-gift-send', async (data, ack) => {
    const done = (payload) => {
      if (typeof ack === 'function') ack(payload);
    };

    try {
      const senderId = session.userId;
      if (!senderId) throw new Error('Session expirée. Reconnectez-vous.');

      const recipientUserId = Number.parseInt(data?.recipientUserId, 10);
      const amount = Number.parseFloat(data?.amount);
      const giftName = String(data?.giftName || 'Cadeau').trim().slice(0, 80) || 'Cadeau';

      if (!recipientUserId || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Données du cadeau invalides.');
      }

      if (recipientUserId === Number(senderId)) {
        throw new Error('Vous ne pouvez pas vous envoyer un cadeau a vous-meme.');
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [senderRows] = await connection.query(
          'SELECT id, username, first_name, last_name, avatar, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ? FOR UPDATE',
          [senderId]
        );
        if (!senderRows.length) throw new Error('Expéditeur introuvable.');
        const sender = senderRows[0];

        const senderBalance = Number(sender.deposit_account_balance || 0);
        if (senderBalance < amount) {
          throw new Error('Solde de depot insuffisant pour envoyer ce cadeau.');
        }

        const [recipientRows] = await connection.query(
          'SELECT id, username, first_name, last_name, dob, withdrawal_account_balance, bonus_account_balance, token_balance FROM users WHERE id = ? FOR UPDATE',
          [recipientUserId]
        );
        if (!recipientRows.length) throw new Error('Utilisateur anniversaire introuvable.');
        const recipient = recipientRows[0];
        const dobDate = recipient.dob ? new Date(recipient.dob) : null;
        const now = new Date();
        const isBirthdayToday = dobDate
          && Number.isFinite(dobDate.getTime())
          && dobDate.getUTCMonth() === now.getUTCMonth()
          && dobDate.getUTCDate() === now.getUTCDate();
        if (!isBirthdayToday) {
          throw new Error('Cet utilisateur ne fete pas son anniversaire aujourd hui.');
        }

        await connection.query(
          'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
          [amount, senderId]
        );
        await connection.query(
          'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
          [amount, recipientUserId]
        );

        await connection.commit();

        const senderName = `${sender.first_name || ''} ${sender.last_name || ''}`.trim() || sender.username || 'Utilisateur';
        const recipientName = `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim() || recipient.username || 'Utilisateur';
        const newSenderDepositBalance = Number((senderBalance - amount).toFixed(2));
        const newRecipientWithdrawalBalance = Number((Number(recipient.withdrawal_account_balance || 0) + amount).toFixed(2));

        await emitNotificationForUser(recipientUserId, {
          recipientId: recipientUserId,
          actorId: senderId,
          type: 'gift',
          message: `${senderName} vous a envoye le cadeau ${giftName} de $${amount.toFixed(2)} pour votre anniversaire.`
        });

        io.to(`user:${senderId}`).emit('balance-updated', {
          userId: Number(senderId),
          depositBalance: newSenderDepositBalance,
          withdrawalBalance: Number(sender.withdrawal_account_balance || 0),
          bonusBalance: Number(sender.bonus_account_balance || 0),
          tokenBalance: Number(sender.token_balance || 0),
          message: null
        });

        io.to(`user:${recipientUserId}`).emit('balance-updated', {
          userId: Number(recipientUserId),
          withdrawalBalance: newRecipientWithdrawalBalance,
          bonusBalance: Number(recipient.bonus_account_balance || 0),
          tokenBalance: Number(recipient.token_balance || 0),
          message: `${senderName} vous a envoye ${giftName} pour $${amount.toFixed(2)}.`
        });

        io.to(`user:${recipientUserId}`).emit('birthday-gift-received', {
          senderName,
          recipientName,
          giftName,
          amount: Number(amount.toFixed(2))
        });

        done({
          success: true,
          recipientUserId,
          recipientName,
          giftName,
          amount: Number(amount.toFixed(2)),
          depositBalance: newSenderDepositBalance
        });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } catch (err) {
      const isValidationError = [
        'Session expirée. Reconnectez-vous.',
        'Données du cadeau invalides.',
        'Vous ne pouvez pas vous envoyer un cadeau a vous-meme.',
        'Expéditeur introuvable.',
        'Solde de depot insuffisant pour envoyer ce cadeau.',
        'Utilisateur anniversaire introuvable.'
        , 'Cet utilisateur ne fete pas son anniversaire aujourd hui.'
      ].includes(err.message);

      if (isValidationError) {
        console.warn(`[Validation Warning] birthday-gift-send: ${err.message}`);
      } else {
        console.error('Error on birthday-gift-send:', err);
      }
      done({ success: false, error: err.message || 'Impossible d envoyer ce cadeau anniversaire.' });
    }
  });

  socket.on('game-move', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');

      const { gameId, r, c, toR, toC, promotion } = data || {};
      const result = await gamesManager.makeMove(gameId, currentUserId, r, c, { toR, toC, promotion });

      if (result && result.success) {
        // Broadcast the player's move state
        await broadcastGameState(gameId, null);

        if (result.finished) {
          io.to(`game:${gameId}`).emit('game-over', {
            winnerId: result.winnerId,
            winningStones: result.winningStones,
            isForfeit: result.isForfeit || false
          });
          io.emit('game-list-updated', gamesManager.getLiveGames());
        } else {
          if (result.roundWinnerId) {
            io.to(`game:${gameId}`).emit('game-round-over', {
              roundWinnerId: result.roundWinnerId,
              winningStones: result.winningStones,
              nextRound: result.nextRound,
              roundWins: result.game.roundWins,
              delayMs: GAME_ROUND_TRANSITION_DELAY_MS
            });
            scheduleNextGameRound(gameId);
          }

          // Schedule bot move with a thinking delay
          const nextPlayer = result.game.currentPlayer === 1 ? result.game.player1 : result.game.player2;
          if (nextPlayer && nextPlayer.isBot && !result.roundWinnerId) {
            const delay = 1200 + Math.random() * 1000; // 1.2s to 2.2s delay
            setTimeout(async () => {
              try {
                const botResult = await gamesManager.makeBotMove(gameId);
                if (botResult && botResult.success) {
                  await broadcastGameState(gameId, botResult.botMove || null);

                  if (botResult.finished) {
                    io.to(`game:${gameId}`).emit('game-over', {
                      winnerId: botResult.winnerId,
                      winningStones: botResult.winningStones,
                      isForfeit: botResult.isForfeit || false
                    });
                    io.emit('game-list-updated', gamesManager.getLiveGames());
                  } else {
                    if (botResult.roundWinnerId) {
                      io.to(`game:${gameId}`).emit('game-round-over', {
                        roundWinnerId: botResult.roundWinnerId,
                        winningStones: botResult.winningStones,
                        nextRound: botResult.nextRound,
                        roundWins: botResult.game.roundWins,
                        delayMs: GAME_ROUND_TRANSITION_DELAY_MS
                      });
                      scheduleNextGameRound(gameId);
                    }
                  }
                }
              } catch (botErr) {
                console.error('Error during delayed bot move:', botErr);
              }
            }, delay);
          }
        }

        if (typeof ack === 'function') {
          ack({ success: true });
        }
      }
    } catch (err) {
      const isValidationError = [
        "La partie n'est pas en cours.",
        "Ce n'est pas votre tour.",
        "Colonne est pleine.",
        "Coup invalide.",
        "Tuile invalide.",
        "Le domino ne correspond pas à l'extrémité gauche.",
        "Le domino ne correspond pas à l'extrémité droite.",
        "Ce coup n est pas autorisé."
      ].includes(err.message);

      if (isValidationError) {
        console.warn(`[Validation Warning] game-move: ${err.message}`);
      } else {
        console.error('Error on game-move:', err);
      }

      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-draw', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');

      const { gameId } = data || {};
      const result = await gamesManager.drawTile(gameId, currentUserId);

      if (result && result.success) {
        await broadcastGameState(gameId, null);
        if (typeof ack === 'function') {
          ack({ success: true });
        }
      }
    } catch (err) {
      console.error('Error on game-draw:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-pass', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');

      const { gameId } = data || {};
      const result = await gamesManager.passTurn(gameId, currentUserId);

      if (result && result.success) {
        await broadcastGameState(gameId, null);

        // If next player is bot, trigger bot play
        const nextPlayer = result.game.currentPlayer === 1 ? result.game.player1 : result.game.player2;
        if (nextPlayer && nextPlayer.isBot) {
          const delay = 1200 + Math.random() * 1000;
          setTimeout(async () => {
            try {
              const botResult = await gamesManager.makeBotMove(gameId);
              if (botResult && botResult.success) {
                await broadcastGameState(gameId, botResult.botMove || null);

                if (botResult.finished) {
                  io.to(`game:${gameId}`).emit('game-over', {
                    winnerId: botResult.winnerId,
                    winningStones: botResult.winningStones,
                    isForfeit: botResult.isForfeit || false
                  });
                  io.emit('game-list-updated', gamesManager.getLiveGames());
                }
              }
            } catch (botErr) {
              console.error('Error during delayed bot move after pass:', botErr);
            }
          }, delay);
        }

        if (typeof ack === 'function') {
          ack({ success: true });
        }
      }
    } catch (err) {
      console.error('Error on game-pass:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-spectate-join', async (data, ack) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) throw new Error('Non authentifié.');
      
      const user = await User.getById(currentUserId);
      if (!user) throw new Error('Utilisateur introuvable.');

      const { gameId } = data || {};
      const game = gamesManager.games[gameId];
      if (!game) throw new Error('Partie introuvable ou terminée.');

      const isPlayer = game.player1.id === currentUserId || (game.player2 && game.player2.id === currentUserId);
      if (!isPlayer && game.liveMode === 'paid') {
        const price = parseFloat(game.livePrice || 0.50);
        if (price > 0) {
          if (!game.spectatorsUnlocked || !game.spectatorsUnlocked.includes(currentUserId)) {
            const [rows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [currentUserId]);
            const balance = rows.length > 0 ? parseFloat(rows[0].deposit_account_balance || 0) : 0;
            if (balance < price) {
              throw new Error(`Solde insuffisant pour regarder ce live (${price.toFixed(2)} $ requis).`);
            }

            const connection = await db.getConnection();
            try {
              await connection.beginTransaction();
              await connection.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [price, currentUserId]);
              await connection.execute('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [price, game.player1.id]);
              await connection.commit();
            } catch (txErr) {
              await connection.rollback();
              throw txErr;
            } finally {
              connection.release();
            }

            if (!game.spectatorsUnlocked) game.spectatorsUnlocked = [];
            game.spectatorsUnlocked.push(currentUserId);

            io.to(`user:${currentUserId}`).emit('balance-updated', { type: 'deposit' });
            io.to(`user:${game.player1.id}`).emit('balance-updated', { type: 'deposit' });
          }
        }
      }

      const updatedGame = gamesManager.spectateJoin(gameId, user);
      if (updatedGame) {
        socket.join(`game:${updatedGame.id}`);
        io.to(`game:${updatedGame.id}`).emit('game-spectators-updated', {
          spectators: updatedGame.spectators,
          count: updatedGame.spectators.length
        });
        
        if (typeof ack === 'function') {
          ack({ success: true, game: sanitizeGame(updatedGame, currentUserId) });
        }
      } else {
        throw new Error('Partie introuvable ou terminée.');
      }
    } catch (err) {
      console.error('Error on game-spectate-join:', err);
      if (typeof ack === 'function') {
        ack({ error: err.message });
      }
    }
  });

  socket.on('game-spectate-leave', (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      
      const { gameId } = data || {};
      const game = gamesManager.spectateLeave(gameId, currentUserId);
      
      if (game) {
        io.to(`game:${gameId}`).emit('game-spectators-updated', {
          spectators: game.spectators,
          count: game.spectators.length
        });
      }
      socket.leave(`game:${gameId}`);
    } catch (err) {
      console.error('Error on game-spectate-leave:', err);
    }
  });

  socket.on('game-forfeit', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      
      const { gameId } = data || {};
      const result = await gamesManager.forfeitGame(gameId, currentUserId);
      
      if (result && result.finished) {
        await broadcastGameState(gameId, null);
        io.to(`game:${gameId}`).emit('game-over', {
          winnerId: result.winnerId,
          winningStones: null,
          isForfeit: true
        });
        io.emit('game-list-updated', gamesManager.getLiveGames());
      }
    } catch (err) {
      console.error('Error on game-forfeit:', err);
    }
  });

  socket.on('game-chat-message', async (data) => {
    try {
      const currentUserId = session.userId;
      if (!currentUserId) return;
      
      const { gameId, content } = data || {};
      if (!content || !content.trim()) return;

      const user = await User.getById(currentUserId);
      if (!user) return;

      io.to(`game:${gameId}`).emit('game-chat-received', {
        senderId: currentUserId,
        senderName: `${user.first_name} ${user.last_name}`,
        senderUsername: user.username,
        avatar: user.avatar,
        content: content.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    } catch (err) {
      console.error('Error on game-chat-message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Un utilisateur s\'est déconnecté :', socket.id);
  });
});

// Middleware de gestion globale des erreurs Express
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err.name === 'RangeNotSatisfiableError' || err.status === 416) {
    console.warn(`[Range Not Satisfiable] 416 for static file: ${req.url}`);
    return res.status(416).send('Range Not Satisfiable');
  }
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).send('Internal Server Error');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  try {
    const installed = await installController.checkIsInstalled();
    if (installed) {
      await ensureBscDepositsSchema();
      console.log('Database bsc_deposits table check complete.');
      await ensureWithdrawalsSchema();
      console.log('Database bsc_withdrawals table and user PIN check complete.');
      
      // Check/migrate admin table columns
      const Admin = require('./models/Admin');
      await Admin.getPrimaryAdmin();
      console.log('Database admins table and columns check complete.');
      
      // Ensure default settings are present in app_settings table
      try {
        const { setSetting, getSetting } = require('./utils/appSettings');
        const hasMin = await getSetting('min_withdrawal_amount');
        if (hasMin === null) {
          await setSetting('min_withdrawal_amount', '50');
          console.log('Initialized default min_withdrawal_amount: 50');
        }
        const hasFee = await getSetting('withdrawal_fee_percent');
        if (hasFee === null) {
          await setSetting('withdrawal_fee_percent', '30');
          console.log('Initialized default withdrawal_fee_percent: 30');
        }
      } catch (settErr) {
        console.error('Failed to initialize default appSettings:', settErr);
      }
      
      bscMonitor.start(io);
    } else {
      console.log('Application is not installed yet. Skipping database schema verification and background services.');
    }
  } catch (err) {
    console.error('Failed to initialize deposits or schema:', err);
  }
  console.log(`Le serveur tourne sur http://localhost:${PORT}`);
});
// Nodemon trigger comment
