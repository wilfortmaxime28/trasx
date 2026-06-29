const fs = require('fs/promises');
const http = require('http');
const https = require('https');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { getSetting } = require('../utils/appSettings');
const User = require('../models/User');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Status = require('../models/Status');

const OFFICIAL_SEED_ACCOUNT_TYPE = 'official_seed';
const OFFICIAL_SEED_SOURCE = 'official_seed';
const OFFICIAL_SEED_ACCOUNT_BATCH_SIZE = 100;
const OFFICIAL_SEED_CONTENT_BATCH_SIZE = 100;
const OFFICIAL_SEED_PEXELS_API_BASE = 'https://api.pexels.com/v1';
const OFFICIAL_SEED_REMOTE_TIMEOUT_MS = 25000;
const OFFICIAL_SEED_REMOTE_MAX_REDIRECTS = 4;
const OFFICIAL_SEED_REMOTE_MIN_POOL = 12;
const OFFICIAL_SEED_REMOTE_MAX_POOL = 100;
const OFFICIAL_SEED_REMOTE_DOWNLOAD_LIMITS = {
  image: 12 * 1024 * 1024,
  video: 40 * 1024 * 1024
};
const OFFICIAL_SEED_SHORT_AUDIO_DURATION = 24;
const OFFICIAL_SEED_HTTP_HEADERS = {
  'User-Agent': 'TRASX Official Seed Bot/1.0',
  'Accept': '*/*'
};

const PUBLIC_ROOT = path.join(__dirname, '../public');
const OFFICIAL_SEED_FALLBACK_AUDIO_UPLOAD_DIR = path.join(PUBLIC_ROOT, 'uploads/reels');
const OFFICIAL_SEED_LIBRARY_ROOT = path.join(PUBLIC_ROOT, 'assets/official-seed-media');
const OFFICIAL_SEED_UPLOAD_ROOT = path.join(PUBLIC_ROOT, 'uploads/official-seed');
const OFFICIAL_SEED_AVATAR_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'avatars');
const OFFICIAL_SEED_POST_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'posts');
const OFFICIAL_SEED_REEL_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'reels');
const OFFICIAL_SEED_STATUS_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'statuses');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.ogg']);

const OFFICIAL_SEED_FIRST_NAMES = [
  'Amina', 'Nadia', 'Yara', 'Safiya', 'Mariam', 'Aya', 'Leila', 'Fatou', 'Ndeye', 'Imane',
  'Sofia', 'Emma', 'Chloe', 'Jade', 'Camille', 'Lina', 'Elena', 'Mila', 'Clara', 'Louise',
  'Maya', 'Nina', 'Eva', 'Rose', 'Alicia', 'Iris', 'Nora', 'Yasmine', 'Kiara', 'Selena',
  'Naomi', 'Ines', 'Mia', 'Sara', 'Talia', 'Rania', 'Samira', 'Mina', 'Laila', 'Ariane',
  'Noah', 'Lucas', 'Ethan', 'Gabriel', 'Nathan', 'Julien', 'Matteo', 'Daniel', 'Samuel', 'David',
  'Hugo', 'Leo', 'Adam', 'Louis', 'Raphael', 'Theo', 'Victor', 'Amos', 'Kenzo', 'Rayan',
  'Yanis', 'Mathis', 'Arthur', 'Bastien', 'Marius', 'Alexis', 'Andre', 'Karim', 'Amadou', 'Idriss',
  'Koffi', 'Junior', 'Malik', 'Nabil', 'Mehdi', 'Ariel', 'Sami', 'Anis', 'Hassan', 'Ilyas'
];

const OFFICIAL_SEED_LAST_NAMES = [
  'Diallo', 'Ndiaye', 'Mensah', 'Mbaye', 'Traore', 'Sow', 'Diop', 'Kone', 'Keita', 'Ouattara',
  'Joseph', 'Pierre', 'Toussaint', 'Baptiste', 'Charles', 'Desir', 'Jean', 'Laurent', 'Morel', 'Bernard',
  'Dubois', 'Martin', 'Garcia', 'Thomas', 'Petit', 'Mercier', 'Roux', 'Simon', 'Fontaine', 'Durand',
  'Morin', 'Lopez', 'Michel', 'Renaud', 'Henry', 'Leroy', 'Marchand', 'Robin', 'Masson', 'Navarro',
  'Tanaka', 'Sato', 'Nakamura', 'Patel', 'Sharma', 'Khan', 'Rahman', 'Benali', 'Haddad', 'Farah'
];

const OFFICIAL_SEED_USERNAME_SUFFIXES = [
  'studio', 'daily', 'media', 'focus', 'vibes', 'inside', 'stories', 'journal', 'creative', 'network',
  'social', 'people', 'circle', 'vision', 'online', 'signals', 'express', 'direct', 'central', 'official'
];

const PROFILE_THEMES = [
  {
    label: 'Culture',
    country: 'Senegal',
    region: 'West Africa',
    tag: '#CultureTRASX',
    cultureTag: '#AfriqueCreative',
    avatarKeywords: 'west african creator portrait',
    photoKeywords: 'west african culture art people community',
    videoKeywords: 'west african culture dance street people',
    bioHeadline: 'culture africaine et scenes creatives ouvertes sur le monde',
    feedAngles: [
      'Les scenes culturelles africaines apportent de la couleur, de la memoire et beaucoup d energie.',
      'Quand heritage visuel et creation moderne se rencontrent, le contenu gagne tout de suite en relief.',
      'Montrer des references culturelles fortes aide le feed a garder une vraie personnalite.'
    ],
    shortAngles: [
      'Ambiance culturelle vive, details nets et mouvement naturel dans le cadre.',
      'Une capsule qui fait circuler l energie du terrain sans perdre l elegance visuelle.',
      'Quelques secondes suffisent pour montrer une scene qui a du caractere.'
    ],
    statusAngles: [
      'Instant culture partage depuis une scene africaine qui inspire.',
      'Petit signal visuel depuis une ambiance ouverte, vivante et chaleureuse.',
      'Pause rapide autour d une scene culturelle qui attire vraiment l oeil.'
    ]
  },
  {
    label: 'Sport',
    country: 'Brazil',
    region: 'Latin America',
    tag: '#SportTRASX',
    cultureTag: '#PulseLatine',
    avatarKeywords: 'latin athlete portrait outdoors',
    photoKeywords: 'latin america sport training people stadium',
    videoKeywords: 'latin america football training running people',
    bioHeadline: 'sport, discipline et mouvements qui parlent a plusieurs cultures',
    feedAngles: [
      'Le sport raconte bien la rigueur, la repetition et l envie de progresser ensemble.',
      'Les contenus sportifs tiennent mieux quand ils montrent le rythme et l effort reel.',
      'Une bonne scene de sport garde toujours quelque chose de collectif et direct.'
    ],
    shortAngles: [
      'Rythme rapide, geste net et energie immediate.',
      'Un format court qui donne tout de suite une sensation de mouvement propre.',
      'Un passage sportif simple, intense et facile a retenir.'
    ],
    statusAngles: [
      'Petit passage sport pour garder le tempo sur TRASX.',
      'Mise a jour rapide autour d une scene active et motivee.',
      'Un moment sportif propre et direct avant la suite du flux.'
    ]
  },
  {
    label: 'Music',
    country: 'Nigeria',
    region: 'West Africa',
    tag: '#MusicTRASX',
    cultureTag: '#AfroPulse',
    avatarKeywords: 'african music artist portrait',
    photoKeywords: 'african music studio artist lifestyle',
    videoKeywords: 'afrobeats music studio performance people',
    bioHeadline: 'musique, vibration et creation connectee entre Afrique et autres scenes',
    feedAngles: [
      'La musique garde le feed vivant quand l image et le rythme avancent ensemble.',
      'Les scenes afro et globales donnent une identite forte a des contenus tres courts.',
      'Un bon angle musical fait exister une ambiance avant meme la premiere phrase.'
    ],
    shortAngles: [
      'Beat visuel, cadence propre et ambiance directe.',
      'Une coupe courte pour faire monter l energie sans forcer la narration.',
      'Le bon rythme suffit parfois a porter tout le short.'
    ],
    statusAngles: [
      'Signal musique du moment avec une ambiance chaude et propre.',
      'Instant rapide autour d une vibration qui donne envie de rester.',
      'Mini capsule audio visuelle pour garder la presence vivante.'
    ]
  },
  {
    label: 'Tech',
    country: 'India',
    region: 'South Asia',
    tag: '#TechTRASX',
    cultureTag: '#FutureMakers',
    avatarKeywords: 'south asian tech creator portrait',
    photoKeywords: 'south asian technology startup creator laptop',
    videoKeywords: 'south asian technology startup office creator',
    bioHeadline: 'tech utile, execution rapide et creation pensee pour des usages reels',
    feedAngles: [
      'La technologie la plus convaincante reste celle qui simplifie vraiment les usages.',
      'Un contenu tech propre montre a la fois l idee, le contexte et l humain derriere.',
      'Le bon signal tech melange precision, calme et clartes visuelles.'
    ],
    shortAngles: [
      'Plan court, interface nette, execution sans bruit.',
      'Un short tech efficace montre juste ce qu il faut pour donner envie de voir plus.',
      'Des gestes simples, une idee claire et un rythme qui reste lisible.'
    ],
    statusAngles: [
      'Point rapide depuis une scene tech qui reste claire et utile.',
      'Petit passage produit, outils et gestes concrets.',
      'Mise a jour courte depuis un univers tech propre et fluide.'
    ]
  },
  {
    label: 'Lifestyle',
    country: 'France',
    region: 'Europe',
    tag: '#LifestyleTRASX',
    cultureTag: '#CityRhythm',
    avatarKeywords: 'european lifestyle creator portrait',
    photoKeywords: 'europe lifestyle city people fashion editorial',
    videoKeywords: 'europe lifestyle city walk fashion people',
    bioHeadline: 'lifestyle, design du quotidien et details qui rendent une page plus chic',
    feedAngles: [
      'Le lifestyle fonctionne mieux quand il reste simple, propre et sincere.',
      'Des details bien cadres suffisent souvent a installer une atmosphere complete.',
      'Le quotidien devient plus fort visuellement quand il garde une ligne claire.'
    ],
    shortAngles: [
      'Petit moment lifestyle, propre, mobile et facile a suivre.',
      'Une coupe douce qui laisse la scene respirer et rester elegante.',
      'Format vertical, ambiance visuelle legere et finitions soignees.'
    ],
    statusAngles: [
      'Pause lifestyle depuis une scene claire et bien cadree.',
      'Instant du quotidien qui garde une touche nette et inspiree.',
      'Petit passage visuel pour rendre le flux plus doux et plus chic.'
    ]
  },
  {
    label: 'Gaming',
    country: 'Japan',
    region: 'East Asia',
    tag: '#GamingTRASX',
    cultureTag: '#PlayCulture',
    avatarKeywords: 'east asian gamer portrait setup',
    photoKeywords: 'east asia gaming setup player neon',
    videoKeywords: 'gaming setup player neon reaction movement',
    bioHeadline: 'gaming, precision, reflexes et univers qui accrochent tout de suite',
    feedAngles: [
      'Le gaming vit mieux quand on voit a la fois la tension et la maitrise du moment.',
      'Les contenus de jeu gagnent quand le cadre reste lisible et nerveux a la fois.',
      'Une vraie scene gaming donne du rythme sans saturer l ecran.'
    ],
    shortAngles: [
      'Un short nerveux, propre et tres lisible.',
      'Reaction rapide, decor fort et sensation de timing reussi.',
      'Quelques secondes suffisent pour transmettre un vrai moment de jeu.'
    ],
    statusAngles: [
      'Petit signal gaming pour garder le flux bien reveille.',
      'Instant rapide depuis un setup qui attire tout de suite le regard.',
      'Pause courte, cadre net et ambiance de jeu assumee.'
    ]
  },
  {
    label: 'Humour',
    country: 'Haiti',
    region: 'Caribbean',
    tag: '#HumourTRASX',
    cultureTag: '#SmileCaribbean',
    avatarKeywords: 'caribbean smiling portrait creator',
    photoKeywords: 'caribbean friends laughter lifestyle people',
    videoKeywords: 'caribbean friends laughing street lifestyle',
    bioHeadline: 'humour, chaleur humaine et contenus qui respirent sans forcer',
    feedAngles: [
      'Un peu d humour bien dose garde la page plus humaine et plus memorable.',
      'Le contenu leger marche mieux quand il reste naturel et bien observe.',
      'Une scene simple et souriante peut tenir le regard plus longtemps qu un long texte.'
    ],
    shortAngles: [
      'Petit moment leger, rythme propre et sourire immediat.',
      'Une coupe courte qui garde l humour simple et visuel.',
      'Le bon format pour un instant fun sans surcharge.'
    ],
    statusAngles: [
      'Pause legere venue d une scene souriante et vivante.',
      'Petit moment de respiration dans le flux officiel.',
      'Mise a jour courte pour garder le feed plus chaleureux.'
    ]
  },
  {
    label: 'Newsroom',
    country: 'Canada',
    region: 'North America',
    tag: '#InsideTRASX',
    cultureTag: '#InsideVoices',
    avatarKeywords: 'north american newsroom portrait professional',
    photoKeywords: 'north america newsroom office team professional',
    videoKeywords: 'newsroom office team meeting professional',
    bioHeadline: 'coulisses, coordination et informations propres sur la vie de la plateforme',
    feedAngles: [
      'Les coulisses racontent mieux une plateforme quand elles restent claires et ouvertes.',
      'Montrer les details internes avec sobriete renforce la confiance dans le produit.',
      'Une newsroom moderne doit rester lisible, calme et transparente.'
    ],
    shortAngles: [
      'Short interne, message direct et execution propre.',
      'Quelques secondes pour montrer une dynamique d equipe claire.',
      'Un format court pour garder la relation produit communaute bien vivante.'
    ],
    statusAngles: [
      'Point rapide depuis les coulisses de TRASX.',
      'Signal court autour du travail d equipe et des evolutions internes.',
      'Petit passage newsroom pour garder la plateforme proche de sa communaute.'
    ]
  },
  {
    label: 'Motion',
    country: 'South Africa',
    region: 'Southern Africa',
    tag: '#MotionTRASX',
    cultureTag: '#MoveWithStyle',
    avatarKeywords: 'south african dancer portrait creator',
    photoKeywords: 'south africa dance motion creator people',
    videoKeywords: 'south africa dance movement performance people',
    bioHeadline: 'mouvement, choregraphie visuelle et scenes qui tiennent le regard',
    feedAngles: [
      'Le mouvement garde un contenu vivant quand la lecture visuelle reste propre.',
      'Une bonne scene dynamique fait circuler l energie sans perdre la clarte.',
      'Les contenus en mouvement gagnent tout de suite quand la composition reste nette.'
    ],
    shortAngles: [
      'Mouvement franc, details visibles et energie continue.',
      'Un plan vertical pense pour donner du souffle a la scene.',
      'Le bon dosage entre vitesse, lisibilite et style.'
    ],
    statusAngles: [
      'Capsule rapide autour d une scene qui bouge avec style.',
      'Petit moment dynamique pour donner du relief au flux.',
      'Un passage court ou le mouvement suffit a raconter la scene.'
    ]
  },
  {
    label: 'Studio',
    country: 'Morocco',
    region: 'North Africa',
    tag: '#StudioTRASX',
    cultureTag: '#StudioNomad',
    avatarKeywords: 'north african creative portrait studio',
    photoKeywords: 'north africa creative studio people design',
    videoKeywords: 'north africa creative studio process people',
    bioHeadline: 'studio creatif, execution propre et regards melanges entre Afrique et autres horizons',
    feedAngles: [
      'Les contenus studio tiennent mieux quand ils montrent la matiere, le geste et la patience.',
      'Un cadre creatif solide donne une vraie profondeur meme a une publication tres simple.',
      'Le travail de fond cree souvent les posts les plus durables dans le feed.'
    ],
    shortAngles: [
      'Petit extrait de creation, cadence souple et details propres.',
      'Un short studio pour montrer le geste sans surjouer la scene.',
      'Processus, texture et rythme dans un format rapide.'
    ],
    statusAngles: [
      'Instant studio pour garder une presence visuelle soignee.',
      'Petit signal creatif depuis une scene de travail propre et calme.',
      'Mise a jour courte pour montrer le process sans casser le rythme.'
    ]
  }
];

const FEED_OPENERS = [
  'Petit signal positif du moment',
  'Le feed TRASX repart avec une note propre et vivante',
  'Une publication claire pour remettre du rythme dans la page',
  'On garde le tempo avec un contenu simple mais bien pense',
  'Une touche visuelle pour relancer la conversation',
  'Un passage rapide pour garder le flux actif et elegant'
];

const SHORTS_HOOKS = [
  'Format court, energie directe.',
  'Quelques secondes pour installer une ambiance nette.',
  'Un short simple pour garder le flux vivant.',
  'Contenu vertical, rythme rapide, message clair.',
  'Le bon format pour une attention immediate.',
  'Un passage court pour capter l oeil sans ralentir le flux.'
];

const STATUS_HOOKS = [
  'Mise a jour officielle TRASX.',
  'Instant rapide depuis les comptes officiels.',
  'Signal court pour garder la presence active.',
  'Petit passage dans les status de la plateforme.',
  'Une capsule visuelle pour garder le lien actif.'
];

const FEED_CLOSERS = [
  'On melange les references africaines et globales pour garder un affichage plus riche.',
  'Le but reste simple: varier les regards, les rythmes et les cultures dans le meme flux.',
  'Le feed gagne quand plusieurs scenes du monde se rencontrent sans se ressembler.',
  'Plus le melange est naturel, plus le contenu parait vivant.'
];

const SHORTS_CLOSERS = [
  'Le mix des cultures garde le scroll plus vivant.',
  'Afrique, Caraibes, Asie, Europe et Ameriques doivent se croiser naturellement ici.',
  'Un short plus fort commence souvent par un vrai melange d ambiances.',
  'Le flux vertical reste plus riche quand les scenes changent vraiment.'
];

const STATUS_CLOSERS = [
  'Toujours avec un melange de references africaines et globales.',
  'Pour garder la plateforme ouverte a plusieurs scenes du monde.',
  'Le but est de faire respirer le flux avec des regards melanges.',
  'On garde le signal court, mais jamais uniforme.'
];

let mediaLibraryCache = {
  expiresAt: 0,
  value: null
};

let officialSeedSettingsCache = {
  expiresAt: 0,
  value: null
};

function invalidateOfficialSeedCaches() {
  mediaLibraryCache = {
    expiresAt: 0,
    value: null
  };
  officialSeedSettingsCache = {
    expiresAt: 0,
    value: null
  };
}

async function getOfficialSeedSettings() {
  if (officialSeedSettingsCache.value && officialSeedSettingsCache.expiresAt > Date.now()) {
    return officialSeedSettingsCache.value;
  }

  const apiKey = String(
    await getSetting(
      'official_seed_pexels_api_key',
      process.env.PEXELS_API_KEY
        || process.env.PIXELS_API_KEY
        || process.env.TRASX_PEXELS_API_KEY
        || ''
    )
  ).trim();

  const value = {
    pexelsApiKey: apiKey
  };

  officialSeedSettingsCache = {
    value,
    expiresAt: Date.now() + 15000
  };

  return value;
}

function maskOfficialSeedApiKey(apiKey) {
  const normalized = String(apiKey || '').trim();
  if (!normalized) return '';
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}****`;
  return `${normalized.slice(0, 4)}••••••${normalized.slice(-4)}`;
}

async function getOfficialSeedPexelsApiKey() {
  const settings = await getOfficialSeedSettings();
  return String(settings?.pexelsApiKey || '').trim();
}

async function hasOfficialSeedRemoteMediaProvider() {
  return Boolean(await getOfficialSeedPexelsApiKey());
}

async function ensureColumn(connection, tableName, columnName, definitionSql) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
  if (rows.length > 0) return;
  await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definitionSql}`);
}

async function ensureIndex(connection, tableName, indexName, columnsSql) {
  const [rows] = await connection.query(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [tableName, indexName]
  );
  if (rows.length > 0) return;
  await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` ${columnsSql}`);
}

async function ensureUniqueIndex(connection, tableName, indexName, columnsSql) {
  const [rows] = await connection.query(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [tableName, indexName]
  );
  if (rows.length > 0) return;
  await connection.query(`ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` ${columnsSql}`);
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function guessMimeType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.ogg') return 'video/ogg';
  return 'application/octet-stream';
}

function guessExtensionFromMimeType(mimeType, fallback = '.bin') {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (normalized === 'image/jpeg') return '.jpg';
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'video/mp4') return '.mp4';
  if (normalized === 'video/webm') return '.webm';
  if (normalized === 'video/ogg') return '.ogg';
  if (normalized === 'video/quicktime') return '.mov';
  return fallback;
}

function slugifyText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
}

function slugifyLettersOnly(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function getOfficialSeedPoolSize(targetCount) {
  return Math.min(
    OFFICIAL_SEED_REMOTE_MAX_POOL,
    Math.max(OFFICIAL_SEED_REMOTE_MIN_POOL, Math.ceil(Number(targetCount) || 0))
  );
}

function rotateList(items, offset = 0) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (list.length <= 1) return list;
  const normalizedOffset = ((Number(offset) || 0) % list.length + list.length) % list.length;
  return list.slice(normalizedOffset).concat(list.slice(0, normalizedOffset));
}

function buildSeedHash(...parts) {
  const input = parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => String(part ?? ''))
    .join('|');

  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickSeededOption(options, ...seedParts) {
  const list = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!list.length) return '';
  return list[buildSeedHash(...seedParts) % list.length];
}

function shuffleListBySeed(items, ...seedParts) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (list.length <= 1) return list;

  return list
    .map((item, index) => ({
      item,
      rank: buildSeedHash(
        ...seedParts,
        index,
        item?.id,
        item?.slotNumber,
        item?.seed_slot,
        item?.username,
        item?.publicUrl,
        item?.remoteUrl,
        item?.audio_url
      )
    }))
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.item);
}

function buildLocalSummaryText(count, label) {
  const total = Number(count) || 0;
  return `${total} media · ${label}`;
}

function getThemeProfileForSlot(slotNumber = 1) {
  const safeSlot = Math.max(1, Number(slotNumber) || 1);
  return PROFILE_THEMES[(safeSlot - 1) % PROFILE_THEMES.length];
}

function getThemeProfileByLabel(themeLabel = 'Studio') {
  const normalized = String(themeLabel || 'Studio').trim().toLowerCase();
  return PROFILE_THEMES.find((theme) => String(theme.label || '').trim().toLowerCase() === normalized) || null;
}

function resolveThemeProfile(user = {}) {
  return getThemeProfileByLabel(user?.theme_label)
    || getThemeProfileForSlot(Number(user?.slotNumber || user?.seed_slot || 1));
}

function isAfricanTheme(theme = {}) {
  const region = String(theme?.region || '').toLowerCase();
  const country = String(theme?.country || '').toLowerCase();
  return region.includes('africa') || ['senegal', 'nigeria'].includes(country);
}

function pickMixedCultureTheme(theme = {}, slotIndex = 0, batchSeed = 0, kind = 'feed') {
  const oppositeCultureThemes = PROFILE_THEMES.filter((candidate) => (
    candidate
    && candidate.label !== theme.label
    && isAfricanTheme(candidate) !== isAfricanTheme(theme)
  ));
  const fallbackThemes = PROFILE_THEMES.filter((candidate) => candidate && candidate.label !== theme.label);
  return pickSeededOption(
    oppositeCultureThemes.length ? oppositeCultureThemes : fallbackThemes,
    kind,
    'culture-partner',
    batchSeed,
    theme.label,
    slotIndex
  ) || theme;
}

function buildCultureBridgeLine(theme = {}, partnerTheme = {}, slotIndex = 0, batchSeed = 0, kind = 'feed') {
  const templates = [
    `${theme.region} rencontre ${String(partnerTheme.region || '').toLowerCase()} pour garder une presence moins repetitive.`,
    `On relie ${theme.country} et ${partnerTheme.country} dans le meme flux pour croiser Afrique et autres scenes du monde.`,
    `${theme.label} avance ici avec un pont visuel entre ${theme.region.toLowerCase()} et ${String(partnerTheme.region || '').toLowerCase()}.`,
    `Le rendu reste plus vivant quand ${theme.region.toLowerCase()} se melange a ${String(partnerTheme.region || '').toLowerCase()} sans copier la meme formule.`
  ];

  return pickSeededOption(
    templates,
    kind,
    'culture-bridge-line',
    batchSeed,
    theme.label,
    partnerTheme.label,
    slotIndex
  );
}

function buildPexelsPhotoQueries(kind = 'feed') {
  if (kind === 'avatar') {
    return PROFILE_THEMES.flatMap((theme) => [
      `${theme.avatarKeywords} smiling portrait natural light`,
      `${theme.avatarKeywords} friendly portrait outdoors`
    ]);
  }

  return PROFILE_THEMES.flatMap((theme) => {
    if (kind === 'status') {
      return [
        `${theme.photoKeywords} vertical story moment`,
        `${theme.photoKeywords} mobile lifestyle portrait`
      ];
    }
    return [
      `${theme.photoKeywords} editorial social moment`,
      `${theme.photoKeywords} community lifestyle portrait`
    ];
  });
}

function buildPexelsVideoQueries(kind = 'shorts') {
  return PROFILE_THEMES.flatMap((theme) => {
    if (kind === 'status') {
      return [
        `${theme.videoKeywords} short vertical clip`,
        `${theme.videoKeywords} portrait motion story`
      ];
    }
    if (kind === 'feed') {
      return [
        `${theme.videoKeywords} lifestyle cinematic clip`,
        `${theme.videoKeywords} editorial social clip`
      ];
    }
    return [
      `${theme.videoKeywords} vertical motion`,
      `${theme.videoKeywords} mobile short video`
    ];
  });
}

function choosePreferredPexelsVideoFile(videoFiles = [], preferredOrientation = 'portrait') {
  const mp4Files = (Array.isArray(videoFiles) ? videoFiles : [])
    .filter((file) => file && String(file.file_type || '').toLowerCase() === 'video/mp4' && file.link);

  if (!mp4Files.length) return null;

  const targetRatio = preferredOrientation === 'portrait' ? (9 / 16) : (16 / 9);

  return mp4Files
    .map((file) => {
      const width = Number(file.width || 0);
      const height = Number(file.height || 0);
      const ratio = width > 0 && height > 0 ? width / height : targetRatio;
      const ratioPenalty = Math.abs(ratio - targetRatio) * 100;
      const oversizePenalty = height > 1280 ? (height - 1280) / 15 : 0;
      const undersizePenalty = height > 0 && height < 480 ? (480 - height) / 8 : 0;
      const qualityPenalty = String(file.quality || '').toLowerCase() === 'sd' ? 0 : 8;

      return {
        ...file,
        rank: ratioPenalty + oversizePenalty + undersizePenalty + qualityPenalty
      };
    })
    .sort((left, right) => left.rank - right.rank)[0];
}

function normalizePexelsPhotoAsset(photo, preferredVariant = 'large2x') {
  if (!photo || !photo.src) return null;
  const sourceUrl = photo.src[preferredVariant] || photo.src.large || photo.src.original || photo.src.medium || photo.src.small;
  if (!sourceUrl) return null;

  return {
    mediaType: 'image',
    remoteUrl: sourceUrl,
    mimeType: guessMimeType(sourceUrl),
    creditName: photo.photographer || '',
    creditUrl: photo.photographer_url || '',
    sourcePageUrl: photo.url || '',
    providerLabel: 'Pexels',
    alt: photo.alt || ''
  };
}

function normalizePexelsVideoAsset(video, preferredOrientation = 'portrait') {
  if (!video) return null;
  const selectedFile = choosePreferredPexelsVideoFile(video.video_files, preferredOrientation);
  if (!selectedFile || !selectedFile.link) return null;

  return {
    mediaType: 'video',
    remoteUrl: selectedFile.link,
    mimeType: 'video/mp4',
    creditName: video.user?.name || '',
    creditUrl: video.user?.url || '',
    sourcePageUrl: video.url || '',
    providerLabel: 'Pexels',
    previewUrl: video.video_pictures?.[0]?.picture || video.image || '',
    duration: Number(video.duration || 0)
  };
}

function appendOfficialSeedMediaCredit(baseText, mediaAsset, noun = 'Media') {
  const content = String(baseText || '').trim();
  const creditName = String(mediaAsset?.creditName || '').trim();
  const providerLabel = String(mediaAsset?.providerLabel || '').trim();
  if (!creditName || !providerLabel) {
    return content;
  }
  return `${content} · ${noun}: ${creditName} via ${providerLabel}`;
}

function toPublicUrl(filePath) {
  const relativePath = path.relative(PUBLIC_ROOT, filePath);
  return `/${relativePath.split(path.sep).join('/')}`;
}

function toAbsolutePublicPath(publicUrl) {
  const normalized = String(publicUrl || '').trim();
  if (!normalized.startsWith('/')) return null;
  const absolutePath = path.join(PUBLIC_ROOT, normalized.replace(/^\//, ''));
  return absolutePath.startsWith(PUBLIC_ROOT) ? absolutePath : null;
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.warn('[OfficialSeed] Failed to delete file:', filePath, error.message);
    }
  }
}

async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function requestRemoteResource(targetUrl, {
  headers = {},
  expectJson = false,
  maxBytes = OFFICIAL_SEED_REMOTE_DOWNLOAD_LIMITS.image
} = {}, redirectCount = 0) {
  const url = new URL(targetUrl);
  const transport = url.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      headers: {
        ...OFFICIAL_SEED_HTTP_HEADERS,
        ...headers
      },
      timeout: OFFICIAL_SEED_REMOTE_TIMEOUT_MS
    }, (response) => {
      const statusCode = Number(response.statusCode || 0);

      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        if (redirectCount >= OFFICIAL_SEED_REMOTE_MAX_REDIRECTS) {
          reject(new Error(`Trop de redirections pour ${targetUrl}`));
          return;
        }
        const redirectedUrl = new URL(response.headers.location, url).toString();
        resolve(requestRemoteResource(redirectedUrl, { headers, expectJson, maxBytes }, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        const errorChunks = [];
        response.on('data', (chunk) => errorChunks.push(chunk));
        response.on('end', () => {
          const errorBody = Buffer.concat(errorChunks).toString('utf8').slice(0, 240);
          reject(new Error(`Requete distante en echec (${statusCode}) pour ${targetUrl}${errorBody ? `: ${errorBody}` : ''}`));
        });
        return;
      }

      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > maxBytes) {
        response.destroy();
        reject(new Error(`Fichier distant trop volumineux (${contentLength} octets) pour ${targetUrl}`));
        return;
      }

      const chunks = [];
      let receivedBytes = 0;

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          response.destroy(new Error(`Limite de telechargement depassee pour ${targetUrl}`));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (expectJson) {
          try {
            const parsed = JSON.parse(buffer.toString('utf8'));
            resolve({
              data: parsed,
              headers: response.headers,
              finalUrl: url.toString()
            });
          } catch (error) {
            reject(new Error(`JSON distant invalide pour ${targetUrl}: ${error.message}`));
          }
          return;
        }

        resolve({
          data: buffer,
          headers: response.headers,
          finalUrl: url.toString()
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Delai d'attente depasse pour ${targetUrl}`));
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchRemoteJson(targetUrl, headers = {}) {
  const response = await requestRemoteResource(targetUrl, {
    headers,
    expectJson: true,
    maxBytes: 1024 * 1024
  });
  return response.data;
}

async function walkDirectory(directoryPath, accumulator = []) {
  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return accumulator;
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, accumulator);
      continue;
    }
    if (entry.isFile()) {
      accumulator.push(fullPath);
    }
  }

  return accumulator;
}

async function collectMediaFiles(directoryPaths, predicate) {
  const collected = [];
  for (const directoryPath of directoryPaths) {
    const files = await walkDirectory(directoryPath, []);
    files.forEach((filePath) => {
      if (filePath.startsWith(OFFICIAL_SEED_UPLOAD_ROOT)) return;
      if (predicate(filePath)) {
        collected.push(filePath);
      }
    });
  }
  return collected;
}

async function buildMediaLibrary() {
  const remoteProviderEnabled = await hasOfficialSeedRemoteMediaProvider();
  const avatarPrimaryDirs = [
    path.join(OFFICIAL_SEED_LIBRARY_ROOT, 'avatars')
  ];
  const avatarFallbackDirs = [
    path.join(PUBLIC_ROOT, 'assets/uploads'),
    path.join(PUBLIC_ROOT, 'uploads/posts'),
    path.join(PUBLIC_ROOT, 'uploads/ads'),
    path.join(PUBLIC_ROOT, 'assets')
  ];
  const feedPrimaryDirs = [
    path.join(OFFICIAL_SEED_LIBRARY_ROOT, 'feed/images'),
    path.join(OFFICIAL_SEED_LIBRARY_ROOT, 'feed')
  ];
  const feedFallbackDirs = [
    path.join(PUBLIC_ROOT, 'uploads/posts'),
    path.join(PUBLIC_ROOT, 'uploads/ads')
  ];
  const shortsPrimaryDirs = [
    path.join(OFFICIAL_SEED_LIBRARY_ROOT, 'shorts')
  ];
  const shortsFallbackDirs = [
    path.join(PUBLIC_ROOT, 'uploads/reels'),
    path.join(PUBLIC_ROOT, 'uploads/posts'),
    path.join(PUBLIC_ROOT, 'uploads/statuses')
  ];
  const statusPrimaryDirs = [
    path.join(OFFICIAL_SEED_LIBRARY_ROOT, 'status')
  ];
  const statusFallbackDirs = [
    path.join(PUBLIC_ROOT, 'uploads/statuses'),
    path.join(PUBLIC_ROOT, 'uploads/posts'),
    path.join(PUBLIC_ROOT, 'uploads/reels')
  ];

  const avatarPrimary = await collectMediaFiles(avatarPrimaryDirs, isImageFile);
  const avatarFallback = await collectMediaFiles(avatarFallbackDirs, isImageFile);
  const feedPrimary = await collectMediaFiles(feedPrimaryDirs, isImageFile);
  const feedFallback = await collectMediaFiles(feedFallbackDirs, isImageFile);
  const shortsPrimary = await collectMediaFiles(shortsPrimaryDirs, isVideoFile);
  const shortsFallback = await collectMediaFiles(shortsFallbackDirs, isVideoFile);
  const statusPrimary = await collectMediaFiles(statusPrimaryDirs, (filePath) => isImageFile(filePath) || isVideoFile(filePath));
  const statusFallback = await collectMediaFiles(statusFallbackDirs, (filePath) => isImageFile(filePath) || isVideoFile(filePath));

  const avatars = avatarPrimary.length ? avatarPrimary : avatarFallback;
  const feedImages = feedPrimary.length ? feedPrimary : feedFallback;
  const shortsVideos = shortsPrimary.length ? shortsPrimary : shortsFallback;
  const statusMedia = statusPrimary.length ? statusPrimary : statusFallback;

  const placeholderAvatar = path.join(PUBLIC_ROOT, 'assets/avatar_placeholder.jpg');
  if (!avatars.length) {
    avatars.push(placeholderAvatar);
  }

  return {
    avatars,
    feedImages,
    shortsVideos,
    statusMedia,
    summary: {
      avatars: avatars.length,
      feedImages: feedImages.length,
      shortsVideos: shortsVideos.length,
      statusMedia: statusMedia.length,
      avatarSource: remoteProviderEnabled
        ? 'internet-pexels'
        : (avatarPrimary.length ? 'official-library' : 'fallback-library'),
      feedSource: feedPrimary.length ? 'official-library' : 'fallback-library',
      shortsSource: shortsPrimary.length ? 'official-library' : 'fallback-library',
      statusSource: statusPrimary.length ? 'official-library' : 'fallback-library',
      avatarSummaryText: remoteProviderEnabled
        ? 'Internet · portraits Pexels actifs'
        : buildLocalSummaryText(avatars.length, avatarPrimary.length ? 'dossier seed' : 'bibliotheque existante'),
      feedSummaryText: remoteProviderEnabled
        ? 'Internet · selection feed Pexels mixee'
        : 'Internet requis · enregistrez une clé Pexels',
      shortsSummaryText: remoteProviderEnabled
        ? 'Internet · shorts Pexels + audio de la plateforme'
        : 'Internet requis · enregistrez une clé Pexels',
      statusSummaryText: remoteProviderEnabled
        ? 'Internet · selection status Pexels mixee'
        : 'Internet requis · enregistrez une clé Pexels'
    }
  };
}

async function getMediaLibrary() {
  const now = Date.now();
  if (mediaLibraryCache.value && mediaLibraryCache.expiresAt > now) {
    return mediaLibraryCache.value;
  }
  const value = await buildMediaLibrary();
  mediaLibraryCache = {
    value,
    expiresAt: now + 15000
  };
  return value;
}

async function searchPexelsPhotos(query, {
  perPage = 18,
  page = 1,
  orientation = 'portrait'
} = {}) {
  const apiKey = await getOfficialSeedPexelsApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    query: String(query || '').trim() || 'people',
    per_page: String(Math.min(80, Math.max(1, Number(perPage) || 18))),
    page: String(Math.max(1, Number(page) || 1)),
    orientation
  });

  const payload = await fetchRemoteJson(`${OFFICIAL_SEED_PEXELS_API_BASE}/search?${params.toString()}`, {
    Authorization: apiKey
  });

  return Array.isArray(payload?.photos)
    ? payload.photos
        .map((photo) => normalizePexelsPhotoAsset(photo, orientation === 'portrait' ? 'portrait' : 'large2x'))
        .filter(Boolean)
    : [];
}

async function searchPexelsVideos(query, {
  perPage = 18,
  page = 1,
  orientation = 'portrait',
  size = 'small'
} = {}) {
  const apiKey = await getOfficialSeedPexelsApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    query: String(query || '').trim() || 'people',
    per_page: String(Math.min(80, Math.max(1, Number(perPage) || 18))),
    page: String(Math.max(1, Number(page) || 1)),
    orientation,
    size
  });

  const payload = await fetchRemoteJson(`${OFFICIAL_SEED_PEXELS_API_BASE}/videos/search?${params.toString()}`, {
    Authorization: apiKey
  });

  return Array.isArray(payload?.videos)
    ? payload.videos
        .filter((video) => Number(video?.duration || 0) <= 35)
        .map((video) => normalizePexelsVideoAsset(video, orientation))
        .filter(Boolean)
    : [];
}

function dedupeRemoteAssets(assets = []) {
  const seen = new Set();
  return (Array.isArray(assets) ? assets : []).filter((asset) => {
    const key = String(asset?.remoteUrl || asset?.sourcePageUrl || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function interleaveAssetPools(primaryAssets = [], secondaryAssets = [], limit = Number.MAX_SAFE_INTEGER) {
  const merged = [];
  const maxLength = Math.max(primaryAssets.length, secondaryAssets.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (primaryAssets[index]) {
      merged.push(primaryAssets[index]);
    }
    if (merged.length >= limit) break;

    if (secondaryAssets[index]) {
      merged.push(secondaryAssets[index]);
    }
    if (merged.length >= limit) break;
  }

  return merged.slice(0, limit);
}

function mergeAssetPools(primaryAssets = [], secondaryAssets = [], limit = Number.MAX_SAFE_INTEGER) {
  const merged = interleaveAssetPools(primaryAssets, secondaryAssets, limit);
  if (merged.length >= limit) {
    return merged.slice(0, limit);
  }

  const seen = new Set(
    merged
      .map((asset) => String(asset?.remoteUrl || asset?.publicUrl || '').trim())
      .filter(Boolean)
  );

  for (const asset of [...primaryAssets, ...secondaryAssets]) {
    const key = String(asset?.remoteUrl || asset?.publicUrl || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(asset);
    if (merged.length >= limit) {
      break;
    }
  }

  return merged.slice(0, limit);
}

async function collectPexelsAssets(queries, targetCount, searchFn, searchOptions = {}) {
  const requestedCount = Math.max(0, Number(targetCount) || 0);
  const queryList = Array.isArray(queries) ? queries.filter(Boolean) : [];
  if (!requestedCount || !queryList.length || typeof searchFn !== 'function') {
    return [];
  }

  const perPage = Math.min(80, Math.max(6, Number(searchOptions.perPage) || 18));
  const maxPages = Math.max(1, Math.min(5, Math.ceil(requestedCount / perPage) + 1));
  const collected = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const rotatedQueries = rotateList(queryList, page - 1);
    for (const query of rotatedQueries) {
      const assets = await searchFn(query, {
        ...searchOptions,
        perPage,
        page
      });
      collected.push(...assets);

      const uniqueAssets = dedupeRemoteAssets(collected);
      if (uniqueAssets.length >= requestedCount) {
        return rotateList(uniqueAssets, Date.now()).slice(0, requestedCount);
      }
    }
  }

  return rotateList(dedupeRemoteAssets(collected), Date.now()).slice(0, requestedCount);
}

async function downloadRemoteAsset(remoteAsset, destinationDirectory, targetStem) {
  await ensureDirectory(destinationDirectory);

  const maxBytes = remoteAsset?.mediaType === 'video'
    ? OFFICIAL_SEED_REMOTE_DOWNLOAD_LIMITS.video
    : OFFICIAL_SEED_REMOTE_DOWNLOAD_LIMITS.image;

  const response = await requestRemoteResource(remoteAsset.remoteUrl, {
    maxBytes
  });
  const mimeType = String(response.headers['content-type'] || remoteAsset.mimeType || '').split(';')[0].trim() || remoteAsset.mimeType || 'application/octet-stream';
  const parsedUrl = new URL(response.finalUrl || remoteAsset.remoteUrl);
  const rawExt = path.extname(parsedUrl.pathname || '');
  const safeExtension = rawExt || guessExtensionFromMimeType(mimeType, remoteAsset.mediaType === 'video' ? '.mp4' : '.jpg');
  const fileName = `${targetStem}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExtension.toLowerCase()}`;
  const destinationPath = path.join(destinationDirectory, fileName);

  await fs.writeFile(destinationPath, response.data);

  return {
    absolutePath: destinationPath,
    publicUrl: toPublicUrl(destinationPath),
    mediaName: fileName,
    mediaSize: response.data.length,
    mimeType,
    mediaType: remoteAsset.mediaType,
    thumbnailUrl: remoteAsset.mediaType === 'video'
      ? String(remoteAsset.previewUrl || '').trim() || null
      : null,
    creditName: remoteAsset.creditName || '',
    creditUrl: remoteAsset.creditUrl || '',
    sourcePageUrl: remoteAsset.sourcePageUrl || '',
    providerLabel: remoteAsset.providerLabel || 'Internet',
    previewUrl: remoteAsset.previewUrl || ''
  };
}

async function prepareLocalMediaPool(kind, sourceFiles, destinationDirectory, targetStem) {
  if (!Array.isArray(sourceFiles) || !sourceFiles.length) return [];

  const poolSize = Math.min(getOfficialSeedPoolSize(sourceFiles.length), sourceFiles.length);
  const rotatedSources = rotateList(sourceFiles, Date.now());
  const selectedSources = rotatedSources.slice(0, poolSize);
  const preparedAssets = [];

  for (let index = 0; index < selectedSources.length; index += 1) {
    const mediaAsset = await copyLibraryAsset(selectedSources[index], destinationDirectory, `${targetStem}-${index + 1}`);
    preparedAssets.push({
      ...mediaAsset,
      mimeType: guessMimeType(selectedSources[index]),
      mediaType: isVideoFile(selectedSources[index]) ? 'video' : 'image',
      providerLabel: 'TRASX',
      creditName: '',
      creditUrl: '',
      sourcePageUrl: ''
    });
  }

  return preparedAssets;
}

async function preparePexelsMediaPool(kind, targetCount) {
  const poolSize = getOfficialSeedPoolSize(targetCount);

  if (kind === 'feed') {
    return collectPexelsAssets(
      buildPexelsPhotoQueries('feed'),
      poolSize,
      searchPexelsPhotos,
      { perPage: 18, orientation: 'landscape' }
    );
  }

  if (kind === 'shorts') {
    return collectPexelsAssets(
      buildPexelsVideoQueries('shorts'),
      poolSize,
      searchPexelsVideos,
      { perPage: 14, orientation: 'portrait', size: 'small' }
    );
  }

  if (kind === 'status') {
    return collectPexelsAssets(
      buildPexelsPhotoQueries('status'),
      poolSize,
      searchPexelsPhotos,
      { perPage: 14, orientation: 'portrait' }
    );
  }

  return [];
}

function getOfficialSeedAvatarPoolSize(targetCount) {
  return Math.max(24, Number(targetCount) || 24);
}

function buildOfficialSeedHandleCandidates(baseHandle, themeLabel, slotNumber) {
  const normalizedBase = slugifyLettersOnly(baseHandle);
  const themeHandle = slugifyLettersOnly(themeLabel);
  const rotatedSuffixes = rotateList(OFFICIAL_SEED_USERNAME_SUFFIXES, slotNumber - 1)
    .map((entry) => slugifyLettersOnly(entry))
    .filter(Boolean);
  const candidates = [];

  const pushCandidate = (candidate) => {
    const normalized = slugifyLettersOnly(candidate);
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  pushCandidate(normalizedBase);
  if (themeHandle) {
    pushCandidate(`${normalizedBase}${themeHandle}`);
  }

  rotatedSuffixes.forEach((suffix) => {
    pushCandidate(`${normalizedBase}${suffix}`);
    if (themeHandle) {
      pushCandidate(`${normalizedBase}${themeHandle}${suffix}`);
    }
  });

  return candidates;
}

async function preparePexelsAvatarPool(targetCount) {
  const poolSize = getOfficialSeedAvatarPoolSize(targetCount);
  return collectPexelsAssets(
    buildPexelsPhotoQueries('avatar'),
    poolSize,
    searchPexelsPhotos,
    { perPage: 40, orientation: 'portrait' }
  );
}

async function prepareOfficialSeedAvatarPool(targetCount, mediaLibrary) {
  if (await hasOfficialSeedRemoteMediaProvider()) {
    const remotePool = await preparePexelsAvatarPool(targetCount);
    if (!remotePool.length) {
      throw new Error('Aucune photo de profil distante valide n’a été trouvée pour les comptes officiels.');
    }

    const preparedAssets = [];
    for (let index = 0; index < remotePool.length; index += 1) {
      const downloaded = await downloadRemoteAsset(
        remotePool[index],
        OFFICIAL_SEED_AVATAR_UPLOAD_DIR,
        `official-seed-avatar-${String(index + 1).padStart(3, '0')}`
      );
      preparedAssets.push(downloaded);
    }

    return {
      assets: preparedAssets,
      sourceMode: 'internet-pexels'
    };
  }

  const localAssets = await prepareLocalMediaPool(
    'avatar',
    mediaLibrary.avatars,
    OFFICIAL_SEED_AVATAR_UPLOAD_DIR,
    'official-seed-avatar'
  );

  return {
    assets: localAssets,
    sourceMode: 'local-library'
  };
}

async function prepareOfficialSeedContentPool(kind, targetCount, mediaLibrary) {
  const remoteEnabled = await hasOfficialSeedRemoteMediaProvider();
  const localSourceMap = {
    feed: {
      files: mediaLibrary.feedImages,
      destinationDirectory: OFFICIAL_SEED_POST_UPLOAD_DIR,
      stem: 'official-seed-feed'
    },
    shorts: {
      files: mediaLibrary.shortsVideos,
      destinationDirectory: OFFICIAL_SEED_REEL_UPLOAD_DIR,
      stem: 'official-seed-shorts'
    },
    status: {
      files: mediaLibrary.statusMedia,
      destinationDirectory: OFFICIAL_SEED_STATUS_UPLOAD_DIR,
      stem: 'official-seed-status'
    }
  };
  const localConfig = localSourceMap[kind];

  if (!remoteEnabled) {
    throw new Error('Enregistrez une clé Pexels dans le dashboard admin pour télécharger les médias officiels TRASX depuis Internet.');
  }

  const remoteDownloadedFiles = [];
  try {
    const remotePool = await preparePexelsMediaPool(kind, targetCount);
    if (!remotePool.length) {
      throw new Error('Aucun média distant n’a été trouvé pour ce type de publication.');
    }

    const preparedAssets = [];
    for (let index = 0; index < remotePool.length; index += 1) {
      const downloaded = await downloadRemoteAsset(
        remotePool[index],
        localConfig.destinationDirectory,
        `${localConfig.stem}-remote-${index + 1}`
      );
      remoteDownloadedFiles.push(downloaded.absolutePath);
      preparedAssets.push(downloaded);
    }

    if (!preparedAssets.length) {
      throw new Error('Les médias distants trouvés n’ont pas pu être téléchargés.');
    }

    return {
      assets: preparedAssets,
      sourceMode: 'internet-pexels'
    };
  } catch (error) {
    await Promise.all(remoteDownloadedFiles.map((filePath) => safeUnlink(filePath)));
    throw new Error(`Téléchargement des médias officiels impossible: ${error.message}`);
  }
}

function buildProfileDescriptor(slotNumber) {
  const theme = getThemeProfileForSlot(slotNumber);
  const combinationsCount = OFFICIAL_SEED_FIRST_NAMES.length * OFFICIAL_SEED_LAST_NAMES.length;
  const pairIndex = (((slotNumber - 1) * 37) % combinationsCount + combinationsCount) % combinationsCount;
  const firstName = OFFICIAL_SEED_FIRST_NAMES[pairIndex % OFFICIAL_SEED_FIRST_NAMES.length];
  const lastName = OFFICIAL_SEED_LAST_NAMES[Math.floor(pairIndex / OFFICIAL_SEED_FIRST_NAMES.length) % OFFICIAL_SEED_LAST_NAMES.length];
  const displayName = `${firstName} ${lastName}`;
  const usernameBase = slugifyLettersOnly(`${firstName}${lastName}`) || slugifyLettersOnly(`${theme.label}trasxprofile`);
  const emailLocalPart = slugifyLettersOnly(`${firstName}${lastName}${theme.label}`) || 'trasxofficialseed';

  return {
    slotNumber,
    theme,
    usernameBase,
    emailLocalPart,
    username: usernameBase,
    email: `${emailLocalPart}@trasx.platform`,
    displayName,
    firstName,
    lastName,
    bio: `Compte officiel TRASX gere par la plateforme pour animer le contenu initial autour de ${theme.label.toLowerCase()}, ${theme.bioHeadline}, avec un vrai melange entre ${theme.region.toLowerCase()} et autres cultures. ${theme.tag} ${theme.cultureTag} #OfficialTRASX`,
    country: theme.country
  };
}

function buildUniqueOfficialSeedDescriptor(slotNumber, usedUsernames, usedEmails) {
  const descriptor = buildProfileDescriptor(slotNumber);
  const usernameCandidates = buildOfficialSeedHandleCandidates(descriptor.usernameBase, descriptor.theme.label, slotNumber);
  const emailCandidates = buildOfficialSeedHandleCandidates(descriptor.emailLocalPart, descriptor.theme.label, slotNumber);
  const candidateCount = Math.max(usernameCandidates.length, emailCandidates.length);

  for (let index = 0; index < candidateCount; index += 1) {
    const username = usernameCandidates[index] || usernameCandidates[0];
    const emailLocalPart = emailCandidates[index] || emailCandidates[0];
    const email = `${emailLocalPart}@trasx.platform`;
    const usernameKey = username.toLowerCase();
    const emailKey = email.toLowerCase();

    if (!usedUsernames.has(usernameKey) && !usedEmails.has(emailKey)) {
      usedUsernames.add(usernameKey);
      usedEmails.add(emailKey);
      return {
        ...descriptor,
        username,
        email
      };
    }
  }

  throw new Error(`Impossible de générer un identifiant unique propre pour le compte officiel #${slotNumber}.`);
}

function buildFeedContent(user, slotIndex, batchSeed = 0) {
  const theme = resolveThemeProfile(user);
  const partnerTheme = pickMixedCultureTheme(theme, slotIndex, batchSeed, 'feed');
  const opener = pickSeededOption(FEED_OPENERS, 'feed-opener', batchSeed, user?.slotNumber, slotIndex, theme.label);
  const body = pickSeededOption(theme.feedAngles, 'feed-body', batchSeed, user?.slotNumber, slotIndex, theme.region);
  const cultureLine = buildCultureBridgeLine(theme, partnerTheme, slotIndex, batchSeed, 'feed');
  const closer = pickSeededOption(FEED_CLOSERS, 'feed-closer', batchSeed, user?.slotNumber, slotIndex, theme.cultureTag);
  return `${opener}. ${body} ${cultureLine} ${closer} ${theme.tag} ${theme.cultureTag} ${partnerTheme.tag} #OfficialTRASX #Trasx`;
}

function buildShortCaption(user, slotIndex, batchSeed = 0) {
  const theme = resolveThemeProfile(user);
  const partnerTheme = pickMixedCultureTheme(theme, slotIndex, batchSeed, 'shorts');
  const hook = pickSeededOption(SHORTS_HOOKS, 'short-hook', batchSeed, user?.slotNumber, slotIndex, theme.label);
  const angle = pickSeededOption(theme.shortAngles, 'short-angle', batchSeed, user?.slotNumber, slotIndex, theme.region);
  const cultureLine = buildCultureBridgeLine(theme, partnerTheme, slotIndex, batchSeed, 'shorts');
  const closer = pickSeededOption(SHORTS_CLOSERS, 'short-closer', batchSeed, user?.slotNumber, slotIndex, theme.cultureTag);
  return `${hook} ${angle} ${cultureLine} ${closer} ${theme.tag} ${theme.cultureTag} ${partnerTheme.tag} #ShortsTRASX`;
}

function buildShortSoundName(user, slotIndex, selectedAudio = null, batchSeed = 0) {
  const explicitTitle = String(selectedAudio?.title || '').trim();
  if (explicitTitle) return explicitTitle;
  const theme = resolveThemeProfile(user);
  const soundLabels = ['Pulse', 'Flow', 'Beat', 'Motion', 'Signal', 'Wave', 'Cut'];
  const pickedLabel = pickSeededOption(soundLabels, 'short-sound', batchSeed, user?.slotNumber, slotIndex, theme.region);
  return `TRASX ${theme.label} ${pickedLabel}`;
}

function buildStatusCaption(user, slotIndex, batchSeed = 0) {
  const theme = resolveThemeProfile(user);
  const partnerTheme = pickMixedCultureTheme(theme, slotIndex, batchSeed, 'status');
  const hook = pickSeededOption(STATUS_HOOKS, 'status-hook', batchSeed, user?.slotNumber, slotIndex, theme.label);
  const angle = pickSeededOption(theme.statusAngles, 'status-angle', batchSeed, user?.slotNumber, slotIndex, theme.region);
  const cultureLine = buildCultureBridgeLine(theme, partnerTheme, slotIndex, batchSeed, 'status');
  const closer = pickSeededOption(STATUS_CLOSERS, 'status-closer', batchSeed, user?.slotNumber, slotIndex, theme.cultureTag);
  return `${hook} ${angle} ${cultureLine} ${closer} ${theme.tag} ${theme.cultureTag} ${partnerTheme.tag}`;
}

async function copyLibraryAsset(sourcePath, destinationDirectory, targetStem) {
  await ensureDirectory(destinationDirectory);
  const extension = path.extname(sourcePath) || '.bin';
  const fileName = `${targetStem}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension.toLowerCase()}`;
  const destinationPath = path.join(destinationDirectory, fileName);
  await fs.copyFile(sourcePath, destinationPath);
  return {
    absolutePath: destinationPath,
    publicUrl: toPublicUrl(destinationPath),
    mediaName: fileName,
    mediaSize: (await fs.stat(destinationPath)).size
  };
}

function normalizeContentType(contentType) {
  const normalized = String(contentType || '').trim().toLowerCase();
  if (normalized === 'feed' || normalized === 'shorts' || normalized === 'status') {
    return normalized;
  }
  return null;
}

async function getOfficialSeedSharedAudioPool() {
  const sharedAudios = await Reel.getSharedAudios();
  const normalizedSharedAudios = (Array.isArray(sharedAudios) ? sharedAudios : [])
    .filter((audio) => String(audio?.audio_url || '').trim());

  let fallbackAudioEntries = [];
  try {
    const localAudioFiles = await fs.readdir(OFFICIAL_SEED_FALLBACK_AUDIO_UPLOAD_DIR, { withFileTypes: true });
    fallbackAudioEntries = localAudioFiles
      .filter((entry) => entry.isFile() && ['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(path.extname(entry.name).toLowerCase()))
      .map((entry, index) => ({
        title: `TRASX Seed Mix ${index + 1}`,
        audio_url: `/uploads/reels/${entry.name}`
      }));
  } catch (_) {
    fallbackAudioEntries = [];
  }

  const mergedAudios = [...normalizedSharedAudios, ...fallbackAudioEntries];
  const seenAudioUrls = new Set();

  return mergedAudios.filter((audio) => {
    const audioUrl = String(audio?.audio_url || '').trim();
    if (!audioUrl || seenAudioUrls.has(audioUrl)) {
      return false;
    }
    seenAudioUrls.add(audioUrl);
    return true;
  });
}

async function getOfficialSeedUsers(connection = db) {
  await backfillOfficialSeedSlots(connection);

  const [rows] = await connection.query(
    `
      SELECT
        id,
        username,
        email,
        seed_slot,
        first_name,
        last_name,
        display_name,
        avatar,
        country,
        bio,
        created_at
      FROM users
      WHERE account_type = ?
      ORDER BY COALESCE(seed_slot, 999999) ASC, id ASC
    `,
    [OFFICIAL_SEED_ACCOUNT_TYPE]
  );

  return rows.map((row, index) => {
    const slotNumber = Number(row.seed_slot) > 0 ? Number(row.seed_slot) : index + 1;
    const theme = getThemeProfileForSlot(slotNumber);
    return {
      ...row,
      slotNumber,
      theme_label: theme.label,
      theme_tag: theme.tag,
      theme_region: theme.region,
      theme_culture_tag: theme.cultureTag,
      theme_bio_headline: theme.bioHeadline
    };
  });
}

async function getOfficialSeedSummary(connection = db) {
  await ensureSchema(connection);
  const mediaLibrary = await getMediaLibrary();
  const officialSeedPexelsApiKey = await getOfficialSeedPexelsApiKey();

  const [[accountsRow]] = await connection.query(
    'SELECT COUNT(*) AS total FROM users WHERE account_type = ?',
    [OFFICIAL_SEED_ACCOUNT_TYPE]
  );
  const [[feedRow]] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM posts p
      INNER JOIN users u ON u.id = p.user_id
      WHERE u.account_type = ? AND COALESCE(p.source, 'user') = ?
    `,
    [OFFICIAL_SEED_ACCOUNT_TYPE, OFFICIAL_SEED_SOURCE]
  );
  const [[shortsRow]] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM reels r
      INNER JOIN users u ON u.id = r.user_id
      WHERE u.account_type = ? AND COALESCE(r.source, 'user') = ?
    `,
    [OFFICIAL_SEED_ACCOUNT_TYPE, OFFICIAL_SEED_SOURCE]
  );
  const [[statusRow]] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM statuses s
      INNER JOIN users u ON u.id = s.user_id
      WHERE u.account_type = ? AND COALESCE(s.source, 'user') = ?
    `,
    [OFFICIAL_SEED_ACCOUNT_TYPE, OFFICIAL_SEED_SOURCE]
  );

  return {
    accountBatchSize: OFFICIAL_SEED_ACCOUNT_BATCH_SIZE,
    contentBatchSize: OFFICIAL_SEED_CONTENT_BATCH_SIZE,
    accountsCount: Number(accountsRow?.total || 0),
    feedCount: Number(feedRow?.total || 0),
    shortsCount: Number(shortsRow?.total || 0),
    statusCount: Number(statusRow?.total || 0),
    mediaLibrary: mediaLibrary.summary,
    remoteKeyConfigured: Boolean(officialSeedPexelsApiKey),
    remoteKeyPreview: maskOfficialSeedApiKey(officialSeedPexelsApiKey)
  };
}

async function ensureSchema(connection = db) {
  await User.ensureSchema();
  await Post.ensureSchema();
  await Reel.ensureReelSchema();
  await Status.ensureSchema();

  await ensureColumn(connection, 'users', 'account_type', "VARCHAR(30) NOT NULL DEFAULT 'standard'");
  await ensureColumn(connection, 'users', 'seed_slot', 'INT NULL');
  await ensureColumn(connection, 'posts', 'source', "VARCHAR(30) NOT NULL DEFAULT 'user'");
  await ensureColumn(connection, 'reels', 'source', "VARCHAR(30) NOT NULL DEFAULT 'user'");
  await ensureColumn(connection, 'statuses', 'source', "VARCHAR(30) NOT NULL DEFAULT 'user'");

  await ensureIndex(connection, 'users', 'idx_users_account_type', '(account_type)');
  await ensureUniqueIndex(connection, 'users', 'uniq_users_account_seed_slot', '(account_type, seed_slot)');
  await ensureIndex(connection, 'posts', 'idx_posts_source_created', '(source, created_at DESC, id DESC)');
  await ensureIndex(connection, 'reels', 'idx_reels_source_created', '(source, created_at DESC, id DESC)');
  await ensureIndex(connection, 'statuses', 'idx_statuses_source_created', '(source, created_at DESC, id DESC)');

  await connection.query(
    `
      UPDATE users
      SET certification_type = 'None',
          is_verified = 0
      WHERE account_type = ?
        AND (
          COALESCE(NULLIF(TRIM(certification_type), ''), 'None') <> 'None'
          OR COALESCE(is_verified, 0) <> 0
        )
    `,
    [OFFICIAL_SEED_ACCOUNT_TYPE]
  );
}

async function backfillOfficialSeedSlots(connection = db) {
  const [rows] = await connection.query(
    `
      SELECT id, seed_slot
      FROM users
      WHERE account_type = ?
      ORDER BY id ASC
    `,
    [OFFICIAL_SEED_ACCOUNT_TYPE]
  );

  if (!rows.length) return;

  const usedSlots = new Set(
    rows
      .map((row) => Number(row.seed_slot))
      .filter((slot) => Number.isInteger(slot) && slot > 0)
  );

  let nextSlot = 1;
  for (const row of rows) {
    const currentSlot = Number(row.seed_slot);
    if (Number.isInteger(currentSlot) && currentSlot > 0) {
      continue;
    }

    while (usedSlots.has(nextSlot)) {
      nextSlot += 1;
    }

    await connection.query(
      'UPDATE users SET seed_slot = ? WHERE id = ?',
      [nextSlot, row.id]
    );
    usedSlots.add(nextSlot);
    nextSlot += 1;
  }
}

async function createOfficialSeedAccounts() {
  const connection = await db.getConnection();
  const createdFiles = [];

  try {
    await connection.beginTransaction();
    await ensureSchema(connection);

    const existingUsers = await getOfficialSeedUsers(connection);
    const [allUsers] = await connection.query('SELECT username, email FROM users');
    const usedUsernames = new Set(allUsers.map((user) => String(user.username || '').toLowerCase()).filter(Boolean));
    const usedEmails = new Set(allUsers.map((user) => String(user.email || '').toLowerCase()).filter(Boolean));
    const missingDescriptors = [];
    const currentMaxSlot = existingUsers.reduce((maxSlot, user) => {
      const slot = Number(user.seed_slot || user.slotNumber || 0);
      return Number.isInteger(slot) && slot > maxSlot ? slot : maxSlot;
    }, 0);

    for (let index = 1; index <= OFFICIAL_SEED_ACCOUNT_BATCH_SIZE; index += 1) {
      const slotNumber = currentMaxSlot + index;
      missingDescriptors.push(buildUniqueOfficialSeedDescriptor(slotNumber, usedUsernames, usedEmails));
    }

    const mediaLibrary = await getMediaLibrary();
    const avatarPool = await prepareOfficialSeedAvatarPool(missingDescriptors.length, mediaLibrary);
    const preparedAvatarAssets = Array.isArray(avatarPool?.assets) ? avatarPool.assets : [];
    const passwordHash = await bcrypt.hash(`trasx_official_seed_${Date.now()}_platform`, 10);

    if (!preparedAvatarAssets.length) {
      throw new Error('Aucune photo de profil n’est disponible pour créer les comptes officiels.');
    }

    for (let index = 0; index < missingDescriptors.length; index += 1) {
      const descriptor = missingDescriptors[index];
      const avatarAsset = preparedAvatarAssets[index % preparedAvatarAssets.length];
      createdFiles.push(avatarAsset.absolutePath);

      await connection.query(
        `
          INSERT INTO users (
            username,
            email,
            password_hash,
            first_name,
            last_name,
            country,
            bio,
            avatar,
            display_name,
            certification_type,
            preferred_language,
            account_status,
            is_verified,
            account_type,
            seed_slot
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          descriptor.username,
          descriptor.email,
          passwordHash,
          descriptor.firstName,
          descriptor.lastName,
          descriptor.country,
          descriptor.bio,
          avatarAsset.publicUrl,
          descriptor.displayName,
          'None',
          'fr',
          'Active',
          0,
          OFFICIAL_SEED_ACCOUNT_TYPE,
          descriptor.slotNumber
        ]
      );
    }

    await connection.commit();
    const summary = await getOfficialSeedSummary();
    return {
      createdAccounts: missingDescriptors.length,
      totalAccounts: summary.accountsCount,
      summary
    };
  } catch (error) {
    await connection.rollback();
    await Promise.all(createdFiles.map((filePath) => safeUnlink(filePath)));
    throw error;
  } finally {
    connection.release();
  }
}

async function generateOfficialSeedContent(contentType) {
  const normalizedType = normalizeContentType(contentType);
  if (!normalizedType) {
    throw new Error('Type de publication officiel invalide.');
  }

  const connection = await db.getConnection();
  const createdFiles = [];

  try {
    await ensureSchema(connection);

    const officialUsers = await getOfficialSeedUsers(connection);
    if (!officialUsers.length) {
      throw new Error('Aucun compte officiel TRASX disponible. Créez les comptes avant de générer du contenu.');
    }

    const mediaLibrary = await getMediaLibrary();
    const generationCount = OFFICIAL_SEED_CONTENT_BATCH_SIZE;
    const preparedPool = await prepareOfficialSeedContentPool(normalizedType, generationCount, mediaLibrary);
    const preparedAssets = Array.isArray(preparedPool?.assets) ? preparedPool.assets : [];
    const batchSeed = Date.now();
    const mixedUsers = shuffleListBySeed(officialUsers, normalizedType, 'users', batchSeed);
    const mixedAssets = shuffleListBySeed(preparedAssets, normalizedType, 'assets', batchSeed);
    const sharedAudioPool = normalizedType === 'shorts'
      ? shuffleListBySeed(await getOfficialSeedSharedAudioPool(), normalizedType, 'audios', batchSeed)
      : [];
    preparedAssets.forEach((asset) => {
      if (asset?.absolutePath) createdFiles.push(asset.absolutePath);
    });

    if (!preparedAssets.length) {
      if (normalizedType === 'feed') {
        throw new Error('Aucun media image ou video disponible pour alimenter le feed officiel.');
      }
      if (normalizedType === 'shorts') {
        throw new Error('Aucune video disponible pour alimenter les shorts officiels.');
      }
      throw new Error('Aucun media disponible pour alimenter les status officiels.');
    }

    if (normalizedType === 'shorts' && !sharedAudioPool.length) {
      throw new Error('Aucun audio partage ou fallback n’est disponible pour donner du son aux shorts officiels.');
    }

    await connection.beginTransaction();

    for (let index = 0; index < generationCount; index += 1) {
      const user = mixedUsers[index % mixedUsers.length];
      const mediaAsset = mixedAssets[index % mixedAssets.length];

      if (normalizedType === 'feed') {
        const isVideoFeedAsset = mediaAsset.mediaType === 'video';
        await connection.query(
          `
            INSERT INTO posts (
              user_id,
              content,
              image_url,
              media_type,
              thumbnail_url,
              allow_download,
              source
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            user.id,
            appendOfficialSeedMediaCredit(buildFeedContent(user, index, batchSeed), mediaAsset, isVideoFeedAsset ? 'Video' : 'Photo'),
            mediaAsset.publicUrl,
            isVideoFeedAsset ? 'video' : 'image',
            isVideoFeedAsset ? (mediaAsset.thumbnailUrl || null) : null,
            1,
            OFFICIAL_SEED_SOURCE
          ]
        );
        continue;
      }

      if (normalizedType === 'shorts') {
        const sharedAudio = sharedAudioPool.length
          ? sharedAudioPool[(index + Number(user.slotNumber || 0)) % sharedAudioPool.length]
          : null;
        await connection.query(
          `
            INSERT INTO reels (
              user_id,
              video_url,
              sound_name,
              caption,
              media_type,
              audio_url,
              audio_start_time,
              audio_duration,
              media_fit,
              is_trade,
              trade_price,
              last_possession_user_id,
              source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            user.id,
            mediaAsset.publicUrl,
            buildShortSoundName(user, index, sharedAudio, batchSeed),
            appendOfficialSeedMediaCredit(buildShortCaption(user, index, batchSeed), mediaAsset, 'Video'),
            'video',
            sharedAudio ? sharedAudio.audio_url : null,
            0,
            sharedAudio ? OFFICIAL_SEED_SHORT_AUDIO_DURATION : 30,
            'cover',
            0,
            null,
            null,
            OFFICIAL_SEED_SOURCE
          ]
        );
        continue;
      }

      await connection.query(
        `
          INSERT INTO statuses (
            user_id,
            media_url,
            media_type,
            media_name,
            media_size,
            caption,
            media_fit,
            expires_at,
            source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), ?)
        `,
        [
          user.id,
          mediaAsset.publicUrl,
          mediaAsset.mimeType || 'application/octet-stream',
          mediaAsset.mediaName,
          mediaAsset.mediaSize,
          appendOfficialSeedMediaCredit(
            buildStatusCaption(user, index, batchSeed),
            mediaAsset,
            mediaAsset.mediaType === 'video' ? 'Video' : 'Photo'
          ),
          mediaAsset.mediaType === 'video' ? 'contain' : 'cover',
          OFFICIAL_SEED_SOURCE
        ]
      );
    }

    await connection.commit();
    const summary = await getOfficialSeedSummary();

    return {
      generatedCount: generationCount,
      contentType: normalizedType,
      sourceMode: preparedPool.sourceMode,
      summary
    };
  } catch (error) {
    await connection.rollback();
    await Promise.all(createdFiles.map((filePath) => safeUnlink(filePath)));
    throw error;
  } finally {
    connection.release();
  }
}

function collectManagedFilePaths(urls) {
  return Array.from(new Set(
    (Array.isArray(urls) ? urls : [])
      .map((url) => toAbsolutePublicPath(url))
      .filter((absolutePath) => absolutePath && absolutePath.startsWith(OFFICIAL_SEED_UPLOAD_ROOT))
  ));
}

async function deleteOfficialSeedAccounts() {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await ensureSchema(connection);

    const [officialUsers] = await connection.query(
      `
        SELECT id, avatar
        FROM users
        WHERE account_type = ?
        ORDER BY id ASC
      `,
      [OFFICIAL_SEED_ACCOUNT_TYPE]
    );

    if (!officialUsers.length) {
      await connection.commit();
      return {
        deletedAccounts: 0,
        deletedPosts: 0,
        deletedReels: 0,
        deletedStatuses: 0,
        summary: await getOfficialSeedSummary()
      };
    }

    const userIds = officialUsers.map((user) => Number(user.id)).filter(Number.isFinite);
    const placeholders = userIds.map(() => '?').join(', ');

    const [posts] = await connection.query(
      `SELECT id, image_url, image_url_2, image_url_3, image_url_4, thumbnail_url FROM posts WHERE user_id IN (${placeholders})`,
      userIds
    );
    const [reels] = await connection.query(
      `SELECT id, video_url, audio_url FROM reels WHERE user_id IN (${placeholders})`,
      userIds
    );
    const [statuses] = await connection.query(
      `SELECT id, media_url FROM statuses WHERE user_id IN (${placeholders})`,
      userIds
    );

    const postIds = posts.map((post) => Number(post.id)).filter(Number.isFinite);
    const reelIds = reels.map((reel) => Number(reel.id)).filter(Number.isFinite);

    if (postIds.length) {
      const postIdPlaceholders = postIds.map(() => '?').join(', ');
      await connection.query(`DELETE FROM post_daily_unique_views WHERE post_id IN (${postIdPlaceholders})`, postIds);
    }
    await connection.query(
      `DELETE FROM post_daily_unique_views WHERE viewer_user_id IN (${placeholders})`,
      userIds
    );

    if (reelIds.length) {
      const reelIdPlaceholders = reelIds.map(() => '?').join(', ');
      await connection.query(`DELETE FROM reel_daily_unique_views WHERE reel_id IN (${reelIdPlaceholders})`, reelIds);
    }
    await connection.query(
      `DELETE FROM reel_daily_unique_views WHERE viewer_user_id IN (${placeholders})`,
      userIds
    );

    await connection.query(
      `DELETE FROM users WHERE account_type = ?`,
      [OFFICIAL_SEED_ACCOUNT_TYPE]
    );

    await connection.commit();

    const filePathsToDelete = collectManagedFilePaths([
      ...officialUsers.map((user) => user.avatar),
      ...posts.flatMap((post) => [post.image_url, post.image_url_2, post.image_url_3, post.image_url_4, post.thumbnail_url]),
      ...reels.flatMap((reel) => [reel.video_url, reel.audio_url]),
      ...statuses.map((status) => status.media_url)
    ]);

    await Promise.all(filePathsToDelete.map((filePath) => safeUnlink(filePath)));

    const summary = await getOfficialSeedSummary();
    return {
      deletedAccounts: officialUsers.length,
      deletedPosts: posts.length,
      deletedReels: reels.length,
      deletedStatuses: statuses.length,
      summary
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  OFFICIAL_SEED_ACCOUNT_TYPE,
  OFFICIAL_SEED_SOURCE,
  OFFICIAL_SEED_ACCOUNT_BATCH_SIZE,
  OFFICIAL_SEED_CONTENT_BATCH_SIZE,
  invalidateCaches: invalidateOfficialSeedCaches,
  ensureSchema,
  getSummary: getOfficialSeedSummary,
  createOfficialSeedAccounts,
  generateOfficialSeedContent,
  deleteOfficialSeedAccounts
};
