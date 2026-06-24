const User = require('../models/User');
const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');
const Post = require('../models/Post');
const KycRequest = require('../models/KycRequest');
const P2PMarket = require('../models/P2PMarket');
const Notification = require('../models/Notification');
const PlatformRevenue = require('../models/PlatformRevenue');
const AdminModerationNotice = require('../models/AdminModerationNotice');
const Message = require('../models/Message');
const Comment = require('../models/Comment');
const PostReport = require('../models/PostReport');
const ActivityLog = require('../models/ActivityLog');
const db = require('../config/db');
const { getNumberSetting, setSetting } = require('../utils/appSettings');
const { createTranslator, normalizeLocale } = require('../utils/i18n');
const receiptCrypto = require('../utils/receiptCrypto');

const PLATFORM_NAME = 'TrasX';
const ADMIN_PRIMARY_BALANCE_ENTRY_TYPES = new Set([
  'event_creation_fee',
  'events_unlock_fee',
  'paid_background_fee',
  'post_trade_admin_capture',
  'reel_trade_admin_capture'
]);
const POST_MODERATION_REASONS = new Set([
  'Spam ou contenu trompeur',
  'Harcèlement ou intimidation',
  'Discours haineux',
  'Violence ou menace',
  'Contenu sexuel ou nudité',
  'Arnaque ou fraude',
  'Violation des droits',
  'Vente ou activité interdite',
  'Autre'
]);
const PROFILE_MODERATION_REASONS = new Set([
  'Usurpation d identité',
  'Compte frauduleux',
  'Spam ou activité suspecte',
  'Harcèlement ou intimidation',
  'Discours haineux',
  'Menace pour la sécurité',
  'Contenu inapproprié répété',
  'Autre'
]);

const ADMIN_PAGE_PATHS = {
  overview: '/admin',
  users: '/admin/users',
  moderation: '/admin/moderation',
  revenue: '/admin/revenue',
  transactions: '/admin/transactions',
  balances: '/admin/balances',
  backgrounds: '/admin/backgrounds',
  rules: '/admin/rules',
  kyc: '/admin/kyc',
  receipts: '/admin/receipts',
  smtp: '/admin/system-settings',
  admins: '/admin/admins',
  disputes: '/admin/disputes',
  conversations: '/admin/conversations',
  comments: '/admin/comments',
  messaging: '/admin/messaging'
};

const ADMIN_PAGE_PERMISSIONS = [
  { key: 'overview', label: 'Vue d ensemble', description: 'Peut voir les indicateurs globaux du dashboard.' },
  { key: 'users', label: 'Base utilisateurs', description: 'Peut voir la liste et les fiches utilisateurs.' },
  { key: 'moderation', label: 'Modération', description: 'Peut voir les signalements et contenus à modérer.' },
  { key: 'revenue', label: 'Revenus plateforme', description: 'Peut voir les revenus et encaissements.' },
  { key: 'transactions', label: 'Dépôts et retraits', description: 'Peut voir les dépôts, retraits et opérations.' },
  { key: 'balances', label: 'Gestion des soldes', description: 'Peut voir la page de gestion des soldes utilisateurs.' },
  { key: 'backgrounds', label: 'Fonds des posts', description: 'Peut voir la gestion des backgrounds premium.' },
  { key: 'rules', label: 'Règles globales', description: 'Peut voir les règles, seuils et tarifications.' },
  { key: 'kyc', label: 'Requêtes KYC', description: 'Peut voir les demandes KYC.' },
  { key: 'receipts', label: 'Lecteur de reçus', description: 'Peut voir et utiliser le décryptage des reçus.' },
  { key: 'smtp', label: 'SMTP et système', description: 'Peut voir les paramètres techniques.' },
  { key: 'admins', label: 'Gestion des admins', description: 'Peut voir la liste des admins et leurs accès.' },
  { key: 'disputes', label: 'Litiges de la plateforme', description: 'Peut voir et gérer tous les litiges (P2P et comptes bloqués).' },
  { key: 'conversations', label: 'Conversations utilisateurs', description: 'Peut voir toutes les conversations privées des utilisateurs.' },
  { key: 'comments', label: 'Commentaires des posts', description: 'Peut voir tous les commentaires publiés sur les posts.' },
  { key: 'messaging', label: 'Messagerie admin', description: 'Peut envoyer des notifications à un utilisateur ou à tous.' }
];

const ADMIN_ACTION_PERMISSIONS = [
  { key: 'manage_users', label: 'Gérer les utilisateurs', description: 'Changer les statuts et supprimer des comptes.' },
  { key: 'moderate_content', label: 'Modérer les contenus', description: 'Créer des alertes de modération profils et posts.' },
  { key: 'manage_balances', label: 'Gérer les soldes', description: 'Ajouter ou retirer des fonds des comptes utilisateurs.' },
  { key: 'manage_backgrounds', label: 'Gérer les backgrounds', description: 'Ajouter ou supprimer des fonds premium.' },
  { key: 'manage_kyc', label: 'Traiter les KYC', description: 'Approuver ou rejeter les demandes KYC.' },
  { key: 'manage_settings', label: 'Modifier les paramètres', description: 'Changer règles globales, seuils et configuration.' },
  { key: 'manage_admins', label: 'Gérer les admins', description: 'Créer des admins et personnaliser leurs vues et droits.' },
  { key: 'manage_disputes', label: 'Gérer les litiges', description: 'Peut débloquer des comptes ou trancher des litiges P2P.' }
];

const USER_CERTIFICATION_OPTIONS = [
  { value: 'None', label: 'Aucune certification', color: '#94a3b8' },
  { value: 'Basique', label: 'Basique', color: '#3b82f6' },
  { value: 'VIP', label: 'VIP', color: '#eab308' },
  { value: 'Gouvernement', label: 'Gouvernement', color: '#22c55e' },
  { value: 'Entreprise', label: 'Entreprise', color: '#a855f7' }
];

const ADMIN_PAGE_META = {
  overview: {
    title: 'Suivi global de la plateforme',
    breadcrumb: 'Vue d ensemble et statistiques',
    description: 'Vue synthétique du backoffice avec les indicateurs clés de la plateforme.'
  },
  users: {
    title: 'Base des utilisateurs',
    breadcrumb: 'Gestion des utilisateurs',
    description: 'Recherche, audience, soldes et actions de statut regroupés sur une page dédiée.'
  },
  moderation: {
    title: 'Analyse et moderation',
    breadcrumb: 'Moderation des profils et posts',
    description: 'Suivi des alertes, signalements et contenus à examiner.'
  },
  messaging: {
    title: 'Messagerie d administration',
    breadcrumb: 'Messagerie et notifications',
    description: 'Envoyer une notification ou un message d information à un utilisateur spécifique ou à l ensemble de la communauté.'
  },
  revenue: {
    title: 'Revenus de la plateforme',
    breadcrumb: 'Compte de revenus',
    description: 'Historique des encaissements USD et token convertis.'
  },
  transactions: {
    title: 'Historique des transactions',
    breadcrumb: 'Depots et retraits',
    description: 'Consolidez les opérations financières, confirmations et bénéfices.'
  },
  balances: {
    title: 'Credits des comptes',
    breadcrumb: 'Top-up et credits',
    description: 'Alimentez les comptes utilisateurs individuellement ou en masse.'
  },
  backgrounds: {
    title: 'Post Backgrounds Management',
    breadcrumb: 'Fonds de posts premium',
    description: 'Ajout, prix et attribution des revenus des backgrounds premium.'
  },
  rules: {
    title: 'Regles globales et tarification',
    breadcrumb: 'Seuils et prix du token',
    description: 'Gérez les paramètres de croissance, visibilité et conversion.'
  },
  kyc: {
    title: 'Requetes KYC',
    breadcrumb: 'Vérification des comptes',
    description: 'Validez ou refusez les dossiers de vérification.'
  },
  receipts: {
    title: 'Lecteur de reçus',
    breadcrumb: 'Décryptage et contrôle',
    description: 'Vérifiez l’authenticité des dépôts et retraits depuis leurs reçus.'
  },
  smtp: {
    title: 'Configuration systeme et SMTP',
    breadcrumb: 'Paramètres techniques',
    description: 'Centralisez la configuration de communication et les actions critiques.'
  },
  admins: {
    title: 'Gestion des administrateurs',
    breadcrumb: 'Comptes admins et permissions',
    description: 'Créez des admins, attribuez leurs droits et personnalisez les pages visibles.'
  },
  disputes: {
    title: 'Gestion des litiges',
    breadcrumb: 'Litiges et blocages',
    description: 'Arbitrez les litiges du marché P2P et traitez les contestations de blocages de compte.'
  },
  conversations: {
    title: 'Conversations des utilisateurs',
    breadcrumb: 'Messagerie privée',
    description: 'Consultez l’ensemble des conversations privées échangées sur la plateforme.'
  },
  comments: {
    title: 'Commentaires des posts',
    breadcrumb: 'Commentaires publics',
    description: 'Surveillez tous les commentaires laissés sous les publications.'
  }
};

function wantsJsonResponse(req) {
  return String(req.headers.accept || '').includes('application/json')
    || String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest'
    || String(req.query?.format || '').toLowerCase() === 'json';
}

function formatBalanceMessage(locale, amount, accountLabel, note = '') {
  const formattedAmount = `$${Number(amount).toFixed(2)}`;
  const cleanNote = String(note || '').trim();
  const t = createTranslator(locale);
  const template = t('admin.balanceTopUpMessage', `${PLATFORM_NAME} credited {amount} to your {account} balance.`);
  const base = String(template || '')
    .replace('{amount}', formattedAmount)
    .replace('{account}', accountLabel);
  return cleanNote ? `${base} ${cleanNote}` : base;
}

function formatBalanceDebitMessage(locale, amount, accountLabel, note = '') {
  const formattedAmount = `$${Number(amount).toFixed(2)}`;
  const cleanNote = String(note || '').trim();
  const t = createTranslator(locale);
  const template = t('admin.balanceDebitMessage', `${PLATFORM_NAME} debited {amount} from your {account} account.`);
  const base = String(template || '')
    .replace('{amount}', formattedAmount)
    .replace('{account}', accountLabel);
  return cleanNote ? `${base} ${cleanNote}` : base;
}

function parseAmountInput(value) {
  let raw = String(value ?? '').trim();
  if (!raw) return NaN;
  
  // Remove all whitespace
  raw = raw.replace(/\s+/g, '');
  
  // If there are both commas and dots:
  if (raw.includes(',') && raw.includes('.')) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European format: thousands is '.', decimal is ',' (e.g. 12.345,67)
      raw = raw.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // US format: thousands is ',', decimal is '.' (e.g. 12,345.67)
      raw = raw.replace(/,/g, '');
    }
  } else if (raw.includes(',')) {
    // Only commas (e.g. 12,5)
    raw = raw.replace(/,/g, '.');
  }
  
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeUserLookup(value) {
  return String(value ?? '').trim().replace(/^@+/, '');
}

function normalizeModerationReason(value, allowedReasons) {
  const reason = String(value || '').trim();
  if (!reason || !allowedReasons.has(reason)) {
    return null;
  }
  return reason;
}

function normalizeModerationDetails(value) {
  const details = String(value || '').trim().replace(/\s+/g, ' ');
  if (!details) return null;
  return details.slice(0, 500);
}

function getUserBalanceAccountConfig(accountType) {
  const normalized = String(accountType || '').trim().toLowerCase();
  const accounts = {
    deposit: {
      key: 'deposit_account_balance',
      labelFr: 'dépôt',
      successLabel: 'compte de dépôt'
    },
    withdrawal: {
      key: 'withdrawal_account_balance',
      labelFr: 'retrait',
      successLabel: 'compte de retrait'
    },
    bonus: {
      key: 'bonus_account_balance',
      labelFr: 'bonus',
      successLabel: 'compte bonus'
    }
  };
  return accounts[normalized] || null;
}

async function findUserForBalanceUpdate(connection, userLookup) {
  let userRows;
  if (userLookup.includes('@')) {
    [userRows] = await connection.query(
      `
        SELECT id, username, email, preferred_language, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance
        FROM users
        WHERE LOWER(email) = LOWER(?)
        FOR UPDATE
      `,
      [userLookup]
    );
  } else {
    [userRows] = await connection.query(
      `
        SELECT id, username, email, preferred_language, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance
        FROM users
        WHERE LOWER(username) = LOWER(?)
        FOR UPDATE
      `,
      [userLookup]
    );
  }

  if ((!userRows || userRows.length === 0) && /^[1-9]\d*$/.test(userLookup)) {
    [userRows] = await connection.query(
      `
        SELECT id, username, email, preferred_language, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance
        FROM users
        WHERE id = ?
        FOR UPDATE
      `,
      [Number.parseInt(userLookup, 10)]
    );
  }

  return userRows?.[0] || null;
}

function toSelectionArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function buildAdminPermissionsFromRequest(body = {}) {
  const pages = new Set(toSelectionArray(body.pages));
  const actions = new Set(toSelectionArray(body.actions));
  const permissions = Admin.getPermissionBlueprint();

  for (const page of Admin.getPageKeys()) {
    permissions.pages[page] = pages.has(page);
  }

  for (const action of Admin.getActionKeys()) {
    permissions.actions[action] = actions.has(action);
  }

  if (!Object.values(permissions.pages).some(Boolean)) {
    permissions.pages.overview = true;
  }

  return permissions;
}

function createPeriodBuckets(period) {
  const now = new Date();
  const buckets = [];

  if (period === 'yearly') {
    const base = new Date(now.getFullYear(), 0, 1);
    for (let index = 4; index >= 0; index -= 1) {
      const bucketDate = new Date(base.getFullYear() - index, 0, 1);
      buckets.push({
        key: String(bucketDate.getFullYear()),
        label: String(bucketDate.getFullYear())
      });
    }
    return buckets;
  }

  if (period === 'monthly') {
    const base = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let index = 5; index >= 0; index -= 1) {
      const bucketDate = new Date(base.getFullYear(), base.getMonth() - index, 1);
      buckets.push({
        key: `${bucketDate.getFullYear()}-${String(bucketDate.getMonth() + 1).padStart(2, '0')}`,
        label: bucketDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
      });
    }
    return buckets;
  }

  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let index = 6; index >= 0; index -= 1) {
    const bucketDate = new Date(base);
    bucketDate.setDate(base.getDate() - index);
    buckets.push({
      key: `${bucketDate.getFullYear()}-${String(bucketDate.getMonth() + 1).padStart(2, '0')}-${String(bucketDate.getDate()).padStart(2, '0')}`,
      label: bucketDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    });
  }
  return buckets;
}

function resolvePeriodKey(dateValue, period) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  if (period === 'yearly') {
    return String(date.getFullYear());
  }

  if (period === 'monthly') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function aggregateSeries(rows, period, options = {}) {
  const buckets = createPeriodBuckets(period);
  const indexByKey = new Map(buckets.map((bucket, index) => [bucket.key, index]));
  const values = new Array(buckets.length).fill(0);
  const getDate = typeof options.getDate === 'function' ? options.getDate : (row) => row?.created_at;
  const getValue = typeof options.getValue === 'function' ? options.getValue : (row) => Number(row?.amount || 0);
  const filter = typeof options.filter === 'function' ? options.filter : () => true;

  for (const row of rows || []) {
    if (!filter(row)) continue;
    const key = resolvePeriodKey(getDate(row), period);
    if (!indexByKey.has(key)) continue;
    const amount = Number(getValue(row) || 0);
    if (!Number.isFinite(amount)) continue;
    values[indexByKey.get(key)] += amount;
  }

  return {
    labels: buckets.map((bucket) => bucket.label),
    values: values.map((value) => Number(value.toFixed(4)))
  };
}

function buildAccountChartsData({
  platformRevenueRows,
  depositRows,
  withdrawalRows,
  adminBalancesSummary,
  adminAccountsGrandTotal,
  userBalancesSummary,
  platformRevenueSummary
}) {
  const periods = ['daily', 'monthly', 'yearly'];
  const charts = {};

  for (const period of periods) {
    const adminPrincipal = aggregateSeries(platformRevenueRows, period, {
      getValue: (row) => row.amount_usd,
      filter: (row) => ADMIN_PRIMARY_BALANCE_ENTRY_TYPES.has(String(row.entry_type || ''))
    });
    const adminWithdrawalFees = aggregateSeries(platformRevenueRows, period, {
      getValue: (row) => row.amount_usd,
      filter: (row) => String(row.entry_type || '') === 'withdrawal_fee'
    });
    const adminAdsFees = aggregateSeries(platformRevenueRows, period, {
      getValue: (row) => row.amount_usd,
      filter: (row) => String(row.entry_type || '') === 'ad_creation_fee'
    });
    const adminPlatformRevenue = aggregateSeries(platformRevenueRows, period, {
      getValue: (row) => row.amount_usd
    });
    const userDeposits = aggregateSeries(depositRows, period, {
      getValue: (row) => row.amount_usdt
    });
    const userWithdrawals = aggregateSeries(withdrawalRows, period, {
      getValue: (row) => row.amount_usdt
    });
    const userTokens = aggregateSeries(platformRevenueRows, period, {
      getValue: (row) => row.amount_native,
      filter: (row) => String(row.currency || '') === 'TOKEN'
    });

    const adminTotalValues = adminPrincipal.values.map((value, index) => Number((
      value
      + Number(adminWithdrawalFees.values[index] || 0)
      + Number(adminAdsFees.values[index] || 0)
      + Number(adminPlatformRevenue.values[index] || 0)
    ).toFixed(4)));
    const emptyBonusValues = userDeposits.values.map(() => 0);

    charts[period] = {
      admin: {
        labels: adminPrincipal.labels,
        series: [
          {
            key: 'admin-total',
            label: 'Somme des comptes admin',
            unit: 'usd',
            color: '#2f6fed',
            currentValue: Number(adminAccountsGrandTotal || 0),
            values: adminTotalValues
          },
          {
            key: 'admin-balance',
            label: 'Solde principal admin',
            unit: 'usd',
            color: '#10b981',
            currentValue: Number(adminBalancesSummary.total_balance || 0),
            values: adminPrincipal.values
          },
          {
            key: 'admin-withdrawal-fees',
            label: 'Frais de retrait admin',
            unit: 'usd',
            color: '#f59e0b',
            currentValue: Number(adminBalancesSummary.total_withdrawal_fees_balance || 0),
            values: adminWithdrawalFees.values
          },
          {
            key: 'admin-ads-fees',
            label: 'Frais publicitaires admin',
            unit: 'usd',
            color: '#6366f1',
            currentValue: Number(adminBalancesSummary.total_ads_fees_balance || 0),
            values: adminAdsFees.values
          },
          {
            key: 'platform-revenue',
            label: 'Revenus plateforme',
            unit: 'usd',
            color: '#14b8a6',
            currentValue: Number(platformRevenueSummary.total_usd_equivalent || 0),
            values: adminPlatformRevenue.values
          }
        ]
      },
      users: {
        labels: userDeposits.labels,
        series: [
          {
            key: 'user-deposits',
            label: 'Compte de depot utilisateurs',
            unit: 'usd',
            color: '#2f6fed',
            currentValue: Number(userBalancesSummary.total_deposit_balance || 0),
            values: userDeposits.values
          },
          {
            key: 'user-withdrawals',
            label: 'Compte de retrait utilisateurs',
            unit: 'usd',
            color: '#10b981',
            currentValue: Number(userBalancesSummary.total_withdrawal_balance || 0),
            values: userWithdrawals.values
          },
          {
            key: 'user-bonus',
            label: 'Compte bonus utilisateurs',
            unit: 'usd',
            color: '#f59e0b',
            currentValue: Number(userBalancesSummary.total_bonus_balance || 0),
            values: emptyBonusValues
          },
          {
            key: 'user-tokens',
            label: 'Compte tokens utilisateurs',
            unit: 'token',
            color: '#8b5cf6',
            currentValue: Number(userBalancesSummary.total_token_balance || 0),
            values: userTokens.values
          }
        ]
      }
    };
  }

  return charts;
}

function buildCountryChartsData(users) {
  const rows = Array.isArray(users) ? users : [];
  const countryTotals = new Map();

  for (const user of rows) {
    const country = String(user?.country || '').trim() || 'Non renseigne';
    countryTotals.set(country, (countryTotals.get(country) || 0) + 1);
  }

  const topCountries = Array.from(countryTotals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'fr'))
    .slice(0, 6)
    .map(([country, total]) => ({ country, total }));

  const palette = ['#2f6fed', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#ef4444'];
  const periods = ['daily', 'monthly', 'yearly'];
  const charts = {};

  for (const period of periods) {
    const labels = createPeriodBuckets(period).map((bucket) => bucket.label);
    const series = topCountries.map((entry, index) => {
      const aggregated = aggregateSeries(rows, period, {
        getDate: (row) => row.created_at,
        getValue: () => 1,
        filter: (row) => (String(row?.country || '').trim() || 'Non renseigne') === entry.country
      });

      return {
        key: `country-${index}`,
        label: entry.country,
        unit: 'count',
        color: palette[index % palette.length],
        currentValue: entry.total,
        values: aggregated.values,
        labels
      };
    });

    charts[period] = {
      labels,
      series
    };
  }

  return {
    topCountries,
    charts
  };
}

function resolveAdminPagePath(page) {
  return ADMIN_PAGE_PATHS[page] || ADMIN_PAGE_PATHS.overview;
}

function extractAdminPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, 'http://localhost');
    return parsed.pathname.startsWith('/admin') ? parsed.pathname : null;
  } catch (error) {
    return raw.startsWith('/admin') ? raw.split('?')[0].split('#')[0] : null;
  }
}

function getAdminReturnPath(req, fallbackPage = 'overview') {
  return extractAdminPath(req.body?.redirectTo)
    || extractAdminPath(req.query?.redirectTo)
    || extractAdminPath(req.headers?.referer)
    || resolveAdminPagePath(fallbackPage);
}

function adminRedirect(req, res, { success, error, anchor = '', fallbackPage = 'overview' }) {
  const query = success
    ? `success=${encodeURIComponent(success)}`
    : `error=${encodeURIComponent(error || 'Operation failed')}`;
  const normalizedAnchor = anchor ? `#${String(anchor).replace(/^#/, '')}` : '';
  return res.redirect(`${getAdminReturnPath(req, fallbackPage)}?${query}${normalizedAnchor}`);
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

exports.getAdminDashboard = async (req, res) => {
  try {
    const adminPage = Object.prototype.hasOwnProperty.call(ADMIN_PAGE_PATHS, req.adminPage)
      ? req.adminPage
      : 'overview';
    await ensurePostBackgroundSchema();
    await Post.ensureSchema();
    await require('../models/Reel').ensureReelSchema();
    await P2PMarket.ensureSchema();
    await require('../models/KycRequest').ensureSchema();
    const users = await User.getAll();
    const userIds = users.map((user) => Number(user.id)).filter(Number.isFinite);

    let followersMap = new Map();
    let followingMap = new Map();
    let postReachMap = new Map();
    let reelReachMap = new Map();

    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(', ');
      const [followersRows] = await db.query(
        `
          SELECT following_id AS user_id, COUNT(*) AS total
          FROM follows
          WHERE following_id IN (${placeholders})
          GROUP BY following_id
        `,
        userIds
      );
      const [followingRows] = await db.query(
        `
          SELECT follower_id AS user_id, COUNT(*) AS total
          FROM follows
          WHERE follower_id IN (${placeholders})
          GROUP BY follower_id
        `,
        userIds
      );
      const [postReachRows] = await db.query(
        `
          SELECT user_id, COALESCE(MAX(promo_daily_target), 0) AS total
          FROM posts
          WHERE user_id IN (${placeholders})
          GROUP BY user_id
        `,
        userIds
      );
      const [reelReachRows] = await db.query(
        `
          SELECT user_id, COALESCE(MAX(promo_daily_target), 0) AS total
          FROM reels
          WHERE user_id IN (${placeholders})
          GROUP BY user_id
        `,
        userIds
      );

      followersMap = new Map(followersRows.map((row) => [Number(row.user_id), Number(row.total || 0)]));
      followingMap = new Map(followingRows.map((row) => [Number(row.user_id), Number(row.total || 0)]));
      postReachMap = new Map(postReachRows.map((row) => [Number(row.user_id), Number(row.total || 0)]));
      reelReachMap = new Map(reelReachRows.map((row) => [Number(row.user_id), Number(row.total || 0)]));
    }

    const enrichedUsers = users.map((user) => ({
      ...user,
      followers_count: followersMap.get(Number(user.id)) || 0,
      following_count: followingMap.get(Number(user.id)) || 0,
      post_daily_reach_target: postReachMap.get(Number(user.id)) || 0,
      reel_daily_reach_target: reelReachMap.get(Number(user.id)) || 0
    }));
    const [settings] = await db.query('SELECT * FROM app_settings');
    const [backgrounds] = await db.query(`
      SELECT
        pb.*,
        u.username AS creator_username,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS creator_name
      FROM post_backgrounds pb
      LEFT JOIN users u ON u.id = pb.creator_user_id
      ORDER BY pb.created_at DESC
    `);
    const kycRequests = await KycRequest.getPending(24);
    const eventsUnlockFee = await getNumberSetting('events_unlock_fee', 0);
    const tokenPriceUsd = await getNumberSetting('token_price_usd', 0.1);
    const newUserPromoDays = await getNumberSetting('new_user_promo_days', 30);
    const newUserDailyViewBase = await getNumberSetting('new_user_daily_view_base', 1000);
    const paidHashtagViewBonus = await getNumberSetting('paid_hashtag_view_bonus', 50);
    const paidBackgroundViewBonusPerDollar = await getNumberSetting('paid_background_view_bonus_per_dollar', 100);
    const minWithdrawalAmount = await getNumberSetting('min_withdrawal_amount', 50);
    const withdrawalFeePercent = await getNumberSetting('withdrawal_fee_percent', 30);
    const platformRevenueSummary = await PlatformRevenue.getSummary();
    const platformRevenueEntries = await PlatformRevenue.getRecentEntries(25);
    const postsForReview = await Post.getAllForAdmin();
    const postReports = await PostReport.getAllPending();
    const adminModerationNotices = await AdminModerationNotice.getRecent(40);
    const adminId = req.session.adminId;
    const currentAdmin = await Admin.getById(adminId);
    const visibleAdminPageKeys = Admin.getAccessiblePageKeys(currentAdmin);
    const currentAdminPermissions = Admin.getPermissions(currentAdmin);
    const canManageAdmins = Admin.canPerformAction(currentAdmin, 'manage_admins');
    const adminAccounts = canManageAdmins
      ? (await Admin.getAll()).map((adminAccount) => ({
        ...adminAccount,
        resolvedPermissions: Admin.getPermissions(adminAccount),
        is_super_admin: Number(adminAccount.is_super_admin || 0) === 1
      }))
      : [];
    const adminBalancesSummary = await Admin.getBalanceTotals();
    const [userBalancesRows] = await db.query(`
      SELECT
        COALESCE(SUM(deposit_account_balance), 0) AS total_deposit_balance,
        COALESCE(SUM(withdrawal_account_balance), 0) AS total_withdrawal_balance,
        COALESCE(SUM(bonus_account_balance), 0) AS total_bonus_balance,
        COALESCE(SUM(token_balance), 0) AS total_token_balance
      FROM users
    `);
    const userBalancesSummary = userBalancesRows[0] || {
      total_deposit_balance: 0,
      total_withdrawal_balance: 0,
      total_bonus_balance: 0,
      total_token_balance: 0
    };
    const adminAccountsGrandTotal = (
      Number(adminBalancesSummary.total_balance || 0)
      + Number(adminBalancesSummary.total_withdrawal_fees_balance || 0)
      + Number(adminBalancesSummary.total_ads_fees_balance || 0)
      + Number(adminBalancesSummary.total_operations_balance || 0)
      + Number(platformRevenueSummary.total_usd_equivalent || 0)
    );
    const [platformRevenueRows] = await db.query(`
      SELECT entry_type, currency, amount_native, amount_usd, created_at
      FROM platform_revenue_entries
      ORDER BY created_at ASC, id ASC
    `);
    const [depositChartRows] = await db.query(`
      SELECT amount_usdt, created_at
      FROM bsc_deposits
      WHERE status IN ('confirmed', 'completed')
      ORDER BY created_at ASC, id ASC
    `);
    const [withdrawalChartRows] = await db.query(`
      SELECT amount_usdt, created_at
      FROM bsc_withdrawals
      WHERE status = 'completed'
      ORDER BY created_at ASC, id ASC
    `);
    const accountChartsData = buildAccountChartsData({
      platformRevenueRows,
      depositRows: depositChartRows,
      withdrawalRows: withdrawalChartRows,
      adminBalancesSummary,
      adminAccountsGrandTotal,
      userBalancesSummary,
      platformRevenueSummary
    });
    const countryChartsData = buildCountryChartsData(enrichedUsers);

    // Fetch deposits history
    const [depositsRows] = await db.query(`
      SELECT d.*, u.username, CONCAT(u.first_name, ' ', u.last_name) AS user_name, u.email
      FROM bsc_deposits d
      LEFT JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC
    `);

    // Fetch withdrawals history
    const [withdrawalsRows] = await db.query(`
      SELECT w.*, u.username, CONCAT(u.first_name, ' ', u.last_name) AS user_name, u.email
      FROM bsc_withdrawals w
      LEFT JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC
    `);

    // Fetch account disputes
    const [disputesRows] = await db.query(`
      SELECT d.*, u.username, u.email, CONCAT(u.first_name, ' ', u.last_name) AS user_name
      FROM disputes d
      JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC
    `);

    const accountDisputes = [];
    for (const dispute of disputesRows) {
      const [kycRows] = await db.query(
        'SELECT * FROM kyc_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [dispute.user_id]
      );
      const userKyc = kycRows[0] || null;

      let conflictingKyc = null;
      if (userKyc) {
        const [conflictRows] = await db.query(`
          SELECT kr.*, u.username, u.email, CONCAT(u.first_name, ' ', u.last_name) AS name
          FROM kyc_requests kr
          JOIN users u ON u.id = kr.user_id
          WHERE kr.user_id != ?
            AND (
              (kr.document_name = ? AND kr.document_size = ? AND kr.document_name IS NOT NULL)
              OR (kr.submitted_full_name = ? AND kr.submitted_dob = ? AND kr.submitted_full_name IS NOT NULL)
              OR (kr.submitted_email = ? AND kr.submitted_email IS NOT NULL)
            )
          ORDER BY kr.id DESC
          LIMIT 1
        `, [
          dispute.user_id,
          userKyc.document_name, userKyc.document_size,
          userKyc.submitted_full_name, userKyc.submitted_dob,
          userKyc.submitted_email
        ]);
        conflictingKyc = conflictRows[0] || null;
      }

      accountDisputes.push({
        ...dispute,
        userKyc,
        conflictingKyc
      });
    }

    // Fetch p2p disputes
    const [p2pDisputes] = await db.query(`
      SELECT po.*, o.asset_code, o.offer_type,
             b.username AS buyer_username, CONCAT(b.first_name, ' ', b.last_name) AS buyer_name,
             s.username AS seller_username, CONCAT(s.first_name, ' ', s.last_name) AS seller_name
      FROM p2p_orders po
      JOIN p2p_offers o ON o.id = po.offer_id
      JOIN users b ON b.id = po.buyer_user_id
      JOIN users s ON s.id = po.seller_user_id
      WHERE po.status = 'disputed'
      ORDER BY po.disputed_at DESC
    `);

    // Fetch reviewed kyc requests
    const [reviewedKycRequests] = await db.query(`
      SELECT kr.*, u.username, u.email, CONCAT(u.first_name, ' ', u.last_name) AS name, u.avatar
      FROM kyc_requests kr
      JOIN users u ON u.id = kr.user_id
      WHERE kr.status IN ('approved', 'rejected')
      ORDER BY kr.reviewed_at DESC, kr.id DESC
      LIMIT 50
    `);

    let adminConversations = [];
    let adminConversationMessages = [];
    if (adminPage === 'conversations') {
      adminConversations = (await Message.getConversationSummariesForAdmin()).map((conversation) => ({
        ...conversation,
        last_sender_username: Number(conversation.last_sender_id || 0) === Number(conversation.user_a_id || 0)
          ? conversation.user_a_username
          : conversation.user_b_username,
        last_receiver_username: Number(conversation.last_receiver_id || 0) === Number(conversation.user_a_id || 0)
          ? conversation.user_a_username
          : conversation.user_b_username,
        display_preview: Message.getPreviewText({
          content: conversation.last_message_content,
          attachment_type: conversation.last_attachment_type,
          attachment_name: conversation.last_attachment_name
        })
      }));
      adminConversationMessages = (await Message.getAllForAdmin()).map((message) => ({
        ...message,
        display_content: Message.getPreviewText(message),
        structured_content: Message.parseStructuredContent(message.content)
      }));
    }

    let adminPostComments = [];
    if (adminPage === 'comments') {
      adminPostComments = await Comment.getAllForAdmin();
    }

    res.render('admin', { 
      adminPage,
      adminPageMeta: ADMIN_PAGE_META[adminPage],
      adminPagePaths: ADMIN_PAGE_PATHS,
      adminPagePermissions: ADMIN_PAGE_PERMISSIONS,
      adminActionPermissions: ADMIN_ACTION_PERMISSIONS,
      userCertificationOptions: USER_CERTIFICATION_OPTIONS,
      users: enrichedUsers, 
      settings, 
      backgrounds, 
      kycRequests,
      eventsUnlockFee,
      tokenPriceUsd,
      newUserPromoDays,
      newUserDailyViewBase,
      paidHashtagViewBonus,
      paidBackgroundViewBonusPerDollar,
      minWithdrawalAmount,
      withdrawalFeePercent,
      platformRevenueSummary,
      platformRevenueEntries,
      postsForReview,
      postReports,
      adminModerationNotices,
      currentAdmin,
      currentAdminPermissions,
      visibleAdminPageKeys,
      canManageAdmins,
      adminAccounts,
      adminBalancesSummary,
      adminAccountsGrandTotal,
      userBalancesSummary,
      accountChartsData,
      countryChartsData,
      deposits: depositsRows,
      withdrawals: withdrawalsRows,
      accountDisputes,
      p2pDisputes,
      reviewedKycRequests,
      adminConversations,
      adminConversationMessages,
      adminPostComments,
      error: req.query.error || null, 
      success: req.query.success || null 
    });
  } catch (error) {
    console.error(error);
    res.send('Error loading admin dashboard');
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const { userId, status } = req.body;
    await User.updateStatus(userId, status);
    adminRedirect(req, res, { success: 'Status updated', fallbackPage: 'users' });
  } catch (error) {
    adminRedirect(req, res, { error: 'Failed to update status', fallbackPage: 'users' });
  }
};

exports.freezeUserAccount = async (req, res) => {
  try {
    const userId = Number.parseInt(req.body.userId, 10);
    const action = String(req.body.action || '').toLowerCase();

    if (!Number.isFinite(userId)) {
      return adminRedirect(req, res, { error: 'Utilisateur introuvable.', fallbackPage: 'users' });
    }

    if (action === 'freeze') {
      await User.updateStatus(userId, 'Frozen');
      await ActivityLog.log(req.session.adminId, 'admin', 'freeze_user', 'user', userId, null, req);
      return adminRedirect(req, res, { success: 'Compte gelé avec succès.', fallbackPage: 'users' });
    }

    if (action === 'unfreeze') {
      await User.updateStatus(userId, 'Active');
      await ActivityLog.log(req.session.adminId, 'admin', 'unfreeze_user', 'user', userId, null, req);
      return adminRedirect(req, res, { success: 'Compte dégelé et réactivé avec succès.', fallbackPage: 'users' });
    }

    return adminRedirect(req, res, { error: 'Action invalide.', fallbackPage: 'users' });
  } catch (error) {
    console.error(error);
    return adminRedirect(req, res, { error: 'Impossible de modifier l\'état du compte.', fallbackPage: 'users' });
  }
};

exports.freezeAllAccounts = async (req, res) => {
  try {
    const action = String(req.body.action || '').toLowerCase();

    if (action === 'freeze') {
      await db.query("UPDATE users SET account_status = 'Frozen' WHERE account_status = 'Active'");
      await ActivityLog.log(req.session.adminId, 'admin', 'freeze_all_users', null, null, null, req);
      return adminRedirect(req, res, { success: 'Tous les comptes actifs ont été gelés.', fallbackPage: 'users' });
    }

    if (action === 'unfreeze') {
      await db.query("UPDATE users SET account_status = 'Active' WHERE account_status = 'Frozen'");
      await ActivityLog.log(req.session.adminId, 'admin', 'unfreeze_all_users', null, null, null, req);
      return adminRedirect(req, res, { success: 'Tous les comptes gelés ont été réactivés.', fallbackPage: 'users' });
    }

    return adminRedirect(req, res, { error: 'Action invalide.', fallbackPage: 'users' });
  } catch (error) {
    console.error(error);
    return adminRedirect(req, res, { error: 'Impossible d\'effectuer l\'opération en masse.', fallbackPage: 'users' });
  }
};

exports.updateUserCertification = async (req, res) => {
  try {
    const userId = Number.parseInt(req.body.userId, 10);
    const certificationType = String(req.body.certification_type || 'None').trim() || 'None';
    const allowedTypes = new Set(USER_CERTIFICATION_OPTIONS.map((option) => option.value));

    if (!Number.isFinite(userId)) {
      return adminRedirect(req, res, { error: 'Utilisateur introuvable.', fallbackPage: 'users' });
    }

    if (!allowedTypes.has(certificationType)) {
      return adminRedirect(req, res, { error: 'Type de certification invalide.', fallbackPage: 'users' });
    }

    await User.updateCertification(userId, certificationType);
    return adminRedirect(req, res, {
      success: certificationType === 'None'
        ? 'Certification retirée avec succès.'
        : `Certification ${certificationType} attribuée avec succès.`,
      fallbackPage: 'users'
    });
  } catch (error) {
    console.error(error);
    return adminRedirect(req, res, { error: 'Impossible de mettre à jour la certification.', fallbackPage: 'users' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = req.body;
    for (const key in settings) {
      if (
        key.startsWith('smtp_')
        || key === 'events_unlock_fee'
        || key === 'token_price_usd'
        || key === 'new_user_promo_days'
        || key === 'new_user_daily_view_base'
        || key === 'paid_hashtag_view_bonus'
        || key === 'paid_background_view_bonus_per_dollar'
        || key === 'min_withdrawal_amount'
        || key === 'withdrawal_fee_percent'
      ) {
        let val = settings[key];
        if (key === 'token_price_usd' || key === 'events_unlock_fee' || key === 'min_withdrawal_amount' || key === 'withdrawal_fee_percent') {
          val = String(val || '').replace(/,/g, '.').trim();
        }
        await setSetting(key, val);
      }
    }
    adminRedirect(req, res, { success: 'Settings updated', fallbackPage: 'smtp' });
  } catch (error) {
    adminRedirect(req, res, { error: 'Failed to update settings', fallbackPage: 'smtp' });
  }
};

exports.reviewKycRequest = async (req, res) => {
  try {
    const requestId = Number.parseInt(req.body.request_id, 10);
    const action = String(req.body.action || '').toLowerCase();
    const request = await db.query('SELECT * FROM kyc_requests WHERE id = ? LIMIT 1', [requestId]);
    const row = request[0]?.[0];

    if (!row) {
      return adminRedirect(req, res, { error: 'KYC request not found', fallbackPage: 'kyc' });
    }

    if (action === 'approve') {
      await User.updateStatus(row.user_id, 'Active');
      await db.query(
        `
          UPDATE users
          SET is_verified = TRUE,
              certification_type = CASE WHEN certification_type = 'None' THEN 'Basique' ELSE certification_type END
          WHERE id = ?
        `,
        [row.user_id]
      );
      await KycRequest.updateStatus(requestId, 'approved', req.session.adminId);
      await User.maybeAutoActivatePremium(row.user_id);
      return adminRedirect(req, res, { success: 'KYC request approved', fallbackPage: 'kyc' });
    }

    await KycRequest.updateStatus(requestId, 'rejected', req.session.adminId);
    return adminRedirect(req, res, { success: 'KYC request rejected', fallbackPage: 'kyc' });
  } catch (error) {
    console.error(error);
    adminRedirect(req, res, { error: 'Failed to review KYC request', fallbackPage: 'kyc' });
  }
};

exports.updateEventThresholds = async (req, res) => {
  try {
    const scope = String(req.body.scope || 'global').toLowerCase();
    const threshold = Number.isFinite(Number(req.body.followers_threshold))
      ? Math.max(0, Number(req.body.followers_threshold))
      : 1000;

    if (scope === 'user') {
      const userId = Number.parseInt(req.body.user_id, 10);
      if (!Number.isFinite(userId)) {
        return adminRedirect(req, res, { error: 'Please enter a valid user id', fallbackPage: 'rules' });
      }
      await User.updateEventThresholdForUser(userId, threshold);
      return adminRedirect(req, res, { success: 'User event threshold updated', fallbackPage: 'rules' });
    }

    await User.updateEventThresholdForAllUsers(threshold);
    return adminRedirect(req, res, { success: 'Global event threshold updated', fallbackPage: 'rules' });
  } catch (error) {
    console.error(error);
    adminRedirect(req, res, { error: 'Failed to update event threshold', fallbackPage: 'rules' });
  }
};

exports.balanceTopUp = async (req, res) => {
  const io = req.app.get('io');
  const wantsJson = wantsJsonResponse(req);
  const respond = (statusCode, payload) => {
    if (wantsJson) {
      return res.status(statusCode).json(payload);
    }
    const query = payload.success
      ? `success=${encodeURIComponent(payload.message || 'Balance updated')}`
      : `error=${encodeURIComponent(payload.message || 'Failed to update balance')}`;
    return res.redirect(`${getAdminReturnPath(req, 'balances')}?${query}`);
  };

  try {
    const scope = String(req.body.scope || 'user').toLowerCase();
    const amount = parseAmountInput(req.body.amount);
    const note = String(req.body.note || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return respond(400, { success: false, message: 'Please enter a valid amount.' });
    }

    const accountConfig = getUserBalanceAccountConfig(req.body.account_type || 'deposit');
    if (!accountConfig) {
      return respond(400, { success: false, message: 'Compte invalide à créditer.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const eventsToEmit = [];

      const admin = await Admin.getPrimaryAdmin(connection, { forUpdate: true });
      if (!admin) {
        await connection.rollback();
        return respond(500, { success: false, message: 'No admin account is available.' });
      }

      if (scope === 'all') {
        const [users] = await connection.query(
          'SELECT id, preferred_language, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance FROM users FOR UPDATE'
        );

        if (!users || users.length === 0) {
          await connection.rollback();
          return respond(400, { success: false, message: 'No users are available to credit.' });
        }

        const totalAmount = amount * users.length;
        await connection.query(`UPDATE users SET ${accountConfig.key} = ${accountConfig.key} + ?`, [amount]);
        await connection.query('UPDATE admins SET operations_balance = COALESCE(operations_balance, 0) - ? WHERE id = ?', [totalAmount, admin.id]);

        for (const user of users) {
          const locale = normalizeLocale(user.preferred_language || 'en');
          const message = formatBalanceMessage(locale, amount, accountConfig.labelFr, note);
          const notificationId = await Notification.create({
            recipientId: user.id,
            actorId: null,
            type: 'message',
            message,
            connection
          });
          const payload = {
            userId: user.id,
            notificationId,
            message,
            depositBalance: accountConfig.key === 'deposit_account_balance'
              ? Number(user.deposit_account_balance || 0) + amount
              : Number(user.deposit_account_balance || 0),
            withdrawalBalance: accountConfig.key === 'withdrawal_account_balance'
              ? Number(user.withdrawal_account_balance || 0) + amount
              : Number(user.withdrawal_account_balance || 0),
            bonusBalance: accountConfig.key === 'bonus_account_balance'
              ? Number(user.bonus_account_balance || 0) + amount
              : Number(user.bonus_account_balance || 0),
            tokenBalance: Number(user.token_balance || 0),
            amount
          };
          eventsToEmit.push({ userId: user.id, notificationId, message, payload });
        }

        await connection.commit();
        for (const event of eventsToEmit) {
          const unreadCount = await Notification.getUnreadCount(event.userId);
          if (io) {
            io.to(`user:${event.userId}`).emit('balance-updated', event.payload);
            io.to(`user:${event.userId}`).emit('notification-created', {
              id: event.notificationId,
              recipient_id: event.userId,
              actor_id: null,
              type: 'message',
              message: event.message,
              post_id: null,
              share_id: null,
              comment_id: null,
              is_read: 0,
              read_at: null,
              created_at: new Date().toISOString(),
              actor_name: PLATFORM_NAME,
              actor_username: 'trasx',
              actor_avatar: '/assets/avatar_placeholder.jpg'
            });
            io.to(`user:${event.userId}`).emit('notification-count-updated', { unreadCount });
          }
        }
        return respond(200, {
          success: true,
          message: `Crédité ${users.length} utilisateurs de $${amount.toFixed(2)} chacun sur leur compte de ${accountConfig.labelFr}.`,
          creditedUsers: users.length,
          amountPerUser: amount,
          totalAmount
        });
      }

      const userLookup = normalizeUserLookup(req.body.user_lookup || req.body.user_id);
      if (!userLookup) {
        await connection.rollback();
        return respond(400, { success: false, message: 'Please enter a username or email.' });
      }

      let userRows;
      if (userLookup.includes('@')) {
        [userRows] = await connection.query(
          `
            SELECT id, username, email, preferred_language, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance
            FROM users
            WHERE LOWER(email) = LOWER(?)
            FOR UPDATE
          `,
          [userLookup]
        );
      } else {
        [userRows] = await connection.query(
          `
            SELECT id, username, email, preferred_language, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance
            FROM users
            WHERE LOWER(username) = LOWER(?)
            FOR UPDATE
          `,
          [userLookup]
        );
      }

      if ((!userRows || userRows.length === 0) && /^[1-9]\d*$/.test(userLookup)) {
        [userRows] = await connection.query(
          `
            SELECT id, username, email, preferred_language, deposit_account_balance, withdrawal_account_balance, bonus_account_balance, token_balance
            FROM users
            WHERE id = ?
            FOR UPDATE
          `,
          [Number.parseInt(userLookup, 10)]
        );
      }
      const targetUser = userRows[0];
      if (!targetUser) {
        await connection.rollback();
        return respond(404, { success: false, message: `User "${userLookup}" not found.` });
      }
      const userId = targetUser.id;

      await connection.query(`UPDATE users SET ${accountConfig.key} = ${accountConfig.key} + ? WHERE id = ?`, [amount, userId]);
      await connection.query('UPDATE admins SET operations_balance = COALESCE(operations_balance, 0) - ? WHERE id = ?', [amount, admin.id]);

      const locale = normalizeLocale(targetUser.preferred_language || 'en');
      const message = formatBalanceMessage(locale, amount, accountConfig.labelFr, note);
      const notificationId = await Notification.create({
        recipientId: userId,
        actorId: null,
        type: 'message',
        message,
        connection
      });

      await connection.commit();

      const depositBalance = accountConfig.key === 'deposit_account_balance'
        ? Number(targetUser.deposit_account_balance || 0) + amount
        : Number(targetUser.deposit_account_balance || 0);
      const withdrawalBalance = accountConfig.key === 'withdrawal_account_balance'
        ? Number(targetUser.withdrawal_account_balance || 0) + amount
        : Number(targetUser.withdrawal_account_balance || 0);
      const bonusBalance = accountConfig.key === 'bonus_account_balance'
        ? Number(targetUser.bonus_account_balance || 0) + amount
        : Number(targetUser.bonus_account_balance || 0);

      const payload = {
        userId,
        notificationId,
        message,
        depositBalance,
        withdrawalBalance,
        bonusBalance,
        tokenBalance: Number(targetUser.token_balance || 0),
        amount
      };
      if (io) {
        io.to(`user:${userId}`).emit('balance-updated', payload);
        io.to(`user:${userId}`).emit('notification-created', {
          id: notificationId,
          recipient_id: userId,
          actor_id: null,
          type: 'message',
          message,
          post_id: null,
          share_id: null,
          comment_id: null,
          is_read: 0,
          read_at: null,
          created_at: new Date().toISOString(),
          actor_name: PLATFORM_NAME,
          actor_username: 'trasx',
          actor_avatar: '/assets/avatar_placeholder.jpg'
        });
        io.to(`user:${userId}`).emit('notification-count-updated', { unreadCount: await Notification.getUnreadCount(userId) });
      }

      return respond(200, {
        success: true,
        message: `Crédité @${targetUser.username} de $${amount.toFixed(2)} sur son compte de ${accountConfig.labelFr}.`,
        userId,
        username: targetUser.username,
        email: targetUser.email,
        amount,
        depositBalance,
        withdrawalBalance,
        bonusBalance
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(error);
    return respond(500, { success: false, message: 'Failed to credit balances.' });
  }
};

exports.balanceDebit = async (req, res) => {
  const io = req.app.get('io');
  const wantsJson = wantsJsonResponse(req);
  const respond = (statusCode, payload) => {
    if (wantsJson) {
      return res.status(statusCode).json(payload);
    }
    const query = payload.success
      ? `success=${encodeURIComponent(payload.message || 'Solde mis à jour')}`
      : `error=${encodeURIComponent(payload.message || 'Impossible de débiter le compte')}`;
    return res.redirect(`${getAdminReturnPath(req, 'users')}?${query}`);
  };

  try {
    const userLookup = normalizeUserLookup(req.body.user_lookup || req.body.user_id || req.body.userId);
    const amount = parseAmountInput(req.body.amount);
    const note = String(req.body.note || '').trim();
    const accountConfig = getUserBalanceAccountConfig(req.body.account_type);

    if (!userLookup) {
      return respond(400, { success: false, message: 'Veuillez renseigner un utilisateur.' });
    }

    if (!accountConfig) {
      return respond(400, { success: false, message: 'Choisissez un compte valide à débiter.' });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return respond(400, { success: false, message: 'Veuillez entrer un montant valide.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const targetUser = await findUserForBalanceUpdate(connection, userLookup);
      if (!targetUser) {
        await connection.rollback();
        return respond(404, { success: false, message: `Utilisateur "${userLookup}" introuvable.` });
      }

      const currentBalance = Number(targetUser[accountConfig.key] || 0);
      if (currentBalance < amount) {
        await connection.rollback();
        return respond(400, {
          success: false,
          message: `Fonds insuffisants sur le ${accountConfig.successLabel}.`
        });
      }

      const admin = await Admin.getPrimaryAdmin(connection, { forUpdate: true });
      if (!admin) {
        await connection.rollback();
        return respond(500, { success: false, message: 'Aucun compte admin disponible.' });
      }

      await connection.query(
        `UPDATE users SET ${accountConfig.key} = ${accountConfig.key} - ? WHERE id = ?`,
        [amount, targetUser.id]
      );
      await connection.query(
        'UPDATE admins SET operations_balance = COALESCE(operations_balance, 0) + ? WHERE id = ?',
        [amount, admin.id]
      );

      const locale = normalizeLocale(targetUser.preferred_language || 'en');
      const message = formatBalanceDebitMessage(locale, amount, accountConfig.labelFr, note);
      const notificationId = await Notification.create({
        recipientId: targetUser.id,
        actorId: null,
        type: 'message',
        message,
        connection
      });

      await connection.commit();

      const payload = {
        userId: targetUser.id,
        notificationId,
        message,
        depositBalance: accountConfig.key === 'deposit_account_balance'
          ? Number((currentBalance - amount).toFixed(2))
          : Number(targetUser.deposit_account_balance || 0),
        withdrawalBalance: accountConfig.key === 'withdrawal_account_balance'
          ? Number((currentBalance - amount).toFixed(2))
          : Number(targetUser.withdrawal_account_balance || 0),
        bonusBalance: accountConfig.key === 'bonus_account_balance'
          ? Number((currentBalance - amount).toFixed(2))
          : Number(targetUser.bonus_account_balance || 0),
        tokenBalance: Number(targetUser.token_balance || 0),
        amount
      };

      if (io) {
        io.to(`user:${targetUser.id}`).emit('balance-updated', payload);
        io.to(`user:${targetUser.id}`).emit('notification-created', {
          id: notificationId,
          recipient_id: targetUser.id,
          actor_id: null,
          type: 'message',
          message,
          post_id: null,
          share_id: null,
          comment_id: null,
          is_read: 0,
          read_at: null,
          created_at: new Date().toISOString(),
          actor_name: PLATFORM_NAME,
          actor_username: 'trasx',
          actor_avatar: '/assets/avatar_placeholder.jpg'
        });
        io.to(`user:${targetUser.id}`).emit('notification-count-updated', { unreadCount: await Notification.getUnreadCount(targetUser.id) });
      }

      return respond(200, {
        success: true,
        message: `$${amount.toFixed(2)} ont été débités du ${accountConfig.successLabel} de @${targetUser.username}.`,
        userId: targetUser.id,
        username: targetUser.username,
        amount,
        accountType: req.body.account_type
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(error);
    return respond(500, { success: false, message: 'Impossible de débiter ce compte pour le moment.' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.body;
    await User.delete(userId);
    await ActivityLog.log(req.session.adminId, 'admin', 'delete_user', 'user', userId, null, req);
    adminRedirect(req, res, { success: 'User deleted successfully', fallbackPage: 'users' });
  } catch (error) {
    console.error(error);
    adminRedirect(req, res, { error: 'Failed to delete user', fallbackPage: 'users' });
  }
};

exports.reportPost = async (req, res) => {
  try {
    const postId = Number.parseInt(req.body.postId, 10);
    if (!Number.isFinite(postId)) {
      return adminRedirect(req, res, { error: 'Post invalide.', fallbackPage: 'moderation' });
    }

    const reason = normalizeModerationReason(req.body.reason, POST_MODERATION_REASONS);
    if (!reason) {
      return adminRedirect(req, res, { error: 'Choisissez une raison valide pour le post.', fallbackPage: 'moderation' });
    }

    const post = await Post.getByIdForAdmin(postId);
    if (!post) {
      return adminRedirect(req, res, { error: 'Post introuvable.', fallbackPage: 'moderation' });
    }

    await AdminModerationNotice.createOrUpdateActive({
      adminId: req.session.adminId,
      targetUserId: post.user_id,
      targetType: 'post',
      postId: post.id,
      reason,
      details: normalizeModerationDetails(req.body.details)
    });

    return adminRedirect(req, res, {
      success: `Le post de @${post.author_username || 'utilisateur'} a ete signale avec succes.`,
      fallbackPage: 'moderation'
    });
  } catch (error) {
    console.error(error);
    return adminRedirect(req, res, { error: 'Impossible de signaler ce post pour le moment.', fallbackPage: 'moderation' });
  }
};

exports.reportProfile = async (req, res) => {
  try {
    const userId = Number.parseInt(req.body.userId, 10);
    if (!Number.isFinite(userId)) {
      return adminRedirect(req, res, { error: 'Utilisateur invalide.', fallbackPage: 'users' });
    }

    const reason = normalizeModerationReason(req.body.reason, PROFILE_MODERATION_REASONS);
    if (!reason) {
      return adminRedirect(req, res, { error: 'Choisissez une raison valide pour le profil.', fallbackPage: 'users' });
    }

    const targetUser = await User.getById(userId);
    if (!targetUser) {
      return adminRedirect(req, res, { error: 'Utilisateur introuvable.', fallbackPage: 'users' });
    }

    await AdminModerationNotice.createOrUpdateActive({
      adminId: req.session.adminId,
      targetUserId: targetUser.id,
      targetType: 'profile',
      reason,
      details: normalizeModerationDetails(req.body.details)
    });

    return adminRedirect(req, res, {
      success: `Le profil de @${targetUser.username || 'utilisateur'} a ete signale avec succes.`,
      fallbackPage: 'users'
    });
  } catch (error) {
    console.error(error);
    return adminRedirect(req, res, { error: 'Impossible de signaler ce profil pour le moment.', fallbackPage: 'users' });
  }
};

exports.emptyDatabase = async (req, res) => {
  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    
    const tablesToTruncate = [
      'users', 'posts', 'likes', 'bookmarks', 'comments', 
      'reels', 'messages'
    ];
    
    for (const table of tablesToTruncate) {
      await db.query(`TRUNCATE TABLE ${table}`);
    }
    
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    
    adminRedirect(req, res, { success: 'Database emptied successfully', fallbackPage: 'smtp' });
  } catch (error) {
    console.error(error);
    adminRedirect(req, res, { error: 'Failed to empty database', fallbackPage: 'smtp' });
  }
};

exports.addBackground = async (req, res) => {
  try {
    await ensurePostBackgroundSchema();
    let imageUrl = '';
    
    if (req.file) {
      imageUrl = '/assets/uploads/' + req.file.filename;
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl.trim();
    }
    
    if (!imageUrl) {
      return adminRedirect(req, res, { error: 'Please select an image file or paste a URL', fallbackPage: 'backgrounds' });
    }
    
    const isPaid = req.body.isPaid === 'on' || req.body.isPaid === true ? 1 : 0;
    const parsedPrice = parseAmountInput(req.body.price);
    const price = isPaid ? (Number.isNaN(parsedPrice) ? 0.00 : parsedPrice) : 0.00;
    const creatorLookup = String(req.body.creatorUserLookup || '').trim();
    let creatorUserId = null;

    if (creatorLookup) {
      let creatorUser = null;
      if (creatorLookup.includes('@')) {
        creatorUser = await User.getByUsername(normalizeUserLookup(creatorLookup));
      } else if (creatorLookup.includes('.')) {
        creatorUser = await User.getByEmail(creatorLookup.toLowerCase());
        if (!creatorUser) {
          creatorUser = await User.getByUsername(normalizeUserLookup(creatorLookup));
        }
      } else {
        creatorUser = await User.getByUsername(normalizeUserLookup(creatorLookup));
      }

      if (!creatorUser) {
        return adminRedirect(req, res, { error: 'Creator not found. Use a valid username or email', fallbackPage: 'backgrounds' });
      }

      creatorUserId = Number(creatorUser.id);
    }
    
    await db.query(
      'INSERT INTO post_backgrounds (image_url, is_paid, price, creator_user_id) VALUES (?, ?, ?, ?)',
      [imageUrl, isPaid, price, Number.isFinite(creatorUserId) ? creatorUserId : null]
    );
    
    adminRedirect(req, res, { success: 'Background added successfully', fallbackPage: 'backgrounds' });
  } catch (error) {
    console.error(error);
    adminRedirect(req, res, { error: 'Failed to add background', fallbackPage: 'backgrounds' });
  }
};

exports.deleteBackground = async (req, res) => {
  try {
    const { bgId } = req.body;
    await db.query('DELETE FROM post_backgrounds WHERE id = ?', [bgId]);
    adminRedirect(req, res, { success: 'Background deleted successfully', fallbackPage: 'backgrounds' });
  } catch (error) {
    console.error(error);
    adminRedirect(req, res, { error: 'Failed to delete background', fallbackPage: 'backgrounds' });
  }
};

exports.createAdminAccount = async (req, res) => {
  try {
    const creatorAdmin = await Admin.getById(req.session.adminId);
    if (!creatorAdmin || !Admin.canPerformAction(creatorAdmin, 'manage_admins')) {
      return adminRedirect(req, res, { error: 'Vous ne pouvez pas créer d’administrateurs.', fallbackPage: 'admins' });
    }

    const displayName = String(req.body.display_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const isSuperAdmin = req.body.is_super_admin === 'on' || req.body.is_super_admin === '1' || req.body.is_super_admin === true;

    if (!email || !password) {
      return adminRedirect(req, res, { error: 'Email et mot de passe sont obligatoires.', fallbackPage: 'admins' });
    }

    if (password.length < 6) {
      return adminRedirect(req, res, { error: 'Le mot de passe admin doit contenir au moins 6 caractères.', fallbackPage: 'admins' });
    }

    const existingAdmin = await Admin.getByEmail(email);
    if (existingAdmin) {
      return adminRedirect(req, res, { error: 'Un administrateur existe déjà avec cet email.', fallbackPage: 'admins' });
    }

    const permissions = buildAdminPermissionsFromRequest(req.body);
    const passwordHash = await bcrypt.hash(password, 10);

    await Admin.createAdmin({
      displayName,
      email,
      passwordHash,
      isSuperAdmin,
      permissions,
      createdByAdminId: req.session.adminId
    });

    return adminRedirect(req, res, { success: 'Nouvel administrateur créé avec succès.', fallbackPage: 'admins' });
  } catch (error) {
    console.error(error);
    return adminRedirect(req, res, { error: 'Impossible de créer cet administrateur.', fallbackPage: 'admins' });
  }
};

exports.updateAdminAccount = async (req, res) => {
  try {
    const editorAdmin = await Admin.getById(req.session.adminId);
    if (!editorAdmin || !Admin.canPerformAction(editorAdmin, 'manage_admins')) {
      return adminRedirect(req, res, { error: 'Vous ne pouvez pas modifier les administrateurs.', fallbackPage: 'admins' });
    }

    const adminId = Number.parseInt(req.body.admin_id, 10);
    if (!Number.isFinite(adminId)) {
      return adminRedirect(req, res, { error: 'Administrateur introuvable.', fallbackPage: 'admins' });
    }

    const targetAdmin = await Admin.getById(adminId);
    if (!targetAdmin) {
      return adminRedirect(req, res, { error: 'Administrateur introuvable.', fallbackPage: 'admins' });
    }

    const displayName = String(req.body.display_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const isSuperAdmin = req.body.is_super_admin === 'on' || req.body.is_super_admin === '1' || req.body.is_super_admin === true;

    if (!email) {
      return adminRedirect(req, res, { error: 'L’email admin est obligatoire.', fallbackPage: 'admins' });
    }

    const existingAdmin = await Admin.getByEmail(email);
    if (existingAdmin && Number(existingAdmin.id) !== adminId) {
      return adminRedirect(req, res, { error: 'Cet email est déjà utilisé par un autre administrateur.', fallbackPage: 'admins' });
    }

    if (Number(targetAdmin.id) === Number(req.session.adminId) && Number(targetAdmin.is_super_admin || 0) === 1 && !isSuperAdmin) {
      return adminRedirect(req, res, { error: 'Le super admin connecté ne peut pas retirer son propre statut super admin.', fallbackPage: 'admins' });
    }

    const permissions = buildAdminPermissionsFromRequest(req.body);
    const passwordHash = password
      ? await bcrypt.hash(password, 10)
      : null;

    await Admin.updateAdminProfile(adminId, {
      displayName,
      email,
      passwordHash,
      isSuperAdmin,
      permissions
    });

    return adminRedirect(req, res, { success: 'Administrateur mis à jour avec succès.', fallbackPage: 'admins' });
  } catch (error) {
    console.error(error);
    return adminRedirect(req, res, { error: 'Impossible de mettre à jour cet administrateur.', fallbackPage: 'admins' });
  }
};

exports.decryptReceipt = async (req, res) => {
  try {
    const { encryptedCode } = req.body;
    if (!encryptedCode || typeof encryptedCode !== 'string') {
      return res.status(400).json({ success: false, message: 'Code chiffré manquant ou invalide.' });
    }

    const decrypted = receiptCrypto.decrypt(encryptedCode.trim());
    if (!decrypted) {
      return res.status(400).json({ success: false, message: 'Impossible de décrypter ce code. Clé invalide ou données altérées.' });
    }

    let payload;
    try {
      payload = JSON.parse(decrypted);
    } catch (parseErr) {
      return res.status(400).json({ success: false, message: 'Le code décrypté ne contient pas un format JSON valide.' });
    }

    const { id, type, user_id, amount, date, tx_hash } = payload;
    if (!id || !type || !user_id) {
      return res.status(400).json({ success: false, message: 'Format de reçu décrypté incomplet.' });
    }

    let dbRecord = null;

    if (type === 'deposit') {
      const [rows] = await db.query(
        `SELECT d.*, u.username, u.email, CONCAT(u.first_name, ' ', u.last_name) AS user_name 
         FROM bsc_deposits d 
         LEFT JOIN users u ON u.id = d.user_id 
         WHERE d.id = ?`,
        [id]
      );
      if (rows.length > 0) {
        dbRecord = rows[0];
      }
    } else if (type === 'withdrawal') {
      const [rows] = await db.query(
        `SELECT w.*, u.username, u.email, CONCAT(u.first_name, ' ', u.last_name) AS user_name 
         FROM bsc_withdrawals w 
         LEFT JOIN users u ON u.id = w.user_id 
         WHERE w.id = ?`,
        [id]
      );
      if (rows.length > 0) {
        dbRecord = rows[0];
      }
    } else {
      return res.status(400).json({ success: false, message: `Type de transaction inconnu : ${type}` });
    }

    if (!dbRecord) {
      return res.json({
        success: true,
        authentic: false,
        decryptedPayload: payload,
        message: "Alerte : Le code est décrypté avec succès, mais aucune transaction correspondante n'a été trouvée en base de données. (Suspicion de fraude)"
      });
    }

    const amountMatches = Math.abs(parseFloat(dbRecord.amount_usdt) - parseFloat(amount)) < 0.0001;
    const userIdMatches = Number(dbRecord.user_id) === Number(user_id);
    const txHashMatches = !dbRecord.tx_hash || !tx_hash || String(dbRecord.tx_hash).toLowerCase().trim() === String(tx_hash).toLowerCase().trim();

    const authentic = amountMatches && userIdMatches && txHashMatches;

    return res.json({
      success: true,
      authentic,
      decryptedPayload: payload,
      dbRecord: {
        id: dbRecord.id,
        type: type,
        user_id: dbRecord.user_id,
        username: dbRecord.username || 'Inconnu',
        user_name: dbRecord.user_name || 'Utilisateur',
        email: dbRecord.email || 'Inconnu',
        amount_usdt: dbRecord.amount_usdt,
        fee_usdt: dbRecord.fee_usdt || 0.0,
        net_amount_usdt: dbRecord.net_amount_usdt || dbRecord.amount_usdt,
        gas_cost_usdt: dbRecord.gas_cost_usdt || 0.0,
        status: dbRecord.status,
        tx_hash: dbRecord.tx_hash,
        created_at: dbRecord.created_at,
        recipient_address: dbRecord.recipient_address || null,
        from_address: dbRecord.from_address || null
      },
      verificationDetails: {
        amountMatches,
        userIdMatches,
        txHashMatches
      },
      message: authentic 
        ? "Succès : Transaction authentique et vérifiée par rapport à la base de données !" 
        : "Alerte : Les données décryptées ne correspondent pas aux enregistrements de la base de données ! (Suspicion de fraude)"
    });

  } catch (err) {
    console.error('[AdminController] Error decrypting receipt:', err);
    return res.status(500).json({ success: false, message: 'Erreur interne du serveur lors du décryptage.' });
  }
};

exports.resolveAccountDispute = async (req, res) => {
  try {
    const disputeId = Number.parseInt(req.body.dispute_id, 10);
    const action = String(req.body.action || '').toLowerCase(); // 'approve' or 'reject'
    
    const [disputeRows] = await db.query('SELECT * FROM disputes WHERE id = ? LIMIT 1', [disputeId]);
    const dispute = disputeRows[0];
    if (!dispute) {
      return adminRedirect(req, res, { error: 'Litige introuvable.', fallbackPage: 'disputes' });
    }

    if (action === 'approve') {
      // Approve dispute: unlock user account, clear allow_dispute, resolve dispute
      await User.updateStatus(dispute.user_id, 'Active');
      await db.query('UPDATE users SET allow_dispute = 0 WHERE id = ?', [dispute.user_id]);
      await db.query('UPDATE disputes SET status = "resolved" WHERE id = ?', [disputeId]);
      return adminRedirect(req, res, { success: 'Compte débloqué et litige résolu.', fallbackPage: 'disputes' });
    } else if (action === 'reverify') {
      // Reverify: unlock account (status Active), set kyc requests to draft and clear details, clear allow_dispute, resolve dispute
      await User.updateStatus(dispute.user_id, 'Active');
      await db.query('UPDATE users SET allow_dispute = 0 WHERE id = ?', [dispute.user_id]);
      await db.query(
        `UPDATE kyc_requests 
         SET status = 'draft', 
             document_url = NULL, document_name = NULL, document_type = NULL, document_size = NULL, 
             selfie_url = NULL, selfie_name = NULL, selfie_type = NULL, selfie_size = NULL, 
             verification_score = NULL, face_match_score = NULL, verification_notes = NULL, 
             ocr_text_excerpt = NULL, ocr_detected_dates = NULL, ocr_selected_dob = NULL, ocr_selected_dob_reason = NULL,
             verified_by_ai = 0
         WHERE user_id = ?`,
        [dispute.user_id]
      );
      await db.query('UPDATE disputes SET status = "resolved" WHERE id = ?', [disputeId]);
      return adminRedirect(req, res, { success: 'Litige résolu. Accès accordé pour revérifier le KYC et compte débloqué.', fallbackPage: 'disputes' });
    } else {
      // Reject dispute: keep user status as Blocked, clear allow_dispute, resolve dispute
      await User.updateStatus(dispute.user_id, 'Blocked');
      await db.query('UPDATE users SET allow_dispute = 0 WHERE id = ?', [dispute.user_id]);
      await db.query('UPDATE disputes SET status = "resolved" WHERE id = ?', [disputeId]);
      return adminRedirect(req, res, { success: 'Litige rejeté. Le compte reste bloqué.', fallbackPage: 'disputes' });
    }
  } catch (error) {
    console.error('[resolveAccountDispute] Error:', error);
    adminRedirect(req, res, { error: 'Erreur lors de la résolution du litige.', fallbackPage: 'disputes' });
  }
};

exports.resolveP2PDispute = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const orderId = Number.parseInt(req.body.order_id, 10);
    const action = String(req.body.action || '').toLowerCase(); // 'release' or 'refund'

    if (action === 'release') {
      const result = await P2PMarket.resolveDisputeRelease(orderId, connection);
      await connection.commit();
      
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${result.buyerUserId}`).emit('p2p-order-updated', { orderId, status: 'released' });
        io.to(`user:${result.sellerUserId}`).emit('p2p-order-updated', { orderId, status: 'released' });
      }

      return adminRedirect(req, res, { success: 'Fonds libérés à l\'acheteur avec succès.', fallbackPage: 'disputes' });
    } else if (action === 'refund') {
      const result = await P2PMarket.resolveDisputeRefund(orderId, connection);
      await connection.commit();

      const io = req.app.get('io');
      if (io) {
        io.to(`user:${result.buyerUserId}`).emit('p2p-order-updated', { orderId, status: 'cancelled' });
        io.to(`user:${result.sellerUserId}`).emit('p2p-order-updated', { orderId, status: 'cancelled' });
      }

      return adminRedirect(req, res, { success: 'Fonds remboursés au vendeur avec succès.', fallbackPage: 'disputes' });
    } else {
      await connection.rollback();
      return adminRedirect(req, res, { error: 'Action invalide.', fallbackPage: 'disputes' });
    }
  } catch (error) {
    await connection.rollback();
    console.error('[resolveP2PDispute] Error:', error);
    adminRedirect(req, res, { error: `Erreur: ${error.message}`, fallbackPage: 'disputes' });
  } finally {
    connection.release();
  }
};

exports.changeOwnPassword = async (req, res) => {
  try {
    const adminId = req.session.adminId;
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ success: false, message: 'Veuillez remplir tous les champs de mot de passe.' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ success: false, message: 'Le nouveau mot de passe et sa confirmation ne correspondent pas.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ success: false, message: 'Le nouveau mot de passe doit faire au moins 6 caractères.' });
    }

    const admin = await Admin.getById(adminId);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Administrateur introuvable.' });
    }

    // Valider le mot de passe actuel
    const isMatch = await bcrypt.compare(current_password, admin.password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Le mot de passe actuel est incorrect.' });
    }

    // Mettre à jour avec le nouveau mot de passe haché
    const newPasswordHash = await bcrypt.hash(new_password, 10);
    await Admin.updateAdminProfile(adminId, {
      passwordHash: newPasswordHash
    });

    return res.json({ success: true, message: 'Votre mot de passe a été modifié avec succès.' });
  } catch (error) {
    console.error('Error changing own admin password:', error);
    return res.status(500).json({ success: false, message: 'Une erreur interne est survenue.' });
  }
};

exports.dismissReport = async (req, res) => {
  try {
    const reportId = Number.parseInt(req.body.reportId, 10);
    if (!Number.isFinite(reportId)) {
      return res.status(400).json({ success: false, message: 'Report ID invalide.' });
    }
    await PostReport.updateStatus(reportId, 'dismissed');
    await ActivityLog.log(req.session.adminId, 'admin', 'dismiss_report', 'report', reportId, null, req);
    return res.json({ success: true, message: 'Signalement ignoré.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

exports.deleteReportedPost = async (req, res) => {
  try {
    const postId = Number.parseInt(req.body.postId, 10);
    if (!Number.isFinite(postId)) {
      return res.status(400).json({ success: false, message: 'Post ID invalide.' });
    }
    await Post.deleteByAdmin(postId);
    await PostReport.updateStatusByPost(postId, 'actioned');
    await ActivityLog.log(req.session.adminId, 'admin', 'delete_reported_post', 'post', postId, null, req);
    return res.json({ success: true, message: 'Publication supprimée.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

exports.blockReportedUser = async (req, res) => {
  try {
    const userId = Number.parseInt(req.body.userId, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ success: false, message: 'Utilisateur ID invalide.' });
    }
    await User.updateStatus(userId, 'Blocked');
    await PostReport.updateStatusByUser(userId, 'actioned');
    await ActivityLog.log(req.session.adminId, 'admin', 'block_reported_user', 'user', userId, null, req);
    return res.json({ success: true, message: 'Utilisateur bloqué.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

exports.sendAdminMessage = async (req, res) => {
  try {
    const { target_type, target_user_id, message_text } = req.body;
    if (!message_text || message_text.trim() === '') {
      return res.status(400).json({ success: false, error: 'Le message ne peut pas être vide.' });
    }

    const io = req.app.get('io');
    const cleanMessage = String(message_text).slice(0, 255);
    const adminActorId = req.session.adminId || req.session.userId || null;

    if (target_type === 'all') {
      const allUsers = await User.getAll();
      for (const user of allUsers) {
        try {
          const notificationId = await Notification.create({
            recipientId: user.id,
            actorId: null, // System notification
            type: 'message',
            message: cleanMessage
          });
          const unreadCount = await Notification.getUnreadCount(user.id);
          
          io.to(`user:${user.id}`).emit('notification-created', {
            id: notificationId,
            recipient_id: user.id,
            actor_id: null,
            type: 'message',
            message: cleanMessage,
            post_id: null,
            share_id: null,
            comment_id: null,
            is_read: 0,
            read_at: null,
            created_at: new Date().toISOString(),
            actor_name: 'Administration',
            actor_username: 'admin',
            actor_avatar: '/assets/trasx-logo-mark.png'
          });
          io.to(`user:${user.id}`).emit('notification-count-updated', { unreadCount });
        } catch (err) {
          console.error(`Failed to send broadcast notification to user ${user.id}:`, err);
        }
      }
      
      await ActivityLog.log(adminActorId, 'admin', 'broadcast_notification', 'all_users', null, { message: cleanMessage }, req);
      res.json({ success: true, message: 'Message diffusé avec succès à tous les utilisateurs.' });
    } else {
      if (!target_user_id) {
        return res.status(400).json({ success: false, error: 'Veuillez sélectionner un utilisateur.' });
      }
      const user = await User.getById(target_user_id);
      if (!user) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
      }

      const notificationId = await Notification.create({
        recipientId: user.id,
        actorId: null,
        type: 'message',
        message: cleanMessage
      });
      const unreadCount = await Notification.getUnreadCount(user.id);

      io.to(`user:${user.id}`).emit('notification-created', {
        id: notificationId,
        recipient_id: user.id,
        actor_id: null,
        type: 'message',
        message: cleanMessage,
        post_id: null,
        share_id: null,
        comment_id: null,
        is_read: 0,
        read_at: null,
        created_at: new Date().toISOString(),
        actor_name: 'Administration',
        actor_username: 'admin',
        actor_avatar: '/assets/trasx-logo-mark.png'
      });
      io.to(`user:${user.id}`).emit('notification-count-updated', { unreadCount });

      await ActivityLog.log(adminActorId, 'admin', 'direct_notification', 'user', user.id, { message: cleanMessage }, req);
      res.json({ success: true, message: `Message envoyé avec succès à ${user.username || user.email || target_user_id}.` });
    }
  } catch (error) {
    console.error('Error sending admin message:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur lors de l’envoi du message.' });
  }
};

exports.ADMIN_PAGE_PATHS = ADMIN_PAGE_PATHS;
exports.ADMIN_PAGE_META = ADMIN_PAGE_META;
