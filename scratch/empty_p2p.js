const db = require('../config/db');

async function emptyP2P() {
  try {
    console.log('Désactivation des vérifications de clés étrangères...');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');

    console.log('Vidage de la table p2p_order_messages...');
    await db.query('TRUNCATE TABLE p2p_order_messages');

    console.log('Vidage de la table p2p_orders...');
    await db.query('TRUNCATE TABLE p2p_orders');

    console.log('Vidage de la table p2p_offers...');
    await db.query('TRUNCATE TABLE p2p_offers');

    console.log('Réactivation des vérifications de clés étrangères...');
    await db.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('Base P2P vidée avec succès !');
  } catch (error) {
    console.error('Erreur lors du vidage des tables P2P :', error);
  } finally {
    await db.end();
  }
}

emptyP2P();
