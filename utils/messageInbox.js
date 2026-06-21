const { getPresenceText } = require('./presence');

const GAME_PREVIEW_NAMES = {
  morpion: 'Morpion',
  domino: 'Domino',
  puissance4: 'Puissance 4',
  connect4: 'Puissance 4',
  gomoku: 'Gomoku',
  tablefootball: 'Football Table',
  chess: 'Echecs',
  echec: 'Echecs',
  echecsmat: 'Echecs'
};

const parseStructuredMessageContent = (content) => {
  const trimmed = String(content || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
};

const getGameInvitationPreviewText = (content) => {
  try {
    const gameData = parseStructuredMessageContent(content);
    if (!gameData || gameData.type !== 'game_invitation') return null;

    const gameLabel = GAME_PREVIEW_NAMES[String(gameData.game || '').toLowerCase()] || gameData.game || 'Jeu';
    const expiresAt = gameData.expiresAt ? new Date(gameData.expiresAt).getTime() : NaN;
    const isExpired = gameData.status === 'pending' && Number.isFinite(expiresAt) && Date.now() > expiresAt;

    if (gameData.status === 'accepted') return `Invitation jeu acceptee : ${gameLabel}`;
    if (gameData.status === 'declined') return `Invitation jeu refusee : ${gameLabel}`;
    if (isExpired) return `Invitation jeu expiree : ${gameLabel}`;
    return `Invitation jeu : ${gameLabel}`;
  } catch (error) {
    return null;
  }
};

const getSharedPostPreviewText = (content) => {
  const payload = parseStructuredMessageContent(content);
  if (!payload || payload.type !== 'shared_post') return null;

  const post = payload.post && typeof payload.post === 'object' ? payload.post : {};
  const authorName = String(post.authorName || post.authorUsername || '').trim();
  const excerpt = String(post.excerpt || post.content || '').replace(/\s+/g, ' ').trim();
  if (excerpt) {
    return `Post partage : ${excerpt.length > 80 ? `${excerpt.slice(0, 77)}...` : excerpt}`;
  }
  if (authorName) {
    return `Post partage de ${authorName}`;
  }
  return 'Post partage';
};

const getSharedReelPreviewText = (content) => {
  const payload = parseStructuredMessageContent(content);
  if (!payload || payload.type !== 'shared_reel') return null;

  const reel = payload.reel && typeof payload.reel === 'object' ? payload.reel : {};
  const authorName = String(reel.authorName || reel.authorUsername || '').trim();
  const excerpt = String(reel.caption || reel.excerpt || '').replace(/\s+/g, ' ').trim();
  if (excerpt) {
    return `Short partage : ${excerpt.length > 80 ? `${excerpt.slice(0, 77)}...` : excerpt}`;
  }
  if (authorName) {
    return `Short partage de ${authorName}`;
  }
  return 'Short partage';
};

const getMessagePreviewText = (message) => {
  if (!message) return 'Start a conversation...';

  const content = String(message.content || '').trim();
  if (content) {
    const gamePreview = getGameInvitationPreviewText(content);
    if (gamePreview) return gamePreview;
    const sharedPostPreview = getSharedPostPreviewText(content);
    if (sharedPostPreview) return sharedPostPreview;
    const sharedReelPreview = getSharedReelPreviewText(content);
    if (sharedReelPreview) return sharedReelPreview;
    return content;
  }

  const attachmentType = String(message.attachment_type || '').toLowerCase();
  const attachmentName = String(message.attachment_name || '').trim();
  const voiceDuration = Number(message.voice_duration_seconds || 0);

  if (attachmentType === 'image') return 'Sent an image';
  if (attachmentType === 'video') return 'Sent a video';
  if (attachmentType === 'audio') {
    if (voiceDuration > 0) {
      const mins = Math.floor(voiceDuration / 60);
      const secs = voiceDuration % 60;
      return `Voice note ${mins}:${String(secs).padStart(2, '0')}`;
    }
    return 'Sent a voice note';
  }

  if (attachmentName) return `Sent ${attachmentName}`;
  if (attachmentType === 'file') return 'Sent a file';
  return 'Sent an attachment';
};

function buildMessageInboxSections(currentUserId, contacts = [], messages = []) {
  const currentId = Number(currentUserId);
  const lastMessageByContact = new Map();

  messages.forEach((message) => {
    const senderId = Number(message.sender_id);
    const receiverId = Number(message.receiver_id);
    const partnerId = senderId === currentId ? receiverId : senderId;
    lastMessageByContact.set(partnerId, message);
  });

  const sections = {
    general: [],
    requests: []
  };

  const addItem = (item) => {
    sections[item.category].push(item);
  };

  contacts.forEach((contact) => {
    const lastMessage = lastMessageByContact.get(Number(contact.id)) || null;
    const hasRelationship = !!contact.is_following || !!contact.is_followed_by;
    if (!lastMessage && !hasRelationship) {
      return;
    }

    const requestStatus = lastMessage?.request_status || null;
    const requesterId = Number(lastMessage?.request_requester_id || 0);
    const recipientId = Number(lastMessage?.request_recipient_id || 0);
    const canManageRequest = requestStatus === 'pending' && recipientId === currentId && requesterId === Number(contact.id);
    if (requestStatus === 'declined' && recipientId === currentId && requesterId === Number(contact.id)) {
      return;
    }

    const category = canManageRequest ? 'requests' : 'general';
    const preview = getMessagePreviewText(lastMessage);
    const isOnline = !!contact.is_online;
    const lastSeenText = contact.last_seen_at ? getPresenceText(false, contact.last_seen_at) : 'Offline';

    addItem({
      id: Number(contact.id),
      username: contact.username,
      name: contact.name,
      avatar: contact.avatar,
      is_following: !!contact.is_following,
      is_followed_by: !!contact.is_followed_by,
      is_mutual: !!contact.is_mutual,
      request_status: requestStatus,
      can_manage_request: canManageRequest,
      is_online: isOnline,
      last_seen_at: contact.last_seen_at || null,
      presence_text: isOnline ? 'Online now' : lastSeenText,
      category,
      last_message: lastMessage,
      preview,
      time_text: lastMessage
        ? new Date(lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '',
      has_message: !!lastMessage
    });
  });

  const sortByLatest = (a, b) => {
    const aTime = a.last_message ? new Date(a.last_message.created_at).getTime() : 0;
    const bTime = b.last_message ? new Date(b.last_message.created_at).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  };

  sections.general.sort(sortByLatest);
  sections.requests.sort(sortByLatest);

  return {
    sections,
    counts: {
      general: sections.general.length,
      requests: sections.requests.length
    }
  };
}

module.exports = {
  buildMessageInboxSections,
  getMessagePreviewText,
  parseStructuredMessageContent
};
