const db = require('../config/db');
const { getSupportedCurrencyOptions } = require('../utils/p2pCurrencies');

let marketSchemaPromise = null;

const COUNTRY_CODE_ALIASES = {
  haiti: 'HT',
  ayiti: 'HT',
  'united states': 'US',
  usa: 'US',
  canada: 'CA',
  france: 'FR',
  brazil: 'BR',
  brasil: 'BR',
  mexico: 'MX',
  spain: 'ES',
  italy: 'IT',
  germany: 'DE',
  belgium: 'BE',
  portugal: 'PT',
  argentina: 'AR',
  chile: 'CL',
  colombia: 'CO',
  'dominican republic': 'DO',
  jamaica: 'JM',
  cuba: 'CU'
};

function parseMoney(value) {
  if (typeof value === 'string') {
    return Number(value.replace(/,/g, '.'));
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(parseMoney(value) * 100) / 100;
}

function countryToFlagEmoji(country) {
  const raw = String(country || '').trim();
  if (!raw) return '🌍';

  let code = raw.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    code = COUNTRY_CODE_ALIASES[raw.toLowerCase()] || '';
  }
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';

  return String.fromCodePoint(...code.split('').map((char) => 127397 + char.charCodeAt(0)));
}

async function ensureMarketSchema() {
  if (!marketSchemaPromise) {
    marketSchemaPromise = (async () => {
      const [tableExists] = await db.query("SHOW TABLES LIKE 'users'");
      if (!tableExists || tableExists.length === 0) {
        console.log("[P2PMarket] users table does not exist yet. Skipping P2P schema creation for now.");
        marketSchemaPromise = null;
        return;
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS p2p_offers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          offer_type ENUM('buy', 'sell') NOT NULL,
          asset_code VARCHAR(12) NOT NULL DEFAULT 'USDT',
          currency_code VARCHAR(12) NOT NULL DEFAULT 'USD',
          price DECIMAL(12,2) NOT NULL DEFAULT 1.00,
          usd_rate DECIMAL(12,4) NULL DEFAULT NULL,
          min_amount DECIMAL(12,2) NOT NULL DEFAULT 10.00,
          max_amount DECIMAL(12,2) NOT NULL DEFAULT 100.00,
          total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
          available_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
          payment_methods TEXT NULL,
          terms TEXT NULL,
          status ENUM('active', 'filled', 'closed') NOT NULL DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_p2p_offers_user (user_id),
          INDEX idx_p2p_offers_type_status (offer_type, status),
          INDEX idx_p2p_offers_created_at (created_at)
        )
      `);

      try {
        await db.query(`
          ALTER TABLE p2p_offers
          ADD COLUMN IF NOT EXISTS usd_rate DECIMAL(12,4) NULL DEFAULT NULL
        `);
      } catch (err) {
        try {
          await db.query(`ALTER TABLE p2p_offers ADD COLUMN usd_rate DECIMAL(12,4) NULL DEFAULT NULL`);
        } catch (alterErr) {
          if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('already exists')) {
            console.error('Failed to alter p2p_offers table:', alterErr);
          }
        }
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS p2p_orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          offer_id INT NOT NULL,
          offer_owner_id INT NOT NULL,
          buyer_user_id INT NOT NULL,
          seller_user_id INT NOT NULL,
          taker_user_id INT NOT NULL,
          amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
          unit_price DECIMAL(12,2) NOT NULL DEFAULT 1.00,
          total_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
          escrow_user_id INT NOT NULL,
          escrow_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
          status ENUM('pending_payment', 'paid', 'released', 'cancelled', 'disputed') NOT NULL DEFAULT 'pending_payment',
          payment_note TEXT NULL,
          cancel_reason TEXT NULL,
          paid_at TIMESTAMP NULL DEFAULT NULL,
          released_at TIMESTAMP NULL DEFAULT NULL,
          cancelled_at TIMESTAMP NULL DEFAULT NULL,
          disputed_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_p2p_orders_offer (offer_id),
          INDEX idx_p2p_orders_buyer (buyer_user_id),
          INDEX idx_p2p_orders_seller (seller_user_id),
          INDEX idx_p2p_orders_status (status),
          INDEX idx_p2p_orders_created_at (created_at)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS p2p_order_messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          sender_user_id INT NOT NULL,
          content TEXT NULL,
          image_url VARCHAR(255) NULL,
          image_name VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_p2p_order_messages_order (order_id, created_at),
          INDEX idx_p2p_order_messages_sender (sender_user_id)
        )
      `);

      const ensureColumn = async (tableName, columnName, definition) => {
        const [rows] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
        if (!rows || rows.length === 0) {
          await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
        }
      };

      await ensureColumn('p2p_offers', 'payment_account_name', 'payment_account_name VARCHAR(160) NULL AFTER payment_methods');
      await ensureColumn('p2p_offers', 'payment_account_number', 'payment_account_number VARCHAR(120) NULL AFTER payment_account_name');
    })().catch((error) => {
      marketSchemaPromise = null;
      throw error;
    });
  }

  return marketSchemaPromise;
}

function normalizePaymentMethods(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function parseAmount(value, assetCode = 'USDT') {
  const parsed = parseMoney(value);
  if (assetCode === 'TOKEN') {
    return Math.round(parsed * 10000) / 10000;
  }
  return Math.round(parsed * 100) / 100;
}

function normalizeOfferRow(row, currentUserId = null) {
  if (!row) return null;
  const asset = row.asset_code || 'USDT';
  return {
    ...row,
    price: parseAmount(row.price, 'USDT'),
    min_amount: parseAmount(row.min_amount, asset),
    max_amount: parseAmount(row.max_amount, asset),
    total_amount: parseAmount(row.total_amount, asset),
    available_amount: parseAmount(row.available_amount, asset),
    payment_methods_list: normalizePaymentMethods(row.payment_methods),
    country_flag: countryToFlagEmoji(row.country),
    is_mine: currentUserId ? Number(row.user_id) === Number(currentUserId) : false
  };
}

function normalizeOrderRow(row, currentUserId = null) {
  if (!row) return null;
  const asset = row.asset_code || 'USDT';
  const isBuyer = currentUserId ? Number(row.buyer_user_id) === Number(currentUserId) : false;
  const isSeller = currentUserId ? Number(row.seller_user_id) === Number(currentUserId) : false;
  return {
    ...row,
    amount: parseAmount(row.amount, asset),
    unit_price: parseAmount(row.unit_price, 'USDT'),
    total_price: parseAmount(row.total_price, 'USDT'),
    escrow_amount: parseAmount(row.escrow_amount, asset),
    payment_methods_list: normalizePaymentMethods(row.payment_methods),
    country_flag: countryToFlagEmoji(row.counterparty_country),
    is_buyer: isBuyer,
    is_seller: isSeller
  };
}

function normalizeOrderMessageRow(row, currentUserId = null) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    order_id: Number(row.order_id),
    sender_user_id: Number(row.sender_user_id),
    sender_name: row.sender_name || row.sender_username || 'Utilisateur',
    sender_avatar: row.sender_avatar || '/assets/avatar_placeholder.jpg',
    image_url: row.image_url || null,
    image_name: row.image_name || null,
    content: row.content || '',
    is_mine: currentUserId ? Number(row.sender_user_id) === Number(currentUserId) : false,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

class P2PMarket {
  static async ensureSchema() {
    await ensureMarketSchema();
  }

  static async getSnapshot(currentUserId) {
    await ensureMarketSchema();

    const [publicOfferRows, myOfferRows, myOrderRows] = await Promise.all([
      db.query(
        `
          SELECT
            o.*,
            u.username,
            CONCAT(u.first_name, ' ', u.last_name) AS user_name,
            u.avatar,
            u.country
          FROM p2p_offers o
          JOIN users u ON u.id = o.user_id
          WHERE o.status = 'active' AND o.available_amount > 0 AND o.user_id <> ?
          ORDER BY
            CASE WHEN o.offer_type = 'sell' THEN 0 ELSE 1 END ASC,
            CASE WHEN o.offer_type = 'sell' THEN o.price END ASC,
            CASE WHEN o.offer_type = 'buy' THEN o.price END DESC,
            o.created_at DESC
          LIMIT 48
        `,
        [currentUserId]
      ),
      db.query(
        `
          SELECT
            o.*,
            u.username,
            CONCAT(u.first_name, ' ', u.last_name) AS user_name,
            u.avatar,
            u.country
          FROM p2p_offers o
          JOIN users u ON u.id = o.user_id
          WHERE o.user_id = ?
          ORDER BY o.created_at DESC
          LIMIT 24
        `,
        [currentUserId]
      ),
      db.query(
        `
          SELECT
            po.*,
            o.offer_type,
            o.asset_code,
            o.currency_code,
            o.payment_methods,
            o.payment_account_name,
            o.payment_account_number,
            cp.country AS counterparty_country,
            cp.avatar AS counterparty_avatar,
            cp.username AS counterparty_username,
            CONCAT(cp.first_name, ' ', cp.last_name) AS counterparty_name
          FROM p2p_orders po
          JOIN p2p_offers o ON o.id = po.offer_id
          JOIN users cp ON cp.id = CASE
            WHEN po.buyer_user_id = ? THEN po.seller_user_id
            ELSE po.buyer_user_id
          END
          WHERE po.buyer_user_id = ? OR po.seller_user_id = ?
          ORDER BY
            CASE
              WHEN po.status = 'pending_payment' THEN 0
              WHEN po.status = 'paid' THEN 1
              WHEN po.status = 'disputed' THEN 2
              WHEN po.status = 'cancelled' THEN 3
              ELSE 4
            END ASC,
            po.created_at DESC
          LIMIT 30
        `,
        [currentUserId, currentUserId, currentUserId]
      )
    ]);

    const publicOffers = (publicOfferRows[0] || []).map((row) => normalizeOfferRow(row, currentUserId));
    const myOffers = (myOfferRows[0] || []).map((row) => normalizeOfferRow(row, currentUserId));
    const myOrders = (myOrderRows[0] || []).map((row) => normalizeOrderRow(row, currentUserId));

    const activeSellOffers = myOffers.filter(o => o.offer_type === 'sell' && ['active', 'filled'].includes(o.status));
    const openSellOrders = myOrders.filter(o => ['pending_payment', 'paid', 'disputed'].includes(o.status) && Number(o.seller_user_id) === Number(currentUserId));

    const frozenUsdt = roundMoney(
      activeSellOffers.filter(o => o.asset_code === 'USDT').reduce((sum, o) => sum + Number(o.available_amount || 0), 0) +
      openSellOrders.filter(o => o.asset_code === 'USDT').reduce((sum, o) => sum + Number(o.escrow_amount || 0), 0)
    );

    const frozenToken = parseAmount(
      activeSellOffers.filter(o => o.asset_code === 'TOKEN').reduce((sum, o) => sum + Number(o.available_amount || 0), 0) +
      openSellOrders.filter(o => o.asset_code === 'TOKEN').reduce((sum, o) => sum + Number(o.escrow_amount || 0), 0),
      'TOKEN'
    );

    const stats = {
      activeSellOffers: publicOffers.filter((offer) => offer.offer_type === 'sell').length,
      activeBuyOffers: publicOffers.filter((offer) => offer.offer_type === 'buy').length,
      myOpenOrders: myOrders.filter((order) => ['pending_payment', 'paid', 'disputed'].includes(order.status)).length,
      myEscrowAmount: roundMoney(myOffers
        .filter((offer) => offer.offer_type === 'sell' && ['active', 'filled'].includes(offer.status))
        .reduce((sum, offer) => sum + Number(offer.available_amount || 0), 0)),
      frozenUsdt,
      frozenToken
    };

    return { publicOffers, myOffers, myOrders, stats };
  }

  static async getFrozenBalances(userId, connection = db) {
    await ensureMarketSchema();

    const [offersSumRows] = await connection.query(
      `
        SELECT asset_code, SUM(available_amount) AS sum_available
        FROM p2p_offers
        WHERE user_id = ? AND offer_type = 'sell' AND status IN ('active', 'filled')
        GROUP BY asset_code
      `,
      [userId]
    );

    const [ordersSumRows] = await connection.query(
      `
        SELECT o.asset_code, SUM(po.escrow_amount) AS sum_escrow
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.seller_user_id = ? AND po.status IN ('pending_payment', 'paid', 'disputed')
        GROUP BY o.asset_code
      `,
      [userId]
    );

    let frozenUsdt = 0;
    let frozenToken = 0;

    if (offersSumRows && offersSumRows.length > 0) {
      for (const row of offersSumRows) {
        if (row.asset_code === 'USDT') frozenUsdt += Number(row.sum_available || 0);
        if (row.asset_code === 'TOKEN') frozenToken += Number(row.sum_available || 0);
      }
    }

    if (ordersSumRows && ordersSumRows.length > 0) {
      for (const row of ordersSumRows) {
        if (row.asset_code === 'USDT') frozenUsdt += Number(row.sum_escrow || 0);
        if (row.asset_code === 'TOKEN') frozenToken += Number(row.sum_escrow || 0);
      }
    }

    return {
      frozenUsdt: Math.round(frozenUsdt * 100) / 100,
      frozenToken: Math.round(frozenToken * 10000) / 10000
    };
  }

  static async createOffer(userId, data = {}, connection = db) {
    await ensureMarketSchema();

    const offerType = String(data.offerType || '').trim().toLowerCase();
    const assetCode = String(data.assetCode || 'USDT').trim().toUpperCase() || 'USDT';
    const currencyCode = String(data.currencyCode || 'USD').trim().toUpperCase() || 'USD';
    const supportedCurrencyCodes = new Set(getSupportedCurrencyOptions().map((entry) => entry.code));
    const price = roundMoney(data.price);
    const usdRate = data.usdRate ? parseMoney(data.usdRate) : null;
    const totalAmount = parseAmount(data.totalAmount, assetCode);
    const minAmount = parseAmount(data.minAmount, assetCode);
    const requestedMaxAmount = parseAmount(data.maxAmount, assetCode);
    const paymentMethods = normalizePaymentMethods(data.paymentMethods).join(', ');
    const paymentAccountName = String(data.paymentAccountName || '').trim().slice(0, 160);
    const paymentAccountNumber = String(data.paymentAccountNumber || '').trim().slice(0, 120);
    const terms = String(data.terms || '').trim().slice(0, 500);

    if (assetCode === 'TOKEN' && (!usdRate || usdRate <= 0)) {
      throw new Error("Le taux de change en USD est requis et doit être supérieur à 0 pour une annonce de Token.");
    }

    if (!['buy', 'sell'].includes(offerType)) {
      throw new Error('Type d annonce P2P invalide.');
    }
    if (!['USDT', 'TOKEN'].includes(assetCode)) {
      throw new Error('Seuls USDT et Token sont disponibles.');
    }
    if (!supportedCurrencyCodes.has(currencyCode)) {
      throw new Error('Devise P2P invalide.');
    }
    if (price <= 0 || totalAmount <= 0) {
      throw new Error('Le prix et le montant doivent etre superieurs a 0.');
    }
    if (minAmount <= 0) {
      throw new Error('Le montant minimum doit etre superieur a 0.');
    }
    if (!paymentMethods) {
      throw new Error('Ajoutez au moins un moyen de paiement.');
    }
    if (!paymentAccountName) {
      throw new Error('Ajoutez le nom du titulaire du compte de reception.');
    }
    if (!paymentAccountNumber) {
      throw new Error('Ajoutez le numero du compte de reception.');
    }

    const maxAmount = requestedMaxAmount > 0 ? Math.min(totalAmount, requestedMaxAmount) : totalAmount;
    if (minAmount > maxAmount) {
      throw new Error('Le montant minimum ne peut pas etre superieur au montant maximum.');
    }

    if (offerType === 'sell') {
      if (assetCode === 'TOKEN') {
        const [userRows] = await connection.query(
          'SELECT id, token_balance FROM users WHERE id = ? FOR UPDATE',
          [userId]
        );
        if (!userRows || userRows.length === 0) {
          throw new Error('Utilisateur introuvable.');
        }
        const availableBalance = Number(userRows[0].token_balance || 0);
        if (availableBalance < totalAmount) {
          throw new Error('Solde de Token insuffisant pour placer cette annonce de vente.');
        }

        await connection.query(
          'UPDATE users SET token_balance = token_balance - ? WHERE id = ?',
          [totalAmount, userId]
        );
      } else {
        const [userRows] = await connection.query(
          'SELECT id, withdrawal_account_balance FROM users WHERE id = ? FOR UPDATE',
          [userId]
        );
        if (!userRows || userRows.length === 0) {
          throw new Error('Utilisateur introuvable.');
        }
        const availableBalance = roundMoney(userRows[0].withdrawal_account_balance);
        if (availableBalance < totalAmount) {
          throw new Error('Solde de retrait insuffisant pour placer cette annonce de vente.');
        }

        await connection.query(
          'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance - ? WHERE id = ?',
          [totalAmount, userId]
        );
      }
    }

    const [result] = await connection.query(
      `
        INSERT INTO p2p_offers (
          user_id,
          offer_type,
          asset_code,
          currency_code,
          price,
          usd_rate,
          min_amount,
          max_amount,
          total_amount,
          available_amount,
          payment_methods,
          payment_account_name,
          payment_account_number,
          terms,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `,
      [
        userId,
        offerType,
        assetCode,
        currencyCode,
        price,
        usdRate,
        minAmount,
        maxAmount,
        totalAmount,
        totalAmount,
        paymentMethods || null,
        paymentAccountName || null,
        paymentAccountNumber || null,
        terms || null
      ]
    );

    return result.insertId;
  }

  static async createOrder(takerUserId, data = {}, connection = db) {
    await ensureMarketSchema();

    const offerId = Number(data.offerId || 0);
    if (!offerId) {
      throw new Error('Commande P2P invalide.');
    }

    const [offerRows] = await connection.query(
      `
        SELECT *
        FROM p2p_offers
        WHERE id = ?
        FOR UPDATE
      `,
      [offerId]
    );
    if (!offerRows || offerRows.length === 0) {
      throw new Error('Annonce P2P introuvable.');
    }

    const offer = offerRows[0];
    const amount = parseAmount(data.amount, offer.asset_code);
    if (amount <= 0) {
      throw new Error('Montant de commande invalide.');
    }

    if (Number(offer.user_id) === Number(takerUserId)) {
      throw new Error('Vous ne pouvez pas prendre votre propre annonce.');
    }

    const availableAmount = parseAmount(offer.available_amount, offer.asset_code);
    const minLimit = parseAmount(offer.min_amount, offer.asset_code);
    const maxLimit = parseAmount(offer.max_amount, offer.asset_code);

    if (offer.status !== 'active' || availableAmount <= 0) {
      throw new Error('Cette annonce n est plus disponible.');
    }
    if (amount < minLimit || amount > maxLimit) {
      throw new Error('Le montant choisi est hors des limites de cette annonce.');
    }
    if (amount > availableAmount) {
      throw new Error('Le montant choisi depasse la quantite encore disponible.');
    }

    let buyerUserId = null;
    let sellerUserId = null;
    let escrowUserId = null;

    if (offer.offer_type === 'sell') {
      buyerUserId = takerUserId;
      sellerUserId = Number(offer.user_id);
      escrowUserId = Number(offer.user_id);
    } else {
      buyerUserId = Number(offer.user_id);
      sellerUserId = takerUserId;
      escrowUserId = takerUserId;

      if (offer.asset_code === 'TOKEN') {
        const [sellerRows] = await connection.query(
          'SELECT id, token_balance FROM users WHERE id = ? FOR UPDATE',
          [sellerUserId]
        );
        if (!sellerRows || sellerRows.length === 0) {
          throw new Error('Vendeur introuvable.');
        }
        const sellerBalance = parseAmount(sellerRows[0].token_balance, 'TOKEN');
        if (sellerBalance < amount) {
          throw new Error('Le vendeur n a pas assez de Tokens pour fournir ce montant.');
        }

        await connection.query(
          'UPDATE users SET token_balance = token_balance - ? WHERE id = ?',
          [amount, sellerUserId]
        );
      } else {
        const [sellerRows] = await connection.query(
          'SELECT id, withdrawal_account_balance FROM users WHERE id = ? FOR UPDATE',
          [sellerUserId]
        );
        if (!sellerRows || sellerRows.length === 0) {
          throw new Error('Vendeur introuvable.');
        }
        const sellerBalance = roundMoney(sellerRows[0].withdrawal_account_balance);
        if (sellerBalance < amount) {
          throw new Error('Le vendeur n a pas assez de solde de retrait pour fournir ce montant.');
        }

        await connection.query(
          'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance - ? WHERE id = ?',
          [amount, sellerUserId]
        );
      }
    }

    const nextAvailableAmount = parseAmount(availableAmount - amount, offer.asset_code);
    await connection.query(
      `
        UPDATE p2p_offers
        SET available_amount = ?,
            status = ?
        WHERE id = ?
      `,
      [nextAvailableAmount, nextAvailableAmount > 0.0001 ? 'active' : 'filled', offerId]
    );

    const totalPrice = roundMoney(amount * parseAmount(offer.price, 'USDT'));
    const [result] = await connection.query(
      `
        INSERT INTO p2p_orders (
          offer_id,
          offer_owner_id,
          buyer_user_id,
          seller_user_id,
          taker_user_id,
          amount,
          unit_price,
          total_price,
          escrow_user_id,
          escrow_amount,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')
      `,
      [offerId, offer.user_id, buyerUserId, sellerUserId, takerUserId, amount, roundMoney(offer.price), totalPrice, escrowUserId, amount]
    );

    return {
      orderId: result.insertId,
      offerOwnerId: Number(offer.user_id),
      buyerUserId: Number(buyerUserId),
      sellerUserId: Number(sellerUserId),
      offerType: offer.offer_type,
      amount,
      totalPrice,
      assetCode: offer.asset_code
    };
  }

  static async markOrderPaid(orderId, actorUserId, paymentNote = '', connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT po.*, o.offer_type, o.asset_code
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.id = ?
        FOR UPDATE
      `,
      [orderId]
    );
    if (!rows || rows.length === 0) {
      throw new Error('Ordre P2P introuvable.');
    }

    const order = rows[0];
    if (Number(order.buyer_user_id) !== Number(actorUserId)) {
      throw new Error('Seul l acheteur peut confirmer le paiement.');
    }
    if (order.status !== 'pending_payment') {
      throw new Error('Cet ordre ne peut plus etre marque comme paye.');
    }

    await connection.query(
      `
        UPDATE p2p_orders
        SET status = 'paid',
            payment_note = ?,
            paid_at = NOW()
        WHERE id = ?
      `,
      [String(paymentNote || '').trim().slice(0, 500) || null, orderId]
    );

    return {
      buyerUserId: Number(order.buyer_user_id),
      sellerUserId: Number(order.seller_user_id),
      amount: parseAmount(order.amount, order.asset_code),
      assetCode: order.asset_code
    };
  }

  static async releaseOrder(orderId, actorUserId, connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT po.*, o.offer_type, o.asset_code
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.id = ?
        FOR UPDATE
      `,
      [orderId]
    );
    if (!rows || rows.length === 0) {
      throw new Error('Ordre P2P introuvable.');
    }

    const order = rows[0];
    if (Number(order.seller_user_id) !== Number(actorUserId)) {
      throw new Error('Seul le vendeur peut liberer les fonds.');
    }
    if (order.status !== 'paid') {
      throw new Error('Les fonds ne peuvent etre liberes que pour un ordre marque comme paye.');
    }

    if (order.asset_code === 'TOKEN') {
      await connection.query(
        'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
        [parseAmount(order.escrow_amount, 'TOKEN'), Number(order.buyer_user_id)]
      );
    } else {
      await connection.query(
        'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
        [parseAmount(order.escrow_amount, 'USDT'), Number(order.buyer_user_id)]
      );
    }

    await connection.query(
      `
        UPDATE p2p_orders
        SET status = 'released',
            released_at = NOW()
        WHERE id = ?
      `,
      [orderId]
    );

    return {
      buyerUserId: Number(order.buyer_user_id),
      sellerUserId: Number(order.seller_user_id),
      amount: parseAmount(order.escrow_amount, order.asset_code),
      assetCode: order.asset_code
    };
  }

  static async cancelOrder(orderId, actorUserId, cancelReason = '', connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT po.*, o.offer_type, o.asset_code, o.status AS offer_status
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.id = ?
        FOR UPDATE
      `,
      [orderId]
    );
    if (!rows || rows.length === 0) {
      throw new Error('Ordre P2P introuvable.');
    }

    const order = rows[0];
    const actorAllowed = [
      Number(order.buyer_user_id),
      Number(order.seller_user_id),
      Number(order.offer_owner_id)
    ].includes(Number(actorUserId));

    if (!actorAllowed) {
      throw new Error('Vous ne pouvez pas annuler cet ordre.');
    }
    if (order.status !== 'pending_payment') {
      throw new Error('Seuls les ordres en attente de paiement peuvent etre annules.');
    }

    if (order.offer_type === 'buy') {
      if (order.asset_code === 'TOKEN') {
        await connection.query(
          'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
          [parseAmount(order.escrow_amount, 'TOKEN'), Number(order.seller_user_id)]
        );
      } else {
        await connection.query(
          'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
          [parseAmount(order.escrow_amount, 'USDT'), Number(order.seller_user_id)]
        );
      }
    }

    await connection.query(
      `
        UPDATE p2p_offers
        SET available_amount = available_amount + ?,
            status = 'active'
        WHERE id = ?
      `,
      [parseAmount(order.amount, order.asset_code), Number(order.offer_id)]
    );

    await connection.query(
      `
        UPDATE p2p_orders
        SET status = 'cancelled',
            cancel_reason = ?,
            cancelled_at = NOW()
        WHERE id = ?
      `,
      [String(cancelReason || '').trim().slice(0, 500) || null, orderId]
    );

    return {
      buyerUserId: Number(order.buyer_user_id),
      sellerUserId: Number(order.seller_user_id),
      amount: parseAmount(order.amount, order.asset_code),
      offerType: order.offer_type,
      assetCode: order.asset_code
    };
  }

  static async disputeOrder(orderId, actorUserId, paymentNote = '', connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT po.*, o.asset_code
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.id = ?
        FOR UPDATE
      `,
      [orderId]
    );
    if (!rows || rows.length === 0) {
      throw new Error('Ordre P2P introuvable.');
    }

    const order = rows[0];
    if (![Number(order.buyer_user_id), Number(order.seller_user_id)].includes(Number(actorUserId))) {
      throw new Error('Vous ne pouvez pas ouvrir un litige sur cet ordre.');
    }
    if (!['pending_payment', 'paid'].includes(order.status)) {
      throw new Error('Cet ordre ne peut plus etre passe en litige.');
    }

    await connection.query(
      `
        UPDATE p2p_orders
        SET status = 'disputed',
            payment_note = ?,
            disputed_at = NOW()
        WHERE id = ?
      `,
      [String(paymentNote || '').trim().slice(0, 500) || null, orderId]
    );

    return {
      buyerUserId: Number(order.buyer_user_id),
      sellerUserId: Number(order.seller_user_id),
      amount: parseAmount(order.amount, order.asset_code),
      assetCode: order.asset_code
    };
  }

  static async closeOffer(offerId, actorUserId, connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT *
        FROM p2p_offers
        WHERE id = ?
        FOR UPDATE
      `,
      [offerId]
    );
    if (!rows || rows.length === 0) {
      throw new Error('Annonce P2P introuvable.');
    }

    const offer = rows[0];
    if (Number(offer.user_id) !== Number(actorUserId)) {
      throw new Error('Vous ne pouvez pas fermer cette annonce.');
    }
    if (offer.status === 'closed') {
      return {
        refundedAmount: 0,
        userId: Number(actorUserId),
        assetCode: offer.asset_code
      };
    }

    const [openOrderRows] = await connection.query(
      `
        SELECT COUNT(*) AS count
        FROM p2p_orders
        WHERE offer_id = ?
          AND status IN ('pending_payment', 'paid', 'disputed')
      `,
      [offerId]
    );
    if (Number(openOrderRows[0]?.count || 0) > 0) {
      throw new Error('Fermez ou resolvez d abord les ordres encore ouverts pour cette annonce.');
    }

    const refundableAmount = offer.offer_type === 'sell' ? parseAmount(offer.available_amount, offer.asset_code) : 0;
    if (refundableAmount > 0) {
      if (offer.asset_code === 'TOKEN') {
        await connection.query(
          'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
          [refundableAmount, actorUserId]
        );
      } else {
        await connection.query(
          'UPDATE users SET withdrawal_account_balance = withdrawal_account_balance + ? WHERE id = ?',
          [refundableAmount, actorUserId]
        );
      }
    }

    await connection.query(
      `
        UPDATE p2p_offers
        SET available_amount = 0,
            status = 'closed'
        WHERE id = ?
      `,
      [offerId]
    );

    return {
      refundedAmount: refundableAmount,
      userId: Number(actorUserId),
      assetCode: offer.asset_code
    };
  }

  static async getOrderContext(orderId, actorUserId, connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT
          po.*,
          o.offer_type,
          o.asset_code,
          o.currency_code
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.id = ?
        LIMIT 1
      `,
      [orderId]
    );

    if (!rows || rows.length === 0) {
      throw new Error('Ordre P2P introuvable.');
    }

    const order = rows[0];
    if (![Number(order.buyer_user_id), Number(order.seller_user_id)].includes(Number(actorUserId))) {
      throw new Error('Vous ne pouvez pas acceder a cette conversation P2P.');
    }

    return order;
  }

  static async getOrderMessages(orderId, actorUserId, connection = db) {
    await this.getOrderContext(orderId, actorUserId, connection);

    const [rows] = await connection.query(
      `
        SELECT
          pom.*,
          u.username AS sender_username,
          CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
          u.avatar AS sender_avatar
        FROM p2p_order_messages pom
        JOIN users u ON u.id = pom.sender_user_id
        WHERE pom.order_id = ?
        ORDER BY pom.created_at ASC, pom.id ASC
        LIMIT 250
      `,
      [orderId]
    );

    return (rows || []).map((row) => normalizeOrderMessageRow(row, actorUserId));
  }

  static async createOrderMessage(orderId, senderUserId, data = {}, connection = db) {
    const order = await this.getOrderContext(orderId, senderUserId, connection);

    const content = String(data.content || '').trim().slice(0, 1500);
    const imageUrl = String(data.imageUrl || '').trim().slice(0, 255) || null;
    const imageName = String(data.imageName || '').trim().slice(0, 255) || null;

    if (!content && !imageUrl) {
      throw new Error('Le message P2P est vide.');
    }

    const [result] = await connection.query(
      `
        INSERT INTO p2p_order_messages (
          order_id,
          sender_user_id,
          content,
          image_url,
          image_name
        ) VALUES (?, ?, ?, ?, ?)
      `,
      [orderId, senderUserId, content || null, imageUrl, imageName]
    );

    const [rows] = await connection.query(
      `
        SELECT
          pom.*,
          u.username AS sender_username,
          CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
          u.avatar AS sender_avatar
        FROM p2p_order_messages pom
        JOIN users u ON u.id = pom.sender_user_id
        WHERE pom.id = ?
        LIMIT 1
      `,
      [result.insertId]
    );

    return {
      order,
      message: normalizeOrderMessageRow(rows[0], senderUserId)
    };
  }

  static async resolveDisputeRelease(orderId, connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT po.*, o.asset_code
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.id = ?
        FOR UPDATE
      `,
      [orderId]
    );
    if (!rows || rows.length === 0) {
      throw new Error('Ordre P2P introuvable.');
    }

    const order = rows[0];
    if (order.status !== 'disputed') {
      throw new Error('Cet ordre n\'est pas en litige.');
    }

    if (order.asset_code === 'TOKEN') {
      await connection.query(
        'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
        [parseAmount(order.escrow_amount, 'TOKEN'), Number(order.buyer_user_id)]
      );
    } else {
      await connection.query(
        'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
        [parseAmount(order.escrow_amount, 'USDT'), Number(order.buyer_user_id)]
      );
    }

    await connection.query(
      `
        UPDATE p2p_orders
        SET status = 'released',
            released_at = NOW()
        WHERE id = ?
      `,
      [orderId]
    );

    return {
      buyerUserId: Number(order.buyer_user_id),
      sellerUserId: Number(order.seller_user_id),
      amount: parseAmount(order.escrow_amount, order.asset_code),
      assetCode: order.asset_code
    };
  }

  static async resolveDisputeRefund(orderId, connection = db) {
    await ensureMarketSchema();

    const [rows] = await connection.query(
      `
        SELECT po.*, o.asset_code, o.offer_type, o.id AS offer_id, o.status AS offer_status
        FROM p2p_orders po
        JOIN p2p_offers o ON o.id = po.offer_id
        WHERE po.id = ?
        FOR UPDATE
      `,
      [orderId]
    );
    if (!rows || rows.length === 0) {
      throw new Error('Ordre P2P introuvable.');
    }

    const order = rows[0];
    if (order.status !== 'disputed') {
      throw new Error('Cet ordre n\'est pas en litige.');
    }

    // Refund coins back to the seller
    if (order.asset_code === 'TOKEN') {
      await connection.query(
        'UPDATE users SET token_balance = token_balance + ? WHERE id = ?',
        [parseAmount(order.escrow_amount, 'TOKEN'), Number(order.seller_user_id)]
      );
    } else {
      await connection.query(
        'UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?',
        [parseAmount(order.escrow_amount, 'USDT'), Number(order.seller_user_id)]
      );
    }

    // Update order status
    await connection.query(
      `
        UPDATE p2p_orders
        SET status = 'cancelled',
            cancel_reason = ?,
            cancelled_at = NOW()
        WHERE id = ?
      `,
      ['Résolu par l\'admin (Remboursé au vendeur)', orderId]
    );

    return {
      buyerUserId: Number(order.buyer_user_id),
      sellerUserId: Number(order.seller_user_id),
      amount: parseAmount(order.escrow_amount, order.asset_code),
      offerType: order.offer_type,
      assetCode: order.asset_code
    };
  }
}

module.exports = P2PMarket;
