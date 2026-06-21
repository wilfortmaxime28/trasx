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

      const hashtag = await Hashtag.getDetailsByName(name);
      if (hashtag) {
        res.json(hashtag);
      } else {
        res.json({ exists: false });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
}

module.exports = HashtagController;
