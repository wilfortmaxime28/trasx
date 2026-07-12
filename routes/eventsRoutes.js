const express = require('express');
const router = express.Router();
const eventsController = require('../controllers/eventsController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const ticketUploadDir = path.join(__dirname, '../public/uploads/events/tickets');
const kycUploadDir = path.join(__dirname, '../public/uploads/events/kyc');
if (!fs.existsSync(ticketUploadDir)) {
  fs.mkdirSync(ticketUploadDir, { recursive: true });
}
if (!fs.existsSync(kycUploadDir)) {
  fs.mkdirSync(kycUploadDir, { recursive: true });
}

const ticketStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, ticketUploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const original = (file.originalname || 'ticket').replace(/\s+/g, '-');
    const parts = original.split('.');
    const ext = parts.length > 1 ? parts.pop() : (file.mimetype.split('/')[1] || 'bin');
    cb(null, `ticket-${uniqueSuffix}.${ext.toLowerCase().trim()}`);
  }
});

const uploadTicket = multer({
  storage: ticketStorage,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

const kycStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, kycUploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const original = (file.originalname || 'kyc-document').replace(/\s+/g, '-');
    const parts = original.split('.');
    const ext = parts.length > 1 ? parts.pop() : (file.mimetype.split('/')[1] || 'bin');
    cb(null, `kyc-${uniqueSuffix}.${ext.toLowerCase().trim()}`);
  }
});

const uploadKycDocument = multer({
  storage: kycStorage,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

router.get('/', eventsController.getEvents);
router.post('/create', uploadTicket.single('ticket_file'), eventsController.createEvent);
router.post('/unlock', eventsController.unlockEventsByPayment);
router.get('/kyc', eventsController.getEventKyc);
router.post('/kyc', uploadKycDocument.single('identity_document'), eventsController.submitEventKyc);
router.post('/:eventId/rsvp', eventsController.rsvpEvent);

module.exports = router;
