'use strict';

const { createClient } = require('redis');

const hasRedisConfig = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

let client = null;
let connectPromise = null;
let permanentlyDisabled = !hasRedisConfig;
let errorLogged = false;

function buildRedisClient() {
  if (process.env.REDIS_URL) {
    return createClient({ url: process.env.REDIS_URL });
  }

  return createClient({
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      reconnectStrategy: false
    },
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    database: Number(process.env.REDIS_DB || 0)
  });
}

async function getClient() {
  if (permanentlyDisabled) return null;
  if (client?.isOpen) return client;
  if (connectPromise) return connectPromise;

  if (!client) {
    client = buildRedisClient();
    client.on('error', (error) => {
      if (!errorLogged) {
        console.warn('[redis] connection error, falling back to in-memory cache:', error.message);
        errorLogged = true;
      }
    });
  }

  connectPromise = client.connect()
    .then(() => {
      errorLogged = false;
      return client;
    })
    .catch((error) => {
      permanentlyDisabled = true;
      if (!errorLogged) {
        console.warn('[redis] unavailable, falling back to in-memory cache:', error.message);
        errorLogged = true;
      }
      try {
        client?.disconnect?.();
      } catch (_) {}
      client = null;
      return null;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

async function run(operation, fallback = null) {
  const activeClient = await getClient();
  if (!activeClient) return fallback;
  try {
    return await operation(activeClient);
  } catch (error) {
    if (!errorLogged) {
      console.warn('[redis] runtime error, using fallback cache:', error.message);
      errorLogged = true;
    }
    return fallback;
  }
}

module.exports = {
  isConfigured() {
    return hasRedisConfig;
  },

  async get(key) {
    return run(async (activeClient) => activeClient.get(key), null);
  },

  async set(key, value, ttlSeconds = 60) {
    return run(async (activeClient) => {
      if (ttlSeconds > 0) {
        await activeClient.set(key, value, { EX: ttlSeconds });
      } else {
        await activeClient.set(key, value);
      }
      return true;
    }, false);
  },

  async del(key) {
    return run(async (activeClient) => activeClient.del(key), 0);
  },

  async keys(pattern) {
    return run(async (activeClient) => activeClient.keys(pattern), []);
  },

  async quit() {
    if (!client?.isOpen) return;
    await client.quit();
  }
};
