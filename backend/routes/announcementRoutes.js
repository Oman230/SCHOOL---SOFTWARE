const express = require('express');
const router = express.Router();
const { getPublicAnnouncements } = require('../controllers/adminController');

router.get('/public', getPublicAnnouncements);

module.exports = router;
