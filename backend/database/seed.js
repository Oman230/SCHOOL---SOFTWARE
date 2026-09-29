// database/seed.js
// Run this once after creating the schema to add a sample admin, teacher,
// and student so you have working logins to test with:
//   node backend/database/seed.js
//
// Sample admin login:   admin@school.com     / password123
// Sample teacher login: teacher@school.com   / password123
// Sample student login: SIS-2026-001         / password123

const pool = require('../config/db');
const { hashPassword } = require('../security/passwords');

async function seed() {
  try {
    // Hash the shared test password once (never store plain-text passwords)
    const passwordHash = await hashPassword('password123');

    // Create a sample admin account
    await pool.query(
      `INSERT INTO admins (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      ['Head Administrator', 'admin@school.com', passwordHash]
    );

    // Create a sample teacher assigned to classroom id 1 (JHS 1A, from schema.sql)
    await pool.query(
      `INSERT INTO teachers (full_name, email, password_hash, phone, classroom_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      ['Mrs. Ama Boateng', 'teacher@school.com', passwordHash, '+233241234567', 1]
    );

    // Create a sample student in the same classroom
    await pool.query(
      `INSERT INTO students
        (student_id_number, full_name, email, password_hash, date_of_birth, gender, classroom_id, total_fees_due, amount_paid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (student_id_number) DO NOTHING`,
      ['SIS-2026-001', 'Kwame Mensah', 'kwame.mensah@example.com', passwordHash, '2012-05-14', 'Male', 1, 1500.00, 0]
    );

    console.log('✅ Sample admin, teacher, and student created successfully.');
    console.log('   Admin login   -> email: admin@school.com   | password: password123');
    console.log('   Teacher login -> email: teacher@school.com | password: password123');
    console.log('   Student login -> ID: SIS-2026-001           | password: password123');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    await pool.end(); // close the database connection so the script exits cleanly
  }
}

seed();
