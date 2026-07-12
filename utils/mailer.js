const nodemailer = require('nodemailer');
const db = require('../config/db');
const QRCode = require('qrcode');
const receiptCrypto = require('./receiptCrypto');

const SMTP_CACHE_TTL_MS = 60 * 1000;
let smtpConfigCache = null;
let smtpTransportCache = null;

async function getSmtpConfig() {
  if (smtpConfigCache && smtpConfigCache.expiresAt > Date.now()) {
    return smtpConfigCache.value;
  }

  const [rows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'smtp_%'");
  const config = {};
  rows.forEach(row => {
    config[row.setting_key] = row.setting_value;
  });
  smtpConfigCache = {
    value: config,
    expiresAt: Date.now() + SMTP_CACHE_TTL_MS
  };
  return config;
}

async function createTransporter() {
  const config = await getSmtpConfig();

  if (
    smtpTransportCache &&
    smtpTransportCache.expiresAt > Date.now() &&
    smtpTransportCache.cacheKey === JSON.stringify(config)
  ) {
    return {
      config,
      transporter: smtpTransportCache.transporter
    };
  }

  if (!config.smtp_host || !config.smtp_port || !config.smtp_user || !config.smtp_pass) {
    throw new Error('SMTP configuration is incomplete.');
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp_host,
    port: parseInt(config.smtp_port, 10),
    secure: config.smtp_secure === 'true',
    auth: {
      user: config.smtp_user,
      pass: config.smtp_pass
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
    dnsTimeout: 5000
  });

  smtpTransportCache = {
    cacheKey: JSON.stringify(config),
    transporter,
    expiresAt: Date.now() + SMTP_CACHE_TTL_MS
  };

  return {
    config,
    transporter
  };
}

async function sendHtmlEmail(to, subject, html) {
  try {
    const { config, transporter } = await createTransporter();
    const info = await transporter.sendMail({
      from: `"TrasX" <${config.smtp_user}>`,
      to,
      subject,
      html
    });
    console.log('Email sent: %s', info.messageId);
    if (config.smtp_host.includes('ethereal')) {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

async function sendVerificationEmail(to, code) {
  try {
    const { config, transporter } = await createTransporter();
    const info = await transporter.sendMail({
      from: `"TrasX" <${config.smtp_user}>`,
      to: to,
      subject: 'Verify your TrasX Account',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Welcome to TrasX!</h2>
          <p>Your verification code is: <strong style="font-size: 24px;">${code}</strong></p>
          <p>Please enter this code on the verification page to activate your account.</p>
        </div>
      `
    });
    console.log('Email sent: %s', info.messageId);
    if(config.smtp_host.includes('ethereal')) {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false; // Dans le pire des cas, on retourne false mais l'application gère cela
  }
}

async function sendPasswordResetEmail(to, code) {
  try {
    const { config, transporter } = await createTransporter();
    const info = await transporter.sendMail({
      from: `"TrasX" <${config.smtp_user}>`,
      to,
      subject: 'Reset your TrasX password',
      html: `
        <div style="font-family: Inter, Arial, sans-serif; padding: 24px; color: #111827;">
          <div style="max-width: 560px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 18px; overflow: hidden;">
            <div style="padding: 24px; background: linear-gradient(135deg, #1d4ed8, #2563eb); color: white;">
              <h2 style="margin: 0 0 6px; font-size: 24px;">Password reset request</h2>
              <p style="margin: 0; opacity: 0.9;">Use the code below to create a new password.</p>
            </div>
            <div style="padding: 24px; background: white;">
              <p style="margin: 0 0 14px;">We received a request to reset your TrasX password.</p>
              <div style="margin: 18px 0; padding: 18px; border-radius: 16px; background: #f8fbff; border: 1px dashed #bfdbfe; text-align: center;">
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin-bottom: 8px;">Reset code</div>
                <div style="font-size: 32px; font-weight: 800; letter-spacing: 0.22em; color: #1d4ed8;">${code}</div>
              </div>
              <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
                If you did not request this change, you can safely ignore this email.
              </p>
            </div>
          </div>
        </div>
      `
    });
    console.log('Password reset email sent: %s', info.messageId);
    if (config.smtp_host.includes('ethereal')) {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return false;
  }
}

async function sendEventTicketEmail(to, payload = {}) {
  const {
    eventTitle,
    eventDate,
    eventLocation,
    ticketCode,
    ticketUrl,
    ticketDownloadUrl,
    holderName,
    priceLabel,
    ticketLabel
  } = payload;

  const subject = `Your ticket for ${eventTitle || 'TrasX Event'}`;
  const downloadLink = ticketDownloadUrl || ticketUrl;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; padding: 24px; color: #111827;">
      <div style="max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 18px; overflow: hidden;">
        <div style="padding: 22px; background: linear-gradient(135deg, #1d4ed8, #7c3aed); color: white;">
          <h2 style="margin: 0 0 6px; font-size: 24px;">${eventTitle || 'Your event ticket'}</h2>
          <p style="margin: 0; opacity: 0.9;">${ticketLabel || 'Personalized ticket'}</p>
        </div>
        <div style="padding: 22px; background: white;">
          <p style="margin: 0 0 12px;">Hello ${holderName || 'there'},</p>
          <p style="margin: 0 0 12px;">Your ticket is ready.</p>
          <div style="padding: 14px; border: 1px dashed #cbd5e1; border-radius: 14px; margin: 16px 0;">
            <div><strong>Code:</strong> ${ticketCode || '-'}</div>
            <div style="margin-top: 6px;"><strong>Date:</strong> ${eventDate || '-'}</div>
            <div style="margin-top: 6px;"><strong>Location:</strong> ${eventLocation || '-'}</div>
            <div style="margin-top: 6px;"><strong>Type:</strong> ${priceLabel || 'Free'}</div>
          </div>
          <p style="margin: 0 0 16px;">Open your ticket here: <a href="${ticketUrl}" style="color: #2563eb;">${ticketUrl}</a></p>
          <p style="margin: 0 0 18px;">
            <a href="${downloadLink}" style="display: inline-flex; align-items: center; gap: 8px; padding: 11px 16px; border-radius: 12px; background: #2563eb; color: #fff; text-decoration: none; font-weight: 700;">
              Download ticket
            </a>
          </p>
          <p style="margin: 0; color: #6b7280; font-size: 13px;">Keep this code safe. It is unique to your ticket.</p>
        </div>
      </div>
    </div>
  `;
  return sendHtmlEmail(to, subject, html);
}

async function sendTransactionReceiptEmail(user, tx, type) {
  try {
    const { config, transporter } = await createTransporter();
    
    const txId = tx.id;
    const amountUsdt = parseFloat(tx.amount_usdt || 0);
    const feeUsdt = parseFloat(tx.fee_usdt || 0);
    const netAmountUsdt = parseFloat(tx.net_amount_usdt || tx.amount_usdt || 0);
    const txHash = tx.tx_hash || 'En attente...';
    const dateString = new Date(tx.created_at || Date.now()).toLocaleString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const walletAddress = tx.recipient_address || tx.from_address || user.wallet_address || 'Inconnu';
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Client TrasX';
    const userUsername = user.username || 'client';
    const userEmail = user.email;

    const payload = {
      id: txId,
      type: type,
      user_id: user.id,
      amount: amountUsdt,
      date: tx.created_at || new Date().toISOString(),
      tx_hash: txHash
    };

    const encryptedCode = receiptCrypto.encrypt(JSON.stringify(payload));
    
    const qrBuffer = await QRCode.toBuffer(encryptedCode, {
      type: 'png',
      margin: 1,
      width: 200,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });

    const subject = `Reçu de transaction TrasX - #${type === 'deposit' ? 'DEP' : 'WTH'}-${txId}`;
    
    const html = `
      <div style="font-family: 'Inter', Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 40px 20px; color: #1e293b; line-height: 1.5; -webkit-font-smoothing: antialiased;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);">
          <div style="height: 6px; background: linear-gradient(90deg, #3b82f6, #8b5cf6);"></div>
          
          <div style="padding: 30px; border-bottom: 1px solid #f1f5f9;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td>
                  <h1 style="font-size: 24px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: -0.02em;">TrasX</h1>
                  <span style="font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Reçu Officiel de Transaction</span>
                </td>
                <td style="text-align: right; vertical-align: middle;">
                  <span style="display: inline-block; padding: 6px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; background-color: #dcfce7; color: #15803d; text-transform: uppercase; letter-spacing: 0.02em;">
                    Réussi
                  </span>
                </td>
              </tr>
            </table>
          </div>
          
          <div style="padding: 30px; border-bottom: 1px solid #f1f5f9;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                  <span style="display: block; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; letter-spacing: 0.02em;">Utilisateur</span>
                  <strong style="color: #0f172a; font-size: 14px; display: block;">${userName} (@${userUsername})</strong>
                  <span style="display: block; font-size: 13px; color: #64748b;">${userEmail}</span>
                </td>
                <td style="width: 50%; vertical-align: top; text-align: right; padding-left: 10px;">
                  <span style="display: block; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; letter-spacing: 0.02em;">Référence de Reçu</span>
                  <strong style="color: #0f172a; font-size: 14px; display: block;">#WS-${type === 'deposit' ? 'DEP' : 'WTH'}-${txId}</strong>
                  <span style="display: block; font-size: 13px; color: #64748b;">${dateString}</span>
                </td>
              </tr>
            </table>
            
            <div style="background-color: #f8fafc; border-radius: 12px; padding: 16px; border: 1px solid #e2e8f0;">
              <span style="display: block; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 6px; letter-spacing: 0.02em;">Adresse Portefeuille Associée</span>
              <code style="font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #0f172a; word-break: break-all; font-weight: 600;">${walletAddress}</code>
            </div>
          </div>
          
          <div style="padding: 30px; border-bottom: 1px solid #f1f5f9;">
            <h3 style="font-size: 14px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.05em;">Détails Financiers</h3>
            
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
              <thead>
                <tr style="border-bottom: 2px solid #e2e8f0;">
                  <th style="padding: 10px 0; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em;">Description</th>
                  <th style="padding: 10px 0; font-size: 12px; font-weight: 600; color: #64748b; text-align: right; text-transform: uppercase; letter-spacing: 0.02em;">Montant</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 0; font-size: 14px; color: #0f172a; vertical-align: top;">
                    <strong style="display: block; margin-bottom: 4px;">${type === 'deposit' ? 'Dépôt USDT (BEP-20)' : 'Retrait USDT (BEP-20)'}</strong>
                    <div style="font-size: 12px; color: #64748b; font-family: 'Courier New', Courier, monospace; word-break: break-all; line-height: 1.3;">Hash: ${txHash}</div>
                  </td>
                  <td style="padding: 14px 0; font-size: 14px; color: #0f172a; text-align: right; font-weight: 600; vertical-align: top;">
                    ${amountUsdt.toFixed(2)} USDT
                  </td>
                </tr>
                ${type === 'withdrawal' ? `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 0; font-size: 14px; color: #ef4444;">Frais de Plateforme (30%)</td>
                  <td style="padding: 14px 0; font-size: 14px; color: #ef4444; text-align: right; font-weight: 600;">
                    -${feeUsdt.toFixed(2)} USDT
                  </td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 20px 0 0 0; font-size: 15px; font-weight: 700; color: #0f172a;">Montant Net Transféré</td>
                  <td style="padding: 20px 0 0 0; font-size: 18px; font-weight: 800; color: #2563eb; text-align: right;">
                    ${netAmountUsdt.toFixed(2)} USDT
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div style="padding: 30px; background-color: #faf5ff; text-align: center; border-bottom: 1px solid #f1f5f9;">
            <div style="max-width: 420px; margin: 0 auto;">
              <span style="display: block; font-size: 11px; color: #7c3aed; text-transform: uppercase; font-weight: 700; margin-bottom: 10px; letter-spacing: 0.05em;">Code de Sécurité de Validation</span>
              
              <div style="background-color: #ffffff; padding: 12px; border-radius: 14px; border: 1px dashed #d8b4fe; margin-bottom: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <img src="cid:receiptQr" alt="QR Code de Validation" style="width: 160px; height: 160px; display: block; margin: 0 auto;" />
              </div>
              
              <p style="font-size: 12px; color: #6b21a8; margin: 0 0 12px 0; font-weight: 500; line-height: 1.4;">
                Ce QR Code contient des données cryptées authentifiant cette transaction. Seuls les administrateurs de TrasX peuvent le décoder dans leur espace de gestion sécurisé.
              </p>
              
              <div style="background-color: #ffffff; border-radius: 8px; padding: 10px; font-family: monospace; font-size: 10px; color: #581c87; word-break: break-all; border: 1px solid #e9d5ff; user-select: all; text-align: left; font-weight: 600;">
                ${encryptedCode}
              </div>
            </div>
          </div>
          
          <div style="padding: 20px 30px; background-color: #f8fafc; text-align: center; font-size: 12px; color: #64748b;">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #475569;">TrasX Inc. — Sécurité & Transparence.</p>
            <p style="margin: 0; line-height: 1.4;">Ceci est un email automatique de confirmation de transaction. Si vous n'êtes pas à l'origine de cette opération, veuillez contacter notre équipe de support immédiatement.</p>
          </div>
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"TrasX Receipts" <${config.smtp_user}>`,
      to: userEmail,
      subject,
      html,
      attachments: [{
        filename: `receipt-qr-${txId}.png`,
        content: qrBuffer,
        cid: 'receiptQr'
      }]
    });
    
    console.log(`[ReceiptMailer] Receipt email sent successfully to ${userEmail} for transaction #${txId} (${type})`);
    if (config.smtp_host.includes('ethereal')) {
      console.log('[ReceiptMailer] Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    return true;
  } catch (err) {
    console.error('[ReceiptMailer] Error sending transaction receipt email:', err);
    return false;
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendHtmlEmail, sendEventTicketEmail, sendTransactionReceiptEmail };
