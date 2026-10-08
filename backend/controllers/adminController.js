// controllers/adminController.js
// Everything a logged-in ADMIN can do: see overview stats, and create/view/
// edit/delete classrooms, teachers, and students — this is what replaces
// having to run raw SQL to add new people to the system.

const pool = require('../config/db');
const crypto = require('crypto');
const { hashPassword, validatePassword } = require('../security/passwords');
const { generateStudentId } = require('../security/studentIds');

function currentAcademicYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 8 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

// ---------------------------------------------------------------
// GET /api/admin/stats — quick numbers for the top of the admin dashboard
// ---------------------------------------------------------------
function normalizeSchoolLevel(rawLevel) {
  const level = String(rawLevel || '').trim();
  const normalized = level.toLowerCase().replace(/[_-]+/g, ' ');

  if (!normalized) return '';
  if (normalized.includes('creche') || normalized.includes('crèche')) return 'Creche';
  if (normalized.includes('kindergarten') || normalized.includes('kinder') || normalized.includes('kingdagaten')) return 'Kindergarten';
  if (normalized.includes('primary') || normalized.includes('basic')) return 'Primary';
  if (normalized.includes('jhs') || normalized.includes('junior high') || normalized.includes('middle school')) return 'JHS';

  return level;
}

async function getStats(req, res) {
  try {
    // Run all the count queries at the same time instead of one after another
    const [studentCount, teacherCount, classroomCount, feesResult] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM students'),
      pool.query('SELECT COUNT(*) FROM teachers'),
      pool.query('SELECT COUNT(*) FROM classrooms'),
      pool.query('SELECT COALESCE(SUM(amount_paid), 0) AS total_paid, COALESCE(SUM(total_fees_due), 0) AS total_due FROM students'),
    ]);

    res.json({
      totalStudents: Number(studentCount.rows[0].count),
      totalTeachers: Number(teacherCount.rows[0].count),
      totalClassrooms: Number(classroomCount.rows[0].count),
      totalFeesCollected: Number(feesResult.rows[0].total_paid),
      totalFeesExpected: Number(feesResult.rows[0].total_due),
    });
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({ message: 'Could not load dashboard stats.' });
  }
}

async function getSchoolFees(req, res) {
  try {
    const result = await pool.query(
      'SELECT school_level, term, amount, updated_at FROM school_fees ORDER BY school_level ASC, term ASC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get school fees error:', error);
    res.status(500).json({ message: 'Could not load school fees.' });
  }
}

async function upsertSchoolFee(req, res) {
  try {
    const { schoolLevel, term, amount } = req.body;
    const normalizedLevel = normalizeSchoolLevel(schoolLevel);
    const normalizedTerm = String(term || '').trim();
    const numericAmount = Number(amount);

    if (!normalizedLevel) {
      return res.status(400).json({ message: 'Please choose a valid school level.' });
    }

    if (!normalizedTerm) {
      return res.status(400).json({ message: 'Please choose a term.' });
    }

    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      return res.status(400).json({ message: 'Fee amount must be zero or greater.' });
    }

    const feeResult = await pool.query(
      `INSERT INTO school_fees (school_level, term, amount, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_level, term)
       DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING school_level, term, amount, updated_at`,
      [normalizedLevel, normalizedTerm, numericAmount, req.user?.id || null]
    );

    const matchingStudents = await pool.query(
      `SELECT s.id
       FROM students s
       JOIN classrooms c ON c.id = s.classroom_id
       WHERE LOWER(COALESCE(c.level, '')) LIKE '%' || LOWER($1) || '%'
          OR LOWER(COALESCE(c.name, '')) LIKE '%' || LOWER($1) || '%'`,
      [normalizedLevel]
    );

    for (const student of matchingStudents.rows) {
      await pool.query('UPDATE students SET total_fees_due = $1 WHERE id = $2', [numericAmount, student.id]);
    }

    res.status(200).json({
      message: 'School fee updated for this level and term.',
      fee: feeResult.rows[0],
      updatedStudents: matchingStudents.rowCount,
    });
  } catch (error) {
    console.error('Upsert school fee error:', error);
    res.status(500).json({ message: 'Could not save school fee schedule.' });
  }
}

// =================================================================
// CLASSROOMS
// =================================================================

async function getClassrooms(req, res) {
  try {
    const result = await pool.query('SELECT * FROM classrooms ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get classrooms error:', error);
    res.status(500).json({ message: 'Could not load classrooms.' });
  }
}

async function createClassroom(req, res) {
  try {
    const { name, level } = req.body;
    if (!name || !level) {
      return res.status(400).json({ message: 'Please provide both a class name and level.' });
    }
    const result = await pool.query(
      'INSERT INTO classrooms (name, level) VALUES ($1, $2) RETURNING *',
      [name, level]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create classroom error:', error);
    res.status(500).json({ message: 'Could not create classroom.' });
  }
}

async function deleteClassroom(req, res) {
  try {
    await pool.query('DELETE FROM classrooms WHERE id = $1', [req.params.id]);
    res.json({ message: 'Classroom deleted.' });
  } catch (error) {
    // Deleting will fail if students/teachers still reference this classroom —
    // that's Postgres protecting your data, so we explain it clearly here.
    console.error('Delete classroom error:', error);
    res.status(400).json({ message: 'Could not delete classroom — make sure no students or teachers are still assigned to it.' });
  }
}

// =================================================================
// TEACHERS
// =================================================================

async function getTeachers(req, res) {
  try {
    const result = await pool.query(
      `SELECT t.id, t.full_name, t.email, t.phone, c.name AS classroom_name
       FROM teachers t LEFT JOIN classrooms c ON t.classroom_id = c.id
       ORDER BY t.full_name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ message: 'Could not load teachers.' });
  }
}

async function createTeacher(req, res) {
  try {
    const { fullName, email, password, phone, classroomId } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Full name, email, and password are required.' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    // Hash the password the admin chose before storing it — never store plain text
    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO teachers (full_name, email, password_hash, phone, classroom_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, email, phone`,
      [fullName, email, passwordHash, phone || null, classroomId || null]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      // Postgres's "unique violation" error code — this email is already taken
      return res.status(400).json({ message: 'A teacher with that email already exists.' });
    }
    console.error('Create teacher error:', error);
    res.status(500).json({ message: 'Could not create teacher.' });
  }
}

async function updateTeacher(req, res) {
  try {
    const { fullName, phone, classroomId } = req.body;
    await pool.query(
      'UPDATE teachers SET full_name = $1, phone = $2, classroom_id = $3 WHERE id = $4',
      [fullName, phone || null, classroomId || null, req.params.id]
    );
    res.json({ message: 'Teacher updated.' });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ message: 'Could not update teacher.' });
  }
}

async function deleteTeacher(req, res) {
  try {
    await pool.query('DELETE FROM teachers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Teacher deleted.' });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({ message: 'Could not delete teacher.' });
  }
}

// =================================================================
// STUDENTS
// =================================================================

async function getStudents(req, res) {
  try {
    const result = await pool.query(
            `SELECT s.id, s.student_id_number, s.full_name, s.email, s.gender, s.photo_url,
              s.total_fees_due, s.amount_paid, c.name AS classroom_name, c.level AS classroom_level
       FROM students s LEFT JOIN classrooms c ON s.classroom_id = c.id
       ORDER BY s.full_name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ message: 'Could not load students.' });
  }
}

async function getStudentReports(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, academic_year, term, created_at
       FROM reports WHERE student_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get student reports error:', error);
    res.status(500).json({ message: 'Could not load this student\'s reports.' });
  }
}

async function recordCashPayment(req, res) {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    return res.status(400).json({ message: 'Enter a cash payment greater than zero with no more than two decimal places.' });
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const studentResult = await client.query(
      `SELECT s.id, s.total_fees_due, s.amount_paid, c.name AS classroom_name,
              (SELECT r.academic_year FROM reports r WHERE r.student_id = s.id
               ORDER BY r.created_at DESC LIMIT 1) AS academic_year
       FROM students s
       LEFT JOIN classrooms c ON c.id = s.classroom_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!studentResult.rows.length) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ message: 'Student not found.' });
    }

    const student = studentResult.rows[0];
    const year = student.academic_year || currentAcademicYear();
    const reference = `CASH-${Date.now()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const paymentResult = await client.query(
      `INSERT INTO payments
        (student_id, amount, paystack_reference, status, payment_method, academic_year, classroom_name)
       VALUES ($1, $2, $3, 'success', 'cash', $4, $5)
       RETURNING id, amount, paystack_reference, status, payment_method, academic_year, classroom_name, paid_at`,
      [req.params.id, amount, reference, year, student.classroom_name || null]
    );
    const updatedStudent = await client.query(
      `UPDATE students SET amount_paid = COALESCE(amount_paid, 0) + $1
       WHERE id = $2
       RETURNING total_fees_due, amount_paid`,
      [amount, req.params.id]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    const amountDue = Number(updatedStudent.rows[0].total_fees_due || 0);
    const amountPaid = Number(updatedStudent.rows[0].amount_paid || 0);
    res.status(201).json({
      message: `Cash payment of GHS ${amount.toFixed(2)} recorded.`,
      payment: paymentResult.rows[0],
      student: {
        amount_due: amountDue,
        amount_paid: amountPaid,
        arrears: Math.max(0, amountDue - amountPaid),
      },
    });
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    console.error('Record cash payment error:', error);
    res.status(500).json({ message: 'Could not record cash payment.' });
  } finally {
    client.release();
  }
}

async function createStudent(req, res) {
  try {
    const {
      fullName, email, password,
      dateOfBirth, gender, classroomId, totalFeesDue, photoUrl, parentName, parentEmail, parentPhone,
    } = req.body;

    if (!fullName || !password) {
      return res.status(400).json({ message: 'Full name and password are required.' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const passwordHash = await hashPassword(password);
    const studentIdNumber = await generateStudentId(pool);

    const result = await pool.query(
      `INSERT INTO students
        (student_id_number, full_name, email, password_hash, date_of_birth, gender, classroom_id, photo_url, parent_name, parent_email, parent_phone, total_fees_due, amount_paid)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0)
       RETURNING id, student_id_number, full_name, photo_url`,
      [
        studentIdNumber, fullName, email || null, passwordHash,
        dateOfBirth || null, gender || null, classroomId || null, photoUrl || null,
        parentName || null, parentEmail || null, parentPhone || null, totalFeesDue || 0,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A student with that email already exists or the generated ID could not be reserved.' });
    }
    console.error('Create student error:', error);
    res.status(500).json({ message: 'Could not create student.' });
  }
}

async function updateStudent(req, res) {
  try {
    const { fullName, classroomId, totalFeesDue, gender, dateOfBirth, photoUrl } = req.body;
    await pool.query(
      `UPDATE students
       SET full_name = $1, classroom_id = $2, total_fees_due = $3, gender = $4, date_of_birth = $5, photo_url = $6
       WHERE id = $7`,
      [fullName, classroomId || null, totalFeesDue, gender || null, dateOfBirth || null, photoUrl || null, req.params.id]
    );
    res.json({ message: 'Student updated.' });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ message: 'Could not update student.' });
  }
}

async function deleteStudent(req, res) {
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    res.json({ message: 'Student deleted.' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ message: 'Could not delete student.' });
  }
}

async function getAnnouncements(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, title, message, created_at FROM announcements ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ message: 'Could not load announcements.' });
  }
}

async function getPublicAnnouncements(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, title, message, created_at FROM announcements ORDER BY created_at DESC LIMIT 5'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get public announcements error:', error);
    res.status(500).json({ message: 'Could not load announcements.' });
  }
}

async function createAnnouncement(req, res) {
  try {
    const { title, message } = req.body;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.status(400).json({ message: 'Title and message are required.' });
    }

    const result = await pool.query(
      'INSERT INTO announcements (title, message) VALUES ($1, $2) RETURNING *',
      [title.trim(), message.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ message: 'Could not create announcement.' });
  }
}

async function updateAnnouncement(req, res) {
  try {
    const { title, message } = req.body;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.status(400).json({ message: 'Title and message are required.' });
    }

    const result = await pool.query(
      'UPDATE announcements SET title = $1, message = $2 WHERE id = $3 RETURNING *',
      [title.trim(), message.trim(), req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Announcement not found.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ message: 'Could not update announcement.' });
  }
}

async function deleteAnnouncement(req, res) {
  try {
    const result = await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Announcement not found.' });
    }
    res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ message: 'Could not delete announcement.' });
  }
}

async function getSubjects(req, res) {
  try {
    const result = await pool.query('SELECT * FROM subjects ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ message: 'Could not load subjects.' });
  }
}

async function createSubject(req, res) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Subject name is required.' });
    }

    const result = await pool.query(
      'INSERT INTO subjects (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A subject with that name already exists.' });
    }
    console.error('Create subject error:', error);
    res.status(500).json({ message: 'Could not create subject.' });
  }
}

async function updateSubject(req, res) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Subject name is required.' });
    }

    const result = await pool.query(
      'UPDATE subjects SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Subject not found.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A subject with that name already exists.' });
    }
    console.error('Update subject error:', error);
    res.status(500).json({ message: 'Could not update subject.' });
  }
}

async function deleteSubject(req, res) {
  try {
    await pool.query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
    res.json({ message: 'Subject deleted.' });
  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(400).json({ message: 'Could not delete this subject because it is linked to report data.' });
  }
}

module.exports = {
  getStats,
  normalizeSchoolLevel,
  getSchoolFees,
  upsertSchoolFee,
  getClassrooms, createClassroom, deleteClassroom,
  getTeachers, createTeacher, updateTeacher, deleteTeacher,
  getStudents, getStudentReports, recordCashPayment, createStudent, updateStudent, deleteStudent,
  getAnnouncements, getPublicAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  getSubjects, createSubject, updateSubject, deleteSubject,
};
