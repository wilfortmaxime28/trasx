const roomManager = require('../mediasoup/roomManager');
const User = require('../models/User');
const presence = require('../utils/presence');

const activeCallSessions = new Map();
const userRoomIndex = new Map();

const CALL_RING_TIMEOUT_MS = Math.max(
  15000,
  Number.parseInt(process.env.CALL_RING_TIMEOUT_MS || '35000', 10) || 35000,
);

function getCurrentUserId(socket) {
  return Number(
    socket.request?.session?.userId ||
      socket.handshake?.auth?.userId ||
      socket.handshake?.query?.userId ||
      0,
  );
}

function createRoomId(callerId, receiverId) {
  return `call:${callerId}:${receiverId}:${Date.now().toString(36)}`;
}

function getRoomKey(userId) {
  return String(Number(userId) || 0);
}

function getActiveRoomIdForUser(userId) {
  return userRoomIndex.get(getRoomKey(userId)) || null;
}

function getSessionByRoomId(roomId) {
  if (!roomId) return null;
  return activeCallSessions.get(String(roomId)) || null;
}

function resolveSession({ roomId, callerId, receiverId }) {
  const direct = getSessionByRoomId(roomId);
  if (direct) return direct;

  const callerRoomId = getActiveRoomIdForUser(callerId);
  if (callerRoomId) {
    const session = getSessionByRoomId(callerRoomId);
    if (session && Number(session.receiverId) === Number(receiverId)) {
      return session;
    }
  }

  return null;
}

function releaseSessionLocks(session) {
  if (!session) return;
  userRoomIndex.delete(getRoomKey(session.callerId));
  userRoomIndex.delete(getRoomKey(session.receiverId));
}

function clearRingTimeout(session) {
  if (!session?.ringTimer) return;
  clearTimeout(session.ringTimer);
  session.ringTimer = null;
}

function destroySession(roomId, { closeRoom = true } = {}) {
  const session = getSessionByRoomId(roomId);
  if (!session) return null;

  clearRingTimeout(session);
  releaseSessionLocks(session);
  activeCallSessions.delete(String(roomId));

  if (closeRoom) {
    roomManager.closeRoom(String(roomId));
  }

  return session;
}

function buildIceServers() {
  const stunUrls = String(
    process.env.CALL_STUN_URLS ||
      process.env.STUN_URLS ||
      'stun:stun.l.google.com:19302',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const turnUrls = String(
    process.env.CALL_TURN_URLS ||
      process.env.TURN_URLS ||
      process.env.COTURN_URLS ||
      'turn:turn.trasx.com:3478?transport=udp,turn:turn.trasx.com:3478?transport=tcp,turns:turn.trasx.com:5349?transport=tcp',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const turnUsername = String(
    process.env.CALL_TURN_USERNAME ||
      process.env.TURN_USERNAME ||
      process.env.COTURN_USERNAME ||
      'trasx',
  ).trim();

  const turnCredential = String(
    process.env.CALL_TURN_CREDENTIAL ||
      process.env.TURN_CREDENTIAL ||
      process.env.COTURN_CREDENTIAL ||
      'MotDePasseTresFort123',
  ).trim();

  const servers = [];

  if (stunUrls.length > 0) {
    servers.push({ urls: stunUrls });
  }

  if (turnUrls.length > 0) {
    const turnServer = { urls: turnUrls };
    if (turnUsername && turnCredential) {
      turnServer.username = turnUsername;
      turnServer.credential = turnCredential;
    }
    servers.push(turnServer);
  }

  return servers;
}

async function validateDirectCall(callerId, receiverId) {
  if (!callerId || !receiverId || callerId === receiverId) {
    return { ok: false, error: 'Appel invalide.' };
  }

  const relationshipState = await User.getMessageRelationshipState(
    callerId,
    receiverId,
  );

  if (!relationshipState.can_chat) {
    return {
      ok: false,
      error: relationshipState.has_blocked_user
        ? 'Debloquez cet utilisateur avant de l appeler.'
        : 'Cet utilisateur vous a bloque.',
    };
  }

  // Allow calling even if the receiver is offline (relying on FCM/APNs VoIP push notification to wake them up)
  /*
  if (!presence.isUserOnline(receiverId)) {
    return {
      ok: false,
      error: 'Cet utilisateur n est pas en ligne.',
    };
  }
  */

  if (getActiveRoomIdForUser(callerId) || getActiveRoomIdForUser(receiverId)) {
    return {
      ok: false,
      error: 'Un des participants est deja dans un appel.',
    };
  }

  return { ok: true };
}

function attachSocketToCall(socket, roomId, peerId) {
  socket.join(String(roomId));
  socket.roomId = String(roomId);
  socket.peerId = String(peerId);
  socket.data.privateCallRoomId = String(roomId);
}

function detachSocketFromCall(socket, roomId) {
  if (roomId) {
    socket.leave(String(roomId));
  }

  if (socket.data?.privateCallRoomId) {
    delete socket.data.privateCallRoomId;
  }

  if (socket.roomId && (!roomId || socket.roomId === String(roomId))) {
    delete socket.roomId;
  }

  if (socket.peerId) {
    delete socket.peerId;
  }
}

function emitCallerUpdate(io, session, payload) {
  io.to(`user:${session.callerId}`).emit('call-response-received', payload);
}

function emitCallEnded(io, session, actorId) {
  const payload = {
    roomId: session.roomId,
    peerId: Number(actorId) || 0,
    enderId: Number(actorId) || 0,
  };

  io.to(session.roomId).emit('call:end', payload);
  io.to(`user:${session.callerId}`).emit('call-ended', payload);
  io.to(`user:${session.receiverId}`).emit('call-ended', payload);
}

module.exports = function handleVideoCallSocket(socket, io) {
  socket.on('call:getConfig', (_, callback) => {
    if (typeof callback === 'function') {
      callback({
        success: true,
        iceServers: buildIceServers(),
        ringTimeoutMs: CALL_RING_TIMEOUT_MS,
      });
    }
  });

  socket.on('call-invite', async (data, callback) => {
    const callerId = getCurrentUserId(socket);
    const receiverId = Number.parseInt(data?.receiverId, 10);
    const isVideo = data?.isVideo === true;
    const done = (payload) => {
      if (typeof callback === 'function') callback(payload);
    };

    try {
      const validation = await validateDirectCall(callerId, receiverId);
      if (!validation.ok) {
        socket.emit('chat-action-error', {
          action: 'start_call',
          targetUserId: receiverId,
          error: validation.error,
        });
        done({ success: false, error: validation.error });
        return;
      }

      const caller = await User.getById(callerId);
      if (!caller) {
        done({ success: false, error: 'Utilisateur introuvable.' });
        return;
      }

      const roomId = createRoomId(callerId, receiverId);
      await roomManager.getOrCreateRoom(roomId);

      const session = {
        roomId,
        callerId,
        receiverId,
        isVideo,
        status: 'ringing',
        createdAt: Date.now(),
        callerSocketId: socket.id,
        receiverSocketId: null,
        ringTimer: null,
      };

      session.ringTimer = setTimeout(() => {
        const activeSession = getSessionByRoomId(roomId);
        if (!activeSession) return;

        emitCallerUpdate(io, activeSession, {
          status: 'missed',
          responderId: activeSession.receiverId,
          roomId: activeSession.roomId,
          isVideo: activeSession.isVideo,
        });
        destroySession(roomId);
      }, CALL_RING_TIMEOUT_MS);

      activeCallSessions.set(roomId, session);
      userRoomIndex.set(getRoomKey(callerId), roomId);
      userRoomIndex.set(getRoomKey(receiverId), roomId);

      io.to(`user:${receiverId}`).emit('call-incoming', {
        roomId,
        callerId,
        callerName: `${caller.first_name} ${caller.last_name}`.trim(),
        callerAvatar: caller.avatar || '/assets/avatar_placeholder.jpg',
        isVideo,
        callerSocketId: socket.id,
        createdAt: new Date().toISOString(),
      });

      // Send FCM push notification to wake up device and ring even if app is closed
      const fcmService = require('../services/fcmService');
      (async () => {
        try {
          await fcmService.sendToUser({
            userId: receiverId,
            title: isVideo ? 'Appel vidéo entrant' : 'Appel audio entrant',
            body: `${caller.first_name} ${caller.last_name} vous appelle.`,
            data: {
              type: 'incoming-call',
              roomId: String(roomId),
              callerId: String(callerId),
              callerName: `${caller.first_name} ${caller.last_name}`.trim(),
              callerAvatar: caller.avatar || '/assets/avatar_placeholder.jpg',
              isVideo: String(isVideo),
            },
          });
          console.log(`[Call FCM] Notification dispatched to user ${receiverId}`);
        } catch (fcmErr) {
          console.error('[Call FCM] Error dispatching Call FCM notification:', fcmErr);
        }
      })();

      socket.emit('call-ringing', {
        roomId,
        receiverId,
        isVideo,
      });

      done({
        success: true,
        roomId,
        receiverId,
        isVideo,
      });
    } catch (error) {
      console.error('[call-invite] error:', error);
      done({
        success: false,
        error: error.message || 'Impossible de lancer cet appel.',
      });
    }
  });

  socket.on('call-response', (data, callback) => {
    const responderId = getCurrentUserId(socket);
    const status = String(data?.status || '').trim().toLowerCase();
    const callerId = Number.parseInt(data?.callerId, 10);
    const roomId = String(data?.roomId || '').trim();
    const done = (payload) => {
      if (typeof callback === 'function') callback(payload);
    };

    try {
      const session = resolveSession({
        roomId,
        callerId,
        receiverId: responderId,
      });

      if (!session || Number(session.receiverId) !== responderId) {
        done({ success: false, error: 'Session d appel introuvable.' });
        return;
      }

      if (status === 'accepted') {
        clearRingTimeout(session);
        session.status = 'accepted';
        session.receiverSocketId = socket.id;

        emitCallerUpdate(io, session, {
          status: 'accepted',
          responderId,
          responderSocketId: socket.id,
          roomId: session.roomId,
          isVideo: session.isVideo,
        });

        socket.emit('call-ready', {
          roomId: session.roomId,
          peerId: responderId,
          callerId: session.callerId,
          receiverId: session.receiverId,
          isVideo: session.isVideo,
          role: 'callee',
        });

        done({
          success: true,
          roomId: session.roomId,
          isVideo: session.isVideo,
        });
        return;
      }

      emitCallerUpdate(io, session, {
        status: status || 'declined',
        responderId,
        responderSocketId: socket.id,
        roomId: session.roomId,
        isVideo: session.isVideo,
      });

      destroySession(session.roomId);
      done({ success: true });
    } catch (error) {
      console.error('[call-response] error:', error);
      done({
        success: false,
        error: error.message || 'Impossible de repondre a cet appel.',
      });
    }
  });

  socket.on('call:start', async ({ roomId, callerId }, callback) => {
    try {
      const effectiveCallerId = getCurrentUserId(socket) || Number(callerId);
      const session = getSessionByRoomId(roomId);
      if (!session) {
        callback?.({ error: "L'appel a expire ou a ete annule" });
        return;
      }

      if (Number(session.callerId) !== Number(effectiveCallerId)) {
        callback?.({ error: 'Vous ne pouvez pas initialiser cet appel.' });
        return;
      }

      const room = await roomManager.getOrCreateRoom(roomId);
      room.addPeer(String(effectiveCallerId), socket.id);
      attachSocketToCall(socket, roomId, effectiveCallerId);

      session.callerSocketId = socket.id;
      callback?.({
        success: true,
        roomId,
        isVideo: session.isVideo,
      });
    } catch (error) {
      console.error('call:start error:', error);
      callback?.({ error: error.message });
    }
  });

  socket.on('call:join', async ({ roomId, peerId }, callback) => {
    try {
      const effectivePeerId = getCurrentUserId(socket) || Number(peerId);
      const session = getSessionByRoomId(roomId);
      if (!session) {
        callback?.({ error: "L'appel a expire ou a ete annule" });
        return;
      }

      if (
        Number(session.receiverId) !== Number(effectivePeerId) &&
        Number(session.callerId) !== Number(effectivePeerId)
      ) {
        callback?.({ error: 'Vous ne pouvez pas rejoindre cet appel.' });
        return;
      }

      const room = await roomManager.getOrCreateRoom(roomId);
      if (!room) {
        callback?.({ error: "L'appel a expire ou a ete annule" });
        return;
      }

      room.addPeer(String(effectivePeerId), socket.id);
      attachSocketToCall(socket, roomId, effectivePeerId);

      const activeProducers = [];
      room.peers.forEach((participant) => {
        participant.producers.forEach((producer) => {
          activeProducers.push({
            producerId: producer.id,
            peerId: participant.id,
            kind: producer.kind,
          });
        });
      });

      session.receiverSocketId = socket.id;
      session.status = 'connected';

      socket.to(roomId).emit('call:participant-joined', {
        roomId,
        peerId: effectivePeerId,
      });
      io.to(roomId).emit('call:connected', {
        roomId,
        isVideo: session.isVideo,
      });

      callback?.({
        success: true,
        roomId,
        isVideo: session.isVideo,
        activeProducers,
      });
    } catch (error) {
      console.error('call:join error:', error);
      callback?.({ error: error.message });
    }
  });

  socket.on('call:end', ({ roomId, peerId } = {}, callback) => {
    try {
      const currentUserId = getCurrentUserId(socket) || Number(peerId);
      const session =
        getSessionByRoomId(String(roomId || '')) ||
        getSessionByRoomId(getActiveRoomIdForUser(currentUserId));

      if (!session) {
        callback?.({ success: true });
        return;
      }

      emitCallEnded(io, session, currentUserId);
      destroySession(session.roomId);
      detachSocketFromCall(socket, session.roomId);
      callback?.({ success: true });
    } catch (error) {
      console.error('call:end error:', error);
      callback?.({
        success: false,
        error: error.message || 'Impossible de terminer cet appel.',
      });
    }
  });

  socket.on('call:reject', ({ roomId, peerId } = {}, callback) => {
    try {
      const currentUserId = getCurrentUserId(socket) || Number(peerId);
      const session =
        getSessionByRoomId(String(roomId || '')) ||
        getSessionByRoomId(getActiveRoomIdForUser(currentUserId));

      if (!session) {
        callback?.({ success: true });
        return;
      }

      emitCallerUpdate(io, session, {
        status: 'declined',
        responderId: currentUserId,
        roomId: session.roomId,
        isVideo: session.isVideo,
      });
      emitCallEnded(io, session, currentUserId);
      destroySession(session.roomId);
      detachSocketFromCall(socket, session.roomId);
      callback?.({ success: true });
    } catch (error) {
      console.error('call:reject error:', error);
      callback?.({
        success: false,
        error: error.message || 'Impossible de rejeter cet appel.',
      });
    }
  });

  socket.on('disconnecting', () => {
    const currentUserId = getCurrentUserId(socket);
    const roomId =
      socket.data?.privateCallRoomId || getActiveRoomIdForUser(currentUserId);
    const session = getSessionByRoomId(roomId);
    if (!session) {
      detachSocketFromCall(socket, roomId);
      return;
    }

    emitCallEnded(io, session, currentUserId);
    destroySession(session.roomId, { closeRoom: false });
    detachSocketFromCall(socket, session.roomId);
  });
};
