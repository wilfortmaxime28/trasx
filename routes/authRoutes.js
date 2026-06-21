const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);

router.get('/verify', authController.getVerify);
router.post('/verify', authController.postVerify);
router.get('/terms', authController.getTerms);

router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);
router.post('/dispute', authController.postDispute);
router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', authController.postForgotPassword);
router.post('/forgot-password/reset', authController.postResetPassword);

router.get('/check-username', authController.checkUsername);

router.get('/logout', authController.logout);

module.exports = router;
