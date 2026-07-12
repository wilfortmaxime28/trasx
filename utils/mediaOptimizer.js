const path = require('path');
const fs = require('fs');
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('Warning: "sharp" module could not be loaded. Running with image optimization bypass fallback.');
}
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Configure ffmpeg to use the static binary from ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Optimizes an uploaded image: converts it to WebP, resizes if too large, and compresses.
 * @param {string} inputPath - Original uploaded file path
 * @param {string} outputPath - Desired destination path (WebP)
 * @returns {Promise<string>} - Resolves to the output path
 */
async function optimizeImage(inputPath, outputPath, options = {}) {
  try {
    const {
      maxWidth = 1920,
      maxHeight = 1920,
      quality = 80
    } = options;
    if (!sharp) {
      fs.copyFileSync(inputPath, outputPath);
      return outputPath;
    }
    await sharp(inputPath)
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality })
      .toFile(outputPath);
    return outputPath;
  } catch (error) {
    console.error('Error optimizing image:', error);
    throw error;
  }
}

/**
 * Generates a thumbnail image from an uploaded image in WebP format.
 * @param {string} inputPath - Original uploaded file path
 * @param {string} outputPath - Desired thumbnail destination path (WebP)
 * @returns {Promise<string>} - Resolves to the output path
 */
async function generateImageThumbnail(inputPath, outputPath) {
  try {
    if (!sharp) {
      fs.copyFileSync(inputPath, outputPath);
      return outputPath;
    }
    await sharp(inputPath)
      .resize({
        width: 360,
        height: 360,
        fit: 'cover'
      })
      .webp({ quality: 70 })
      .toFile(outputPath);
    return outputPath;
  } catch (error) {
    console.error('Error generating image thumbnail:', error);
    throw error;
  }
}

async function generateResponsiveImageVariants(inputPath, outputDir, baseName) {
  const variants = {
    thumbnail: path.join(outputDir, `${baseName}-thumb.webp`),
    240: path.join(outputDir, `${baseName}-240.webp`),
    480: path.join(outputDir, `${baseName}-480.webp`),
    720: path.join(outputDir, `${baseName}-720.webp`)
  };

  if (!sharp) {
    Object.values(variants).forEach((targetPath) => {
      fs.copyFileSync(inputPath, targetPath);
    });
    return variants;
  }

  const pipeline = sharp(inputPath);
  await Promise.all([
    pipeline.clone().resize({ width: 160, height: 160, fit: 'cover' }).webp({ quality: 68 }).toFile(variants.thumbnail),
    pipeline.clone().resize({ width: 240, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toFile(variants[240]),
    pipeline.clone().resize({ width: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toFile(variants[480]),
    pipeline.clone().resize({ width: 720, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(variants[720])
  ]);

  return variants;
}

/**
 * Optimizes an uploaded video: downscales it to 720p maximum, converts it to MP4 H.264/AAC, and compresses it.
 * @param {string} inputPath - Original uploaded file path
 * @param {string} outputPath - Desired destination path (MP4)
 * @returns {Promise<string>} - Resolves to the output path
 */
function optimizeVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-crf 28',                  // Constant rate factor (good quality, small file size)
        '-preset fast',
        '-vf scale=-2:min(720\\,ih)', // Downscale to 720p maximum, preserve aspect ratio
        '-movflags +faststart'      // Web playability (moves index to front)
      ])
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error optimizing video:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Trims and optimizes an uploaded video using start time and duration.
 * @param {string} inputPath - Original uploaded file path
 * @param {string} outputPath - Desired destination path (MP4)
 * @param {number} startTime - Start time in seconds
 * @param {number} duration - Duration in seconds
 * @returns {Promise<string>} - Resolves to the output path
 */
function optimizeAndTrimVideo(inputPath, outputPath, startTime, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-crf 28',                  // Constant rate factor
        '-preset fast',
        '-vf scale=-2:min(720\\,ih)', // Downscale to 720p maximum, preserve aspect ratio
        '-movflags +faststart'      // Web playability
      ])
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error optimizing/trimming video:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Extracts a frame from a video at 00:00:01 and saves it as a WebP thumbnail.
 * @param {string} videoPath - Source video path
 * @param {string} thumbnailPath - Destination path for the WebP thumbnail
 * @returns {Promise<string>} - Resolves to the thumbnail output path
 */
function generateVideoThumbnail(videoPath, thumbnailPath) {
  const tempJpgName = 'temp-thumb-' + Date.now() + '.jpg';
  const tempJpgPath = path.join(path.dirname(thumbnailPath), tempJpgName);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['1'],
        filename: tempJpgName,
        folder: path.dirname(thumbnailPath),
        size: '360x?' // Aspect ratio preserved, 360px wide
      })
      .on('end', async () => {
        try {
          if (fs.existsSync(tempJpgPath)) {
            if (!sharp) {
              fs.renameSync(tempJpgPath, thumbnailPath);
              resolve(thumbnailPath);
              return;
            }
            // Compress the temporary screenshot to WebP and save it
            await sharp(tempJpgPath)
              .webp({ quality: 70 })
              .toFile(thumbnailPath);

            // Clean up temporary JPG screenshot
            try { fs.unlinkSync(tempJpgPath); } catch (e) {}
            resolve(thumbnailPath);
          } else {
            reject(new Error('Failed to capture video thumbnail frame.'));
          }
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error('Error generating video thumbnail:', err);
        reject(err);
      });
  });
}

module.exports = {
  optimizeImage,
  generateImageThumbnail,
  generateResponsiveImageVariants,
  optimizeVideo,
  optimizeAndTrimVideo,
  generateVideoThumbnail
};
