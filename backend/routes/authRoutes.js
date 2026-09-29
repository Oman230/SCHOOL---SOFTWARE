// routes/authRoutes.js
// Defines the URL paths for logging in. No token is needed to reach these,
// since logging in is how you GET a token in the first place.

const express = require('express');
const router = express.Router(); // a mini, self-contained router we'll attach to the main app
const { studentLogin, teacherLogin, teacherSignup, adminLogin } = require('../controllers/authController');

router.post('/student-login', studentLogin); // POST /api/auth/student-login
router.post('/teacher-login', teacherLogin); // POST /api/auth/teacher-login
router.post('/teacher-signup', teacherSignup); // POST /api/auth/teacher-signup
router.post('/admin-login', adminLogin);     // POST /api/auth/admin-login

module.exports = router;
