const db = require('../config/db');

let botsTablePromise = null;

async function ensureBotsTable() {
  if (!botsTablePromise) {
    botsTablePromise = (async () => {
      // Create table if not exists
      await db.query(`
        CREATE TABLE IF NOT EXISTS bots (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) NOT NULL UNIQUE,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          avatar VARCHAR(255) DEFAULT '/assets/avatar_placeholder.jpg',
          wins INT DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Safely add column if the table already exists
      try {
        await db.query('ALTER TABLE bots ADD COLUMN wins INT DEFAULT 0');
      } catch (err) {
        // Ignored if the column already exists
      }

      // Check if table is empty
      const [rows] = await db.query('SELECT COUNT(*) as count FROM bots');
      if (rows[0].count === 0) {
        // Seed some realistic bots
        const seedBots = [
          ['alex_gamer', 'Alexandre', 'Gamer', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80'],
          ['sophie_play', 'Sophie', 'Martin', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150&q=80'],
          ['lucas_master', 'Lucas', 'Dubois', 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&h=150&q=80'],
          ['emma_wins', 'Emma', 'Leroy', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&h=150&q=80'],
          ['pierre_pro', 'Pierre', 'Moreau', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&h=150&q=80'],
          ['julie_play', 'Julie', 'Petit', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&h=150&q=80'],
          ['max_games', 'Maxime', 'Guerin', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&h=150&q=80'],
          ['clara_win', 'Clara', 'Rousseau', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80']
        ];

        for (const bot of seedBots) {
          await db.query(
            'INSERT INTO bots (username, first_name, last_name, avatar) VALUES (?, ?, ?, ?)',
            bot
          );
        }
        console.log('Bots table seeded successfully!');
      }
    })().catch((error) => {
      botsTablePromise = null;
      console.error('Failed to create or seed bots table:', error);
      throw error;
    });
  }
  return botsTablePromise;
}

class Bot {
  static async getAll() {
    await ensureBotsTable();
    const [rows] = await db.query('SELECT *, CONCAT(first_name, \' \', last_name) AS name FROM bots');
    return rows;
  }

  static async getById(id) {
    await ensureBotsTable();
    const [rows] = await db.query('SELECT *, CONCAT(first_name, \' \', last_name) AS name FROM bots WHERE id = ?', [id]);
    return rows[0];
  }

  static async getRandomBot() {
    await ensureBotsTable();
    const bots = await this.getAll();
    if (bots.length === 0) return null;
    return bots[Math.floor(Math.random() * bots.length)];
  }
}

module.exports = Bot;
