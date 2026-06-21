CREATE DATABASE IF NOT EXISTS trasx DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE trasx;

-- Désactiver temporairement les contraintes de clés étrangères
SET FOREIGN_KEY_CHECKS = 0;

-- Nettoyer les tables existantes pour repartir sur une base propre
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS bookmarks;
DROP TABLE IF EXISTS reels;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS event_attendees;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS post_shares;
DROP TABLE IF EXISTS reel_comments;
DROP TABLE IF EXISTS statuses;
DROP TABLE IF EXISTS event_tickets;
DROP TABLE IF EXISTS hashtags;
DROP TABLE IF EXISTS follows;

-- Table pour les paramètres globaux (SMTP, etc.)
CREATE TABLE app_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value VARCHAR(255) NOT NULL,
  description TEXT
);

-- Insertion des paramètres SMTP par défaut (à configurer par l'admin)
INSERT INTO app_settings (setting_key, setting_value, description) VALUES
('smtp_host', 'smtp.example.com', 'Hôte SMTP'),
('smtp_port', '587', 'Port SMTP'),
('smtp_user', 'user@example.com', 'Utilisateur SMTP'),
('smtp_pass', 'password', 'Mot de passe SMTP'),
('smtp_secure', 'false', 'Utiliser SSL/TLS (true/false)'),
('token_price_usd', '0.1', 'Prix des tokens en USDT/USD');

-- 1. Table Utilisateurs
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  dob DATE DEFAULT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  country VARCHAR(100) DEFAULT NULL,
  bio TEXT DEFAULT NULL,
  avatar VARCHAR(255) DEFAULT 'assets/avatar_placeholder.jpg',
  banner_color VARCHAR(255) DEFAULT 'linear-gradient(135deg, #1e3a8a, var(--primary))',
  deposit_account_balance DECIMAL(15,2) DEFAULT 0.00,
  withdrawal_account_balance DECIMAL(15,2) DEFAULT 0.00,
  bonus_account_balance DECIMAL(15,2) DEFAULT 0.00,
  token_balance DECIMAL(15,4) DEFAULT 0.0000,
  wallet_address VARCHAR(255) DEFAULT NULL,
  certification_type ENUM('None', 'Basique', 'VIP', 'Gouvernement', 'Entreprise') DEFAULT 'None',
  account_status ENUM('Active', 'Paused', 'Partially Blocked', 'Blocked') DEFAULT 'Active',
  is_verified BOOLEAN DEFAULT FALSE,
  verification_code VARCHAR(10) DEFAULT NULL,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  preferred_language ENUM('en', 'fr', 'es') DEFAULT 'en',
  events_status ENUM('locked', 'active') DEFAULT 'locked',
  events_followers_threshold INT DEFAULT 1000,
  events_activated_at TIMESTAMP NULL DEFAULT NULL,
  premium_status ENUM('free', 'active') DEFAULT 'free',
  premium_unlock_method ENUM('manual', 'auto_followers', 'paid') DEFAULT 'manual',
  premium_followers_threshold INT DEFAULT 1000,
  premium_paid_at TIMESTAMP NULL DEFAULT NULL,
  premium_activated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table Publications (avec support pour 2 images maximum pour la grille)
CREATE TABLE posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  content TEXT NOT NULL,
  image_url VARCHAR(255) DEFAULT NULL,
  image_url_2 VARCHAR(255) DEFAULT NULL,
  image_url_3 VARCHAR(255) DEFAULT NULL,
  image_url_4 VARCHAR(255) DEFAULT NULL,
  media_type VARCHAR(20) DEFAULT NULL,
  thumbnail_url VARCHAR(255) DEFAULT NULL,
  allow_download TINYINT(1) DEFAULT 1,
  bg_image_url VARCHAR(255) DEFAULT NULL,
  text_color VARCHAR(20) DEFAULT NULL,
  text_alignment VARCHAR(20) DEFAULT NULL,
  text_position VARCHAR(20) DEFAULT NULL,
  text_font VARCHAR(100) DEFAULT NULL,
  text_size VARCHAR(20) DEFAULT NULL,
  is_trade TINYINT(1) DEFAULT 0,
  trade_price DECIMAL(10,2) DEFAULT NULL,
  last_possession_user_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Table Likes
CREATE TABLE likes (
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 4. Table Signets (Bookmarks)
CREATE TABLE bookmarks (
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 5b. Table Shares de publications
CREATE TABLE post_shares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  sharer_id INT NOT NULL,
  recipient_user_id INT DEFAULT NULL,
  channel VARCHAR(50) NOT NULL DEFAULT 'social',
  platform VARCHAR(50) DEFAULT NULL,
  share_token VARCHAR(64) NOT NULL UNIQUE,
  clicked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (sharer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_post_shares_post_clicked (post_id, clicked_at)
);

-- 5. Table Commentaires
CREATE TABLE comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  voice_duration_seconds INT DEFAULT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5c. Table Notifications
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient_id INT NOT NULL,
  actor_id INT NOT NULL,
  type ENUM('like', 'comment', 'share', 'follow', 'mention', 'message', 'ad-published', 'game', 'gift') NOT NULL,
  message VARCHAR(255) NOT NULL,
  post_id INT DEFAULT NULL,
  share_id INT DEFAULT NULL,
  comment_id INT DEFAULT NULL,
  ad_url VARCHAR(255) DEFAULT NULL,
  ad_image_url VARCHAR(255) DEFAULT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (share_id) REFERENCES post_shares(id) ON DELETE CASCADE,
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  INDEX idx_notifications_recipient_read (recipient_id, is_read, created_at)
);

-- 6. Table Reels/Shorts
CREATE TABLE reels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  video_url VARCHAR(255) DEFAULT NULL,
  sound_name VARCHAR(100) NOT NULL,
  caption TEXT NOT NULL,
  media_type VARCHAR(50) NOT NULL DEFAULT 'video',
  audio_url VARCHAR(255) DEFAULT NULL,
  audio_start_time DOUBLE DEFAULT 0,
  audio_duration INT DEFAULT 30,
  media_fit VARCHAR(20) NOT NULL DEFAULT 'cover',
  is_trade TINYINT(1) DEFAULT 0,
  trade_price DECIMAL(10,2) DEFAULT NULL,
  last_possession_user_id INT DEFAULT NULL,
  likes_count INT DEFAULT 0,
  comments_count INT DEFAULT 0,
  shares_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE reel_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reel_id INT NOT NULL,
  user_id INT NOT NULL,
  parent_id INT DEFAULT NULL,
  content TEXT NOT NULL,
  voice_url VARCHAR(255) DEFAULT NULL,
  voice_duration_seconds INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 7. Table Statuses
CREATE TABLE statuses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  media_url VARCHAR(255) NOT NULL,
  media_type VARCHAR(50) NOT NULL,
  media_name VARCHAR(255) DEFAULT NULL,
  media_size INT DEFAULT NULL,
  caption TEXT DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_statuses_user_created (user_id, created_at),
  INDEX idx_statuses_expires_at (expires_at)
);

-- 8. Table Events
CREATE TABLE events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organizer_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT DEFAULT NULL,
  location_name VARCHAR(180) DEFAULT NULL,
  location_address VARCHAR(255) DEFAULT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME DEFAULT NULL,
  category VARCHAR(80) DEFAULT 'Community',
  cover_image_url VARCHAR(255) DEFAULT NULL,
  ticket_mode ENUM('generated', 'uploaded') DEFAULT 'generated',
  is_paid TINYINT(1) DEFAULT 0,
  ticket_price DECIMAL(10,2) DEFAULT 0.00,
  ticket_asset_url VARCHAR(255) DEFAULT NULL,
  ticket_asset_name VARCHAR(255) DEFAULT NULL,
  ticket_asset_type VARCHAR(50) DEFAULT NULL,
  visibility ENUM('public', 'friends', 'private') DEFAULT 'public',
  capacity INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_events_starts_at (starts_at),
  INDEX idx_events_organizer (organizer_id)
);

CREATE TABLE event_attendees (
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  status ENUM('going', 'interested') NOT NULL DEFAULT 'going',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_event_attendees_status (status)
);

CREATE TABLE event_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  ticket_code VARCHAR(80) NOT NULL UNIQUE,
  ticket_type ENUM('free', 'paid') DEFAULT 'free',
  ticket_asset_url VARCHAR(255) DEFAULT NULL,
  ticket_asset_name VARCHAR(255) DEFAULT NULL,
  ticket_asset_type VARCHAR(50) DEFAULT NULL,
  email_sent_at TIMESTAMP NULL DEFAULT NULL,
  message_sent_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_event_tickets_event_user (event_id, user_id)
);

-- 9. Table Messages (Messagerie)
CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  content TEXT NOT NULL,
  attachment_url VARCHAR(255) DEFAULT NULL,
  attachment_type VARCHAR(50) DEFAULT NULL,
  attachment_name VARCHAR(255) DEFAULT NULL,
  attachment_size INT DEFAULT NULL,
  voice_duration_seconds INT DEFAULT NULL,
  delivered_at TIMESTAMP NULL DEFAULT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table Hashtags
CREATE TABLE IF NOT EXISTS hashtags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  creator_id INT NOT NULL,
  is_paid BOOLEAN DEFAULT FALSE,
  price DECIMAL(10,2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 9. Table Follows
CREATE TABLE follows (
  follower_id INT NOT NULL,
  following_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
);


-- Table post_backgrounds
CREATE TABLE IF NOT EXISTS post_backgrounds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  image_url VARCHAR(255) NOT NULL,
  is_paid TINYINT(1) DEFAULT 0,
  price DECIMAL(15,2) DEFAULT 0.00,
  creator_user_id INT NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table bsc_deposits
CREATE TABLE IF NOT EXISTS bsc_deposits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  tx_hash VARCHAR(66) NOT NULL UNIQUE,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  amount_wei VARCHAR(40) NOT NULL,
  amount_usdt DECIMAL(18,6) NOT NULL,
  token_symbol VARCHAR(20) DEFAULT 'USDT',
  block_number INT DEFAULT NULL,
  confirmations INT DEFAULT 0,
  status ENUM('pending','confirmed','failed') DEFAULT 'pending',
  credited_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bsc_deposits_status (status),
  INDEX idx_bsc_deposits_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table bsc_withdrawals
CREATE TABLE IF NOT EXISTS bsc_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  tx_hash VARCHAR(66) DEFAULT NULL,
  recipient_address VARCHAR(42) NOT NULL,
  amount_usdt DECIMAL(18,6) NOT NULL,
  fee_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
  net_amount_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
  gas_cost_usdt DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
  status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bsc_withdrawals_user (user_id),
  INDEX idx_bsc_withdrawals_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table p2p_offers
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
  payment_account_name VARCHAR(160) NULL DEFAULT NULL,
  payment_account_number VARCHAR(120) NULL DEFAULT NULL,
  terms TEXT NULL,
  status ENUM('active', 'filled', 'closed') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_p2p_offers_user (user_id),
  INDEX idx_p2p_offers_type_status (offer_type, status),
  INDEX idx_p2p_offers_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table p2p_orders
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
  FOREIGN KEY (offer_id) REFERENCES p2p_offers(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_p2p_orders_offer (offer_id),
  INDEX idx_p2p_orders_buyer (buyer_user_id),
  INDEX idx_p2p_orders_seller (seller_user_id),
  INDEX idx_p2p_orders_status (status),
  INDEX idx_p2p_orders_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table p2p_order_messages
CREATE TABLE IF NOT EXISTS p2p_order_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  sender_user_id INT NOT NULL,
  content TEXT NULL,
  image_url VARCHAR(255) NULL,
  image_name VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES p2p_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_p2p_order_messages_order (order_id, created_at),
  INDEX idx_p2p_order_messages_sender (sender_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table kyc_requests
CREATE TABLE IF NOT EXISTS kyc_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  request_type ENUM('premium', 'events', 'withdrawal') NOT NULL DEFAULT 'premium',
  status ENUM('draft', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
  payment_status ENUM('none', 'paid') NOT NULL DEFAULT 'none',
  payment_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  payment_non_refundable TINYINT(1) NOT NULL DEFAULT 0,
  request_note TEXT DEFAULT NULL,
  document_url VARCHAR(255) DEFAULT NULL,
  document_name VARCHAR(255) DEFAULT NULL,
  document_type VARCHAR(100) DEFAULT NULL,
  document_size INT DEFAULT NULL,
  selfie_url VARCHAR(255) DEFAULT NULL,
  selfie_name VARCHAR(255) DEFAULT NULL,
  selfie_type VARCHAR(100) DEFAULT NULL,
  selfie_size INT DEFAULT NULL,
  submitted_full_name VARCHAR(160) DEFAULT NULL,
  submitted_username VARCHAR(80) DEFAULT NULL,
  submitted_email VARCHAR(150) DEFAULT NULL,
  submitted_country VARCHAR(100) DEFAULT NULL,
  submitted_dob DATE DEFAULT NULL,
  verification_score INT DEFAULT NULL,
  face_match_score INT DEFAULT NULL,
  verification_notes TEXT DEFAULT NULL,
  ai_provider VARCHAR(50) DEFAULT NULL,
  ai_model VARCHAR(80) DEFAULT NULL,
  ocr_text_excerpt TEXT DEFAULT NULL,
  ocr_detected_dates LONGTEXT DEFAULT NULL,
  ocr_selected_dob VARCHAR(20) DEFAULT NULL,
  ocr_selected_dob_reason VARCHAR(160) DEFAULT NULL,
  verified_by_ai TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_by_admin_id INT DEFAULT NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_kyc_requests_type_status (request_type, status),
  INDEX idx_kyc_requests_status (status),
  INDEX idx_kyc_requests_created_at (created_at),
  UNIQUE KEY uniq_kyc_user_type (user_id, request_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Réactiver les contraintes de clés étrangères
SET FOREIGN_KEY_CHECKS = 1;

