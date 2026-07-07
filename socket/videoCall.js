const roomManager = require('../mediasoup/roomManager');

// Gère le cycle de vie applicatif des appels privés
module.exports = function(socket, io) {

  // Démarrer ou initier un appel
  socket.on('call:start', async ({ roomId, callerId }, callback) => {
    try {
      socket.join(roomId);
      const room = await roomManager.getOrCreateRoom(roomId);
      room.addPeer(callerId, socket.id);
      
      socket.roomId = roomId;
      socket.peerId = callerId;
      
      console.log(`[Appel] ${callerId} a initié l'appel dans la salle ${roomId}`);
      callback({ success: true });
    } catch (err) {
      console.error('call:start error:', err);
      callback({ error: err.message });
    }
  });

  // Rejoindre un appel (le correspondant accepte)
  socket.on('call:join', async ({ roomId, peerId }, callback) => {
    try {
      socket.join(roomId);
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return callback({ error: "L'appel a expiré ou a été annulé" });
      }

      room.addPeer(peerId, socket.id);
      socket.roomId = roomId;
      socket.peerId = peerId;

      // Récupérer les flux déjà en cours
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

      console.log(`[Appel] ${peerId} a rejoint l'appel ${roomId}`);
      callback({ success: true, activeProducers });
    } catch (err) {
      console.error('call:join error:', err);
      callback({ error: err.message });
    }
  });

  // Terminer ou raccrocher l'appel
  socket.on('call:end', ({ roomId, peerId }) => {
    console.log(`[Appel] Appel terminé par ${peerId} dans ${roomId}`);
    socket.to(roomId).emit('call:end', { peerId });
    roomManager.closeRoom(roomId);
  });

  // Rejeter l'appel entrant
  socket.on('call:reject', ({ roomId, peerId }) => {
    console.log(`[Appel] Appel rejeté par ${peerId} pour la salle ${roomId}`);
    socket.to(roomId).emit('call:reject', { peerId });
    roomManager.closeRoom(roomId);
  });
};
