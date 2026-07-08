const roomManager = require('../mediasoup/roomManager');
const db = require('../config/db');

module.exports = function(socket, io) {

  // Création d'un Live par l'animateur (Host)
  socket.on('live:create', async ({ roomId, hostId, title, hostName, hostAvatar, isPaid, price }, callback) => {
    try {
      socket.join(roomId);
      const room = await roomManager.getOrCreateRoom(roomId);
      room.isLive = true;
      room.hostId = hostId;
      room.title = title || 'Live TRASX';
      room.hostName = hostName || 'Anonyme';
      room.hostAvatar = hostAvatar || '/assets/avatar_placeholder.jpg';
      room.isPaid = !!isPaid;
      room.price = Number(price || 0);
      room.paidUsers = new Set(); // Track who has already paid

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

      console.log(`[Live] Hôte ${hostId} a créé le live ${roomId} (${room.title}) – ${room.isPaid ? `Payant $${room.price}` : 'Gratuit'}`);
      callback({ success: true });
    } catch (err) {
      console.error('live:create error:', err);
      callback({ error: err.message });
    }
  });

  // Rejoindre un Live existant (en tant que spectateur)
  socket.on('live:join', async ({ roomId, peerId, name, avatar }, callback) => {
    try {
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return callback({ error: 'Le live est inactif ou introuvable' });
      }

      // ── Access control for paid lives ──────────────────────────────────────
      const userId = socket.request?.session?.userId;
      const effectivePeerId = userId || peerId;
      if (room.isPaid && Number(room.hostId) !== Number(effectivePeerId)) {
        if (!room.paidUsers || !room.paidUsers.has(Number(effectivePeerId))) {
          return callback({
            error: 'PAYMENT_REQUIRED',
            price: room.price,
            hostName: room.hostName
          });
        }
      }

      socket.join(roomId);
      const peer = room.addPeer(peerId, socket.id);
      peer.name = name || 'Spectateur';
      peer.avatar = avatar || '/assets/avatar_placeholder.jpg';
      
      socket.roomId = roomId;
      socket.peerId = peerId;
      socket.isHost = false;

      // Notifier l'hôte et les autres spectateurs
      socket.to(roomId).emit('live:viewerJoined', { peerId, name: name || 'Anonyme', avatar: avatar || '' });

      // Envoyer la liste des spectateurs mise à jour (sans l'animateur/créateur)
      const spectators = [];
      room.peers.forEach(p => {
        if (p.id !== room.hostId) {
          spectators.push({
            peerId: p.id,
            name: p.name || 'Spectateur',
            avatar: p.avatar || '/assets/avatar_placeholder.jpg'
          });
        }
      });
      io.to(roomId).emit('live:spectators-updated', {
        spectatorsCount: spectators.length,
        spectators
      });

      // Envoyer la liste des producteurs déjà actifs dans le live
      const activeProducers = [];
      room.peers.forEach(p => {
        p.producers.forEach(prod => {
          activeProducers.push({
            producerId: prod.id,
            peerId: p.id,
            kind: prod.kind,
            name: p.name || 'Spectateur'
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

  // Payer l'entrée d'un live payant
  socket.on('live:pay-entry', async ({ roomId }, callback) => {
    try {
      const senderId = socket.request?.session?.userId;
      if (!senderId) throw new Error('Session expirée. Reconnectez-vous.');

      const room = roomManager.getRoom(roomId);
      if (!room || !room.isLive || !room.hostId) {
        throw new Error('Le direct est inactif ou introuvable.');
      }

      // Already paid
      if (room.paidUsers && room.paidUsers.has(Number(senderId))) {
        return callback({ success: true });
      }

      const amount = Number(room.price || 0);
      const recipientUserId = Number(room.hostId);

      if (amount <= 0) {
        if (!room.paidUsers) room.paidUsers = new Set();
        room.paidUsers.add(Number(senderId));
        return callback({ success: true });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [senderRows] = await connection.query(
          'SELECT id, deposit_account_balance, withdrawal_account_balance FROM users WHERE id = ? FOR UPDATE',
          [senderId]
        );
        if (!senderRows.length) throw new Error('Utilisateur introuvable.');
        const sender = senderRows[0];
        const senderBalance = Number(sender.deposit_account_balance || 0);

        if (senderBalance < amount) throw new Error('Solde de dépôt insuffisant pour accéder à ce direct.');

        const [recipientRows] = await connection.query(
          'SELECT id, deposit_account_balance, withdrawal_account_balance FROM users WHERE id = ? FOR UPDATE',
          [recipientUserId]
        );
        if (!recipientRows.length) throw new Error('Créateur du live introuvable.');
        const recipient = recipientRows[0];

        await connection.query(
          'UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?',
          [amount, senderId]
        );
        await connection.query(
          'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
          [amount, recipientUserId]
        );

        await connection.commit();

        if (!room.paidUsers) room.paidUsers = new Set();
        room.paidUsers.add(Number(senderId));

        const newSenderBalance = Number((senderBalance - amount).toFixed(2));
        io.to(`user:${senderId}`).emit('balance-updated', {
          userId: Number(senderId),
          depositBalance: newSenderBalance,
          withdrawalBalance: Number(sender.withdrawal_account_balance || 0)
        });
        io.to(`user:${recipientUserId}`).emit('balance-updated', {
          userId: Number(recipientUserId),
          depositBalance: Number(recipient.deposit_account_balance || 0),
          withdrawalBalance: Number((Number(recipient.withdrawal_account_balance || 0) + amount).toFixed(2))
        });

        console.log(`[live:pay-entry] User ${senderId} paid $${amount} to enter live ${roomId}`);
        callback({ success: true, depositBalance: newSenderBalance });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('[live:pay-entry] Error:', err);
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
            spectatorsCount: Math.max(0, room.peers.size - 1),
            isPaid: room.isPaid || false,
            price: room.price || 0
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
        if (socket.isHost) {
          socket.to(roomId).emit('live:ended');
          roomManager.closeRoom(roomId);
          io.emit('live:ended-global', { roomId });
        } else {
          socket.to(roomId).emit('live:viewerLeft', { peerId });

          const spectators = [];
          room.peers.forEach(p => {
            if (p.id !== room.hostId) {
              spectators.push({
                peerId: p.id,
                name: p.name || 'Spectateur',
                avatar: p.avatar || '/assets/avatar_placeholder.jpg'
              });
            }
          });
          io.to(roomId).emit('live:spectators-updated', {
            spectatorsCount: spectators.length,
            spectators
          });
        }
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
    io.to(roomId).emit('live:removeSpeaker', { peerId });
  });

  // Message de chat en direct
  socket.on('live:chatMessage', ({ roomId, peerId, name, avatar, message }) => {
    io.to(roomId).emit('live:chatMessage', { peerId, name, avatar, message });
  });
};
