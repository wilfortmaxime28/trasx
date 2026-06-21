const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/', settingsController.getSettings);
router.post('/language', settingsController.updateLanguage);
router.post('/token-swap', settingsController.swapDepositToTokens);
router.post('/premium/preferences', settingsController.updatePremiumPreferences);
router.post('/premium/kyc', settingsController.requestKyc);

module.exports = router;
