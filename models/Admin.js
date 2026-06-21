const db = require('../config/db');

const ADMIN_PAGE_KEYS = [
  'overview',
  'users',
  'moderation',
  'revenue',
  'transactions',
  'balances',
  'backgrounds',
  'rules',
  'kyc',
  'receipts',
  'smtp',
  'admins',
  'disputes',
  'conversations',
  'comments'
];

const ADMIN_ACTION_KEYS = [
  'manage_users',
  'moderate_content',
  'manage_balances',
  'manage_backgrounds',
  'manage_kyc',
  'manage_settings',
  'manage_admins',
  'manage_disputes'
];

let adminSchemaPromise = null;
let adminSchemaPoolId = null;

async function ensureAdminSchema() {
  if (!adminSchemaPromise || adminSchemaPoolId !== db.poolId) {
    adminSchemaPoolId = db.poolId;
    adminSchemaPromise = (async () => {
      // 0. Ensure admins table exists
      await db.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(150) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 1. balance column
      const [rows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['balance']);
      if (!rows || rows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN balance DECIMAL(15,2) NOT NULL DEFAULT 0.00');
      }
      
      // 2. withdrawal_fees_balance column
      const [feeRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['withdrawal_fees_balance']);
      if (!feeRows || feeRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN withdrawal_fees_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00');
      }

      // 3. ads_fees_balance column
      const [adsFeeRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['ads_fees_balance']);
      if (!adsFeeRows || adsFeeRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN ads_fees_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00');
      }

      // 4. operations_balance column
      const [opsRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['operations_balance']);
      if (!opsRows || opsRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN operations_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00');
      }

      const [displayNameRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['display_name']);
      if (!displayNameRows || displayNameRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN display_name VARCHAR(120) NULL DEFAULT NULL AFTER email');
      }

      const [superAdminRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['is_super_admin']);
      if (!superAdminRows || superAdminRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN is_super_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
      }

      const [permissionsRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['permissions_json']);
      if (!permissionsRows || permissionsRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN permissions_json LONGTEXT NULL AFTER is_super_admin');
      }

      const [createdByRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['created_by_admin_id']);
      if (!createdByRows || createdByRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN created_by_admin_id INT NULL DEFAULT NULL AFTER permissions_json');
      }

      const [loginTokenRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['secret_login_token']);
      if (!loginTokenRows || loginTokenRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN secret_login_token VARCHAR(255) NULL AFTER created_by_admin_id');
      }

      const [loginCodeRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['secret_login_code']);
      if (!loginCodeRows || loginCodeRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN secret_login_code VARCHAR(10) NULL AFTER secret_login_token');
      }

      const [loginExpiresRows] = await db.query('SHOW COLUMNS FROM admins LIKE ?', ['secret_login_expires']);
      if (!loginExpiresRows || loginExpiresRows.length === 0) {
        await db.query('ALTER TABLE admins ADD COLUMN secret_login_expires TIMESTAMP NULL AFTER secret_login_code');
      }

      const [countRows] = await db.query('SELECT COUNT(*) AS total FROM admins WHERE COALESCE(is_super_admin, 0) = 1');
      const totalSuperAdmins = Number(countRows?.[0]?.total || 0);
      if (totalSuperAdmins === 0) {
        await db.query(
          `
            UPDATE admins
            SET is_super_admin = 1
            WHERE id = (
              SELECT id FROM (
                SELECT id
                FROM admins
                ORDER BY id ASC
                LIMIT 1
              ) AS first_admin
            )
          `
        );
      }
    })().catch((error) => {
      adminSchemaPromise = null;
      adminSchemaPoolId = null;
      throw error;
    });
  }

  return adminSchemaPromise;
}

class Admin {
  static getPageKeys() {
    return [...ADMIN_PAGE_KEYS];
  }

  static getActionKeys() {
    return [...ADMIN_ACTION_KEYS];
  }

  static getPermissionBlueprint() {
    return {
      pages: Object.fromEntries(ADMIN_PAGE_KEYS.map((key) => [key, false])),
      actions: Object.fromEntries(ADMIN_ACTION_KEYS.map((key) => [key, false]))
    };
  }

  static getDefaultPermissions() {
    const defaults = Admin.getPermissionBlueprint();
    defaults.pages.overview = true;
    return defaults;
  }

  static normalizePermissions(rawPermissions) {
    const defaults = Admin.getDefaultPermissions();
    let parsed = rawPermissions;

    if (typeof rawPermissions === 'string') {
      try {
        parsed = JSON.parse(rawPermissions);
      } catch (error) {
        parsed = null;
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return defaults;
    }

    for (const key of ADMIN_PAGE_KEYS) {
      defaults.pages[key] = Boolean(parsed?.pages?.[key]);
    }

    for (const key of ADMIN_ACTION_KEYS) {
      defaults.actions[key] = Boolean(parsed?.actions?.[key]);
    }

    if (!Object.values(defaults.pages).some(Boolean)) {
      defaults.pages.overview = true;
    }

    return defaults;
  }

  static serializePermissions(permissions) {
    return JSON.stringify(Admin.normalizePermissions(permissions));
  }

  static isSuperAdmin(admin) {
    return Number(admin?.is_super_admin || 0) === 1;
  }

  static getPermissions(admin) {
    if (Admin.isSuperAdmin(admin)) {
      return {
        pages: Object.fromEntries(ADMIN_PAGE_KEYS.map((key) => [key, true])),
        actions: Object.fromEntries(ADMIN_ACTION_KEYS.map((key) => [key, true]))
      };
    }
    return Admin.normalizePermissions(admin?.permissions_json || null);
  }

  static canAccessPage(admin, pageKey) {
    if (!ADMIN_PAGE_KEYS.includes(pageKey)) return false;
    return Boolean(Admin.getPermissions(admin)?.pages?.[pageKey]);
  }

  static canPerformAction(admin, actionKey) {
    if (!ADMIN_ACTION_KEYS.includes(actionKey)) return false;
    return Boolean(Admin.getPermissions(admin)?.actions?.[actionKey]);
  }

  static getAccessiblePageKeys(admin) {
    const permissions = Admin.getPermissions(admin);
    return ADMIN_PAGE_KEYS.filter((key) => Boolean(permissions?.pages?.[key]));
  }

  static getFirstAccessiblePageKey(admin) {
    const keys = Admin.getAccessiblePageKeys(admin);
    return keys[0] || 'overview';
  }

  static async ensureSchema() {
    await ensureAdminSchema();
  }

  static async getByEmail(email) {
    await ensureAdminSchema();
    const [rows] = await db.query('SELECT * FROM admins WHERE LOWER(email) = LOWER(?)', [email]);
    return rows[0];
  }

  static async getById(id) {
    await ensureAdminSchema();
    const [rows] = await db.query('SELECT * FROM admins WHERE id = ?', [id]);
    return rows[0];
  }

  static async getAll(connection = db) {
    await ensureAdminSchema();
    const [rows] = await connection.query('SELECT * FROM admins ORDER BY is_super_admin DESC, id ASC');
    return rows;
  }

  static async getPrimaryAdmin(connection = db, options = {}) {
    await ensureAdminSchema();
    const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await connection.query(`SELECT * FROM admins ORDER BY id ASC LIMIT 1${lockClause}`);
    return rows[0] || null;
  }

  static async createAdmin({ displayName = null, email, passwordHash, isSuperAdmin = false, permissions = null, createdByAdminId = null }, connection = db) {
    await ensureAdminSchema();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedDisplayName = String(displayName || '').trim() || null;
    const permissionsJson = Admin.isSuperAdmin({ is_super_admin: isSuperAdmin ? 1 : 0 })
      ? Admin.serializePermissions(Admin.getPermissionBlueprint())
      : Admin.serializePermissions(permissions);

    const [result] = await connection.query(
      `
        INSERT INTO admins (display_name, email, password_hash, is_super_admin, permissions_json, created_by_admin_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [normalizedDisplayName, normalizedEmail, passwordHash, isSuperAdmin ? 1 : 0, permissionsJson, createdByAdminId]
    );

    return result.insertId;
  }

  static async updateAdminProfile(adminId, { displayName = null, email, passwordHash = null, isSuperAdmin = null, permissions = null }, connection = db) {
    await ensureAdminSchema();
    const existingAdmin = await Admin.getById(adminId);
    if (!existingAdmin) {
      return false;
    }

    const normalizedDisplayName = String(displayName ?? existingAdmin.display_name ?? '').trim() || null;
    const normalizedEmail = String(email ?? existingAdmin.email ?? '').trim().toLowerCase();
    const nextSuperAdmin = isSuperAdmin === null ? Number(existingAdmin.is_super_admin || 0) === 1 : Boolean(isSuperAdmin);
    const nextPermissionsJson = nextSuperAdmin
      ? Admin.serializePermissions(Admin.getPermissionBlueprint())
      : Admin.serializePermissions(permissions ?? existingAdmin.permissions_json);

    if (passwordHash) {
      await connection.query(
        `
          UPDATE admins
          SET display_name = ?,
              email = ?,
              password_hash = ?,
              is_super_admin = ?,
              permissions_json = ?
          WHERE id = ?
        `,
        [normalizedDisplayName, normalizedEmail, passwordHash, nextSuperAdmin ? 1 : 0, nextPermissionsJson, adminId]
      );
    } else {
      await connection.query(
        `
          UPDATE admins
          SET display_name = ?,
              email = ?,
              is_super_admin = ?,
              permissions_json = ?
          WHERE id = ?
        `,
        [normalizedDisplayName, normalizedEmail, nextSuperAdmin ? 1 : 0, nextPermissionsJson, adminId]
      );
    }

    return true;
  }

  static async addBalance(adminId, amount, connection = db) {
    await ensureAdminSchema();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return false;
    }

    await connection.query(
      'UPDATE admins SET balance = COALESCE(balance, 0) + ? WHERE id = ?',
      [numericAmount, adminId]
    );
    return true;
  }

  static async addAdsFeesBalance(adminId, amount, connection = db) {
    await ensureAdminSchema();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return false;
    }

    await connection.query(
      'UPDATE admins SET ads_fees_balance = COALESCE(ads_fees_balance, 0) + ? WHERE id = ?',
      [numericAmount, adminId]
    );
    return true;
  }

  static async getBalanceTotals(connection = db) {
    await ensureAdminSchema();
    const [rows] = await connection.query(`
      SELECT
        COALESCE(SUM(balance), 0) AS total_balance,
        COALESCE(SUM(withdrawal_fees_balance), 0) AS total_withdrawal_fees_balance,
        COALESCE(SUM(ads_fees_balance), 0) AS total_ads_fees_balance,
        COALESCE(SUM(operations_balance), 0) AS total_operations_balance
      FROM admins
    `);

    return rows[0] || {
      total_balance: 0,
      total_withdrawal_fees_balance: 0,
      total_ads_fees_balance: 0,
      total_operations_balance: 0
    };
  }
}

module.exports = Admin;
