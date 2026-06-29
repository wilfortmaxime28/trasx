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
const OFFICIAL_SEED_HTTP_HEADERS = {
  'User-Agent': 'TRASX Official Seed Bot/1.0',
  'Accept': '*/*'
};

const PUBLIC_ROOT = path.join(__dirname, '../public');
const OFFICIAL_SEED_LIBRARY_ROOT = path.join(PUBLIC_ROOT, 'assets/official-seed-media');
const OFFICIAL_SEED_UPLOAD_ROOT = path.join(PUBLIC_ROOT, 'uploads/official-seed');
const OFFICIAL_SEED_AVATAR_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'avatars');
const OFFICIAL_SEED_POST_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'posts');
const OFFICIAL_SEED_REEL_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'reels');
const OFFICIAL_SEED_STATUS_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'statuses');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.ogg']);

const OFFICIAL_SEED_FIRST_NAMES = [
  'Amelie', 'Sofia', 'Emma', 'Chloe', 'Jade', 'Camille', 'Lina', 'Sarah', 'Elena', 'Mila',
  'Noah', 'Lucas', 'Ethan', 'Gabriel', 'Nathan', 'Julien', 'Matteo', 'Daniel', 'Samuel', 'David',
  'Ines', 'Lea', 'Maya', 'Anais', 'Mia', 'Nina', 'Eva', 'Rose', 'Clara', 'Louise',
  'Alicia', 'Maelle', 'Iris', 'Celine', 'Nora', 'Yasmine', 'Melissa', 'Ariana', 'Kiara', 'Selena',
  'Hugo', 'Leo', 'Adam', 'Louis', 'Maxime', 'Raphael', 'Theo', 'Victor', 'Amos', 'Kenzo',
  'Rayan', 'Yanis', 'Mathis', 'Arthur', 'Bastien', 'Enzo', 'Marius', 'Alexis', 'Kevin', 'Andre'
];

const OFFICIAL_SEED_LAST_NAMES = [
  'Pierre', 'Dubois', 'Laurent', 'Morel', 'Bernard', 'Joseph', 'Martin', 'Garcia', 'Thomas', 'Petit',
  'Mercier', 'Roux', 'Simon', 'Fontaine', 'Durand', 'Morin', 'Lopez', 'Charles', 'Benoit', 'Michel',
  'Renaud', 'Colin', 'Blanchard', 'Henry', 'Baptiste', 'Germain', 'Leroy', 'Marchand', 'Robin', 'Masson',
  'Delorme', 'Baron', 'Chevalier', 'Renard', 'Moulin', 'Pascal', 'Roche', 'Descamps', 'Valentin', 'Navarro'
];

const OFFICIAL_SEED_USERNAME_SUFFIXES = [
  'studio', 'daily', 'media', 'focus', 'vibes', 'inside', 'stories', 'journal', 'creative', 'network',
  'social', 'people', 'circle', 'vision', 'online', 'signals', 'express', 'direct', 'central', 'official'
];

const PROFILE_THEMES = [
  { label: 'Culture', country: 'France', tag: '#CultureTRASX' },
  { label: 'Sport', country: 'Brazil', tag: '#SportTRASX' },
  { label: 'Music', country: 'United States', tag: '#MusicTRASX' },
  { label: 'Tech', country: 'Canada', tag: '#TechTRASX' },
  { label: 'Lifestyle', country: 'Spain', tag: '#LifestyleTRASX' },
  { label: 'Gaming', country: 'Japan', tag: '#GamingTRASX' },
  { label: 'Humour', country: 'Haiti', tag: '#HumourTRASX' },
  { label: 'Newsroom', country: 'United Kingdom', tag: '#InsideTRASX' },
  { label: 'Motion', country: 'South Korea', tag: '#MotionTRASX' },
  { label: 'Studio', country: 'Nigeria', tag: '#StudioTRASX' }
];

const FEED_OPENERS = [
  'Petit signal positif de la journée',
  'Le feed TRASX démarre avec une note propre',
  'Un contenu simple, visuel et clair pour lancer la discussion',
  'On garde le rythme avec une publication légère et utile',
  'Une publication pensée pour donner de la vie au feed'
];

const FEED_BODY_VARIANTS = {
  Culture: [
    'La culture circule mieux quand on la partage avec une vraie intention.',
    'Un bon visuel peut ouvrir une vraie conversation sur les idées et les tendances.'
  ],
  Sport: [
    'La discipline et l energie collective restent toujours des moteurs puissants.',
    'Le sport raconte souvent les meilleurs exemples de constance et de mental.'
  ],
  Music: [
    'Le son, le rythme et l image peuvent porter une ambiance en quelques secondes.',
    'Une bonne vibration musicale transforme vite un moment simple en souvenir fort.'
  ],
  Tech: [
    'La technologie utile reste celle qui rend les usages plus fluides et plus humains.',
    'Construire vite, mais proprement, change tout dans une plateforme qui veut durer.'
  ],
  Lifestyle: [
    'Les petites habitudes elegantes construisent souvent les plus grands resultats.',
    'Le lifestyle, c est aussi la facon de rendre le quotidien plus net et plus inspire.'
  ],
  Gaming: [
    'Le jeu apprend le timing, la lecture et la capacite de rebondir sans bruit.',
    'Les univers gaming vivent mieux quand la communaute partage ses moments forts.'
  ],
  Humour: [
    'Un peu d humour bien place fait parfois plus de bien qu un long discours.',
    'Le contenu leger garde souvent l audience plus longtemps qu on ne le pense.'
  ],
  Newsroom: [
    'Les coulisses d une plateforme meritent aussi des formats simples et transparents.',
    'Partager les mouvements internes aide a creer une relation plus saine avec la communaute.'
  ],
  Motion: [
    'Le mouvement attire l oeil, mais la coherence retient vraiment l utilisateur.',
    'Une bonne dynamique visuelle donne du souffle a tout le produit.'
  ],
  Studio: [
    'Un studio creatif solide avance avec regularite, details et identite.',
    'Le travail de fond produit souvent les contenus les plus durables.'
  ]
};

const SHORTS_HOOKS = [
  'Format court, energie directe.',
  'Quelques secondes pour installer une ambiance nette.',
  'Un short simple pour garder le flux vivant.',
  'Contenu vertical, rythme rapide, message clair.',
  'Le bon format pour une attention immediate.'
];

const STATUS_HOOKS = [
  'Mise a jour officielle TRASX.',
  'Instant rapide depuis les comptes officiels.',
  'Signal court pour garder la presence active.',
  'Petit passage dans les status de la plateforme.'
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

function buildLocalSummaryText(count, label) {
  const total = Number(count) || 0;
  return `${total} media · ${label}`;
}

function getThemeKeyword(themeLabel = 'Studio') {
  const normalized = String(themeLabel || 'Studio').trim().toLowerCase();
  if (normalized === 'culture') return 'art culture people';
  if (normalized === 'sport') return 'sport training people';
  if (normalized === 'music') return 'music studio artist';
  if (normalized === 'tech') return 'technology laptop creator';
  if (normalized === 'lifestyle') return 'lifestyle city people';
  if (normalized === 'gaming') return 'gaming setup player';
  if (normalized === 'humour') return 'friends laughing fun';
  if (normalized === 'newsroom') return 'team newsroom office';
  if (normalized === 'motion') return 'dance motion people';
  return 'creative studio people';
}

function buildPexelsPhotoQueries(kind = 'feed') {
  if (kind === 'avatar') {
    return [
      'portrait smiling woman natural light',
      'portrait smiling man natural light',
      'casual creator portrait outdoors',
      'friendly professional portrait person',
      'young adult portrait soft daylight',
      'editorial face portrait lifestyle',
      'street portrait confident person'
    ];
  }

  return PROFILE_THEMES.map((theme) => {
    const keyword = getThemeKeyword(theme.label);
    if (kind === 'status') {
      return `${keyword} vertical story moment`;
    }
    return `${keyword} lifestyle editorial`;
  });
}

function buildPexelsVideoQueries(kind = 'shorts') {
  return PROFILE_THEMES.map((theme) => {
    const keyword = getThemeKeyword(theme.label);
    if (kind === 'status') {
      return `${keyword} short vertical clip`;
    }
    if (kind === 'feed') {
      return `${keyword} lifestyle cinematic clip`;
    }
    return `${keyword} vertical motion`;
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
        ? 'Internet · photos et videos Pexels actives'
        : 'Internet requis · enregistrez une clé Pexels',
      shortsSummaryText: remoteProviderEnabled
        ? 'Internet · Pexels API active'
        : 'Internet requis · enregistrez une clé Pexels',
      statusSummaryText: remoteProviderEnabled
        ? 'Internet · Pexels API active'
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
    const videoPoolTarget = Math.max(1, Math.floor(poolSize * 0.35));
    const images = await collectPexelsAssets(
      buildPexelsPhotoQueries('feed'),
      poolSize,
      searchPexelsPhotos,
      { perPage: 18, orientation: 'landscape' }
    );
    const videos = await collectPexelsAssets(
      buildPexelsVideoQueries('feed'),
      videoPoolTarget,
      searchPexelsVideos,
      { perPage: 14, orientation: 'landscape', size: 'medium' }
    );

    return mergeAssetPools(images, videos, poolSize);
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
    const videoPoolTarget = Math.max(3, Math.floor(poolSize * 0.4));
    const images = await collectPexelsAssets(
      buildPexelsPhotoQueries('status'),
      poolSize,
      searchPexelsPhotos,
      { perPage: 14, orientation: 'portrait' }
    );
    const videos = await collectPexelsAssets(
      buildPexelsVideoQueries('status'),
      videoPoolTarget,
      searchPexelsVideos,
      { perPage: 10, orientation: 'portrait', size: 'small' }
    );

    return mergeAssetPools(images, videos, poolSize);
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
  const theme = PROFILE_THEMES[(slotNumber - 1) % PROFILE_THEMES.length];
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
    bio: `Compte officiel TRASX gere par la plateforme pour animer le contenu initial autour de ${theme.label.toLowerCase()}. ${theme.tag} #OfficialTRASX`,
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

function buildFeedContent(user, slotIndex) {
  const themeLabel = String(user.theme_label || 'Studio');
  const tag = String(user.theme_tag || '#OfficialTRASX');
  const bodyOptions = FEED_BODY_VARIANTS[themeLabel] || FEED_BODY_VARIANTS.Studio;
  const opener = FEED_OPENERS[slotIndex % FEED_OPENERS.length];
  const body = bodyOptions[slotIndex % bodyOptions.length];
  return `${opener}. ${body} ${tag} #OfficialTRASX #Trasx`;
}

function buildShortCaption(user, slotIndex) {
  const themeLabel = String(user.theme_label || 'Studio');
  const tag = String(user.theme_tag || '#OfficialTRASX');
  const hook = SHORTS_HOOKS[slotIndex % SHORTS_HOOKS.length];
  return `${hook} Univers ${themeLabel.toLowerCase()} en avant sur TRASX. ${tag} #ShortsTRASX`;
}

function buildShortSoundName(user, slotIndex) {
  const themeLabel = String(user.theme_label || 'Studio');
  const soundLabels = ['Pulse', 'Flow', 'Beat', 'Motion', 'Signal'];
  return `TRASX ${themeLabel} ${soundLabels[slotIndex % soundLabels.length]}`;
}

function buildStatusCaption(user, slotIndex) {
  const themeLabel = String(user.theme_label || 'Studio');
  const tag = String(user.theme_tag || '#OfficialTRASX');
  const hook = STATUS_HOOKS[slotIndex % STATUS_HOOKS.length];
  return `${hook} Capsule ${themeLabel.toLowerCase()} du moment. ${tag}`;
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

  return rows.map((row, index) => ({
    ...row,
    slotNumber: Number(row.seed_slot) > 0 ? Number(row.seed_slot) : index + 1,
    theme_label: PROFILE_THEMES[index % PROFILE_THEMES.length].label,
    theme_tag: PROFILE_THEMES[index % PROFILE_THEMES.length].tag
  }));
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

    await connection.beginTransaction();

    for (let index = 0; index < generationCount; index += 1) {
      const user = officialUsers[index % officialUsers.length];
      const mediaAsset = preparedAssets[index % preparedAssets.length];

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
            appendOfficialSeedMediaCredit(buildFeedContent(user, index), mediaAsset, isVideoFeedAsset ? 'Video' : 'Photo'),
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
            buildShortSoundName(user, index),
            appendOfficialSeedMediaCredit(buildShortCaption(user, index), mediaAsset, 'Video'),
            'video',
            null,
            0,
            30,
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
            buildStatusCaption(user, index),
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
