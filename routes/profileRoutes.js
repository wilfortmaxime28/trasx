const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const profileController = require('../controllers/profileController');

// Configuration de multer pour profil
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../public/assets/uploads/'));
  },
  filename: function (req, file, cb) {
    cb(null, 'avatar_' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Configuration de multer pour les reels/shorts
const reelsUploadDir = path.join(__dirname, '../public/uploads/reels');
if (!fs.existsSync(reelsUploadDir)) {
  fs.mkdirSync(reelsUploadDir, { recursive: true });
}
const reelsStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, reelsUploadDir);
  },
  filename(req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `reel-${unique}${path.extname(file.originalname).toLowerCase()}`);
  }
});
const uploadReels = multer({
  storage: reelsStorage,
  limits: { fileSize: 150 * 1024 * 1024 } // 150 MB
});

router.get('/', profileController.getProfile);
router.get('/u/:username', profileController.viewPublicProfile);
router.post('/avatar', upload.single('avatarFile'), profileController.updateAvatar);
router.post('/edit', profileController.updateInfo);
router.post('/post/:id/delete', profileController.deletePost);
router.post('/reel/:id/delete', profileController.deleteReel);
router.get('/reel/shared-audios', profileController.getSharedAudios);
router.post('/reel/create', uploadReels.fields([
  { name: 'reel_video', maxCount: 1 },
  { name: 'reel_image', maxCount: 1 },
  { name: 'reel_audio', maxCount: 1 }
]), profileController.createReel);

module.exports = router;
