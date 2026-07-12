/**
 * ocrHelper.js
 * 
 * Image preprocessing helper for OCR optimization.
 * Downscales, desaturates, and normalizes identity document images
 * using sharp to make Tesseract OCR fast (<5s) and highly accurate.
 */

const sharp = require('sharp');
const fs = require('fs');

/**
 * Preprocesses an uploaded identity document image to optimize it for Tesseract OCR.
 * 
 * Steps:
 *  1. Resize to a maximum width of 1600px (ideal balance of detail and performance).
 *  2. Convert to greyscale (reduces color noise and shadows).
 *  3. Normalize (enhances contrast by stretching the luminance range).
 *  4. Sharpen (makes text edges crisper).
 *  5. Save as a medium-quality JPEG.
 * 
 * @param {string} filePath - Path to the original uploaded image
 * @returns {Promise<string>} - Path to the preprocessed temp image
 */
async function preprocessImageForOcr(filePath) {
  const tempPath = filePath + '_ocr_prep.jpg';
  try {
    console.log('[OCR Preprocess] Optimizing image:', filePath);
    await sharp(filePath)
      .resize(1600, null, { withoutEnlargement: true, fit: 'inside' })
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.2 }) // Crisper character edges
      .jpeg({ quality: 80 })
      .toFile(tempPath);
    
    console.log('[OCR Preprocess] Optimization complete. Saved to:', tempPath);
    return tempPath;
  } catch (err) {
    console.error('[OCR Preprocess] Failed, falling back to original image:', err);
    return filePath; // Fallback to raw file if sharp fails
  }
}

/**
 * Safely deletes the preprocessed temporary file.
 * @param {string} tempPath - Path to delete
 */
function cleanOcrTempFile(tempPath) {
  if (tempPath && tempPath.endsWith('_ocr_prep.jpg')) {
    try {
      fs.unlinkSync(tempPath);
      console.log('[OCR Preprocess] Temporary preprocessed file deleted.');
    } catch (e) {
      console.error('[OCR Preprocess] Error deleting temp file:', e.message);
    }
  }
}

module.exports = {
  preprocessImageForOcr,
  cleanOcrTempFile
};
