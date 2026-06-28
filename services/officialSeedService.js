const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const User = require('../models/User');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Status = require('../models/Status');

const OFFICIAL_SEED_ACCOUNT_TYPE = 'official_seed';
const OFFICIAL_SEED_SOURCE = 'official_seed';
const OFFICIAL_SEED_TARGET_COUNT = 100;

const PUBLIC_ROOT = path.join(__dirname, '../public');
const OFFICIAL_SEED_LIBRARY_ROOT = path.join(PUBLIC_ROOT, 'assets/official-seed-media');
const OFFICIAL_SEED_UPLOAD_ROOT = path.join(PUBLIC_ROOT, 'uploads/official-seed');
const OFFICIAL_SEED_AVATAR_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'avatars');
const OFFICIAL_SEED_POST_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'posts');
const OFFICIAL_SEED_REEL_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'reels');
const OFFICIAL_SEED_STATUS_UPLOAD_DIR = path.join(OFFICIAL_SEED_UPLOAD_ROOT, 'statuses');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.ogg']);

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
      avatarSource: avatarPrimary.length ? 'official-library' : 'fallback-library',
      feedSource: feedPrimary.length ? 'official-library' : 'fallback-library',
      shortsSource: shortsPrimary.length ? 'official-library' : 'fallback-library',
      statusSource: statusPrimary.length ? 'official-library' : 'fallback-library'
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

function buildProfileDescriptor(slotNumber) {
  const theme = PROFILE_THEMES[(slotNumber - 1) % PROFILE_THEMES.length];
  const batch = Math.floor((slotNumber - 1) / PROFILE_THEMES.length) + 1;
  const paddedSlot = String(slotNumber).padStart(3, '0');
  const paddedBatch = String(batch).padStart(2, '0');
  const displayName = `TRASX ${theme.label} ${paddedBatch}`;

  return {
    slotNumber,
    theme,
    username: `trasx_official_${paddedSlot}`,
    email: `official.seed${paddedSlot}@trasx.platform`,
    displayName,
    firstName: 'TRASX',
    lastName: `${theme.label} ${paddedBatch}`,
    bio: `Compte officiel TRASX gere par la plateforme pour animer le contenu initial autour de ${theme.label.toLowerCase()}. ${theme.tag} #OfficialTRASX`,
    country: theme.country
  };
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
  const [rows] = await connection.query(
    `
      SELECT
        id,
        username,
        email,
        first_name,
        last_name,
        display_name,
        avatar,
        country,
        bio,
        created_at
      FROM users
      WHERE account_type = ?
      ORDER BY id ASC
    `,
    [OFFICIAL_SEED_ACCOUNT_TYPE]
  );

  return rows.map((row, index) => ({
    ...row,
    slotNumber: index + 1,
    theme_label: PROFILE_THEMES[index % PROFILE_THEMES.length].label,
    theme_tag: PROFILE_THEMES[index % PROFILE_THEMES.length].tag
  }));
}

async function getOfficialSeedSummary(connection = db) {
  await ensureSchema(connection);
  const mediaLibrary = await getMediaLibrary();

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
    targetCount: OFFICIAL_SEED_TARGET_COUNT,
    accountsCount: Number(accountsRow?.total || 0),
    feedCount: Number(feedRow?.total || 0),
    shortsCount: Number(shortsRow?.total || 0),
    statusCount: Number(statusRow?.total || 0),
    mediaLibrary: mediaLibrary.summary
  };
}

async function ensureSchema(connection = db) {
  await User.ensureSchema();
  await Post.ensureSchema();
  await Reel.ensureReelSchema();
  await Status.ensureSchema();

  await ensureColumn(connection, 'users', 'account_type', "VARCHAR(30) NOT NULL DEFAULT 'standard'");
  await ensureColumn(connection, 'posts', 'source', "VARCHAR(30) NOT NULL DEFAULT 'user'");
  await ensureColumn(connection, 'reels', 'source', "VARCHAR(30) NOT NULL DEFAULT 'user'");
  await ensureColumn(connection, 'statuses', 'source', "VARCHAR(30) NOT NULL DEFAULT 'user'");

  await ensureIndex(connection, 'users', 'idx_users_account_type', '(account_type)');
  await ensureIndex(connection, 'posts', 'idx_posts_source_created', '(source, created_at DESC, id DESC)');
  await ensureIndex(connection, 'reels', 'idx_reels_source_created', '(source, created_at DESC, id DESC)');
  await ensureIndex(connection, 'statuses', 'idx_statuses_source_created', '(source, created_at DESC, id DESC)');
}

async function createOfficialSeedAccounts() {
  const connection = await db.getConnection();
  const createdFiles = [];

  try {
    await connection.beginTransaction();
    await ensureSchema(connection);

    const existingUsers = await getOfficialSeedUsers(connection);
    const existingUsernames = new Set(existingUsers.map((user) => String(user.username || '').toLowerCase()));
    const missingDescriptors = [];

    for (let slotNumber = 1; slotNumber <= OFFICIAL_SEED_TARGET_COUNT; slotNumber += 1) {
      const descriptor = buildProfileDescriptor(slotNumber);
      if (!existingUsernames.has(descriptor.username.toLowerCase())) {
        missingDescriptors.push(descriptor);
      }
    }

    if (!missingDescriptors.length) {
      await connection.commit();
      return {
        createdAccounts: 0,
        totalAccounts: existingUsers.length,
        summary: await getOfficialSeedSummary()
      };
    }

    const mediaLibrary = await getMediaLibrary();
    const passwordHash = await bcrypt.hash(`trasx_official_seed_${Date.now()}_platform`, 10);

    for (let index = 0; index < missingDescriptors.length; index += 1) {
      const descriptor = missingDescriptors[index];
      const avatarSource = mediaLibrary.avatars[index % mediaLibrary.avatars.length];
      const avatarAsset = await copyLibraryAsset(
        avatarSource,
        OFFICIAL_SEED_AVATAR_UPLOAD_DIR,
        `official-seed-avatar-${String(descriptor.slotNumber).padStart(3, '0')}`
      );
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
            account_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          'Entreprise',
          'fr',
          'Active',
          1,
          OFFICIAL_SEED_ACCOUNT_TYPE
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
    await connection.beginTransaction();
    await ensureSchema(connection);

    const officialUsers = await getOfficialSeedUsers(connection);
    if (!officialUsers.length) {
      throw new Error('Aucun compte officiel TRASX disponible. Créez les comptes avant de générer du contenu.');
    }

    const mediaLibrary = await getMediaLibrary();

    if (normalizedType === 'feed' && !mediaLibrary.feedImages.length) {
      throw new Error('Aucun media disponible pour alimenter le feed officiel.');
    }
    if (normalizedType === 'shorts' && !mediaLibrary.shortsVideos.length) {
      throw new Error('Aucune video disponible pour alimenter les shorts officiels.');
    }
    if (normalizedType === 'status' && !mediaLibrary.statusMedia.length) {
      throw new Error('Aucun media disponible pour alimenter les status officiels.');
    }

    for (let index = 0; index < officialUsers.length; index += 1) {
      const user = officialUsers[index];

      if (normalizedType === 'feed') {
        const sourcePath = mediaLibrary.feedImages[index % mediaLibrary.feedImages.length];
        const mediaAsset = await copyLibraryAsset(sourcePath, OFFICIAL_SEED_POST_UPLOAD_DIR, `official-seed-post-${user.id}`);
        createdFiles.push(mediaAsset.absolutePath);

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
            buildFeedContent(user, index),
            mediaAsset.publicUrl,
            'image',
            null,
            1,
            OFFICIAL_SEED_SOURCE
          ]
        );
        continue;
      }

      if (normalizedType === 'shorts') {
        const sourcePath = mediaLibrary.shortsVideos[index % mediaLibrary.shortsVideos.length];
        const mediaAsset = await copyLibraryAsset(sourcePath, OFFICIAL_SEED_REEL_UPLOAD_DIR, `official-seed-reel-${user.id}`);
        createdFiles.push(mediaAsset.absolutePath);

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
            buildShortCaption(user, index),
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

      const sourcePath = mediaLibrary.statusMedia[index % mediaLibrary.statusMedia.length];
      const mediaAsset = await copyLibraryAsset(sourcePath, OFFICIAL_SEED_STATUS_UPLOAD_DIR, `official-seed-status-${user.id}`);
      createdFiles.push(mediaAsset.absolutePath);

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
          guessMimeType(sourcePath),
          mediaAsset.mediaName,
          mediaAsset.mediaSize,
          buildStatusCaption(user, index),
          isVideoFile(sourcePath) ? 'contain' : 'cover',
          OFFICIAL_SEED_SOURCE
        ]
      );
    }

    await connection.commit();
    const summary = await getOfficialSeedSummary();

    return {
      generatedCount: officialUsers.length,
      contentType: normalizedType,
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
  OFFICIAL_SEED_TARGET_COUNT,
  ensureSchema,
  getSummary: getOfficialSeedSummary,
  createOfficialSeedAccounts,
  generateOfficialSeedContent,
  deleteOfficialSeedAccounts
};
