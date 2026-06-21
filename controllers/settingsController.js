const User = require('../models/User');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const KycRequest = require('../models/KycRequest');
const Event = require('../models/Event');
const HiddenPost = require('../models/HiddenPost');
const PlatformRevenue = require('../models/PlatformRevenue');
const db = require('../config/db');
const { buildMessageInboxSections } = require('../utils/messageInbox');
const { normalizeLocale, createTranslator } = require('../utils/i18n');
const { getNumberSetting } = require('../utils/appSettings');

const PREMIUM_FEATURES = [
  {
    icon: 'badge-check',
    titleKey: 'settings.premiumBadgeTitle',
    descriptionKey: 'settings.premiumBadgeDescription',
    title: 'Premium badge',
    description: 'Stand out with a premium badge on your profile and posts.'
  },
  {
    icon: 'sparkles',
    titleKey: 'settings.priorityPlacementTitle',
    descriptionKey: 'settings.priorityPlacementDescription',
    title: 'Priority placement',
    description: 'Your profile appears higher in follow and message discovery.'
  },
  {
    icon: 'bar-chart-3',
    titleKey: 'settings.creatorAnalyticsTitle',
    descriptionKey: 'settings.creatorAnalyticsDescription',
    title: 'Creator analytics',
    description: 'Unlock a clearer view of follower growth and engagement.'
  },
  {
    icon: 'palette',
    titleKey: 'settings.profileAccentsTitle',
    descriptionKey: 'settings.profileAccentsDescription',
    title: 'Profile accents',
    description: 'Enable richer profile accents and premium layout details.'
  },
  {
    icon: 'shield-check',
    titleKey: 'settings.trustLayerTitle',
    descriptionKey: 'settings.trustLayerDescription',
    title: 'Trust layer',
    description: 'Premium accounts get a more polished trust signal.'
  },
  {
    icon: 'rocket',
    titleKey: 'settings.growthBoostTitle',
    descriptionKey: 'settings.growthBoostDescription',
    title: 'Growth boost',
    description: 'Automatically unlock premium when you reach your growth goal.'
  }
];

class SettingsController {
  static async getSettings(req, res) {
    try {
      const currentUserId = req.session.userId;
      let currentUser = await User.getById(currentUserId);

      if (!currentUser) {
        req.session.destroy();
        return res.redirect('/auth/login');
      }

      const contacts = await User.getContactsWithFollowState(currentUserId);
      const messages = await Message.getRecentForUser(currentUserId);
      const messageInbox = buildMessageInboxSections(currentUserId, contacts, messages);
      const [notifications, unreadNotificationCount] = await Promise.all([
        Notification.getRecentForUser(currentUserId, 12),
        Notification.getUnreadCount(currentUserId)
      ]);

      const followersCount = await User.getFollowersCount(currentUserId);
      const followingCount = await User.getFollowingCount(currentUserId);
      const postLikes = await Post.getTotalLikesForUser(currentUserId);
      const reelLikes = await Reel.getTotalLikesForUser(currentUserId);
      const totalLikesCount = Number(postLikes) + Number(reelLikes);
      const currentLocale = normalizeLocale(currentUser.preferred_language || req.session.locale || 'en');
      const translate = createTranslator(currentLocale);
      const eventsUnlockFee = await getNumberSetting('events_unlock_fee', 0);
      const tokenPriceUsd = await getNumberSetting('token_price_usd', 0.1);
      const dashboard = await Event.getDashboard(currentUserId);

      await User.maybeAutoActivatePremium(currentUserId, followersCount);
      await User.maybeAutoActivateEvents(currentUserId, followersCount);
      currentUser = await User.getById(currentUserId);
      const premiumEligibility = await User.getPremiumEligibility(currentUserId, followersCount);
      const premiumKycRequest = await KycRequest.getByUserId(currentUserId);
      const eventKycRequest = await KycRequest.getByUserIdAndType(currentUserId, 'events');
      const hiddenPostsRaw = await HiddenPost.getHiddenPostsForUser(currentUserId);
      const hiddenPosts = Array.isArray(hiddenPostsRaw)
        ? hiddenPostsRaw.map((post) => {
            const safeUsername = String(post?.author_username || '').trim().replace(/^@+/, '') || 'unknown';
            return {
              ...post,
              author_username: safeUsername,
              author_name: safeUsername
            };
          })
        : [];

      const premiumFollowersThreshold = Number(currentUser.premium_followers_threshold || 1000);
      const premiumProgress = premiumFollowersThreshold > 0
        ? Math.min(100, Math.round((followersCount / premiumFollowersThreshold) * 100))
        : 0;
      const eventsFollowersThreshold = Number(currentUser.events_followers_threshold || 1000);
      const eventsProgress = eventsFollowersThreshold > 0
        ? Math.min(100, Math.round((followersCount / eventsFollowersThreshold) * 100))
        : 0;
      const tokenSwapStatus = String(req.query.token_swap || '').toLowerCase();
      const tokenSwapModal = tokenSwapStatus
        ? {
            tone: tokenSwapStatus === 'success' ? 'success' : 'error',
            amount: Number.parseFloat(req.query.swap_amount || '0'),
            tokens: Number.parseFloat(req.query.swap_tokens || '0'),
            message: String(req.query.swap_message || '').trim()
          }
        : null;

      res.render('settings', {
        currentUser,
        followersCount,
        followingCount,
        totalLikesCount,
        messageInbox,
        premiumFeatures: PREMIUM_FEATURES,
        premiumProgress,
        premiumEligibility,
        premiumKycRequest,
        eventKycRequest,
        eventsProgress,
        eventsFollowersThreshold,
        eventsUnlockFee,
        tokenPriceUsd,
        languageOptions: [
          { code: 'en', label: translate('settings.languageEnglish', 'English') },
          { code: 'fr', label: translate('settings.languageFrench', 'French') },
          { code: 'es', label: translate('settings.languageSpanish', 'Spanish') }
        ],
        currentLanguage: currentLocale,
        notifications,
        unreadNotificationCount,
        hiddenPosts,
        dashboard,
        tokenSwapModal,
        settingsStatus: tokenSwapModal ? null : (req.query.success || null),
        settingsError: tokenSwapModal ? null : (req.query.error || null),
        activeTab: 'settings'
      });
    } catch (err) {
      console.error('Settings page error:', err);
      res.status(500).send('Error while loading the settings page.');
    }
  }

  static async updateLanguage(req, res) {
    try {
      const currentUserId = req.session.userId;
      const locale = normalizeLocale(req.body?.language);
      await User.updateLanguagePreference(currentUserId, locale);
      req.session.locale = locale;
      return res.redirect('/settings?success=Language+updated+successfully');
    } catch (err) {
      console.error('Language update error:', err);
      return res.redirect('/settings?error=Unable+to+update+language');
    }
  }

  static async updatePremiumPreferences(req, res) {
    try {
      const currentUserId = req.session.userId;
      await User.updatePremiumPreferences(currentUserId, {
        unlockMethod: 'auto_followers',
        followersThreshold: (await User.getById(currentUserId))?.premium_followers_threshold || 1000
      });
      return res.redirect('/settings?success=Premium+preferences+saved');
    } catch (err) {
      console.error('Premium preferences update error:', err);
      return res.redirect('/settings?error=Unable+to+save+premium+preferences');
    }
  }

  static async updateEventAccessPreferences(req, res) {
    try {
      return res.redirect('/settings?error=This+setting+is+managed+by+administration');
    } catch (err) {
      console.error('Event access update error:', err);
      return res.redirect('/settings?error=Unable+to+save+event+access');
    }
  }

  static async activatePremium(req, res) {
    try {
      return res.redirect('/settings?error=Premium+is+automatic+and+no+manual+activation+is+available');
    } catch (err) {
      console.error('Premium activation error:', err);
      return res.redirect('/settings?error=Unable+to+update+premium+status');
    }
  }

  static async requestKyc(req, res) {
    try {
      const currentUserId = req.session.userId;
      const currentUser = await User.getById(currentUserId);
      if (!currentUser) {
        return res.redirect('/auth/login');
      }

      await KycRequest.createOrUpdatePending(currentUserId, 'Premium KYC requested from settings.');
      return res.redirect('/settings?success=KYC+request+sent');
    } catch (err) {
      console.error('KYC request error:', err);
      return res.redirect('/settings?error=Unable+to+request+KYC');
    }
  }

  static async swapDepositToTokens(req, res) {
    try {
      const currentUserId = req.session.userId;
      const rawAmount = String(req.body?.deposit_amount ?? '').trim();
      const depositAmount = Number.parseFloat(rawAmount);

      if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
        return res.redirect('/settings?token_swap=error&swap_message=Please+enter+a+valid+deposit+amount');
      }

      const tokenPriceUsd = await getNumberSetting('token_price_usd', 0.1);
      if (!Number.isFinite(tokenPriceUsd) || tokenPriceUsd <= 0) {
        return res.redirect('/settings?token_swap=error&swap_message=Token+price+is+not+configured');
      }

      const normalizedDepositAmount = Math.round(depositAmount * 100) / 100;
      const tokenAmount = Math.round((normalizedDepositAmount / tokenPriceUsd) * 10000) / 10000;

      if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
        return res.redirect('/settings?token_swap=error&swap_message=Unable+to+calculate+the+token+amount');
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
          'SELECT id, deposit_account_balance, token_balance FROM users WHERE id = ? FOR UPDATE',
          [currentUserId]
        );

        if (!rows || rows.length === 0) {
          await connection.rollback();
          req.session.destroy(() => {});
          return res.redirect('/auth/login');
        }

        const user = rows[0];
        const currentDepositBalance = Number(user.deposit_account_balance || 0);
        if (currentDepositBalance < normalizedDepositAmount) {
          await connection.rollback();
          return res.redirect('/settings?token_swap=error&swap_message=Insufficient+deposit+balance');
        }

        await connection.query(
          `
            UPDATE users
            SET deposit_account_balance = deposit_account_balance - ?,
                token_balance = token_balance + ?
            WHERE id = ?
          `,
          [normalizedDepositAmount, tokenAmount, currentUserId]
        );

        await PlatformRevenue.recordUsd({
          amount: normalizedDepositAmount,
          entryType: 'token_swap_purchase',
          payerUserId: currentUserId,
          referenceId: `token-swap-${currentUserId}-${Date.now()}`,
          note: `Deposit to token swap (${tokenAmount.toFixed(4)} tokens issued)`,
          connection
        });

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      return res.redirect(
        `/settings?token_swap=success&swap_amount=${encodeURIComponent(normalizedDepositAmount.toFixed(2))}&swap_tokens=${encodeURIComponent(tokenAmount.toFixed(4))}`
      );
    } catch (err) {
      console.error('Token swap error:', err);
      return res.redirect('/settings?token_swap=error&swap_message=Unable+to+swap+deposit+to+tokens');
    }
  }
}

module.exports = SettingsController;
