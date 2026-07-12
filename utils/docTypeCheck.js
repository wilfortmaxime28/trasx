/**
 * docTypeCheck.js
 * 
 * Fast identity document type pre-screening.
 * 
 * Before running the full Tesseract OCR (which takes 30–60 seconds),
 * this module runs a lightweight OCR pass on a downscaled image using
 * Tesseract PSM 11 (sparse text detection) — typically <5 seconds —
 * and checks for the presence of identity document keywords.
 * 
 * Accepted types: Passport, National ID Card, Driver's License
 * Languages covered: French, English, Spanish, Portuguese, Arabic (transliterated)
 */

const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const fs = require('fs');
const path = require('path');

// ── Keyword lists per document type ──────────────────────────────────────────

const PASSPORT_KEYWORDS = [
  'PASSPORT', 'PASSEPORT', 'PASAPORTE', 'PASSAPORTE',
  'REPUBLIC', 'REPUBLIQUE', 'REPÚBLICA',
  'P<', '<<',                          // MRZ markers
  'NATIONALITY', 'NATIONALITÉ', 'NATIONALITE',
  'GIVEN NAMES', 'PRÉNOMS', 'PRENOMS',
  'SURNAME', 'NOM', 'DATE OF BIRTH',
];

const ID_CARD_KEYWORDS = [
  "CARTE NATIONALE D'IDENTITE", "CARTE D'IDENTITE", 'NATIONAL IDENTITY',
  'IDENTITY CARD', 'ID CARD', 'CARTE IDENTITE',
  'CEDULA', 'DOCUMENTO', 'AUSWEIS',
  'PERSONAL ID', 'TARJETA',
];

const LICENSE_KEYWORDS = [
  'PERMIS DE CONDUIRE', "PERMIS DE CONDUIRE",
  'DRIVING LICENCE', 'DRIVER LICENSE', "DRIVER'S LICENSE",
  'DRIVING LICENSE', 'LICENCIA DE CONDUCIR',
  'FÜHRERSCHEIN', 'RIJBEWIJS', 'PERMESSO DI GUIDA',
  'CATEGORIES', 'CATÉGORIES',
];

// Generic identity markers present on most official documents
const GENERIC_IDENTITY_KEYWORDS = [
  'DATE OF BIRTH', 'DATE DE NAISSANCE', 'FECHA DE NACIMIENTO',
  'EXPIRY DATE', "DATE D'EXPIRATION", 'DATE D\'EXPIRY',
  'PLACE OF BIRTH', 'LIEU DE NAISSANCE',
  'ISSUED BY', 'DÉLIVRÉ PAR',
  'SEX', 'SEXE', 'GENDER',
  'SIGNATURE', 'HEIGHT', 'TAILLE',
  // MRZ patterns — reliable marker for machine-readable travel documents
  'IDCAN', 'IDFRA', 'IDUSA', 'IDBEL', 'IDCHE', 'IDDEU', 'IDGBR',
];

// Combined set for fast lookup
const ALL_KEYWORDS = [
  ...PASSPORT_KEYWORDS,
  ...ID_CARD_KEYWORDS,
  ...LICENSE_KEYWORDS,
  ...GENERIC_IDENTITY_KEYWORDS,
];

// ── Tesseract quick-scan worker (singleton) ────────────────────────────────

let quickScanWorkerPromise = null;

async function getQuickScanWorker() {
  if (!quickScanWorkerPromise) {
    let engPath;
    try {
      engPath = path.dirname(require.resolve('@tesseract.js-data/eng/package.json')) + '/4.0.0';
    } catch {
      engPath = undefined; // fallback: tesseract downloads it
    }

    quickScanWorkerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        ...(engPath ? { langPath: engPath } : {}),
        logger: () => {}, // silence logs
      });
      return worker;
    })().catch((err) => {
      quickScanWorkerPromise = null;
      throw err;
    });
  }
  return quickScanWorkerPromise;
}

// ── Main exported function ─────────────────────────────────────────────────

/**
 * Quickly checks whether an image contains an identity document
 * (passport, national ID, driver's license).
 *
 * Strategy:
 *  1. Resize the image to max 700px wide using sharp (fast)
 *  2. Run Tesseract PSM 11 (sparse text) on the small image (~3–6s)
 *  3. Check extracted text for identity document keywords
 *
 * @param {string} imagePath - Absolute path to the document image
 * @returns {Promise<{isIdentityDoc: boolean, docType: string|null, reason: string}>}
 */
async function checkIsIdentityDocument(imagePath) {
  let thumbPath = null;

  try {
    // Step 1: Downscale image for fast processing
    thumbPath = imagePath + '_quickscan_thumb.jpg';
    await sharp(imagePath)
      .resize(700, null, { withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 55 })
      .toFile(thumbPath);

    // Step 2: Quick sparse OCR
    const worker = await getQuickScanWorker();
    const { data: { text } } = await worker.recognize(thumbPath, {
      tessedit_pageseg_mode: '11',  // PSM 11 = sparse text, much faster
    });

    const normalized = String(text || '').toUpperCase().replace(/\n/g, ' ');
    console.log('[DocTypeCheck] Quick-scan text (first 200 chars):', normalized.slice(0, 200));

    // Step 3: Keyword matching
    let docType = null;

    if (PASSPORT_KEYWORDS.some(kw => normalized.includes(kw))) {
      docType = 'passport';
    } else if (ID_CARD_KEYWORDS.some(kw => normalized.includes(kw))) {
      docType = 'id_card';
    } else if (LICENSE_KEYWORDS.some(kw => normalized.includes(kw))) {
      docType = 'driving_license';
    } else if (GENERIC_IDENTITY_KEYWORDS.some(kw => normalized.includes(kw))) {
      // Looks like an official document even if type is ambiguous
      docType = 'identity_document';
    }

    // Also detect MRZ pattern: two lines of 30/44 chars matching [A-Z0-9<]
    if (!docType) {
      const mrzPattern = /[A-Z0-9<]{20,}/g;
      const mrzMatches = normalized.match(mrzPattern) || [];
      if (mrzMatches.length >= 1) {
        docType = 'mrz_document'; // MRZ found, it's a travel/ID document
        console.log('[DocTypeCheck] MRZ pattern detected.');
      }
    }

    const isIdentityDoc = docType !== null;

    return {
      isIdentityDoc,
      docType,
      reason: isIdentityDoc
        ? `Document reconnu comme : ${docType}`
        : 'Aucun marqueur de pièce d\'identité officielle détecté dans le document.',
    };
  } catch (err) {
    console.error('[DocTypeCheck] Error during quick scan:', err);
    // On failure, don't block — let full OCR decide
    return { isIdentityDoc: true, docType: 'unknown', reason: 'Vérification rapide indisponible.' };
  } finally {
    // Clean up temp thumbnail
    if (thumbPath) {
      fs.unlink(thumbPath, () => {});
    }
  }
}

module.exports = { checkIsIdentityDocument };
