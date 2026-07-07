// TRASX Native Live Client integration (mediasoup + Socket.IO)

document.addEventListener('DOMContentLoaded', () => {
  const socket = window.socket || io();
  
  // DOM Elements
  const openLiveCreateModalBtn = document.getElementById('openLiveCreateModalBtn');
  const liveCreateModal = document.getElementById('liveCreateModal');
  const closeLiveCreateModal = document.getElementById('closeLiveCreateModal');
  const startLiveBtn = document.getElementById('startLiveBtn');
  const liveTitleInput = document.getElementById('liveTitleInput');

  const liveOverlayViewer = document.getElementById('liveOverlayViewer');
  const leaveLiveBtn = document.getElementById('leaveLiveBtn');
  const liveHostAvatar = document.getElementById('liveHostAvatar');
  const liveHostName = document.getElementById('liveHostName');
  const liveTitleText = document.getElementById('liveTitleText');
  const liveBlurBg = document.getElementById('liveBlurBg');
  const liveViewerCountVal = document.getElementById('liveViewerCountVal');

  const liveHostVideo = document.getElementById('liveHostVideo');
  const liveGuestCard = document.getElementById('liveGuestCard');
  const liveGuestVideo = document.getElementById('liveGuestVideo');
  const liveGuestName = document.getElementById('liveGuestName');

  const liveHostNotification = document.getElementById('liveHostNotification');
  const liveHostNotificationText = document.getElementById('liveHostNotificationText');
  const liveAcceptSpeakBtn = document.getElementById('liveAcceptSpeakBtn');
  const liveRejectSpeakBtn = document.getElementById('liveRejectSpeakBtn');

  const liveSpeakRequestBtn = document.getElementById('liveSpeakRequestBtn');
  const liveMicToggleBtn = document.getElementById('liveMicToggleBtn');
  const liveCamToggleBtn = document.getElementById('liveCamToggleBtn');
  const liveRemoveSpeakerBtn = document.getElementById('liveRemoveSpeakerBtn');
  
  const liveChatInput = document.getElementById('liveChatInput');
  const sendLiveChatBtn = document.getElementById('sendLiveChatBtn');
  const activeLivesContainer = document.getElementById('activeLivesContainer');
  const activeLivesList = document.getElementById('activeLivesList');

  // Mediasoup variables
  let device = null;
  let sendTransport = null;
  let recvTransport = null;
  let localStream = null;
  let currentRoomId = null;
  let isHost = false;
  let isSpeaker = false;
  let micEnabled = true;
  let camEnabled = true;
  
  let currentProducers = new Map(); // kind -> Producer
  let currentConsumers = new Map(); // producerId -> Consumer
  
  let pendingSpeakerRequestId = null;

  // Initial Load - Fetch Active Lives
  const refreshActiveLives = () => {
    socket.emit('live:list-active', (lives) => {
      if (lives && lives.length > 0) {
        activeLivesContainer.style.display = 'flex';
        activeLivesList.innerHTML = '';
        lives.forEach(live => {
          const item = document.createElement('div');
          item.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; min-width: 60px;';
          item.innerHTML = `
            <div style="position: relative; width: 44px; height: 44px; border-radius: 50%; border: 2px solid #ef4444; padding: 2px;">
              <img src="${live.hostAvatar || '/assets/avatar_placeholder.jpg'}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
              <span style="position: absolute; bottom: -3px; left: 50%; transform: translateX(-50%); background: #ef4444; color: white; font-size: 7px; font-weight: 800; padding: 1px 4px; border-radius: 4px; text-transform: uppercase;">LIVE</span>
            </div>
            <span style="font-size: 9px; font-weight: 700; color: var(--text-primary); text-align: center; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${live.hostName}</span>
          `;
          item.addEventListener('click', () => joinLive(live.roomId));
          activeLivesList.appendChild(item);
        });
      } else {
        activeLivesContainer.style.display = 'none';
      }
    });
  };

  // Socket: new live started notification
  socket.on('live:started', () => {
    refreshActiveLives();
  });

  // Call refresh initially
  refreshActiveLives();

  // Modals management
  if (openLiveCreateModalBtn) {
    openLiveCreateModalBtn.addEventListener('click', () => {
      liveCreateModal.style.display = 'flex';
    });
  }
  if (closeLiveCreateModal) {
    closeLiveCreateModal.addEventListener('click', () => {
      liveCreateModal.style.display = 'none';
    });
  }

  // Create & Start Live
  if (startLiveBtn) {
    startLiveBtn.addEventListener('click', async () => {
      const title = liveTitleInput.value.trim() || 'Live TRASX';
      const roomId = `live-${window.currentUserId}`; // Room ID based on Host user ID
      
      try {
        isHost = true;
        isSpeaker = true;
        currentRoomId = roomId;
        liveCreateModal.style.display = 'none';

        // Request local stream
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Show overlay
        liveOverlayViewer.style.display = 'flex';
        liveHostVideo.srcObject = localStream;
        liveHostVideo.style.transform = 'scaleX(-1)'; // Mirror for host self preview
        liveHostName.textContent = 'Moi (Animateur)';
        liveTitleText.textContent = title;
        liveHostAvatar.src = document.querySelector('.profile-btn img')?.getAttribute('src') || '/assets/avatar_placeholder.jpg';
        if (liveBlurBg) liveBlurBg.style.backgroundImage = `url(${liveHostAvatar.src})`;
        
        // Setup speaker controls
        liveMicToggleBtn.style.display = 'inline-flex';
        liveCamToggleBtn.style.display = 'inline-flex';

        // Join live room on socket level
        socket.emit('live:create', {
          roomId,
          hostId: window.currentUserId,
          title,
          hostName: window.currentUserUsername || 'Animateur',
          hostAvatar: liveHostAvatar.src
        }, async ({ success, error }) => {
          if (error) throw new Error(error);
          
          // Connect to mediasoup
          await initMediasoup(roomId, window.currentUserId);
          await publishStream();
        });
      } catch (err) {
        console.error(err);
        alert('Impossible de démarrer le live: ' + err.message);
        cleanUpLive();
      }
    });
  }

  // Join Live as Spectator
  const joinLive = async (roomId) => {
    try {
      isHost = false;
      isSpeaker = false;
      currentRoomId = roomId;
      
      liveOverlayViewer.style.display = 'flex';
      liveHostVideo.srcObject = null;
      liveHostVideo.style.transform = 'none';
      
      socket.emit('live:join', { roomId, peerId: window.currentUserId }, async (response) => {
        if (response.error) {
          alert(response.error);
          cleanUpLive();
          return;
        }

        liveHostName.textContent = response.hostName;
        liveTitleText.textContent = response.title;
        liveHostAvatar.src = response.hostAvatar || '/assets/avatar_placeholder.jpg';
        if (liveBlurBg) liveBlurBg.style.backgroundImage = `url(${liveHostAvatar.src})`;

        // Show speak request button for spectator
        liveSpeakRequestBtn.style.display = 'inline-flex';

        // Init Mediasoup client
        await initMediasoup(roomId, window.currentUserId);

        // Consume all active producers (Host streams)
        if (response.activeProducers) {
          for (const prod of response.activeProducers) {
            await consumeProducer(prod.producerId, prod.kind, prod.peerId);
          }
        }
      });
    } catch (err) {
      console.error(err);
      alert('Impossible de rejoindre le live: ' + err.message);
      cleanUpLive();
    }
  };

  // Mediasoup Client init
  async function initMediasoup(roomId, peerId) {
    return new Promise((resolve, reject) => {
      socket.emit('mediasoup:getRtpCapabilities', { roomId }, async ({ rtpCapabilities, error }) => {
        if (error) return reject(new Error(error));
        
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        
        await createTransports(roomId, peerId);
        resolve();
      });
    });
  }

  async function createTransports(roomId, peerId) {
    return new Promise((resolve) => {
      // Send Transport (For publishing, only if Host/Orateur)
      socket.emit('mediasoup:createTransport', { roomId, peerId }, async ({ params }) => {
        sendTransport = device.createSendTransport(params);
        
        sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socket.emit('mediasoup:connectTransport', { roomId, peerId, transportId: sendTransport.id, dtlsParameters }, ({ error }) => {
            if (error) return errback(error);
            callback();
          });
        });
        
        sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
          socket.emit('mediasoup:produce', { roomId, peerId, transportId: sendTransport.id, kind, rtpParameters, appData }, ({ id, error }) => {
            if (error) return errback(error);
            callback({ id });
          });
        });
      });

      // Recv Transport (For consuming)
      socket.emit('mediasoup:createTransport', { roomId, peerId }, async ({ params }) => {
        recvTransport = device.createRecvTransport(params);
        
        recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socket.emit('mediasoup:connectTransport', { roomId, peerId, transportId: recvTransport.id, dtlsParameters }, ({ error }) => {
            if (error) return errback(error);
            callback();
          });
        });
        
        resolve();
      });
    });
  }

  // Publish tracks
  async function publishStream() {
    if (!localStream || !sendTransport) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];
    
    if (audioTrack) {
      const audioProducer = await sendTransport.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
      currentProducers.set('audio', audioProducer);
    }
    if (videoTrack) {
      const videoProducer = await sendTransport.produce({ track: videoTrack, appData: { mediaType: 'video' } });
      currentProducers.set('video', videoProducer);
    }
  }

  // Consume a producer
  async function consumeProducer(producerId, kind, producerPeerId) {
    if (!recvTransport) return;
    
    socket.emit('mediasoup:consume', {
      roomId: currentRoomId,
      peerId: window.currentUserId,
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities
    }, async ({ params, error }) => {
      if (error) return console.error(error);
      
      const consumer = await recvTransport.consume(params);
      currentConsumers.set(consumer.id, consumer);
      
      socket.emit('mediasoup:resumeConsumer', { roomId: currentRoomId, peerId: window.currentUserId, consumerId: consumer.id });
      
      const stream = new MediaStream([consumer.track]);
      
      const hostCleanId = currentRoomId.replace('live-', '');
      if (Number(producerPeerId) === Number(hostCleanId)) {
        // Host video stream
        if (kind === 'video') {
          liveHostVideo.srcObject = stream;
        }
      } else {
        // Guest/Speaker video stream
        if (kind === 'video') {
          liveGuestCard.style.display = 'block';
          liveGuestVideo.srcObject = stream;
        }
      }
    });
  }

  // Socket incoming signaling
  socket.on('live:newProducer', async ({ producerId, peerId, kind }) => {
    if (peerId !== window.currentUserId) {
      await consumeProducer(producerId, kind, peerId);
    }
  });

  socket.on('live:producerClosed', ({ producerId }) => {
    currentConsumers.forEach((consumer, consumerId) => {
      if (consumer.producerId === producerId) {
        consumer.close();
        currentConsumers.delete(consumerId);
      }
    });
  });

  // Speak requests logic (Host UI side)
  socket.on('live:requestToSpeak', ({ peerId, name }) => {
    if (isHost) {
      pendingSpeakerRequestId = peerId;
      liveHostNotificationText.textContent = `${name} souhaite prendre la parole.`;
      liveHostNotification.style.display = 'flex';
      
      // Play dial tone chime
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      } catch(e) {}
    }
  });

  if (liveAcceptSpeakBtn) {
    liveAcceptSpeakBtn.addEventListener('click', () => {
      if (pendingSpeakerRequestId && currentRoomId) {
        socket.emit('live:acceptSpeaker', { roomId: currentRoomId, peerId: pendingSpeakerRequestId });
        liveHostNotification.style.display = 'none';
        pendingSpeakerRequestId = null;
      }
    });
  }

  if (liveRejectSpeakBtn) {
    liveRejectSpeakBtn.addEventListener('click', () => {
      if (pendingSpeakerRequestId && currentRoomId) {
        socket.emit('live:rejectSpeaker', { roomId: currentRoomId, peerId: pendingSpeakerRequestId });
        liveHostNotification.style.display = 'none';
        pendingSpeakerRequestId = null;
      }
    });
  }

  // Speak requests logic (Spectator UI side)
  if (liveSpeakRequestBtn) {
    liveSpeakRequestBtn.addEventListener('click', () => {
      if (currentRoomId) {
        socket.emit('live:requestToSpeak', {
          roomId: currentRoomId,
          peerId: window.currentUserId,
          name: window.currentUserUsername || 'Spectateur'
        });
        liveSpeakRequestBtn.textContent = 'Demande envoyée...';
        liveSpeakRequestBtn.disabled = true;
        liveSpeakRequestBtn.style.opacity = '0.6';
      }
    });
  }

  socket.on('live:acceptSpeaker', async ({ peerId }) => {
    if (peerId === window.currentUserId) {
      isSpeaker = true;
      liveSpeakRequestBtn.style.display = 'none';
      
      // Enable speaker mic/cam buttons
      liveMicToggleBtn.style.display = 'inline-flex';
      liveCamToggleBtn.style.display = 'inline-flex';
      
      try {
        // Capture camera/mic stream
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Show overlay preview local mini card
        liveGuestCard.style.display = 'block';
        liveGuestVideo.srcObject = localStream;
        liveGuestName.textContent = 'Moi';
        
        await publishStream();
        alert('Votre demande a été acceptée ! Vous êtes en direct.');
      } catch (err) {
        console.error(err);
      }
    }
  });

  socket.on('live:rejectSpeaker', ({ peerId }) => {
    if (peerId === window.currentUserId) {
      alert("L'hôte a décliné votre demande d'intervention.");
      liveSpeakRequestBtn.textContent = 'Demander à intervenir';
      liveSpeakRequestBtn.disabled = false;
      liveSpeakRequestBtn.style.opacity = '1';
    }
  });

  socket.on('live:removeSpeaker', ({ peerId }) => {
    if (peerId === window.currentUserId) {
      alert("L'hôte vous a replacé en simple spectateur.");
      isSpeaker = false;
      
      // Remove media stream
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }
      
      // Close producers
      currentProducers.forEach(p => {
        socket.emit('mediasoup:closeProducer', { roomId: currentRoomId, peerId: window.currentUserId, producerId: p.id });
        p.close();
      });
      currentProducers.clear();
      
      // Hide camera card and buttons
      liveGuestCard.style.display = 'none';
      liveMicToggleBtn.style.display = 'none';
      liveCamToggleBtn.style.display = 'none';
      
      // Reset request button
      liveSpeakRequestBtn.style.display = 'inline-flex';
      liveSpeakRequestBtn.textContent = 'Demander à intervenir';
      liveSpeakRequestBtn.disabled = false;
      liveSpeakRequestBtn.style.opacity = '1';
    } else {
      // Hide guest card for other viewers
      liveGuestCard.style.display = 'none';
      liveGuestVideo.srcObject = null;
    }
  });

  // Toggles for Micro / Camera
  if (liveMicToggleBtn) {
    liveMicToggleBtn.addEventListener('click', () => {
      micEnabled = !micEnabled;
      if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = micEnabled);
      }
      liveMicToggleBtn.innerHTML = micEnabled ? '<i data-lucide="mic"></i>' : '<i data-lucide="mic-off"></i>';
      liveMicToggleBtn.style.background = micEnabled ? 'rgba(255,255,255,0.15)' : '#ef4444';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [liveMicToggleBtn] });
    });
  }

  if (liveCamToggleBtn) {
    liveCamToggleBtn.addEventListener('click', () => {
      camEnabled = !camEnabled;
      if (localStream) {
        localStream.getVideoTracks().forEach(track => track.enabled = camEnabled);
      }
      liveCamToggleBtn.innerHTML = camEnabled ? '<i data-lucide="video"></i>' : '<i data-lucide="video-off"></i>';
      liveCamToggleBtn.style.background = camEnabled ? 'rgba(255,255,255,0.15)' : '#ef4444';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [liveCamToggleBtn] });
    });
  }

  // End / Leave Live
  const cleanUpLive = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    currentProducers.forEach(p => p.close());
    currentProducers.clear();
    
    currentConsumers.forEach(c => c.close());
    currentConsumers.clear();
    
    if (sendTransport) { sendTransport.close(); sendTransport = null; }
    if (recvTransport) { recvTransport.close(); recvTransport = null; }
    
    liveOverlayViewer.style.display = 'none';
    liveGuestCard.style.display = 'none';
    liveMicToggleBtn.style.display = 'none';
    liveCamToggleBtn.style.display = 'none';
    liveSpeakRequestBtn.style.display = 'none';
    
    currentRoomId = null;
    isHost = false;
    isSpeaker = false;
    
    refreshActiveLives();
  };

  if (leaveLiveBtn) {
    leaveLiveBtn.addEventListener('click', () => {
      if (currentRoomId) {
        if (isHost) {
          if (confirm("Arrêter la diffusion et fermer le live ?")) {
            socket.emit('live:leave', { roomId: currentRoomId, peerId: window.currentUserId });
            cleanUpLive();
          }
        } else {
          socket.emit('live:leave', { roomId: currentRoomId, peerId: window.currentUserId });
          cleanUpLive();
        }
      }
    });
  }

  socket.on('live:ended', () => {
    alert("La diffusion s'est terminée.");
    cleanUpLive();
  });
});
