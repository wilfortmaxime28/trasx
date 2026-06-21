 const User = require('../models/User');
const Message = require('../models/Message');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Event = require('../models/Event');
const Ad = require('../models/Ad');
const PlatformRevenue = require('../models/PlatformRevenue');
const AdminModerationNotice = require('../models/AdminModerationNotice');
const Notification = require('../models/Notification');
const { buildMessageInboxSections } = require('../utils/messageInbox');
const { getNumberSetting } = require('../utils/appSettings');
const { isNewUserWithinWindow, computePromoDailyTarget } = require('../utils/promoReach');
const presence = require('../utils/presence');
const db = require('../config/db');

class ProfileController {
  static async getProfile(req, res) {
    try {
      const currentUserId = req.session.userId;
      const currentUser = await User.getById(currentUserId);
      
      if (!currentUser) {
        req.session.destroy();
        return res.redirect('/auth/login');
      }

      // Predefined avatar list (DiceBear)
      const presetAvatars = [
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Mimi',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Jack',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Zoey',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Sophie',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Oscar',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Mia',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Riley',
        '/assets/avatar_placeholder.jpg' // Default avatar
      ];

      // Load contacts for the right sidebar
      const contacts = await User.getContactsWithFollowState(currentUserId);

      // Load recent messages for the right sidebar
      const messages = await Message.getRecentForUser(currentUserId);
      const messageInbox = buildMessageInboxSections(currentUserId, contacts, messages);

      // Load social stats
      const followersCount = await User.getFollowersCount(currentUserId);
      const followingCount = await User.getFollowingCount(currentUserId);
      const followersList = await User.getFollowersForProfile(currentUserId, currentUserId);
      const followingList = await User.getFollowingForProfile(currentUserId, currentUserId);
      
      const postLikes = await Post.getTotalLikesForUser(currentUserId);
      const reelLikes = await Reel.getTotalLikesForUser(currentUserId);
      const totalLikesCount = Number(postLikes) + Number(reelLikes);
      const currentUserPresenceText = presence.getPresenceText(true, currentUser.last_seen_at || null);
      const dashboard = await Event.getDashboard(currentUserId);

      // Load posts and reels
      const userPosts = await Post.getByUserId(currentUserId, currentUserId);
      for (const post of userPosts) {
        if (post.challenge_type) {
          const Challenge = require('../models/Challenge');
          post.challenge_participants = await Challenge.getParticipants(post.id);
        }
      }
      const userReels = await Reel.getByUserId(currentUserId);
      const moderationNotices = await AdminModerationNotice.getActiveForUser(currentUserId);
      const minWithdrawalAmount = await getNumberSetting('min_withdrawal_amount', 50);
      const withdrawalFeePercent = await getNumberSetting('withdrawal_fee_percent', 30);
      const activeAds = await Ad.getActiveAds();

      res.render('profile', {
        currentUser,
        contacts,
        messages,
        messageInbox,
        presetAvatars,
        followersCount,
        followingCount,
        followersList,
        followingList,
        totalLikesCount,
        currentUserPresenceText,
        userPosts,
        userReels,
        moderationNotices,
        dashboard,
        minWithdrawalAmount,
        withdrawalFeePercent,
        activeAds,
        activeTab: 'profile',
        success: req.query.success,
        error: req.query.error
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error while loading the profile.');
    }
  }

  static async viewPublicProfile(req, res) {
    try {
      const viewerId = req.session.userId;
      const { username } = req.params;

      const viewerUser = await User.getById(viewerId);
      const profileUser = await User.getByUsername(username);

      if (!viewerUser) {
        req.session.destroy();
        return res.redirect('/auth/login');
      }

      if (!profileUser) {
        return res.status(404).send('Profile not found.');
      }

      const contacts = await User.getContactsWithFollowState(viewerId);
      const messages = await Message.getRecentForUser(viewerId);
      const messageInbox = buildMessageInboxSections(viewerId, contacts, messages);
      const followersCount = await User.getFollowersCount(profileUser.id);
      const followingCount = await User.getFollowingCount(profileUser.id);
      const followersList = await User.getFollowersForProfile(profileUser.id, viewerId);
      const followingList = await User.getFollowingForProfile(profileUser.id, viewerId);
      const viewerFollowingIds = await User.getFollowingIds(viewerId);
      const postLikes = await Post.getTotalLikesForUser(profileUser.id);
      const reelLikes = await Reel.getTotalLikesForUser(profileUser.id);
      const totalLikesCount = Number(postLikes) + Number(reelLikes);
      const userPosts = await Post.getByUserId(profileUser.id, viewerId);
      for (const post of userPosts) {
        if (post.challenge_type) {
          const Challenge = require('../models/Challenge');
          post.challenge_participants = await Challenge.getParticipants(post.id);
        }
      }
      const userReels = await Reel.getByUserId(profileUser.id);
      const profileIsOnline = presence.isUserOnline(profileUser.id);
      const profilePresenceText = presence.getPresenceText(profileIsOnline, profileUser.last_seen_at || null);
      const dashboard = await Event.getDashboard(viewerId);
      const activeAds = await Ad.getActiveAds();

      res.render('publicProfile', {
        currentUser: viewerUser,
        profileUser,
        contacts,
        messages,
        messageInbox,
        followersCount,
        followingCount,
        followersList,
        followingList,
        viewerFollowsProfile: viewerFollowingIds.includes(profileUser.id),
        totalLikesCount,
        profilePresenceText,
        profileIsOnline,
        userPosts,
        userReels,
        dashboard,
        activeAds,
        activeTab: 'profile',
        isOwnProfile: false
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error while loading the public profile.');
    }
  }

  static async updateAvatar(req, res) {
    try {
      const currentUserId = req.session.userId;
      let avatarUrl = req.body.avatarUrl;
      
      if (req.file) {
        avatarUrl = '/assets/uploads/' + req.file.filename;
      }
      
      if (!avatarUrl) {
        return res.redirect('/profile?error=Please select or upload an avatar.');
      }

      await User.updateAvatar(currentUserId, avatarUrl);
      
      res.redirect('/profile?success=Avatar updated successfully.');
    } catch (err) {
      console.error(err);
      res.redirect('/profile?error=Error while updating the avatar.');
    }
  }

  static async updateInfo(req, res) {
    try {
      const currentUserId = req.session.userId;
      const { bio, phone, wallet_address, banner_color } = req.body;
      await User.updateProfile(currentUserId, { bio, phone, wallet_address, banner_color });
      res.redirect('/profile?success=Profile updated successfully.');
    } catch (err) {
      console.error(err);
      res.redirect('/profile?error=Error while updating the profile.');
    }
  }

  static async deletePost(req, res) {
    try {
      const currentUserId = req.session.userId;
      const postId = req.params.id;
      await Post.delete(postId, currentUserId);
      res.redirect('/profile?success=Post deleted.');
    } catch (err) {
      console.error(err);
      res.redirect('/profile?error=Error while deleting.');
    }
  }

  static async deleteReel(req, res) {
    try {
      const currentUserId = req.session.userId;
      const reelId = req.params.id;
      await Reel.delete(reelId, currentUserId);
      res.redirect('/profile?success=Reel deleted.');
    } catch (err) {
      console.error(err);
      res.redirect('/profile?error=Error while deleting.');
    }
  }

  static async createReel(req, res) {
    try {
      const io = req.app.get('io');
      const currentUserId = req.session.userId;
      if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
      const currentUser = await User.getById(currentUserId);
      if (!currentUser) return res.status(401).json({ error: 'Unauthorized' });

      const { caption, sound_name, media_type, audio_start_time, audio_duration, media_fit, is_trade } = req.body;
      let video_url = null;
      let audio_url = null;
      const normalizedMediaFit = media_fit === 'contain' ? 'contain' : 'cover';
      const isTradeShort = is_trade === true || is_trade === 'true' || is_trade === 1 || is_trade === '1';
      let finalIsTrade = 0;
      let finalTradePrice = null;
      let finalLastPossessionUserId = null;
      let paidHashtagCountUsed = 0;
      let reelBaseIncrement = 0;

      const files = req.files || {};
      
      if (media_type === 'video') {
        if (!files.reel_video || files.reel_video.length === 0) {
          return res.status(400).json({ error: 'Video file required.' });
        }
        video_url = `/uploads/reels/${files.reel_video[0].filename}`;
      } else if (media_type === 'image_audio') {
        if (!files.reel_image || files.reel_image.length === 0) {
          return res.status(400).json({ error: 'Image file required.' });
        }
        if (!files.reel_audio || files.reel_audio.length === 0) {
          return res.status(400).json({ error: 'Audio file required.' });
        }
        video_url = `/uploads/reels/${files.reel_image[0].filename}`;
        audio_url = `/uploads/reels/${files.reel_audio[0].filename}`;
      } else if (media_type === 'voice') {
        if (!files.reel_audio || files.reel_audio.length === 0) {
          return res.status(400).json({ error: 'Voice recording required.' });
        }
        audio_url = `/uploads/reels/${files.reel_audio[0].filename}`;
      } else if (media_type === 'audio') {
        if (!files.reel_audio || files.reel_audio.length === 0) {
          return res.status(400).json({ error: 'Audio file required.' });
        }
        audio_url = `/uploads/reels/${files.reel_audio[0].filename}`;
      }

      if (isTradeShort) {
        const tokenBalance = Number(currentUser.token_balance || 0);
        if (tokenBalance < 5) {
          return res.status(400).json({
            error: 'Solde insuffisant pour creer un Trade Short.',
            requiredTokens: 5,
            currentTokens: tokenBalance
          });
        }
        await db.execute('UPDATE users SET token_balance = token_balance - 5 WHERE id = ?', [currentUserId]);
        await PlatformRevenue.recordTokens({
          amountTokens: 5,
          entryType: 'trade_short_creation_fee',
          payerUserId: currentUserId,
          note: 'Trade short creation fee'
        });
        finalIsTrade = 1;
        finalTradePrice = Math.floor(Math.random() * 19) + 2;
        finalLastPossessionUserId = currentUserId;
      }

      const captionText = String(caption || '');
      const paidHashtagMatches = Array.from(new Set((captionText.match(/#(\w+)/g) || []).map((tag) => tag.slice(1).toLowerCase())));
      if (paidHashtagMatches.length > 0) {
        const placeholders = paidHashtagMatches.map(() => '?').join(', ');
        const [paidTags] = await db.query(
          `SELECT id, name, price, creator_id, is_paid FROM hashtags WHERE LOWER(name) IN (${placeholders}) AND is_paid = 1`,
          paidHashtagMatches
        );

        for (const tag of paidTags) {
          const price = Number(tag.price || 0);
          const creatorId = Number(tag.creator_id || 0);
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(creatorId)) {
            continue;
          }

          const [payerRows] = await db.query(
            'SELECT deposit_account_balance FROM users WHERE id = ? LIMIT 1',
            [currentUserId]
          );
          const payerBalance = Number(payerRows[0]?.deposit_account_balance || 0);
          if (payerBalance < price) {
            return res.status(400).json({ error: `Solde insuffisant pour utiliser le hashtag premium #${tag.name}.` });
          }

          await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [price, currentUserId]);
          await db.execute('UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?', [price, creatorId]);
          const notificationMessage = `a utilise votre hashtag premium #${tag.name} dans un short et ${price.toFixed(2)}$ ont ete ajoutes a votre compte de retrait.`;
          const notificationId = await Notification.create({
            recipientId: creatorId,
            actorId: currentUserId,
            type: 'share',
            message: notificationMessage
          });
          const unreadCount = await Notification.getUnreadCount(creatorId);
          io?.to(`user:${creatorId}`).emit('notification-created', {
            id: notificationId,
            recipient_id: creatorId,
            actor_id: currentUserId,
            type: 'share',
            message: notificationMessage,
            post_id: null,
            share_id: null,
            comment_id: null,
            is_read: 0,
            read_at: null,
            created_at: new Date().toISOString(),
            actor_name: `${currentUser.first_name} ${currentUser.last_name}`,
            actor_username: currentUser.username || 'trasx',
            actor_avatar: currentUser.avatar || '/assets/avatar_placeholder.jpg'
          });
          io?.to(`user:${creatorId}`).emit('notification-count-updated', { unreadCount });
          paidHashtagCountUsed += 1;
        }
      }

      const promoWindowDays = await getNumberSetting('new_user_promo_days', 30);
      const paidHashtagViewBonus = await getNumberSetting('paid_hashtag_view_bonus', 50);
      reelBaseIncrement += paidHashtagCountUsed * Math.max(0, Number(paidHashtagViewBonus || 0));
      const currentReelBase = Number(currentUser.promo_reel_daily_base || await getNumberSetting('new_user_daily_view_base', 1000));
      const updatedReelBase = Math.max(0, currentReelBase + reelBaseIncrement);
      if (reelBaseIncrement > 0) {
        await db.execute('UPDATE users SET promo_reel_daily_base = ? WHERE id = ?', [updatedReelBase, currentUserId]);
        currentUser.promo_reel_daily_base = updatedReelBase;
      }
      const promoDailyTarget = computePromoDailyTarget({
        isEligibleNewUser: isNewUserWithinWindow(currentUser.created_at, promoWindowDays),
        baseDailyViews: updatedReelBase,
        paidHashtagCount: 0,
        paidHashtagViewBonus: 0,
        paidBackgroundPrice: 0,
        paidBackgroundViewBonusPerDollar: 0
      });

      await Reel.create({
        user_id: currentUserId,
        video_url,
        sound_name: sound_name || 'Original Audio',
        caption: caption || '',
        media_type,
        audio_url,
        audio_start_time: parseFloat(audio_start_time || 0),
        audio_duration: parseInt(audio_duration || 30),
        media_fit: normalizedMediaFit,
        is_trade: finalIsTrade,
        trade_price: finalTradePrice,
        last_possession_user_id: finalLastPossessionUserId,
        promo_daily_target: promoDailyTarget,
        promo_paid_hashtag_count: paidHashtagCountUsed
      });

      res.json({ success: true, message: 'Short uploaded successfully!' });
    } catch (error) {
      console.error('Create Reel Error:', error);
      res.status(500).json({ error: 'Failed to upload short.' });
    }
  }
}

module.exports = ProfileController;
