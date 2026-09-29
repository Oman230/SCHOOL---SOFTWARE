const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../controllers/adminController');
const authController = require('../controllers/authController');
const teacherController = require('../controllers/teacherController');
const assignmentController = require('../controllers/assignmentController');
const db = require('../config/db');

test('admin exposes subject management APIs', () => {
  assert.equal(typeof admin.getSubjects, 'function');
  assert.equal(typeof admin.createSubject, 'function');
  assert.equal(typeof admin.updateSubject, 'function');
  assert.equal(typeof admin.deleteSubject, 'function');
});

test('admin exposes announcement management APIs for home-page updates', () => {
  assert.equal(typeof admin.getAnnouncements, 'function');
  assert.equal(typeof admin.getPublicAnnouncements, 'function');
  assert.equal(typeof admin.createAnnouncement, 'function');
  assert.equal(typeof admin.updateAnnouncement, 'function');
  assert.equal(typeof admin.deleteAnnouncement, 'function');
});

test('admin exposes student report history needed for trend badges', () => {
  assert.equal(typeof admin.getStudentReports, 'function');
});

test('admin exposes school fee setup needed for class-based term billing', () => {
  assert.equal(typeof admin.getSchoolFees, 'function');
  assert.equal(typeof admin.upsertSchoolFee, 'function');
});

test('student creation payload supports photo uploads', () => {
  const student = {
    studentIdNumber: 'STU-001',
    fullName: 'Jane Doe',
    password: 'secret123',
    photoUrl: 'data:image/png;base64,abc123',
  };

  assert.equal(typeof student.photoUrl, 'string');
  assert.match(student.photoUrl, /^data:image\//);
});

test('teacher student creation supports parent contact and photo fields', () => {
  assert.equal(typeof teacherController.createStudentForTeacher, 'function');

  const studentPayload = {
    studentIdNumber: 'STU-010',
    fullName: 'John Doe',
    email: 'john@example.com',
    password: 'secret123',
    gender: 'Male',
    photoUrl: 'data:image/jpeg;base64,abc',
    parentName: 'Mary Doe',
    parentPhone: '+233500000000',
  };

  assert.equal(studentPayload.parentName, 'Mary Doe');
  assert.equal(studentPayload.parentPhone, '+233500000000');
  assert.match(studentPayload.photoUrl, /^data:image\//);
});

test('teacher signup and student photo upload are exposed as backend actions', () => {
  assert.equal(typeof authController.teacherSignup, 'function');
  assert.equal(typeof require('../controllers/studentController').updateMyProfilePhoto, 'function');
  assert.equal(typeof require('../controllers/teacherController').deleteStudentForTeacher, 'function');
});

test('teacher school email validation enforces the approved institutional domain', () => {
  assert.equal(authController.isValidTeacherEmail('jane.doe@sunriseinternationalschool.edu'), true);
  assert.equal(authController.isValidTeacherEmail('jane@gmail.com'), false);
  assert.equal(authController.isValidTeacherEmail('teacher@sunriseinternationalschool.edu.ng'), false);
});

test('SQLite schema stores profile photos as text', () => {
  const teacherColumns = db.database.pragma('table_info(teachers)');
  const studentColumns = db.database.pragma('table_info(students)');
  assert.equal(teacherColumns.find((column) => column.name === 'photo_url').type, 'TEXT');
  assert.equal(studentColumns.find((column) => column.name === 'photo_url').type, 'TEXT');
});

test('SQLite adapter preserves parameter order, RETURNING rows, JSON, and rollback', async () => {
  const translated = db.prepareQuery(
    'SELECT id FROM students WHERE classroom_id = $1 AND id = ANY($2::int[])',
    [7, [3, 4]]
  );
  assert.equal(translated.sql, 'SELECT id FROM students WHERE classroom_id = ? AND id IN (?, ?)');
  assert.deepEqual(translated.parameters, [7, 3, 4]);

  const client = await db.connect();
  await client.query('BEGIN');
  try {
    const classroom = await client.query(
      'INSERT INTO classrooms (name, level) VALUES ($1, $2) RETURNING id',
      ['Test class', 'Test level']
    );
    const teacher = await client.query(
      'INSERT INTO teachers (full_name, email, password_hash, classroom_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Test teacher', 'sqlite-test@example.invalid', 'hash', classroom.rows[0].id]
    );
    const assignment = await client.query(
      'INSERT INTO assignments (teacher_id, classroom_id, title, content_html, attachments) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING attachments',
      [teacher.rows[0].id, classroom.rows[0].id, 'Test work', '<p>Read</p>', '[{"name":"work.pdf"}]']
    );
    assert.deepEqual(assignment.rows[0].attachments, [{ name: 'work.pdf' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('assignment content removes executable HTML', () => {
  const safeContent = assignmentController.sanitizeAssignmentContent('<p>Read this</p><script>alert(1)</script><strong>carefully</strong>');
  assert.equal(safeContent.includes('<script>'), false);
  assert.match(safeContent, /<strong>carefully<\/strong>/);
});

test('assignment uploads reject unsupported file types', () => {
  assert.throws(
    () => assignmentController.parseAttachments([{ name: 'script.exe', type: 'application/octet-stream', data: 'data:application/octet-stream;base64,ZmFrZQ==' }]),
    /Only PDF, PNG, JPG, GIF, and WEBP assignment files are allowed/
  );
});

test('teacher assignment removal is scoped to the assigned classroom', async () => {
  const originalQuery = db.query;
  let deleteQuery = '';
  let responseBody;
  let responseStatus = 200;

  db.query = async (query, values) => {
    deleteQuery = query;
    assert.deepEqual(values, [42, 7]);
    return { rows: [{ id: 42 }] };
  };

  const response = {
    status(code) {
      responseStatus = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  try {
    await assignmentController.deleteTeacherAssignment(
      { params: { id: '42' }, user: { id: 7 } },
      response
    );
  } finally {
    db.query = originalQuery;
  }

  assert.match(deleteQuery, /classroom_id = \(SELECT classroom_id FROM teachers WHERE id = \$2\)/i);
  assert.doesNotMatch(deleteQuery, /teacher_id\s*=/i);
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.assignmentId, 42);
});

test('teacher assignment edits are classroom-scoped and preserve attachments by default', async () => {
  const originalQuery = db.query;
  let updateQuery = '';
  let updateValues = [];
  let responseBody;

  db.query = async (query, values) => {
    updateQuery = query;
    updateValues = values;
    return { rows: [{ id: 42, title: values[2], content_html: values[3] }] };
  };

  const response = {
    status() { return this; },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  try {
    await assignmentController.updateTeacherAssignment({
      params: { id: '42' },
      user: { id: 7 },
      body: { title: 'Updated work', contentHtml: '<p>Read chapter four.</p>', dueDate: '' },
    }, response);
  } finally {
    db.query = originalQuery;
  }

  assert.match(updateQuery, /classroom_id = \(SELECT classroom_id FROM teachers WHERE id = \$2\)/i);
  assert.doesNotMatch(updateQuery, /teacher_id\s*=/i);
  assert.equal(updateValues[5], false);
  assert.equal(updateValues[6], '[]');
  assert.equal(responseBody.assignment.title, 'Updated work');
});
