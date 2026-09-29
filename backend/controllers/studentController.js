// controllers/studentController.js
// Everything a logged-in STUDENT can see on their own dashboard/profile:
// their classroom, level, fee balance, and list of report cards.

const pool = require('../config/db');

function isValidImageDataUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return false;
  }

  const [, encoded] = trimmed.split(',', 2);
  if (!encoded) {
    return false;
  }

  try {
    const binary = Buffer.from(encoded, 'base64');
    if (binary.length < 16) {
      return false;
    }

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff]);
    const gifHeader87a = Buffer.from('GIF87a');
    const gifHeader89a = Buffer.from('GIF89a');

    if (trimmed.toLowerCase().startsWith('data:image/png')) {
      return binary.subarray(0, 8).equals(pngHeader);
    }
    if (trimmed.toLowerCase().startsWith('data:image/jpeg')) {
      return binary.subarray(0, 3).equals(jpegHeader);
    }
    if (trimmed.toLowerCase().startsWith('data:image/gif')) {
      return binary.subarray(0, 6).equals(gifHeader87a) || binary.subarray(0, 6).equals(gifHeader89a);
    }
    if (trimmed.toLowerCase().startsWith('data:image/webp')) {
      return binary.subarray(0, 4).equals(Buffer.from('RIFF')) && binary.subarray(8, 12).equals(Buffer.from('WEBP'));
    }
  } catch (error) {
    return false;
  }

  return false;
}

function normalizePhotoUrl(photoUrl) {
  if (!isValidImageDataUrl(photoUrl)) {
    return null;
  }
  return photoUrl.trim();
}

// ---------------------------------------------------------------
// GET /api/students/me
// Returns the logged-in student's full profile + classroom + fee info
// ---------------------------------------------------------------
async function getMyProfile(req, res) {
  try {
    const studentId = req.user.id; // came from the verified JWT token

    // Join students with classrooms so we get the class name/level in one query
    const result = await pool.query(
            `SELECT s.id, s.student_id_number, s.full_name, s.email, s.date_of_birth,
              s.gender, s.photo_url, s.parent_name, s.parent_email, s.parent_phone,
              s.total_fees_due, s.amount_paid,
              c.name AS classroom_name, c.level AS classroom_level
       FROM students s
       LEFT JOIN classrooms c ON s.classroom_id = c.id
       WHERE s.id = $1`,
      [studentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const student = result.rows[0];

    // Calculate the outstanding balance so the frontend doesn't have to
    const balance = Number(student.total_fees_due) - Number(student.amount_paid);

    student.photo_url = normalizePhotoUrl(student.photo_url) || null;

    res.json({
      ...student,
      balance: balance > 0 ? balance : 0, // never show a negative balance
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Could not load profile.' });
  }
}

// ---------------------------------------------------------------
// GET /api/students/me/reports
// Returns a list of all report cards (terms/years) available for this student
// ---------------------------------------------------------------
async function getMyReports(req, res) {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT id, academic_year, term, created_at
       FROM reports
       WHERE student_id = $1
       ORDER BY created_at DESC`,
      [studentId]
    );

    res.json(result.rows); // send back an array of report summaries
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ message: 'Could not load reports.' });
  }
}

async function updateMyProfilePhoto(req, res) {
  try {
    const { photoUrl } = req.body;
    const safePhotoUrl = normalizePhotoUrl(photoUrl);

    if (!safePhotoUrl) {
      return res.status(400).json({ message: 'Please upload a valid image file.' });
    }

    const result = await pool.query(
      'UPDATE students SET photo_url = $1 WHERE id = $2 RETURNING id, full_name, photo_url',
      [safePhotoUrl, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    res.json({ message: 'Profile photo updated.', student: result.rows[0] });
  } catch (error) {
    console.error('Update student photo error:', error);
    res.status(500).json({ message: 'Could not update profile photo.' });
  }
}

async function getMyAttendance(req, res) {
  try {
    const result = await pool.query(
      `SELECT attendance_date, status, notes
       FROM attendance_records
       WHERE student_id = $1
       ORDER BY attendance_date DESC
       LIMIT 60`,
      [req.user.id]
    );

    const counts = result.rows.reduce((summary, record) => {
      summary[record.status] = (summary[record.status] || 0) + 1;
      return summary;
    }, { present: 0, absent: 0, late: 0, excused: 0 });

    res.json({ records: result.rows, counts });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ message: 'Could not load attendance.' });
  }
}

module.exports = { getMyProfile, getMyReports, updateMyProfilePhoto, getMyAttendance };
