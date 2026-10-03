// routes/adminRoutes.js
// Every route here requires a valid admin login token.

const express = require('express');
const router = express.Router();
const { verifyToken, requireAdmin } = require('../middleware/auth');
const admin = require('../controllers/adminController');
const admission = require('../controllers/admissionController');
const { sendParentNotice } = require('../controllers/emailController');
const backup = require('../controllers/backupController');

// All routes below run verifyToken + requireAdmin first
router.use(verifyToken, requireAdmin);

router.get('/backup', backup.exportDatabase);
router.post('/backup', express.raw({ type: 'application/octet-stream', limit: '512mb' }), backup.importDatabase);

router.get('/stats', admin.getStats); // GET /api/admin/stats
router.post('/parent-notices', sendParentNotice);

// Admission applications
router.get('/admissions', admission.getAdmissionApplications);
router.get('/admissions/:id/pdf', admission.getAdmissionApplicationPdf);
router.patch('/admissions/:id/status', admission.updateAdmissionStatus);
router.delete('/admissions/:id', admission.deleteAdmissionApplication);

// Classrooms
router.get('/classrooms', admin.getClassrooms);        // GET    /api/admin/classrooms
router.post('/classrooms', admin.createClassroom);      // POST   /api/admin/classrooms
router.delete('/classrooms/:id', admin.deleteClassroom); // DELETE /api/admin/classrooms/5

// Teachers
router.get('/teachers', admin.getTeachers);          // GET    /api/admin/teachers
router.post('/teachers', admin.createTeacher);        // POST   /api/admin/teachers
router.put('/teachers/:id', admin.updateTeacher);     // PUT    /api/admin/teachers/5
router.delete('/teachers/:id', admin.deleteTeacher);  // DELETE /api/admin/teachers/5

// Students
router.get('/students', admin.getStudents);          // GET    /api/admin/students
router.get('/students/:id/reports', admin.getStudentReports); // GET /api/admin/students/5/reports
router.post('/students', admin.createStudent);        // POST   /api/admin/students
router.put('/students/:id', admin.updateStudent);     // PUT    /api/admin/students/5
router.delete('/students/:id', admin.deleteStudent);  // DELETE /api/admin/students/5

// Announcements
router.get('/announcements', admin.getAnnouncements);             // GET /api/admin/announcements
router.post('/announcements', admin.createAnnouncement);         // POST /api/admin/announcements
router.put('/announcements/:id', admin.updateAnnouncement);      // PUT /api/admin/announcements/5
router.delete('/announcements/:id', admin.deleteAnnouncement);    // DELETE /api/admin/announcements/5

// School fees
router.get('/school-fees', admin.getSchoolFees);             // GET /api/admin/school-fees
router.post('/school-fees', admin.upsertSchoolFee);          // POST /api/admin/school-fees

// Subjects
router.get('/subjects', admin.getSubjects);           // GET    /api/admin/subjects
router.post('/subjects', admin.createSubject);        // POST   /api/admin/subjects
router.put('/subjects/:id', admin.updateSubject);      // PUT    /api/admin/subjects/5
router.delete('/subjects/:id', admin.deleteSubject);   // DELETE /api/admin/subjects/5

module.exports = router;
