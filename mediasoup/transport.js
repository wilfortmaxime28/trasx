const config = require('./config');

/**
 * Crée un WebRtcTransport mediasoup pour un producteur ou consommateur
 */
async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport(config.webRtcTransportSettings);
  
  // Gestionnaires DTLS optionnels
  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'failed' || dtlsState === 'closed') {
      console.warn(`[Mediasoup Transport] Échec de l'état DTLS : ${dtlsState}`);
    }
  });

  return transport;
}

module.exports = {
  createWebRtcTransport
};
