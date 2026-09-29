const express = require('express');
const router = express.Router();
const { verifyToken, requireAdmin } = require('../middleware/auth');
const admission = require('../controllers/admissionController');

router.post('/', admission.submitAdmission);
router.get('/reference/:applicationNumber/pdf', admission.getPublicAdmissionApplicationPdf);
router.get('/', verifyToken, requireAdmin, admission.getAdmissionApplications);
router.get('/:id/pdf', verifyToken, requireAdmin, admission.getAdmissionApplicationPdf);
router.patch('/:id/status', verifyToken, requireAdmin, admission.updateAdmissionStatus);

module.exports = router;
