const Status = require('../models/Status');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { normalizeLocale, createTranslator } = require('../utils/i18n');

function wantsJsonResponse(req) {
  return String(req.headers.accept || '').includes('application/json')
    || String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest'
    || String(req.query?.format || '').toLowerCase() === 'json';
}

class StatusController {
  static async createStatus(req, res) {
    try {
      const currentUserId = req.session.userId;
      const currentUser = await User.getById(currentUserId);
      if (!currentUser) {
        return res.redirect('/auth/login');
      }

      const statusType = String(req.body?.status_type || 'media').toLowerCase();
      const caption = String(req.body?.caption || '').trim();
      const bgColor = String(req.body?.bg_color || '').trim() || null;
      const trimStart = req.body?.trim_start ? parseFloat(req.body.trim_start) : null;
      const trimEnd = req.body?.trim_end ? parseFloat(req.body.trim_end) : null;
      const requestedMediaFit = String(req.body?.media_fit || '').trim().toLowerCase();
      const mediaFit = requestedMediaFit === 'contain' ? 'contain' : 'cover';

      let mediaUrl = '';
      let mediaType = '';
      let mediaName = null;
      let mediaSize = null;

      const locale = normalizeLocale(req.session?.locale || 'en');
      const t = createTranslator(locale);

      if (statusType === 'text') {
        if (!caption) {
          const message = t('status.textRequired', 'Please enter some text for your status.');
          if (wantsJsonResponse(req)) {
            return res.status(400).json({ success: false, message });
          }
          return res.redirect(`/${req.body?.return_to || ''}?error=${encodeURIComponent(message)}`);
        }
        mediaUrl = 'text';
        mediaType = 'text';
      } else {
        // Media (image/video) or voice note
        const mediaFile = req.file || null;
        if (!mediaFile) {
          const message = t('status.mediaRequired', 'Please choose a file or record a voice note for your status.');
          if (wantsJsonResponse(req)) {
            return res.status(400).json({ success: false, message });
          }
          return res.redirect(`/${req.body?.return_to || ''}?error=${encodeURIComponent(message)}`);
        }

        mediaType = String(mediaFile.mimetype || '').toLowerCase();
        
        // Accept image, video, and audio (voice note) mimetypes
        if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/') && !mediaType.startsWith('audio/')) {
          const message = t('status.unsupportedType', 'Statuses accept images, videos, and voice notes only.');
          if (wantsJsonResponse(req)) {
            return res.status(400).json({ success: false, message });
          }
          return res.redirect(`/` + `?error=${encodeURIComponent(message)}`);
        }

        mediaUrl = `/uploads/statuses/${mediaFile.filename}`;
        mediaName = mediaFile.originalname || mediaFile.filename;
        mediaSize = mediaFile.size || null;
      }

      const statusId = await Status.create(currentUserId, {
        mediaUrl,
        mediaType,
        mediaName,
        mediaSize,
        caption: caption || null,
        trimStart,
        trimEnd,
        bgColor,
        mediaFit: mediaType.startsWith('video/') ? mediaFit : 'cover'
      });

      const newStatus = await Status.getById(statusId);

      if (req.app?.get('io') && newStatus) {
        req.app.get('io').emit('status-created', {
          user_id: currentUserId,
          user_name: currentUser.first_name + ' ' + currentUser.last_name,
          username: currentUser.username,
          avatar: currentUser.avatar || '/uploads/avatars/default.png',
          status: newStatus
        });
      }

      const message = t('status.postedSuccess', 'Status posted successfully!');

      if (wantsJsonResponse(req)) {
        return res.json({
          success: true,
          statusId,
          status: newStatus,
          message
        });
      }

      return res.redirect(`/${req.body?.return_to || ''}?success=${encodeURIComponent(message)}`);
    } catch (err) {
      console.error('Create status error:', err);
      const locale = normalizeLocale(req.session?.locale || 'en');
      const t = createTranslator(locale);
      const message = t('status.createFailed', 'Unable to post your status right now.');
      if (wantsJsonResponse(req)) {
        return res.status(500).json({ success: false, message });
      }
      return res.redirect(`/` + `?error=${encodeURIComponent(message)}`);
    }
  }

  static async recordView(req, res) {
    try {
      const currentUserId = req.session.userId;
      const statusId = parseInt(req.params.id, 10);
      if (!statusId) {
        return res.status(400).json({ error: 'Status ID is required.' });
      }

      await Status.recordView(statusId, currentUserId);
      const viewsCount = await Status.getViewCount(statusId);
      return res.json({ success: true, viewsCount });
    } catch (err) {
      console.error('recordView error:', err);
      return res.status(500).json({ error: 'Failed to record view.' });
    }
  }

  static async createComment(req, res) {
    try {
      const currentUserId = req.session.userId;
      const statusId = parseInt(req.params.id, 10);
      const content = String(req.body.content || '').trim();

      if (!statusId || !content) {
        return res.status(400).json({ error: 'Status ID and comment content are required.' });
      }

      const status = await Status.getById(statusId);
      if (!status) {
        return res.status(404).json({ error: 'Status not found.' });
      }

      const commentId = await Status.addComment(statusId, currentUserId, content);

      // Notify the status creator if it's not their own status
      if (Number(status.user_id) !== Number(currentUserId)) {
        const currentUser = await User.getById(currentUserId);
        const senderName = currentUser ? `${currentUser.first_name} ${currentUser.last_name}` : 'Quelqu\'un';

        const excerpt = content.slice(0, 50);
        const notificationMessage = `${senderName} a repondu a votre statut : "${excerpt}${content.length > 50 ? '...' : ''}"`;
        const notificationId = await Notification.create({
          recipientId: status.user_id,
          actorId: currentUserId,
          type: 'comment',
          message: notificationMessage,
          commentId,
          statusId: statusId
        });

        // Emit real-time notification via socket
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${status.user_id}`).emit('notification-created', {
            id: notificationId,
            recipient_id: status.user_id,
            actor_id: currentUserId,
            actor_name: senderName,
            actor_avatar: currentUser?.avatar || '/assets/avatar_placeholder.jpg',
            actor_username: currentUser?.username || '',
            type: 'comment',
            message: notificationMessage,
            created_at: new Date(),
            status_id: statusId,
            status_media_url: status.media_url,
            status_media_type: status.media_type,
            status_caption: status.caption,
            status_bg_color: status.bg_color
          });

          const unreadCount = await Notification.getUnreadCount(status.user_id);
          io.to(`user:${status.user_id}`).emit('notification-count-updated', { unreadCount });
        }
      }

      return res.json({ success: true, commentId });
    } catch (err) {
      console.error('createComment error:', err);
      return res.status(500).json({ error: 'Failed to post comment.' });
    }
  }

  static async recordShare(req, res) {
    try {
      const currentUserId = req.session.userId;
      const statusId = parseInt(req.params.id, 10);
      
      if (!statusId) {
        return res.status(400).json({ error: 'Status ID is required.' });
      }

      const status = await Status.getById(statusId);
      if (!status) {
        return res.status(404).json({ error: 'Status not found.' });
      }

      // Notify the status creator if it's not their own status
      if (Number(status.user_id) !== Number(currentUserId)) {
        const currentUser = await User.getById(currentUserId);
        const senderName = currentUser ? `${currentUser.first_name} ${currentUser.last_name}` : 'Quelqu\'un';
        
        const notificationMessage = `${senderName} a partagé votre statut.`;
        const notificationId = await Notification.create({
          recipientId: status.user_id,
          actorId: currentUserId,
          type: 'share',
          message: notificationMessage
        });

        // Emit real-time notification via socket
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${status.user_id}`).emit('notification-created', {
            id: notificationId,
            recipient_id: status.user_id,
            actor_id: currentUserId,
            actor_name: senderName,
            actor_avatar: currentUser?.avatar || '/assets/avatar_placeholder.jpg',
            type: 'share',
            message: notificationMessage,
            created_at: new Date()
          });

          const unreadCount = await Notification.getUnreadCount(status.user_id);
          io.to(`user:${status.user_id}`).emit('notification-count-updated', { unreadCount });
        }
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('recordShare error:', err);
      return res.status(500).json({ error: 'Failed to record share.' });
    }
  }

  static async getViewers(req, res) {
    try {
      const currentUserId = req.session.userId;
      const statusId = parseInt(req.params.id, 10);
      if (!statusId) {
        return res.status(400).json({ error: 'Status ID is required.' });
      }
      const status = await Status.getById(statusId);
      if (!status) {
        return res.status(404).json({ error: 'Status not found.' });
      }
      if (Number(status.user_id) !== Number(currentUserId)) {
        return res.status(403).json({ error: 'Unauthorized to view status viewers.' });
      }
      const viewers = await Status.getViewers(statusId);
      return res.json({ success: true, viewers });
    } catch (err) {
      console.error('getViewers error:', err);
      return res.status(500).json({ error: 'Failed to retrieve viewers.' });
    }
  }
  static async getStatusById(req, res) {
    try {
      const statusId = parseInt(req.params.id, 10);
      if (!statusId) {
        return res.status(400).json({ error: 'Status ID is required.' });
      }
      const status = await Status.getById(statusId);
      if (!status) {
        return res.status(404).json({ error: 'Status not found.' });
      }
      return res.json({ success: true, status });
    } catch (err) {
      console.error('getStatusById error:', err);
      return res.status(500).json({ error: 'Failed to retrieve status.' });
    }
  }
}

module.exports = StatusController;
