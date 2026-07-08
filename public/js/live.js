// TRASX Native Live Client integration (mediasoup + Socket.IO)
console.log('[live.js] Script loaded, io available:', typeof io !== 'undefined');

(function initLive() {
  console.log('[live.js] initLive() called, io:', typeof io, 'readyState:', document.readyState);
  if (typeof io === 'undefined') {
    // Fallback: socket.io not yet loaded, wait for it
    console.log('[live.js] io not ready, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', initLive);
    return;
  }
  const socket = io();
  console.log('[live.js] socket created:', !!socket);
  
  // DOM Elements
  const openLiveCreateModalBtn = document.getElementById('openLiveCreateModalBtn');
  const shortsMobileLiveBtn = document.getElementById('shortsMobileLiveBtn');
  const desktopLiveCreateBtn = document.getElementById('desktopLiveCreateBtn');
  const liveCreateModal = document.getElementById('liveCreateModal');
  const closeLiveCreateModal = document.getElementById('closeLiveCreateModal');
  const startLiveBtn = document.getElementById('startLiveBtn');
  const liveTitleInput = document.getElementById('liveTitleInput');

  console.log('[live.js] DOM elements found:', {
    openLiveCreateModalBtn: !!openLiveCreateModalBtn,
    shortsMobileLiveBtn: !!shortsMobileLiveBtn,
    desktopLiveCreateBtn: !!desktopLiveCreateBtn,
    liveCreateModal: !!liveCreateModal,
    startLiveBtn: !!startLiveBtn
  });

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
  const liveChatMessages = document.getElementById('liveChatMessages');
  const liveFollowBtn = document.getElementById('liveFollowBtn');
  const liveGiftBtn = document.getElementById('liveGiftBtn');
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
    if (!activeLivesContainer) return;
    if (window.currentView !== 'feed') {
      activeLivesContainer.style.display = 'none';
      return;
    }

    socket.emit('live:list-active', (lives) => {
      if (lives && lives.length > 0 && window.currentView === 'feed') {
        activeLivesContainer.style.display = 'flex';
        if (activeLivesList) {
          activeLivesList.innerHTML = '';
          lives.forEach(live => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; min-width: 60px;';
            item.innerHTML = `
              <div style="position: relative; width: 44px; height: 44px; border-radius: 50%; border: 2px solid #ef4444; padding: 2px;">
                <img src="${live.hostAvatar || '/assets/avatar_placeholder.jpg'}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
                <span style="position: absolute; bottom: -3px; left: 50%; transform: translateX(-50%); background: #ef4444; color: white; font-size: 7px; font-weight: 800; padding: 1px 4px; border-radius: 4px; text-transform: uppercase; font-family: 'Outfit', sans-serif;">LIVE</span>
              </div>
              <span class="story-username" style="font-family: 'Outfit', sans-serif; font-size: 11px; font-weight: 500; color: var(--text-secondary); text-align: center; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${live.hostName}</span>
            `;
            item.addEventListener('click', () => joinLive(live.roomId));
            activeLivesList.appendChild(item);
          });
        }
      } else {
        activeLivesContainer.style.display = 'none';
      }
    });
  };

  window.refreshActiveLives = refreshActiveLives;

  // Socket: new live started notification
  socket.on('live:started', () => {
    refreshActiveLives();
  });

  socket.on('live:ended-global', () => {
    refreshActiveLives();
  });

  // Call refresh initially
  refreshActiveLives();

  const stopAllOtherPlayback = () => {
    // Stop short video autoplay observer first
    if (typeof window.stopShortsPlayback === 'function') {
      window.stopShortsPlayback();
    }
    document.querySelectorAll('video, audio').forEach(el => {
      if (el.id !== 'liveHostVideo' && el.id !== 'liveGuestVideo' && el.id !== 'localVideo' && el.id !== 'remoteVideo') {
        try {
          el.pause();
        } catch (e) {
          console.warn(e);
        }
      }
    });
  };

  // Modals management
  const openLiveBtns = [openLiveCreateModalBtn, shortsMobileLiveBtn, desktopLiveCreateBtn];
  openLiveBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        liveCreateModal.style.display = 'flex';
      });
    }
  });
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
        stopAllOtherPlayback();
        isHost = true;
        isSpeaker = true;
        currentRoomId = roomId;
        liveCreateModal.style.display = 'none';

        // Request local stream
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Show overlay
        liveOverlayViewer.style.display = 'flex';
        if (liveFollowBtn) liveFollowBtn.style.display = 'none';
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
          hostName: window.currentUserDisplayName || window.currentUsername || 'Animateur',
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
      stopAllOtherPlayback();
      isHost = false;
      isSpeaker = false;
      currentRoomId = roomId;
      
      liveOverlayViewer.style.display = 'flex';
      if (liveFollowBtn) {
        liveFollowBtn.style.display = 'inline-block';
        liveFollowBtn.textContent = 'Suivre';
        liveFollowBtn.style.background = '#ef4444';
        liveFollowBtn.disabled = false;
      }
      liveHostVideo.srcObject = null;
      liveHostVideo.style.transform = 'none';
      
      const viewerAvatar = document.querySelector('.profile-btn img')?.getAttribute('src') || '/assets/avatar_placeholder.jpg';
      const viewerName = window.currentUserDisplayName || window.currentUsername || 'Anonyme';
      socket.emit('live:join', { roomId, peerId: window.currentUserId, name: viewerName, avatar: viewerAvatar }, async (response) => {
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
  const liveSpeakRequestBadge = document.getElementById('liveSpeakRequestBadge');
  const liveSpeakRequestIcon = document.getElementById('liveSpeakRequestIcon');

  if (liveSpeakRequestBtn) {
    liveSpeakRequestBtn.addEventListener('click', () => {
      if (currentRoomId) {
        socket.emit('live:requestToSpeak', {
          roomId: currentRoomId,
          peerId: window.currentUserId,
          name: window.currentUserDisplayName || window.currentUsername || 'Spectateur'
        });
        // Visual feedback: amber badge pulsing, button slightly muted
        liveSpeakRequestBtn.disabled = true;
        liveSpeakRequestBtn.style.background = '#f59e0b';
        liveSpeakRequestBtn.style.opacity = '0.85';
        liveSpeakRequestBtn.title = 'Demande envoyée...';
        if (liveSpeakRequestBadge) liveSpeakRequestBadge.style.display = 'block';
        if (liveSpeakRequestIcon) {
          liveSpeakRequestIcon.setAttribute('data-lucide', 'loader');
          if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [liveSpeakRequestBtn] });
        }
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
      // Reset button to idle state
      liveSpeakRequestBtn.disabled = false;
      liveSpeakRequestBtn.style.background = '#3b82f6';
      liveSpeakRequestBtn.style.opacity = '1';
      liveSpeakRequestBtn.title = 'Demander à parler';
      if (liveSpeakRequestBadge) liveSpeakRequestBadge.style.display = 'none';
      if (liveSpeakRequestIcon) {
        liveSpeakRequestIcon.setAttribute('data-lucide', 'mic');
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [liveSpeakRequestBtn] });
      }
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
      liveSpeakRequestBtn.disabled = false;
      liveSpeakRequestBtn.style.background = '#3b82f6';
      liveSpeakRequestBtn.style.opacity = '1';
      liveSpeakRequestBtn.title = 'Demander à parler';
      if (liveSpeakRequestBadge) liveSpeakRequestBadge.style.display = 'none';
      if (liveSpeakRequestIcon) {
        liveSpeakRequestIcon.setAttribute('data-lucide', 'mic');
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [liveSpeakRequestBtn] });
      }
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
      liveMicToggleBtn.style.background = micEnabled ? 'rgba(255,255,255,0.15)' : '#3b82f6';
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
      liveCamToggleBtn.style.background = camEnabled ? 'rgba(255,255,255,0.15)' : '#3b82f6';
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
    
    // Reset Chat & Follow button
    if (liveChatMessages) {
      liveChatMessages.innerHTML = `
        <div style="background: rgba(0,0,0,0.3); padding: 6px 12px; border-radius: 12px; font-size: 12px; line-height: 1.4; display: inline-block; align-self: flex-start; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.05);">
          <span style="font-weight: 700; color: #10b981; margin-right: 6px;">Système</span>
          <span style="color: #e5e7eb;">Bienvenue dans le chat du direct ! Restez poli et courtois.</span>
        </div>
      `;
    }
    if (liveFollowBtn) {
      liveFollowBtn.style.display = 'none';
      liveFollowBtn.textContent = 'Suivre';
      liveFollowBtn.style.background = '#ef4444';
      liveFollowBtn.disabled = false;
    }
    
    currentRoomId = null;
    isHost = false;
    isSpeaker = false;
    
    refreshActiveLives();
  };

  if (leaveLiveBtn) {
    leaveLiveBtn.addEventListener('click', () => {
      if (currentRoomId) {
        const confirmModal = document.getElementById('liveEndConfirmModal');
        const titleEl = document.getElementById('liveEndConfirmTitle');
        const textEl = document.getElementById('liveEndConfirmText');
        const confirmBtn = document.getElementById('liveConfirmEndBtn');
        const cancelBtn = document.getElementById('liveCancelEndBtn');

        if (confirmModal) {
          if (isHost) {
            if (titleEl) titleEl.textContent = "Arrêter la diffusion ?";
            if (textEl) textEl.textContent = "Êtes-vous sûr de vouloir mettre fin à ce direct et fermer la diffusion pour tous les spectateurs ?";
            if (confirmBtn) {
              confirmBtn.textContent = "Mettre fin";
              confirmBtn.style.background = "#ef4444";
            }
          } else {
            if (titleEl) titleEl.textContent = "Quitter le direct ?";
            if (textEl) textEl.textContent = "Êtes-vous sûr de vouloir quitter cette diffusion ?";
            if (confirmBtn) {
              confirmBtn.textContent = "Quitter";
              confirmBtn.style.background = "#3b82f6"; // platform blue
            }
          }

          confirmModal.style.display = 'flex';
          confirmModal.setAttribute('aria-hidden', 'false');

          const onCancel = () => {
            confirmModal.style.display = 'none';
            confirmModal.setAttribute('aria-hidden', 'true');
            cleanupListeners();
          };

          const onConfirm = () => {
            confirmModal.style.display = 'none';
            confirmModal.setAttribute('aria-hidden', 'true');
            cleanupListeners();

            let cleanupCalled = false;
            const doCleanup = () => {
              if (cleanupCalled) return;
              cleanupCalled = true;
              cleanUpLive();
            };
            const timeout = setTimeout(doCleanup, 1000);
            socket.emit('live:leave', { roomId: currentRoomId, peerId: window.currentUserId }, () => {
              clearTimeout(timeout);
              doCleanup();
            });
          };

          const cleanupListeners = () => {
            cancelBtn.removeEventListener('click', onCancel);
            confirmBtn.removeEventListener('click', onConfirm);
          };

          cancelBtn.addEventListener('click', onCancel);
          confirmBtn.addEventListener('click', onConfirm);
        }
      }
    });
  }

  // --- Live Chat Client Logic ---
  const sendLiveChatMessage = () => {
    if (!currentRoomId || !liveChatInput) return;
    const text = liveChatInput.value.trim();
    if (!text) return;

    const userAvatar = document.querySelector('.profile-btn img')?.getAttribute('src') || '/assets/avatar_placeholder.jpg';
    socket.emit('live:chatMessage', {
      roomId: currentRoomId,
      peerId: window.currentUserId,
      name: window.currentUserDisplayName || window.currentUsername || 'Anonyme',
      avatar: userAvatar,
      message: text
    });
    liveChatInput.value = '';
  };

  if (sendLiveChatBtn) {
    sendLiveChatBtn.addEventListener('click', sendLiveChatMessage);
  }
  if (liveChatInput) {
    liveChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendLiveChatMessage();
      }
    });
  }

  // Socket: Receive Live Chat Message
  socket.on('live:chatMessage', ({ peerId, name, avatar, message }) => {
    if (!liveChatMessages) return;

    const msgDiv = document.createElement('div');
    msgDiv.style.background = 'rgba(0,0,0,0.35)';
    msgDiv.style.borderRadius = '12px';
    msgDiv.style.fontSize = '12px';
    msgDiv.style.lineHeight = '1.4';
    msgDiv.style.display = 'flex';
    msgDiv.style.alignItems = 'flex-start';
    msgDiv.style.gap = '6px';
    msgDiv.style.alignSelf = 'flex-start';
    msgDiv.style.backdropFilter = 'blur(4px)';
    msgDiv.style.webkitBackdropFilter = 'blur(4px)';
    msgDiv.style.border = '1px solid rgba(255,255,255,0.05)';
    msgDiv.style.marginBottom = '4px';
    msgDiv.style.padding = '5px 10px 5px 5px';
    msgDiv.style.maxWidth = '100%';

    // Customize system style vs user style
    if (peerId === 'system-join') {
      msgDiv.style.background = 'rgba(59,130,246,0.15)';
      msgDiv.style.border = '1px solid rgba(59,130,246,0.25)';
      const avatarHtml = avatar
        ? `<img src="${avatar}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-top:1px;border:1.5px solid #3b82f6;" onerror="this.style.display='none'">`
        : '';
      msgDiv.innerHTML = `${avatarHtml}<span style="color:#93c5fd;font-size:11px;"><strong style="color:#60a5fa;">${name}</strong> a rejoint le direct 👋</span>`;
    } else if (peerId === 'system-follow') {
      msgDiv.innerHTML = `<span style="padding: 1px 6px;"><span style="font-weight: 700; color: #ff2d55; margin-right: 6px;">${name}</span><span style="color: #ff85a2; font-style: italic;">${message}</span></span>`;
    } else if (peerId === 'system-gift') {
      msgDiv.innerHTML = `<span style="padding: 1px 6px;"><span style="font-weight: 700; color: #ff85a2; margin-right: 6px;">${name}</span><span style="color: #ffd166; font-weight: bold;">${message}</span></span>`;
      // Extract emoji from the message if any, or fall back to 🌹
      const emojiMatch = message.match(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g);
      const giftEmoji = emojiMatch ? emojiMatch[0] : '🌹';
      showFloatingGiftAnimation(giftEmoji, name, message);
    } else {
      // Normal chat message with avatar
      const isHostMsg = (peerId === currentRoomId.replace('live-', ''));
      const nameColor = isHostMsg ? '#ffd166' : '#f3f4f6';
      const badgeHtml = isHostMsg ? '<span style="font-size: 8px; background: #ef4444; color: white; padding: 1px 4px; border-radius: 4px; font-weight: 800; margin-right: 4px; vertical-align: middle;">HÔTE</span>' : '';
      const avatarHtml = avatar
        ? `<img src="${avatar}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-top:1px;" onerror="this.style.display='none'">`
        : `<div style="width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">${name.charAt(0).toUpperCase()}</div>`;
      msgDiv.innerHTML = `${avatarHtml}<span style="overflow-wrap:break-word;word-break:break-word;">${badgeHtml}<span style="font-weight: 700; color: ${nameColor}; margin-right: 4px; vertical-align: middle;">${name}</span><span style="color: #e5e7eb; vertical-align: middle;">${message}</span></span>`;
    }

    liveChatMessages.appendChild(msgDiv);
    liveChatMessages.scrollTop = liveChatMessages.scrollHeight;
  });

  // Socket: Viewer joined notification
  socket.on('live:viewerJoined', ({ peerId, name, avatar }) => {
    if (!liveChatMessages) return;
    const joinDiv = document.createElement('div');
    joinDiv.style.background = 'rgba(59,130,246,0.15)';
    joinDiv.style.border = '1px solid rgba(59,130,246,0.25)';
    joinDiv.style.borderRadius = '12px';
    joinDiv.style.fontSize = '11px';
    joinDiv.style.display = 'flex';
    joinDiv.style.alignItems = 'center';
    joinDiv.style.gap = '6px';
    joinDiv.style.alignSelf = 'flex-start';
    joinDiv.style.padding = '4px 10px 4px 5px';
    joinDiv.style.marginBottom = '4px';
    const avatarHtml = avatar
      ? `<img src="${avatar}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid #3b82f6;" onerror="this.style.display='none'">`
      : '';
    joinDiv.innerHTML = `${avatarHtml}<span style="color:#93c5fd;"><strong style="color:#60a5fa;">${name || 'Quelqu\'un'}</strong> a rejoint le direct 👋</span>`;
    liveChatMessages.appendChild(joinDiv);
    liveChatMessages.scrollTop = liveChatMessages.scrollHeight;
  });

  // --- Follow Button Actions ---
  if (liveFollowBtn) {
    liveFollowBtn.addEventListener('click', () => {
      liveFollowBtn.textContent = 'Suivi';
      liveFollowBtn.style.background = 'rgba(255,255,255,0.2)';
      liveFollowBtn.disabled = true;

      // Broadcast system notice
      if (currentRoomId) {
        socket.emit('live:chatMessage', {
          roomId: currentRoomId,
          peerId: 'system-follow',
          name: window.currentUserDisplayName || window.currentUsername || 'Anonyme',
          avatar: '',
          message: "a commencé à suivre l'animateur ! 💖"
        });
      }
    });
  }

  // --- Gift Button / Custom Gift Click ---
  const showFloatingGiftAnimation = (emoji = '🌹', senderName = '', giftLabel = '') => {
    if (!liveOverlayViewer) return;

    // --- TikTok-style gift card overlay ---
    const card = document.createElement('div');
    card.style.cssText = `
      position: absolute;
      bottom: 130px;
      right: 16px;
      background: linear-gradient(135deg, rgba(15,15,30,0.92) 0%, rgba(30,20,60,0.92) 100%);
      border: 1.5px solid rgba(255,200,100,0.45);
      border-radius: 18px;
      padding: 12px 18px 12px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 200;
      pointer-events: none;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px rgba(255,180,50,0.18);
      transform: translateX(120px) scale(0.8);
      opacity: 0;
      transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease;
      min-width: 160px;
      max-width: 220px;
    `;

    const emojiWrap = document.createElement('div');
    emojiWrap.style.cssText = 'font-size:36px;line-height:1;flex-shrink:0;filter:drop-shadow(0 2px 8px rgba(255,200,50,0.5));';
    emojiWrap.textContent = emoji;

    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;overflow:hidden;';
    const senderEl = document.createElement('div');
    senderEl.style.cssText = 'font-size:11px;font-weight:700;color:#ffd166;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    senderEl.textContent = senderName || 'Cadeau';
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    labelEl.textContent = giftLabel ? giftLabel.split(' a envoyé')[1] || giftLabel : '';
    textWrap.appendChild(senderEl);
    textWrap.appendChild(labelEl);
    card.appendChild(emojiWrap);
    card.appendChild(textWrap);
    liveOverlayViewer.appendChild(card);

    // Slide in
    requestAnimationFrame(() => {
      card.style.transform = 'translateX(0) scale(1)';
      card.style.opacity = '1';
    });

    // Launch multiple floating emojis
    const count = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const item = document.createElement('div');
        item.textContent = emoji;
        item.style.cssText = `
          position: absolute;
          bottom: ${130 + Math.random() * 60}px;
          right: ${12 + Math.random() * 80}px;
          font-size: ${22 + Math.random() * 18}px;
          z-index: 190;
          pointer-events: none;
          opacity: 1;
          transition: transform 2s cubic-bezier(0.25, 1, 0.5, 1), opacity 2s ease-out;
          transform: translateY(0) scale(0.7) rotate(0deg);
        `;
        liveOverlayViewer.appendChild(item);
        requestAnimationFrame(() => {
          item.style.transform = `translateY(-${200 + Math.random() * 150}px) translateX(${(Math.random() - 0.5) * 100}px) scale(${1.2 + Math.random() * 0.8}) rotate(${(Math.random()-0.5)*40}deg)`;
          item.style.opacity = '0';
        });
        setTimeout(() => item.remove(), 2000);
      }, i * 120);
    }

    // Slide out the card after 3 seconds
    setTimeout(() => {
      card.style.transform = 'translateX(120px) scale(0.8)';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 450);
    }, 3000);
  };

  // Backward compat alias
  const showFloatingGiftEmoji = (emoji) => showFloatingGiftAnimation(emoji, '', '');

  if (liveGiftBtn) {
    liveGiftBtn.addEventListener('click', () => {
      if (currentRoomId && typeof window.openLiveGiftModal === 'function') {
        window.openLiveGiftModal(currentRoomId);
      }
    });
  }

  socket.on('live:ended', () => {
    cleanUpLive();
  });
})();
