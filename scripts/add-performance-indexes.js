/**
 * scripts/add-performance-indexes.js
 * Ajoute les index MySQL nécessaires pour optimiser les performances du feed.
 * Sécurisé : utilise IF NOT EXISTS / IGNORE — ne cassera rien si déjà présent.
 *
 * Exécution : node scripts/add-performance-indexes.js
 */

require('dotenv').config();
const db = require('../config/db');

const indexes = [
  // ── posts ──────────────────────────────────────────────────────────────────
  { table: 'posts',         index: 'idx_posts_created_at',      cols: '(created_at DESC)'           },
  { table: 'posts',         index: 'idx_posts_user_created',    cols: '(user_id, created_at DESC)'  },
  { table: 'posts',         index: 'idx_posts_id_desc',         cols: '(id DESC)'                   },

  // ── likes ──────────────────────────────────────────────────────────────────
  { table: 'likes',         index: 'idx_likes_post',            cols: '(post_id)'                   },
  // (user_id, post_id) est déjà PRIMARY KEY

  // ── comments ───────────────────────────────────────────────────────────────
  { table: 'comments',      index: 'idx_comments_post',         cols: '(post_id)'                   },
  { table: 'comments',      index: 'idx_comments_post_created', cols: '(post_id, created_at)'       },

  // ── follows ────────────────────────────────────────────────────────────────
  { table: 'follows',       index: 'idx_follows_follower',      cols: '(follower_id)'               },
  { table: 'follows',       index: 'idx_follows_following',     cols: '(following_id)'              },

  // ── notifications ──────────────────────────────────────────────────────────
  { table: 'notifications', index: 'idx_notif_recipient_created', cols: '(recipient_id, created_at DESC)' },
  { table: 'notifications', index: 'idx_notif_recipient_unread',  cols: '(recipient_id, is_read)'         },

  // ── messages ───────────────────────────────────────────────────────────────
  { table: 'messages', index: 'idx_msg_sender_receiver', cols: '(sender_id, receiver_id, created_at DESC)' },
  { table: 'messages', index: 'idx_msg_receiver_created', cols: '(receiver_id, created_at DESC)'           },

  // ── reels ──────────────────────────────────────────────────────────────────
  { table: 'reels', index: 'idx_reels_created',      cols: '(created_at DESC)'           },
  { table: 'reels', index: 'idx_reels_user_created', cols: '(user_id, created_at DESC)'  },

  // ── bookmarks ──────────────────────────────────────────────────────────────
  { table: 'bookmarks', index: 'idx_bookmarks_post', cols: '(post_id)' },

  // ── post_daily_unique_views ────────────────────────────────────────────────
  { table: 'post_daily_unique_views', index: 'idx_pdv_post_date',  cols: '(post_id, view_date)' },
  { table: 'post_daily_unique_views', index: 'idx_pdv_date',       cols: '(view_date)'          },

  // ── reel_daily_unique_views (si existe) ────────────────────────────────────
  { table: 'reel_daily_unique_views', index: 'idx_rdv_reel_date',  cols: '(reel_id, view_date)', optional: true },
];

async function tableExists(name) {
  const [rows] = await db.query('SHOW TABLES LIKE ?', [name]);
  return rows.length > 0;
}

async function indexExists(table, indexName) {
  const [rows] = await db.query(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [table, indexName]
  );
  return rows.length > 0;
}

async function run() {
  console.log('🔧 TRASX — Performance Index Migration\n');
  let created = 0;
  let skipped = 0;
  let errors  = 0;

  for (const { table, index, cols, optional } of indexes) {
    try {
      const exists = await tableExists(table);
      if (!exists) {
        if (!optional) console.warn(`  ⚠️  Table "${table}" introuvable — index ignoré`);
        skipped++;
        continue;
      }

      const already = await indexExists(table, index);
      if (already) {
        console.log(`  ✓ ${table}.${index} — déjà présent`);
        skipped++;
        continue;
      }

      await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` ${cols}`);
      console.log(`  ✅ ${table}.${index} — créé`);
      created++;
    } catch (err) {
      console.error(`  ❌ ${table}.${index} — erreur: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nTerminé : ${created} index créé(s), ${skipped} ignoré(s), ${errors} erreur(s)`);
  process.exit(errors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
