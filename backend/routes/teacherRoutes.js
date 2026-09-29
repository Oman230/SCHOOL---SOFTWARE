// routes/teacherRoutes.js
// All routes here require a valid teacher login token.

const express = require('express');
const router = express.Router();
const { verifyToken, requireTeacher } = require('../middleware/auth');
const {
  getMyProfile,
  getMyClassStudents,
  getAllSubjects,
  getPublicTeachers,
  saveReport,
  getStudentReports,
  createStudentForTeacher,
  deleteStudentForTeacher,
  updateMyProfilePhoto,
  getClassAttendance,
  saveClassAttendance,
} = require('../controllers/teacherController');
const { sendParentNotice } = require('../controllers/emailController');
const { createAssignment, getTeacherAssignments, deleteTeacherAssignment, updateTeacherAssignment } = require('../controllers/assignmentController');

router.get('/public', getPublicTeachers);                                        // GET /api/teachers/public
router.get('/me', verifyToken, requireTeacher, getMyProfile);                    // GET /api/teachers/me
router.put('/me/photo', verifyToken, requireTeacher, updateMyProfilePhoto);      // PUT /api/teachers/me/photo
router.get('/my-class', verifyToken, requireTeacher, getMyClassStudents);        // GET /api/teachers/my-class
router.get('/attendance', verifyToken, requireTeacher, getClassAttendance);
router.put('/attendance', verifyToken, requireTeacher, saveClassAttendance);
router.get('/assignments', verifyToken, requireTeacher, getTeacherAssignments);
router.post('/assignments', verifyToken, requireTeacher, createAssignment);
router.put('/assignments/:id', verifyToken, requireTeacher, updateTeacherAssignment);
router.delete('/assignments/:id', verifyToken, requireTeacher, deleteTeacherAssignment);
router.post('/parent-notices', verifyToken, requireTeacher, sendParentNotice);    // POST /api/teachers/parent-notices
router.get('/subjects', verifyToken, requireTeacher, getAllSubjects);            // GET /api/teachers/subjects
router.post('/students', verifyToken, requireTeacher, createStudentForTeacher);   // POST /api/teachers/students
router.delete('/students/:id', verifyToken, requireTeacher, deleteStudentForTeacher); // DELETE /api/teachers/students/:id
router.post('/reports', verifyToken, requireTeacher, saveReport);                // POST /api/teachers/reports
router.get('/students/:studentId/reports', verifyToken, requireTeacher, getStudentReports); // GET /api/teachers/students/5/reports

module.exports = router;
