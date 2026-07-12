const EventEmitter = require('events');
const config = require('./config');
const Peer = require('./peer');

class Room extends EventEmitter {
  constructor(roomId) {
    super();
    this.id = roomId;
    this.router = null;
    this.peers = new Map(); // peerId -> Peer instance
  }

  async init(worker) {
    this.router = await worker.createRouter(config.routerSettings);
  }

  addPeer(peerId, socketId) {
    const peer = new Peer(peerId, socketId);
    this.peers.set(peerId, peer);
    return peer;
  }

  getPeer(peerId) {
    return this.peers.get(peerId);
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
    }
    
    // Si la salle est vide, on la ferme automatiquement
    if (this.peers.size === 0) {
      this.close();
    }
  }

  close() {
    this.peers.forEach(peer => peer.close());
    this.peers.clear();
    
    if (this.router) {
      this.router.close();
    }
    
    this.emit('close');
  }
}

module.exports = Room;
