// routes/studentRoutes.js
// All routes here require a valid student login token (see the middleware below).

const express = require('express');
const router = express.Router();
const { verifyToken, requireStudent } = require('../middleware/auth');
const { getMyProfile, getMyReports, updateMyProfilePhoto, getMyAttendance } = require('../controllers/studentController');
const { getStudentAssignments } = require('../controllers/assignmentController');

// Every route below first checks the token is valid, THEN checks the role is "student"
router.get('/me', verifyToken, requireStudent, getMyProfile);          // GET /api/students/me
router.get('/me/reports', verifyToken, requireStudent, getMyReports);  // GET /api/students/me/reports
router.put('/me/photo', verifyToken, requireStudent, updateMyProfilePhoto); // PUT /api/students/me/photo
router.get('/me/attendance', verifyToken, requireStudent, getMyAttendance);
router.get('/me/assignments', verifyToken, requireStudent, getStudentAssignments);

module.exports = router;
