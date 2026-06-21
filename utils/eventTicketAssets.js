const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');

const GENERATED_TICKET_DIR = path.join(__dirname, '../public/uploads/events/tickets/generated');

async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value, maxLength = 80) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatTicketDate(value) {
  if (!value) return 'TBA';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBA';
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildGeneratedTicketSvg({
  event,
  holderName,
  ticketCode,
  ticketType,
  ticketPageUrl,
  qrDataUrl
}) {
  const eventTitle = escapeXml(truncate(event?.title || 'Event ticket', 42));
  const holder = escapeXml(truncate(holderName || 'Guest', 34));
  const location = escapeXml(truncate(event?.location_name || event?.location_address || 'Online', 44));
  const dateLabel = escapeXml(formatTicketDate(event?.starts_at));
  const code = escapeXml(ticketCode);
  const typeLabel = escapeXml(ticketType === 'paid' ? 'Paid ticket' : 'Free ticket');
  const ticketUrl = escapeXml(ticketPageUrl);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" fill="none">
  <defs>
    <linearGradient id="bg" x1="80" y1="80" x2="1120" y2="640" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1D4ED8"/>
      <stop offset="1" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.08"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="720" rx="36" fill="#F8FAFC"/>
  <rect x="32" y="32" width="1136" height="656" rx="32" fill="url(#bg)"/>
  <rect x="56" y="56" width="1088" height="608" rx="28" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="2"/>

  <rect x="80" y="88" width="618" height="544" rx="28" fill="url(#panel)" stroke="#FFFFFF" stroke-opacity="0.14"/>
  <rect x="728" y="88" width="392" height="544" rx="28" fill="#FFFFFF" fill-opacity="0.94"/>

  <text x="110" y="138" fill="#E0E7FF" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2">TrasX Ticket</text>
  <text x="110" y="215" fill="#FFFFFF" font-family="Outfit, Inter, Arial, sans-serif" font-size="52" font-weight="800">${eventTitle}</text>
  <text x="110" y="260" fill="#E0E7FF" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="500">${typeLabel}</text>
  <text x="110" y="320" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600">Holder</text>
  <text x="110" y="356" fill="#DBEAFE" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800">${holder}</text>

  <text x="110" y="418" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600">Date</text>
  <text x="110" y="452" fill="#DBEAFE" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700">${dateLabel}</text>

  <text x="110" y="512" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600">Location</text>
  <text x="110" y="546" fill="#DBEAFE" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700">${location}</text>

  <text x="110" y="600" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="600" opacity="0.92">Ticket code</text>
  <text x="110" y="628" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800">${code}</text>

  <text x="770" y="138" fill="#0F172A" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" letter-spacing="1.5">Scan to open ticket</text>
  <rect x="770" y="164" width="300" height="300" rx="24" fill="#F8FAFC" stroke="#E2E8F0"/>
  <image href="${qrDataUrl}" x="790" y="184" width="260" height="260" preserveAspectRatio="xMidYMid meet"/>

  <rect x="770" y="490" width="300" height="90" rx="18" fill="#EEF2FF" stroke="#C7D2FE"/>
  <text x="790" y="526" fill="#1E293B" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700">Open ticket page</text>
  <text x="790" y="552" fill="#2563EB" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="500">Scan the QR to open the ticket</text>
</svg>`;
}

async function generateTicketAsset({ event, holderName, ticketCode, ticketType, ticketPageUrl }) {
  await ensureDirectory(GENERATED_TICKET_DIR);
  const qrDataUrl = await QRCode.toDataURL(ticketPageUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: {
      dark: '#0F172A',
      light: '#FFFFFF'
    }
  });

  const fileName = `${ticketCode}.svg`;
  const filePath = path.join(GENERATED_TICKET_DIR, fileName);
  const svg = buildGeneratedTicketSvg({
    event,
    holderName,
    ticketCode,
    ticketType,
    ticketPageUrl,
    qrDataUrl
  });

  await fs.writeFile(filePath, svg, 'utf8');
  const stats = await fs.stat(filePath);

  return {
    fileName,
    filePath,
    fileUrl: `/uploads/events/tickets/generated/${fileName}`,
    mimeType: 'image/svg+xml',
    size: stats.size
  };
}

module.exports = {
  generateTicketAsset
};
