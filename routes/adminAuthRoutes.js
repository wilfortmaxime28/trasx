const express = require('express');
const router = express.Router();
const adminAuthController = require('../controllers/adminAuthController');

// Secret admin login route
router.get('/', adminAuthController.getLogin);
router.post('/', adminAuthController.postLogin);
router.get('/logout', adminAuthController.logout);

module.exports = router;