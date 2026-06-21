const Status = require('../models/Status');
const User = require('../models/User');
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
        bgColor
      });

      const message = t('status.postedSuccess', 'Status posted successfully!');

      if (wantsJsonResponse(req)) {
        return res.json({
          success: true,
          statusId,
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
}

module.exports = StatusController;
