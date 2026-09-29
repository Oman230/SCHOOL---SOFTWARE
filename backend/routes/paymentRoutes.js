// routes/paymentRoutes.js
// Fee payment routes — only logged-in students can start/verify a payment.

const express = require('express');
const router = express.Router();
const { verifyToken, requireStudent } = require('../middleware/auth');
const {
  initializePayment,
  verifyPayment,
  getPaymentHistory,
  getPaymentReceiptPdf,
  handlePaystackWebhook,
} = require('../controllers/paymentController');

router.post('/webhook', handlePaystackWebhook);                                     // POST /api/payments/webhook
router.post('/initialize', verifyToken, requireStudent, initializePayment);        // POST /api/payments/initialize
router.get('/verify/:reference', verifyToken, requireStudent, verifyPayment);      // GET /api/payments/verify/:reference
router.get('/history', verifyToken, requireStudent, getPaymentHistory);            // GET /api/payments/history
router.get('/receipt/:paymentId/pdf', verifyToken, requireStudent, getPaymentReceiptPdf);

module.exports = router;
