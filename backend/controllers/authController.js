// controllers/authController.js
// Handles logging in for BOTH students and teachers.
// Students log in with their student ID number + password.
// Teachers log in with their email + password.

const jwt = require('jsonwebtoken');  // for creating login tokens
const fs = require('fs');
const pool = require('../config/db'); // our shared database connection
const { hashPassword, verifyPassword, validatePassword } = require('../security/passwords');
require('dotenv').config();

const ALLOWED_TEACHER_EMAIL_DOMAIN = '@sunriseinternationalschool.edu';

function isValidTeacherEmail(email) {
  if (typeof email !== 'string') {
    return false;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(ALLOWED_TEACHER_EMAIL_DOMAIN);
}

// ---------------------------------------------------------------
// STUDENT LOGIN
// ---------------------------------------------------------------
async function studentLogin(req, res) {
  try {
    const { studentIdNumber, password } = req.body; // data sent from the login form

    // Basic validation — make sure both fields were actually submitted
    if (!studentIdNumber || !password) {
      return res.status(400).json({ message: 'Please provide your student ID and password.' });
    }

    // Look up the student by their unique ID number
    const result = await pool.query(
      'SELECT * FROM students WHERE student_id_number = $1',
      [studentIdNumber]
    );

    // No student found with that ID
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid student ID or password.' });
    }

    const student = result.rows[0]; // the matching student record

    // Compare the submitted password with the stored hashed password
    const passwordMatches = await verifyPassword(password, student.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid student ID or password.' });
    }

    // Create a signed token containing the student's id and role.
    // This token will be sent with every future request to prove who they are.
    const token = jwt.sign(
      { id: student.id, role: 'student' },
      process.env.JWT_SECRET,
      { expiresIn: '12h', algorithm: 'HS256' } // token expires after 12 hours, so they'll need to log in again
    );

    // Send the token and a few basic details back to the browser
    res.json({
      message: 'Login successful',
      token,
      user: { id: student.id, name: student.full_name, role: 'student' },
    });
  } catch (error) {
    console.error('Student login error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
}

// ---------------------------------------------------------------
// TEACHER LOGIN
// ---------------------------------------------------------------
async function teacherLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide your email and password.' });
    }

    // Look up the teacher by email
    const result = await pool.query('SELECT * FROM teachers WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const teacher = result.rows[0];

    // Check the password against the stored hash
    const passwordMatches = await verifyPassword(password, teacher.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Sign a token for the teacher
    const token = jwt.sign(
      { id: teacher.id, role: 'teacher' },
      process.env.JWT_SECRET,
      { expiresIn: '12h', algorithm: 'HS256' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: teacher.id, name: teacher.full_name, role: 'teacher' },
    });
  } catch (error) {
    console.error('Teacher login error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
}

async function teacherSignup(req, res) {
  try {
    const { fullName, email, password, phone, photoUrl } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Full name, email, and password are required.' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    if (!isValidTeacherEmail(email)) {
      return res.status(400).json({
        message: `Use a school email ending with ${ALLOWED_TEACHER_EMAIL_DOMAIN}.`,
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const trimmedName = String(fullName).trim();

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO teachers (full_name, email, password_hash, phone, photo_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, email, phone, photo_url`,
      [trimmedName, normalizedEmail, passwordHash, phone || null, photoUrl || null]
    );

    const teacher = result.rows[0];
    const token = jwt.sign(
      { id: teacher.id, role: 'teacher' },
      process.env.JWT_SECRET,
      { expiresIn: '12h', algorithm: 'HS256' }
    );

    res.status(201).json({
      message: 'Teacher account created successfully.',
      token,
      user: { id: teacher.id, name: teacher.full_name, role: 'teacher' },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'A teacher with that email already exists.' });
    }
    console.error('Teacher signup error:', error);
    res.status(500).json({ message: 'Could not create teacher account.' });
  }
}

// ---------------------------------------------------------------
// ADMIN LOGIN
// ---------------------------------------------------------------
async function adminLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide your email and password.' });
    }

    const result = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const admin = result.rows[0];

    const passwordMatches = await verifyPassword(password, admin.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: admin.id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '12h', algorithm: 'HS256' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: admin.id, name: admin.full_name, role: 'admin' },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
}

async function setupInitialAdmin(req, res) {
  if (process.env.ELECTRON_APP !== 'true') {
    return res.status(404).json({ message: 'Admin setup is only available in the desktop app.' });
  }

  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  if (!fullName || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    return res.status(400).json({ message: 'Enter your name, a valid email address, and a password.' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    const existingAdmins = await client.query('SELECT id, email FROM admins');
    const isLegacyAdminReplacement = process.env.ELECTRON_LEGACY_ADMIN_SETUP === 'true'
      && existingAdmins.rows.length === 1
      && existingAdmins.rows[0].email === 'admin@localhost';
    if (existingAdmins.rows.length > 0 && !isLegacyAdminReplacement) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ message: 'An administrator account already exists.' });
    }

    const passwordHash = await hashPassword(password);
    const result = isLegacyAdminReplacement
      ? await client.query(
        'UPDATE admins SET full_name = $1, email = $2, password_hash = $3 WHERE id = $4 RETURNING id, full_name',
        [fullName, email, passwordHash, existingAdmins.rows[0].id]
      )
      : await client.query(
        'INSERT INTO admins (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name',
        [fullName, email, passwordHash]
      );
    await client.query('COMMIT');
    transactionStarted = false;
    if (isLegacyAdminReplacement) {
      process.env.ELECTRON_LEGACY_ADMIN_SETUP = 'false';
      if (process.env.ELECTRON_LEGACY_ADMIN_CREDENTIALS_PATH) {
        fs.rmSync(process.env.ELECTRON_LEGACY_ADMIN_CREDENTIALS_PATH, { force: true });
      }
    }
    const admin = result.rows[0];
    const token = jwt.sign(
      { id: admin.id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '12h', algorithm: 'HS256' }
    );
    return res.status(isLegacyAdminReplacement ? 200 : 201).json({
      message: isLegacyAdminReplacement ? 'Administrator login updated.' : 'Administrator account created.',
      token,
      user: { id: admin.id, name: admin.full_name, role: 'admin' },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Admin setup rollback failed:', rollbackError);
      }
    }
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
      return res.status(409).json({ message: 'An administrator with that email already exists.' });
    }
    console.error('Initial admin setup failed:', error);
    return res.status(500).json({ message: 'Could not create the administrator account.' });
  } finally {
    client?.release();
  }
}

module.exports = { studentLogin, teacherLogin, teacherSignup, adminLogin, setupInitialAdmin, isValidTeacherEmail };
