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

// ── Strict keyword lists per document type to avoid false positives ──────────

const PASSPORT_KEYWORDS = [
  'PASSPORT', 'PASSEPORT', 'PASAPORTE', 'PASSAPORTE',
  'RÉPUBLIQUE FRANÇAISE', 'REPUBLIQUE FRANCAISE', 'REPUBLIQUE DE', 'REPUBLIC OF',
  'NATIONALITY', 'NATIONALITÉ', 'NATIONALITE',
  'GIVEN NAMES', 'PRÉNOMS', 'PRENOMS',
  'SURNAME', 'DATE OF BIRTH', 'DATE DE NAISSANCE'
];

const ID_CARD_KEYWORDS = [
  "CARTE NATIONALE D'IDENTITE", "CARTE D'IDENTITE", 'NATIONAL IDENTITY',
  'IDENTITY CARD', 'ID CARD', 'CARTE IDENTITE',
  'CEDULA DE IDENTIDAD', 'DOCUMENTO NACIONAL DE IDENTIDAD', 'PERSONALAUSWEIS',
  'TARJETA DE IDENTIDAD',
];

const LICENSE_KEYWORDS = [
  'PERMIS DE CONDUIRE',
  'DRIVING LICENCE', 'DRIVER LICENSE', "DRIVER'S LICENSE",
  'DRIVING LICENSE', 'LICENCIA DE CONDUCIR',
  'FÜHRERSCHEIN', 'RIJBEWIJS', 'PERMESSO DI GUIDA',
];

// Generic identity markers present on most official documents
const GENERIC_IDENTITY_KEYWORDS = [
  'DATE OF BIRTH', 'DATE DE NAISSANCE', 'FECHA DE NACIMIENTO',
  'EXPIRY DATE', "DATE D'EXPIRATION", 'DATE D\'EXPIRY',
  'PLACE OF BIRTH', 'LIEU DE NAISSANCE',
  'ISSUED BY', 'DÉLIVRÉ PAR',
  'SURNAME / NOM', 'GIVEN NAMES / PRÉNOMS'
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

    // Normalize text: remove accents, normalize whitespace, uppercase
    const normalized = String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ');

    console.log('[DocTypeCheck] Quick-scan text (first 250 chars):', normalized.slice(0, 250));

    // Step 3: Keyword matching
    let docType = null;

    if (PASSPORT_KEYWORDS.some(kw => normalized.includes(kw))) {
      docType = 'passport';
    } else if (ID_CARD_KEYWORDS.some(kw => normalized.includes(kw))) {
      docType = 'id_card';
    } else if (LICENSE_KEYWORDS.some(kw => normalized.includes(kw))) {
      docType = 'driving_license';
    } else if (GENERIC_IDENTITY_KEYWORDS.some(kw => normalized.includes(kw))) {
      docType = 'identity_document';
    }

    // Strict MRZ Detection: must contain at least 2 '<' characters inside a word of at least 15 characters
    if (!docType) {
      const mrzPattern = /[A-Z0-9<]{15,}/g;
      const candidates = normalized.match(mrzPattern) || [];
      for (const cand of candidates) {
        // Count number of '<' in the candidate string
        const angleCount = (cand.match(/</g) || []).length;
        if (angleCount >= 2) {
          docType = 'mrz_document';
          console.log('[DocTypeCheck] Real MRZ pattern detected in word:', cand);
          break;
        }
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
      try {
        fs.unlinkSync(thumbPath);
      } catch (e) {}
    }
  }
}

module.exports = { checkIsIdentityDocument };

