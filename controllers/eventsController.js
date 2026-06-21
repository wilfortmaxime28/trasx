const db = require('../config/db');
const fs = require('fs/promises');
const path = require('path');
const { createWorker } = require('tesseract.js');
const Event = require('../models/Event');
const User = require('../models/User');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Ad = require('../models/Ad');
const Message = require('../models/Message');
const EventTicket = require('../models/EventTicket');
const KycRequest = require('../models/KycRequest');
const Admin = require('../models/Admin');
const PlatformRevenue = require('../models/PlatformRevenue');
const { sendEventTicketEmail } = require('../utils/mailer');
const { buildMessageInboxSections } = require('../utils/messageInbox');
const { getNumberSetting } = require('../utils/appSettings');
const { createTranslator, normalizeLocale } = require('../utils/i18n');
const { evaluateEventKycSubmission } = require('../utils/kycAi');
const { isoFromDateObject, normalizeDateToIso } = require('../utils/dateUtils');
const presence = require('../utils/presence');

const TESSERACT_ENG_PATH = path.dirname(require.resolve('@tesseract.js-data/eng/package.json')) + '/4.0.0';
let ocrWorkerPromise = null;

const EVENT_CATEGORY_OPTIONS = ['Community', 'Workshop', 'Networking', 'Product', 'Meetup', 'Party', 'Charity'];
const EVENT_VISIBILITY_OPTIONS = ['public', 'friends', 'private'];
const EVENT_KYC_SELFIE_DIR = path.join(__dirname, '../public/uploads/events/kyc/selfies');

async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2]
  };
}

async function saveDataUrlToFile(dataUrl, directoryPath, prefix = 'file') {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return null;
  }

  await ensureDirectory(directoryPath);
  const extension = parsed.mimeType.split('/')[1] || 'bin';
  const fileName = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`;
  const filePath = path.join(directoryPath, fileName);
  await fs.writeFile(filePath, Buffer.from(parsed.base64, 'base64'));

  return {
    fileName,
    filePath,
    fileUrl: `/uploads/events/kyc/selfies/${fileName}`,
    mimeType: parsed.mimeType,
    size: Buffer.byteLength(parsed.base64, 'base64')
  };
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      console.log('[KYC] Loading OCR worker...');
      const worker = await createWorker('eng', 1, {
        langPath: TESSERACT_ENG_PATH,
        logger: (message) => {
          if (message?.status) {
            const progress = Number.isFinite(Number(message.progress))
              ? ` ${(Number(message.progress) * 100).toFixed(0)}%`
              : '';
            console.log(`[KYC OCR] ${message.status}${progress}`);
          }
        }
      });
      console.log('[KYC] OCR worker ready.');
      return worker;
    })().catch((error) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }

  return ocrWorkerPromise;
}

async function extractOcrTextFromImage(filePath) {
  const worker = await getOcrWorker();
  const result = await worker.recognize(filePath);
  return String(result?.data?.text || '').trim();
}

function wantsJsonResponse(req) {
  return String(req.headers.accept || '').includes('application/json')
    || String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest'
    || String(req.query?.format || '').toLowerCase() === 'json';
}

function formatDateForSql(value) {
  return normalizeDateToIso(value);
}

function getUnlockMessages(req) {
  const locale = normalizeLocale(req.session?.locale || 'en');
  const t = createTranslator(locale);
  return {
    paymentSuccess: t('events.unlockPaymentSuccess', 'Payment received. Please complete KYC. Rejected requests are non-refundable.'),
    continueKyc: t('events.unlockPaymentContinueKyc', 'Your payment was accepted. Continue KYC to unlock event access.'),
    alreadyUnlocked: t('events.unlockPaymentAlreadyUnlocked', 'Event access is already active.'),
    insufficientBalance: t('events.unlockPaymentInsufficient', 'You need more deposit balance to unlock events.'),
    feeMissing: t('events.unlockPaymentFeeMissing', 'The admin has not configured the event unlock fee yet.'),
    missingAdmin: t('events.unlockPaymentAdminMissing', 'No admin account is available to receive this payment.'),
    unableToUnlock: t('events.unlockPaymentFailed', 'Unable to unlock events right now.')
  };
}

function buildTicketConversationPayload(partnerUser, previewText, followingIds = [], followerIds = []) {
  if (!partnerUser) return null;
  const partnerId = Number(partnerUser.id || 0);
  if (!partnerId) return null;

  const isFollowing = followingIds.includes(partnerId);
  const isFollowedBy = followerIds.includes(partnerId);
  const isMutual = isFollowing && isFollowedBy;
  const category = 'general';
  const isOnline = presence.isUserOnline(partnerId);
  const presenceText = presence.getPresenceText(isOnline, partnerUser.last_seen_at || null);

  return {
    contactId: partnerId,
    contactName: `${partnerUser.first_name || ''} ${partnerUser.last_name || ''}`.trim() || partnerUser.username || 'Conversation',
    contactUsername: partnerUser.username || '',
    contactAvatar: partnerUser.avatar || '/assets/avatar_placeholder.jpg',
    preview: previewText,
    timeText: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    category,
    isFollowing,
    isFollowedBy,
    isMutual,
    isOnline,
    presenceText
  };
}

class EventsController {
  static async getEvents(req, res) {
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

      const followersCount = await User.getFollowersCount(currentUserId);
      const followingCount = await User.getFollowingCount(currentUserId);
      const postLikes = await Post.getTotalLikesForUser(currentUserId);
      const reelLikes = await Reel.getTotalLikesForUser(currentUserId);
      const totalLikesCount = Number(postLikes) + Number(reelLikes);
      const eventsUnlockFee = await getNumberSetting('events_unlock_fee', 0);
      const eventKycRequest = await KycRequest.getByUserIdAndType(currentUserId, 'events');
      await User.maybeAutoActivateEvents(currentUserId, followersCount);
      currentUser = await User.getById(currentUserId);
      const eventCreationEligibility = await User.getEventCreationEligibility(currentUserId, followersCount);

      const eventsFollowersThreshold = Number(currentUser.events_followers_threshold || 1000);
      const eventsProgress = eventsFollowersThreshold > 0
        ? Math.min(100, Math.round((followersCount / eventsFollowersThreshold) * 100))
        : 0;
      const canCreateEvent = eventCreationEligibility.canCreateEvent;
      const dashboard = await Event.getDashboard(currentUserId);
      const activeAds = await Ad.getActiveAds();

      res.render('events', {
        currentUser,
        contacts,
        messages,
        messageInbox,
        followersCount,
        followingCount,
        totalLikesCount,
        dashboard,
        canCreateEvent,
        eventCreationEligibility,
        eventsFollowersThreshold,
        eventsProgress,
        eventsUnlockFee,
        eventKycRequest,
        activeAds,
        eventCategoryOptions: EVENT_CATEGORY_OPTIONS,
        eventVisibilityOptions: EVENT_VISIBILITY_OPTIONS,
        eventsStatus: req.query.success || null,
        eventsError: req.query.error || null,
        activeTab: 'events'
      });
    } catch (err) {
      console.error('Events page error:', err);
      res.status(500).send('Error while loading the events page.');
    }
  }

  static async createEvent(req, res) {
    try {
      const currentUserId = req.session.userId;
      const currentUser = await User.getById(currentUserId);
      if (!currentUser) {
        return res.redirect('/auth/login');
      }

      const locale = normalizeLocale(req.session?.locale || 'en');
      const t = createTranslator(locale);
      await User.maybeAutoActivateEvents(currentUserId);
      const eligibility = await User.getEventCreationEligibility(currentUserId);
      if (!eligibility.canCreateEvent) {
        return res.redirect('/events?error=You+must+be+eligible+and+certified+to+create+an+event');
      }

      const {
        title,
        description,
        location_name,
        location_address,
        starts_at,
        ends_at,
        category,
        visibility,
        capacity,
        cover_image_url,
        ticket_mode,
        ticket_price
      } = req.body || {};

      const safeTitle = String(title || '').trim();
      if (!safeTitle) {
        return res.redirect('/events?error=Event+title+is+required');
      }

      const startsAt = new Date(starts_at);
      if (Number.isNaN(startsAt.getTime())) {
        return res.redirect('/events?error=Please+choose+a+valid+start+date');
      }

      const endsAt = ends_at ? new Date(ends_at) : null;
      const parsedCapacity = Number.parseInt(capacity, 10);
      const safeCapacity = Number.isFinite(parsedCapacity) && parsedCapacity > 0 ? parsedCapacity : null;
      const safeVisibility = EVENT_VISIBILITY_OPTIONS.includes(visibility) ? visibility : 'public';
      const safeCategory = String(category || '').trim() || 'Community';
      const safeTicketMode = ['generated', 'uploaded'].includes(String(ticket_mode || '').toLowerCase())
        ? String(ticket_mode).toLowerCase()
        : 'generated';
      const parsedTicketPrice = Number.parseFloat(ticket_price);
      const safeTicketPrice = Number.isFinite(parsedTicketPrice) && parsedTicketPrice > 0 ? parsedTicketPrice : 0;
      const creationFee = safeTicketPrice > 0 ? 0 : 10;
      const uploadedTicket = req.file || null;

      if (safeTicketMode === 'uploaded' && !uploadedTicket) {
        return res.redirect('/events?error=Please+upload+a+ticket+file+or+choose+generated+ticket');
      }

      const connection = await db.getConnection();
      let createdEventId = null;

      try {
        await connection.beginTransaction();

        const [lockedUserRows] = await connection.query(
          'SELECT id, deposit_account_balance FROM users WHERE id = ? FOR UPDATE',
          [currentUserId]
        );
        const lockedUser = lockedUserRows[0];
        if (!lockedUser) {
          await connection.rollback();
          return res.redirect('/events?error=Unable+to+create+the+event');
        }

        if (creationFee > 0) {
          if (Number(lockedUser.deposit_account_balance || 0) < creationFee) {
            await connection.rollback();
            return res.redirect(`/events?error=${encodeURIComponent(t('events.creationFeeInsufficientBalance', 'You need at least $10.00 deposit balance to create a free event.'))}`);
          }

          const admin = await Admin.getPrimaryAdmin(connection, { forUpdate: true });
          if (!admin) {
            await connection.rollback();
            return res.redirect(`/events?error=${encodeURIComponent(t('events.creationFeeNoAdmin', 'The platform fee cannot be collected right now because no admin account is available.'))}`);
          }

          await connection.query(
            'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
            [creationFee, currentUserId]
          );
          await Admin.addBalance(admin.id, creationFee, connection);
          await PlatformRevenue.recordUsd({
            amount: creationFee,
            entryType: 'event_creation_fee',
            payerUserId: currentUserId,
            referenceId: null,
            note: 'Free event creation fee',
            connection
          });
        }

        createdEventId = await Event.create(currentUserId, {
          title: safeTitle,
          description: String(description || '').trim(),
          locationName: String(location_name || '').trim(),
          locationAddress: String(location_address || '').trim(),
          startsAt: startsAt.toISOString().slice(0, 19).replace('T', ' '),
          endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString().slice(0, 19).replace('T', ' ') : null,
          category: safeCategory,
          visibility: safeVisibility,
          capacity: safeCapacity,
          coverImageUrl: String(cover_image_url || '').trim() || null,
          ticketMode: safeTicketMode,
          isPaid: safeTicketPrice > 0,
          ticketPrice: safeTicketPrice,
          ticketAssetUrl: uploadedTicket ? `/uploads/events/tickets/${uploadedTicket.filename}` : null,
          ticketAssetName: uploadedTicket ? uploadedTicket.originalname || uploadedTicket.filename : null,
          ticketAssetType: uploadedTicket ? uploadedTicket.mimetype || null : null
        }, connection);

        await connection.commit();
      } catch (txError) {
        await connection.rollback();
        throw txError;
      } finally {
        connection.release();
      }

      const creationSummary = creationFee > 0
        ? t('events.creationFeeChargedSuccess', 'Event created successfully. A $10 creation fee was charged. The platform keeps 10% of each ticket sold.')
        : t('events.creationPaidSuccess', 'Event created successfully. No creation fee was charged. The platform keeps 10% of each ticket sold.');

      if (req.app?.get('io')) {
        const updatedCurrentUser = await User.getById(currentUserId);
        if (updatedCurrentUser && creationFee > 0) {
          req.app.get('io').to(`user:${currentUserId}`).emit('balance-updated', {
            userId: currentUserId,
            depositBalance: Number(updatedCurrentUser.deposit_account_balance || 0),
            withdrawalBalance: Number(updatedCurrentUser.withdrawal_account_balance || 0),
            bonusBalance: Number(updatedCurrentUser.bonus_account_balance || 0),
            tokenBalance: Number(updatedCurrentUser.token_balance || 0),
            message: t('events.creationFeeChargedRealtime', 'A creation fee was charged for your new event.')
          });
        }
        if (createdEventId) {
          req.app.get('io').to(`user:${currentUserId}`).emit('event-created', {
            eventId: createdEventId,
            message: creationSummary
          });
        }
      }

      return res.redirect(`/events?success=${encodeURIComponent(creationSummary)}`);
    } catch (err) {
      console.error('Create event error:', err);
      return res.redirect('/events?error=Unable+to+create+the+event');
    }
  }

  static async rsvpEvent(req, res) {
    try {
      const currentUserId = req.session.userId;
      const eventId = Number.parseInt(req.params.eventId, 10);
      const status = String(req.body?.status || '').toLowerCase();

      if (!Number.isFinite(eventId)) {
        return res.status(400).json({ error: 'Invalid event id.' });
      }

      await Event.upsertRsvp(eventId, currentUserId, status === 'none' ? null : status);
      const event = await Event.getById(eventId, currentUserId);

      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      if (status === 'going') {
        const existingTicket = await EventTicket.getByEventAndUser(eventId, currentUserId);
        const ticket = existingTicket || await EventTicket.issueForUser({
          eventId,
          userId: currentUserId,
          ticketType: event.is_paid ? 'paid' : 'free'
        });
        const attendee = await User.getById(currentUserId);
        const organizer = await User.getById(event.organizer_id);
        const ticketUrl = `${req.protocol}://${req.get('host')}/events/tickets/${ticket.ticket_code}`;
        const attendeeFollowingIds = await User.getFollowingIds(currentUserId);
        const attendeeFollowerIds = await User.getFollowersIds(currentUserId);
        const organizerFollowingIds = organizer ? await User.getFollowingIds(event.organizer_id) : [];
        const organizerFollowerIds = organizer ? await User.getFollowersIds(event.organizer_id) : [];
        const ticketLabel = event.ticket_mode === 'uploaded' ? 'Uploaded ticket' : 'Generated ticket';
        const priceLabel = event.is_paid ? `$${Number(event.ticket_price || 0).toFixed(2)}` : 'Free';
        let ticketAsset = null;

        if (event.ticket_mode === 'generated') {
          ticketAsset = await EventTicket.ensureGeneratedAsset({
            ticket,
            event,
            holderName: `${attendee.first_name} ${attendee.last_name}`.trim(),
            ticketPageUrl: ticketUrl
          });
        } else if (event.ticket_asset_url) {
          ticketAsset = {
            ticket_asset_url: event.ticket_asset_url,
            ticket_asset_name: event.ticket_asset_name || `${event.title} ticket`,
            ticket_asset_type: event.ticket_asset_type || 'application/octet-stream'
          };
          await EventTicket.updateAssetByCode(ticket.ticket_code, ticketAsset);
        }

        const ticketDownloadPath = ticketAsset?.ticket_asset_url || null;
        const ticketDownloadUrl = ticketDownloadPath
          ? `${req.protocol}://${req.get('host')}${ticketDownloadPath}`
          : ticketUrl;
        const ticketAttachmentType = String(ticketAsset?.ticket_asset_type || '').startsWith('image/')
          ? 'image'
          : (String(ticketAsset?.ticket_asset_type || '').toLowerCase() === 'application/pdf' ? 'file' : 'file');
        const ticketAttachmentName = ticketAsset?.ticket_asset_name || `${event.title} ticket`;
        const shouldSendEmail = !ticket?.email_sent_at;
        const shouldSendMessage = !ticket?.message_sent_at;
        const messageText = `Your ticket for ${event.title} is ready. Download it from the attachment below or open it here: ${ticketUrl}`;
        const io = req.app.get('io');

        if (shouldSendEmail) {
          const emailSent = await sendEventTicketEmail(attendee.email, {
            eventTitle: event.title,
            eventDate: event.time_label,
            eventLocation: event.location_name || event.location_address || 'Online',
            ticketCode: ticket.ticket_code,
            ticketUrl,
            ticketDownloadUrl,
            holderName: `${attendee.first_name} ${attendee.last_name}`,
            priceLabel,
            ticketLabel
          });
          if (emailSent) {
            await EventTicket.markDeliveryStatusByCode(ticket.ticket_code, { emailSent: true });
          }
        }

        if (shouldSendMessage) {
          const messageId = await Message.create(event.organizer_id, currentUserId, messageText, {
            attachmentUrl: ticketDownloadPath || ticketUrl,
            attachmentType: ticketAttachmentType,
            attachmentName: ticketAttachmentName,
            attachmentSize: ticketAsset?.ticket_asset_size || null,
            voiceDurationSeconds: null
          });
          await EventTicket.markDeliveryStatusByCode(ticket.ticket_code, { messageSent: true });

          if (io) {
            const createdAt = new Date().toISOString();
            const senderPayload = {
              senderId: event.organizer_id,
              receiverId: currentUserId,
              sender_name: organizer ? `${organizer.first_name} ${organizer.last_name}` : '',
              sender_avatar: organizer?.avatar || '/assets/avatar_placeholder.jpg',
              content: messageText,
              messageId,
              attachmentUrl: ticketDownloadPath || ticketUrl,
              attachmentType: ticketAttachmentType,
              attachmentName: ticketAttachmentName,
              attachmentSize: ticketAsset?.ticket_asset_size || null,
              voiceDurationSeconds: null,
              delivered_at: null,
              read_at: null,
              messageStatus: 'sent',
              created_at: createdAt,
              conversation: buildTicketConversationPayload(attendee, messageText, organizerFollowingIds, organizerFollowerIds)
            };
            const receiverPayload = {
              senderId: event.organizer_id,
              receiverId: currentUserId,
              sender_name: organizer ? `${organizer.first_name} ${organizer.last_name}` : '',
              sender_avatar: organizer?.avatar || '/assets/avatar_placeholder.jpg',
              content: messageText,
              messageId,
              attachmentUrl: ticketDownloadPath || ticketUrl,
              attachmentType: ticketAttachmentType,
              attachmentName: ticketAttachmentName,
              attachmentSize: ticketAsset?.ticket_asset_size || null,
              voiceDurationSeconds: null,
              delivered_at: null,
              read_at: null,
              messageStatus: 'incoming',
              created_at: createdAt,
              conversation: buildTicketConversationPayload(organizer, messageText, attendeeFollowingIds, attendeeFollowerIds)
            };

            io.to(`user:${event.organizer_id}`).emit('chat-message-received', senderPayload);
            io.to(`user:${currentUserId}`).emit('chat-message-received', receiverPayload);
            if (presence.isUserOnline(currentUserId)) {
              await Message.markDelivered(messageId);
              io.to(`user:${event.organizer_id}`).emit('chat-message-status', {
                messageId,
                status: 'delivered',
                delivered_at: new Date().toISOString(),
                receiverId: currentUserId
              });
            }
          }
        }
      }

      if (req.xhr || String(req.headers.accept || '').includes('application/json')) {
        return res.json({
          success: true,
          eventId: event.id,
          myStatus: event.my_status,
          attendeeCount: event.attendee_count,
          goingCount: event.going_count,
          interestedCount: event.interested_count,
          isFull: event.is_full
        });
      }

      return res.redirect('/events?success=Event+status+updated');
    } catch (err) {
      console.error('RSVP event error:', err);
      if (req.xhr || String(req.headers.accept || '').includes('application/json')) {
        return res.status(500).json({ error: 'Unable to update RSVP.' });
      }
      return res.redirect('/events?error=Unable+to+update+RSVP');
    }
  }

  static async unlockEventsByPayment(req, res) {
    try {
      const currentUserId = req.session.userId;
      let currentUser = await User.getById(currentUserId);
      if (!currentUser) {
        return res.redirect('/auth/login');
      }

      const unlockMessages = getUnlockMessages(req);
      const eventsUnlockFee = await getNumberSetting('events_unlock_fee', 0);
      if (eventsUnlockFee <= 0) {
        if (wantsJsonResponse(req)) {
          return res.status(400).json({ success: false, message: unlockMessages.feeMissing });
        }
        return res.redirect('/events?error=Events+unlock+fee+is+not+configured');
      }

      await User.maybeAutoActivateEvents(currentUserId);
      currentUser = await User.getById(currentUserId);
      if (String(currentUser.events_status || 'locked') === 'active') {
        if (wantsJsonResponse(req)) {
          return res.json({
            success: true,
            alreadyUnlocked: true,
            nextUrl: '/events/kyc',
            message: unlockMessages.alreadyUnlocked
          });
        }
        return res.redirect('/events?success=Events+are+already+unlocked');
      }

      const existingKyc = await KycRequest.getByUserIdAndType(currentUserId, 'events');
      if (existingKyc && existingKyc.payment_status === 'paid' && ['draft', 'pending'].includes(String(existingKyc.status || '').toLowerCase())) {
        if (wantsJsonResponse(req)) {
          return res.json({
            success: true,
            alreadyPaid: true,
            nextUrl: '/events/kyc?success=Continue+your+KYC+to+unlock+event+access',
            message: unlockMessages.continueKyc
          });
        }
        return res.redirect('/events/kyc?success=Continue+your+KYC+to+unlock+event+access');
      }

      const depositBalance = Number(currentUser.deposit_account_balance || 0);
      if (depositBalance < eventsUnlockFee) {
        if (wantsJsonResponse(req)) {
          return res.status(400).json({ success: false, message: unlockMessages.insufficientBalance });
        }
        return res.redirect('/events?error=You+need+more+deposit+balance+to+unlock+events');
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [userRows] = await connection.query(
          'SELECT id, deposit_account_balance, events_status FROM users WHERE id = ? FOR UPDATE',
          [currentUserId]
        );
        const lockedUser = userRows[0];
        if (!lockedUser) {
          await connection.rollback();
          if (wantsJsonResponse(req)) {
            return res.status(404).json({ success: false, message: unlockMessages.unableToUnlock });
          }
          return res.redirect('/events?error=Unable+to+unlock+events');
        }

        const admin = await Admin.getPrimaryAdmin(connection);
        if (!admin) {
          await connection.rollback();
          if (wantsJsonResponse(req)) {
            return res.status(500).json({ success: false, message: unlockMessages.missingAdmin });
          }
          return res.redirect('/events?error=No+admin+account+available');
        }

        if (Number(lockedUser.deposit_account_balance || 0) < eventsUnlockFee) {
          await connection.rollback();
          if (wantsJsonResponse(req)) {
            return res.status(400).json({ success: false, message: unlockMessages.insufficientBalance });
          }
          return res.redirect('/events?error=You+need+more+deposit+balance+to+unlock+events');
        }

        await connection.query(
          'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
          [eventsUnlockFee, currentUserId]
        );
        await Admin.addBalance(admin.id, eventsUnlockFee, connection);
        await PlatformRevenue.recordUsd({
          amount: eventsUnlockFee,
          entryType: 'events_unlock_fee',
          payerUserId: currentUserId,
          referenceId: `events_kyc:${currentUserId}`,
          note: 'Paid event access unlock fee',
          connection
        });

        await KycRequest.createOrUpdateDraft(currentUserId, {
          requestType: 'events',
          paymentAmount: eventsUnlockFee,
          requestNote: 'Payment completed for event access. KYC is required before activation.',
          connection
        });

        await connection.commit();
      } catch (txError) {
        await connection.rollback();
        throw txError;
      } finally {
        connection.release();
      }

      if (wantsJsonResponse(req)) {
        return res.json({
          success: true,
          nextUrl: '/events/kyc?success=Continue+your+KYC+to+unlock+event+access',
          message: unlockMessages.paymentSuccess
        });
      }

      return res.redirect(
        `/events/kyc?success=${encodeURIComponent('Payment received. Please complete KYC. Rejected requests are non-refundable.')}`
      );
    } catch (err) {
      console.error('Events unlock by payment error:', err);
      if (wantsJsonResponse(req)) {
        return res.status(500).json({
          success: false,
          message: getUnlockMessages(req).unableToUnlock
        });
      }
      return res.redirect('/events?error=Unable+to+unlock+events');
    }
  }

  static async getEventKyc(req, res) {
    try {
      const currentUserId = req.session.userId;
      let currentUser = await User.getById(currentUserId);
      if (!currentUser) {
        req.session.destroy();
        return res.redirect('/auth/login');
      }

      await User.maybeAutoActivateEvents(currentUserId);
      currentUser = await User.getById(currentUserId);
      if (String(currentUser.events_status || 'locked') === 'active') {
        return res.redirect('/events?success=Events+are+already+unlocked');
      }

      const eventsUnlockFee = await getNumberSetting('events_unlock_fee', 0);
      const eventKycRequest = await KycRequest.getByUserIdAndType(currentUserId, 'events');
      if (!eventKycRequest || eventKycRequest.payment_status !== 'paid') {
        return res.redirect('/events?error=Please+pay+the+event+access+fee+first');
      }

      return res.render('eventKyc', {
        currentUser,
        currentUserDob: isoFromDateObject(currentUser.dob) || normalizeDateToIso(currentUser.dob),
        eventsUnlockFee,
        eventKycRequest,
        eventsStatus: req.query.success || null,
        eventsError: req.query.error || null,
        activeTab: 'events'
      });
    } catch (err) {
      console.error('Event KYC page error:', err);
      return res.status(500).send('Error while loading event KYC.');
    }
  }

  static async submitEventKyc(req, res) {
    try {
      const currentUserId = req.session.userId;
      let currentUser = await User.getById(currentUserId);
      if (!currentUser) {
        req.session.destroy();
        return res.redirect('/auth/login');
      }

      const eventKycRequest = await KycRequest.getByUserIdAndType(currentUserId, 'events');
      if (!eventKycRequest || eventKycRequest.payment_status !== 'paid') {
        return res.redirect('/events?error=Please+pay+the+event+access+fee+first');
      }
      if (String(eventKycRequest.status || '').toLowerCase() === 'rejected') {
        return res.redirect('/events?error=Previous+KYC+was+rejected.+Pay+again+to+start+a+new+review');
      }

      const selfieImageData = String(req.body?.selfie_image_data || '').trim();
      if (!selfieImageData.startsWith('data:image/')) {
        return res.redirect('/events/kyc?error=Please+capture+a+selfie+with+your+camera');
      }
      if (!req.file) {
        return res.redirect('/events/kyc?error=Please+upload+your+identity+document');
      }

      // Check if document or user information has already been used by another account
      const fullName = `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim();
      const dobVal = formatDateForSql(currentUser.dob) || '';

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
        
        return res.redirect('/auth/login?error=' + encodeURIComponent("Votre compte a été bloqué pour cause de conflit de KYC avec un autre utilisateur."));
      }

      const submission = {
        full_name: `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim(),
        username: String(currentUser.username || '').trim(),
        email: String(currentUser.email || '').trim(),
        country: String(currentUser.country || '').trim(),
        dob: formatDateForSql(currentUser.dob) || ''
      };

      console.log(`[KYC] Starting event verification for user ${currentUserId}`);
      console.log('[KYC] Account snapshot:', {
        fullName: submission.full_name,
        username: submission.username,
        country: submission.country,
        dob: submission.dob || null
      });

      console.log('[KYC] Extracting OCR from uploaded document...');
      const ocrText = await extractOcrTextFromImage(req.file.path);
      console.log('[KYC] OCR text extracted:', String(ocrText || '').slice(0, 140));
      const faceMatchDistance = Number(req.body?.face_match_distance);
      const savedSelfie = await saveDataUrlToFile(selfieImageData, EVENT_KYC_SELFIE_DIR, `selfie-${currentUserId}`);
      console.log('[KYC] Running identity evaluation...');
      const evaluation = await evaluateEventKycSubmission(
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
      console.log('[KYC] Evaluation result:', {
        approved: evaluation.approved,
        score: evaluation.score,
        faceMatchScore: evaluation.faceMatchScore,
        matchedFullName: evaluation.matchedFullName,
        matchedDob: evaluation.matchedDob,
        selectedDob: evaluation.ocrSelectedDob,
        reasons: evaluation.reasons
      });
      const isApproved = evaluation.approved;
      const requestNote = isApproved
        ? `Automated KYC approved by ${evaluation.aiProvider || 'the AI verifier'}.`
        : `Automated KYC rejected: ${evaluation.reasons.join(' | ') || 'Verification rules not met.'}`;

      const updatedRequest = await KycRequest.updateEventVerificationResult(currentUserId, {
        status: isApproved ? 'approved' : 'rejected',
        submittedFullName: submission.full_name,
        submittedUsername: submission.username,
        submittedEmail: submission.email,
        submittedCountry: submission.country,
        submittedDob: formatDateForSql(submission.dob),
        documentUrl: req.file ? `/uploads/events/kyc/${req.file.filename}` : null,
        documentName: req.file ? req.file.originalname || req.file.filename : null,
        documentType: req.file ? req.file.mimetype || null : null,
        documentSize: req.file ? req.file.size || null : null,
        selfieUrl: savedSelfie ? savedSelfie.fileUrl : null,
        selfieName: savedSelfie ? savedSelfie.fileName : null,
        selfieType: savedSelfie ? savedSelfie.mimeType : null,
        selfieSize: savedSelfie ? savedSelfie.size : null,
        verificationScore: evaluation.score,
        faceMatchScore: evaluation.faceMatchScore || null,
        verificationNotes: evaluation.summary,
        aiProvider: evaluation.aiProvider || null,
        aiModel: evaluation.aiModel || null,
        ocrTextExcerpt: evaluation.ocrTextExcerpt || null,
        ocrDetectedDates: JSON.stringify(evaluation.ocrDetectedDates || []),
        ocrSelectedDob: evaluation.ocrSelectedDob || null,
        ocrSelectedDobReason: evaluation.ocrSelectedDobReason || null,
        requestNote,
        verifiedByAi: 1
      });
      console.log('[KYC] KYC request updated in database.');

      if (isApproved) {
        await db.query(
          `
            UPDATE users
            SET events_status = 'active',
                events_activated_at = COALESCE(events_activated_at, NOW())
            WHERE id = ?
          `,
            [currentUserId]
        );
        console.log(`[KYC] Event access approved for user ${currentUserId}.`);
        return res.redirect('/events?success=Event+access+approved');
      }

      console.log(`[KYC] Event access rejected for user ${currentUserId}:`, evaluation.reasons);
      const locale = normalizeLocale(req.session?.locale || 'en');
      const t = createTranslator(locale);
      const rejectionReasonText = evaluation.reasons.length > 0
        ? evaluation.reasons.join(' | ')
        : t('events.kycRejectionNoReason', 'No detailed reason was returned by the verifier.');
      const rejectionNotificationMessage = `${t('events.kycRejectionNotificationPrefix', 'Your KYC was rejected: ')}${rejectionReasonText}`;
      const notificationId = await Notification.create({
        recipientId: currentUserId,
        actorId: null,
        type: 'message',
        message: rejectionNotificationMessage
      });
      const io = req.app.get('io');
      if (io) {
        const unreadCount = await Notification.getUnreadCount(currentUserId);
        io.to(`user:${currentUserId}`).emit('notification-created', {
          id: notificationId,
          recipient_id: currentUserId,
          actor_id: null,
          type: 'message',
          message: rejectionNotificationMessage,
          post_id: null,
          share_id: null,
          comment_id: null,
          is_read: 0,
          read_at: null,
          created_at: new Date().toISOString(),
          actor_name: 'TrasX',
          actor_username: 'trasx',
          actor_avatar: '/assets/avatar_placeholder.jpg'
        });
        io.to(`user:${currentUserId}`).emit('notification-count-updated', { unreadCount });
      }
      return res.redirect(`/events/kyc?error=${encodeURIComponent('Event access was rejected and the payment is not refundable.')}`);
    } catch (err) {
      console.error('Event KYC submit error:', err);
      return res.redirect('/events/kyc?error=Unable+to+submit+event+KYC');
    }
  }
}

module.exports = EventsController;
