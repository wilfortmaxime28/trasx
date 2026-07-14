const workerManager = require('./worker');
const roomManager = require('./roomManager');
const transportHelper = require('./transport');

async function initMediasoup() {
  await workerManager.initWorkers();
}

/**
 * Point d'entrée pour la gestion des événements de signalisation brute mediasoup
 */
function handleSocket(socket, io) {
  // Récupérer les RTP Capabilities de la salle
  socket.on('mediasoup:getRtpCapabilities', async ({ roomId }, callback) => {
    try {
      const room = await roomManager.getOrCreateRoom(roomId);
      callback({ rtpCapabilities: room.router.rtpCapabilities });
    } catch (err) {
      console.error('[Mediasoup:getRtpCapabilities] Error:', err);
      callback({ error: err.message });
    }
  });

  // Créer un transport WebRTC (pour produire ou consommer)
  socket.on('mediasoup:createTransport', async ({ roomId, peerId }, callback) => {
    try {
      const room = roomManager.getRoom(roomId);
      if (!room) throw new Error('Salle introuvable');
      
      let peer = room.getPeer(peerId);
      if (!peer) {
        peer = room.addPeer(peerId, socket.id);
      }

      const transport = await transportHelper.createWebRtcTransport(room.router);
      peer.addTransport(transport);

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      });
    } catch (err) {
      console.error('[Mediasoup:createTransport] Error:', err);
      callback({ error: err.message });
    }
  });

  // Connecter un transport WebRTC
  socket.on('mediasoup:connectTransport', async ({ roomId, peerId, transportId, dtlsParameters }, callback) => {
    try {
      const room = roomManager.getRoom(roomId);
      const peer = room?.getPeer(peerId);
      const transport = peer?.getTransport(transportId);

      if (!transport) throw new Error('Transport introuvable');

      await transport.connect({ dtlsParameters });
      callback({ success: true });
    } catch (err) {
      console.error('[Mediasoup:connectTransport] Error:', err);
      callback({ error: err.message });
    }
  });

  // Commencer à produire (émettre) un flux
  socket.on('mediasoup:produce', async ({ roomId, peerId, transportId, kind, rtpParameters, appData }, callback) => {
    try {
      const room = roomManager.getRoom(roomId);
      const peer = room?.getPeer(peerId);
      const transport = peer?.getTransport(transportId);

      if (!transport) throw new Error('Transport introuvable pour produire');

      const producer = await transport.produce({ kind, rtpParameters, appData });
      peer.addProducer(producer);

      const producerPayload = {
        roomId,
        producerId: producer.id,
        peerId: peer.id,
        kind: producer.kind,
        name: peer.name || 'Spectateur',
        appData: appData || {}
      };

      // Notifier les autres de ce nouveau producteur
      socket.to(roomId).emit('mediasoup:newProducer', producerPayload);
      if (room?.isLive) {
        socket.to(roomId).emit('live:newProducer', producerPayload);
      }

      callback({ id: producer.id });
    } catch (err) {
      console.error('[Mediasoup:produce] Error:', err);
      callback({ error: err.message });
    }
  });

  // Commencer à consommer (recevoir) un flux
  socket.on('mediasoup:consume', async ({ roomId, peerId, transportId, producerId, rtpCapabilities }, callback) => {
    try {
      const room = roomManager.getRoom(roomId);
      const peer = room?.getPeer(peerId);
      const transport = peer?.getTransport(transportId);

      if (!room || !transport) throw new Error('Salle ou transport introuvable pour consommer');

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error('Impossible de consommer ce producteur (incompatibilité RTP)');
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true // Toujours démarrer en pause, à reprendre côté client
      });

      peer.addConsumer(consumer);

      callback({
        params: {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        }
      });
    } catch (err) {
      console.error('[Mediasoup:consume] Error:', err);
      callback({ error: err.message });
    }
  });

  // Reprendre la consommation d'un flux
  socket.on('mediasoup:resumeConsumer', async ({ roomId, peerId, consumerId }, callback) => {
    try {
      const room = roomManager.getRoom(roomId);
      const peer = room?.getPeer(peerId);
      const consumer = peer?.consumers.get(consumerId);

      if (!consumer) throw new Error('Consommateur introuvable');

      await consumer.resume();
      callback({ success: true });
    } catch (err) {
      console.error('[Mediasoup:resumeConsumer] Error:', err);
      callback({ error: err.message });
    }
  });

  // Arrêter proprement un producteur
  socket.on('mediasoup:closeProducer', async ({ roomId, peerId, producerId }, callback) => {
    try {
      const room = roomManager.getRoom(roomId);
      const peer = room?.getPeer(peerId);
      const producer = peer?.producers?.get(producerId);
      if (peer) {
        peer.closeProducer(producerId);
      }

      const producerClosedPayload = {
        roomId,
        producerId,
        peerId,
        kind: producer?.kind || null
      };

      socket.to(roomId).emit('mediasoup:producerClosed', producerClosedPayload);
      if (room?.isLive) {
        socket.to(roomId).emit('live:producerClosed', producerClosedPayload);
      }
      if (callback) callback({ success: true });
    } catch (err) {
      console.error('[Mediasoup:closeProducer] Error:', err);
      if (callback) callback({ error: err.message });
    }
  });
}

module.exports = {
  initMediasoup,
  handleSocket
};
