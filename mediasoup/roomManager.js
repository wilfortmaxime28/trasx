const Room = require('./room');
const workerManager = require('./worker');

const rooms = new Map(); // roomId -> Room instance

/**
 * Crée ou retourne une salle existante
 */
async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) {
    return rooms.get(roomId);
  }
  
  const worker = workerManager.getNextWorker();
  const room = new Room(roomId);
  await room.init(worker);
  
  rooms.set(roomId, room);
  
  // Callback si la salle est fermée vide
  room.on('close', () => {
    rooms.delete(roomId);
    console.log(`[Mediasoup RoomManager] Salle nettoyée : ${roomId}`);
  });
  
  console.log(`[Mediasoup RoomManager] Nouvelle salle créée : ${roomId}`);
  return room;
}

/**
 * Récupère une salle par son ID
 */
function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * Ferme et supprime une salle
 */
function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.close();
    rooms.delete(roomId);
  }
}

module.exports = {
  getOrCreateRoom,
  getRoom,
  closeRoom,
  rooms
};
