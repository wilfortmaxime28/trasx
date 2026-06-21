const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const statusController = require('../controllers/statusController');

const statusUploadDir = path.join(__dirname, '../public/uploads/statuses');
if (!fs.existsSync(statusUploadDir)) {
  fs.mkdirSync(statusUploadDir, { recursive: true });
}

const statusStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, statusUploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const original = (file.originalname || 'status').replace(/\s+/g, '-');
    const parts = original.split('.');
    const ext = parts.length > 1 ? parts.pop() : (file.mimetype.split('/')[1] || 'bin');
    cb(null, `status-${uniqueSuffix}.${ext.toLowerCase().trim()}`);
  }
});

const uploadStatusMedia = multer({
  storage: statusStorage,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

router.post('/create', uploadStatusMedia.single('status_media'), statusController.createStatus);

module.exports = router;
