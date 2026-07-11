const Hashtag = require('../models/Hashtag');
const User = require('../models/User');
const PlatformRevenue = require('../models/PlatformRevenue');

class HashtagController {
  // API: Get all hashtags
  static async getAll(req, res) {
    try {
      const hashtags = await Hashtag.getAll();
      res.json(hashtags);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }

  // API: Create a new hashtag
  static async create(req, res) {
    try {
      const currentUserId = req.session.userId;
      if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });

      let { name, isPaid } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });
      isPaid = Number(isPaid) === 1 || isPaid === true || isPaid === 'true';

      // Clean name
      name = name.trim().toLowerCase();
      if (name.startsWith('#')) name = name.substring(1);

      // Check if it already exists
      const existing = await Hashtag.getByName(name);
      if (existing) {
        return res.status(400).json({ error: 'Hashtag already exists' });
      }

      const CREATION_COST = 0.5;
      let updatedTokenBalance = null;

      if (isPaid) {
        const currentUser = await User.getById(currentUserId);
        if (Number(currentUser?.token_balance || 0) < CREATION_COST) {
          return res.status(400).json({ error: 'Insufficient token balance. You need 0.5 tokens to create a premium hashtag.' });
        }

        const db = require('../config/db');
        await db.execute('UPDATE users SET token_balance = token_balance - ? WHERE id = ?', [CREATION_COST, currentUserId]);
        await PlatformRevenue.recordTokens({
          amountTokens: CREATION_COST,
          entryType: 'hashtag_creation_fee',
          payerUserId: currentUserId,
          referenceId: `hashtag:${name}`,
          note: 'Premium hashtag creation cost'
        });

        const refreshedUser = await User.getById(currentUserId);
        updatedTokenBalance = Number(refreshedUser?.token_balance || 0);
      }

      const price = isPaid ? 0.10 : 0.00; // Fixed at 0.10$ if paid
      const hashtagId = await Hashtag.create(name, currentUserId, isPaid, price);

      res.json({ success: true, id: hashtagId, name, isPaid, tokenBalance: updatedTokenBalance });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }

  // API: Check a hashtag
  static async check(req, res) {
    try {
      let { name } = req.query;
      if (!name) return res.status(400).json({ error: 'Name required' });
      if (name.startsWith('#')) name = name.substring(1);

      const db = require('../config/db');
      let hashtag = await Hashtag.getDetailsByName(name);
      if (!hashtag) {
        // Find usage stats dynamically from posts if not officially created
        const [countRows] = await db.execute(`
          SELECT COUNT(*) as usage_count FROM posts p
          WHERE LOWER(COALESCE(p.content, '')) REGEXP CONCAT('(^|[^a-z0-9_])#', LOWER(?), '([^a-z0-9_]|$)')
        `, [name]);
        const usageCount = countRows[0]?.usage_count || 0;

        // Try to find the first user who posted this hashtag as the logical creator
        const [firstUserRows] = await db.execute(`
          SELECT u.id, u.username, u.first_name, u.last_name, u.avatar
          FROM posts p
          JOIN users u ON p.user_id = u.id
          WHERE LOWER(COALESCE(p.content, '')) REGEXP CONCAT('(^|[^a-z0-9_])#', LOWER(?), '([^a-z0-9_]|$)')
          ORDER BY p.created_at ASC LIMIT 1
        `, [name]);

        const creator = firstUserRows[0] || {
          id: 1,
          username: 'admin',
          first_name: 'TrasX',
          last_name: 'Admin',
          avatar: ''
        };

        hashtag = {
          name: name,
          creator_id: creator.id,
          is_paid: name.toLowerCase().includes('trade') || name.toLowerCase().includes('p2p') ? 1 : 0,
          price: name.toLowerCase().includes('trade') || name.toLowerCase().includes('p2p') ? 0.10 : 0.00,
          usage_count: usageCount,
          first_name: creator.first_name,
          last_name: creator.last_name,
          username: creator.username,
          avatar: creator.avatar
        };
      }

      // Find distinct users who used this hashtag
      const [usersUsed] = await db.execute(`
        SELECT DISTINCT u.id, u.username, u.first_name, u.last_name, u.avatar
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE LOWER(COALESCE(p.content, '')) REGEXP CONCAT('(^|[^a-z0-9_])#', LOWER(?), '([^a-z0-9_]|$)')
        LIMIT 20
      `, [name]);

      hashtag.used_by = usersUsed;
      hashtag.exists = true;
      res.json(hashtag);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
}

module.exports = HashtagController;
