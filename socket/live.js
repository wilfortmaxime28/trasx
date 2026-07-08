const roomManager = require('../mediasoup/roomManager');

module.exports = function(socket, io) {

  // Création d'un Live par l'animateur (Host)
  socket.on('live:create', async ({ roomId, hostId, title, hostName, hostAvatar }, callback) => {
    try {
      socket.join(roomId);
      const room = await roomManager.getOrCreateRoom(roomId);
      room.isLive = true;
      room.hostId = hostId;
      room.title = title || 'Live TRASX';
      room.hostName = hostName || 'Anonyme';
      room.hostAvatar = hostAvatar || '/assets/avatar_placeholder.jpg';

      const peer = room.addPeer(hostId, socket.id);
      
      socket.roomId = roomId;
      socket.peerId = hostId;
      socket.isHost = true;
      
      // Notifier tout le monde qu'un live a démarré
      io.emit('live:started', {
        roomId,
        title: room.title,
        hostId,
        hostName: room.hostName,
        hostAvatar: room.hostAvatar
      });

      console.log(`[Live] Hôte ${hostId} a créé le live ${roomId} (${room.title})`);
      callback({ success: true });
    } catch (err) {
      console.error('live:create error:', err);
      callback({ error: err.message });
    }
  });

  // Rejoindre un Live existant (en tant que spectateur)
  socket.on('live:join', async ({ roomId, peerId }, callback) => {
    try {
      socket.join(roomId);
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return callback({ error: 'Le live est inactif ou introuvable' });
      }

      const peer = room.addPeer(peerId, socket.id);
      socket.roomId = roomId;
      socket.peerId = peerId;
      socket.isHost = false;

      // Notifier l'hôte et les autres spectateurs
      socket.to(roomId).emit('live:viewerJoined', { peerId });

      // Envoyer la liste des producteurs déjà actifs dans le live
      const activeProducers = [];
      room.peers.forEach(p => {
        p.producers.forEach(prod => {
          activeProducers.push({
            producerId: prod.id,
            peerId: p.id,
            kind: prod.kind
          });
        });
      });

      console.log(`[Live] Spectateur ${peerId} a rejoint le live ${roomId}`);
      callback({
        success: true,
        activeProducers,
        title: room.title,
        hostName: room.hostName,
        hostAvatar: room.hostAvatar
      });
    } catch (err) {
      console.error('live:join error:', err);
      callback({ error: err.message });
    }
  });

  // Récupérer la liste des lives actifs
  socket.on('live:list-active', (callback) => {
    try {
      const activeLives = [];
      roomManager.rooms.forEach(room => {
        if (room.isLive) {
          activeLives.push({
            roomId: room.id,
            title: room.title,
            hostId: room.hostId,
            hostName: room.hostName,
            hostAvatar: room.hostAvatar,
            spectatorsCount: Math.max(0, room.peers.size - 1)
          });
        }
      });
      callback(activeLives);
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // Quitter le live
  socket.on('live:leave', async ({ roomId, peerId }, callback) => {
    try {
      socket.leave(roomId);
      const room = roomManager.getRoom(roomId);
      if (room) {
        room.removePeer(peerId);
        socket.to(roomId).emit('live:viewerLeft', { peerId });
      }
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Demande d'intervention par un spectateur
  socket.on('live:requestToSpeak', ({ roomId, peerId, name }) => {
    socket.to(roomId).emit('live:requestToSpeak', { peerId, name });
  });

  // L'hôte accepte la demande
  socket.on('live:acceptSpeaker', ({ roomId, peerId }) => {
    socket.to(roomId).emit('live:acceptSpeaker', { peerId });
  });

  // L'hôte refuse la demande
  socket.on('live:rejectSpeaker', ({ roomId, peerId }) => {
    socket.to(roomId).emit('live:rejectSpeaker', { peerId });
  });

  // L'hôte retire la parole
  socket.on('live:removeSpeaker', ({ roomId, peerId }) => {
    socket.to(roomId).emit('live:removeSpeaker', { peerId });
  });

  // Message de chat en direct
  socket.on('live:chatMessage', ({ roomId, peerId, name, avatar, message }) => {
    io.to(roomId).emit('live:chatMessage', { peerId, name, avatar, message });
  });
};
