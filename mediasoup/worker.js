const mediasoup = require('mediasoup');
const config = require('./config');

const workers = [];
let nextWorkerIdx = 0;

/**
 * Initialise les workers mediasoup basés sur le nombre de coeurs CPU
 */
async function initWorkers() {
  const cpuCount = require('os').cpus().length;
  console.log(`[Mediasoup] Initialisation de ${cpuCount} workers...`);
  
  for (let i = 0; i < cpuCount; i++) {
    const worker = await mediasoup.createWorker(config.workerSettings);
    
    worker.on('died', () => {
      console.error(`[Mediasoup] Le worker PID ${worker.pid} est mort. Arrêt du processus.`);
      process.exit(1);
    });
    
    workers.push(worker);
  }
}

/**
 * Retourne le prochain worker disponible (Load Balancing Round-Robin)
 */
function getNextWorker() {
  if (workers.length === 0) {
    throw new Error('[Mediasoup] Aucun worker disponible.');
  }
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

module.exports = {
  initWorkers,
  getNextWorker,
  workers
};
