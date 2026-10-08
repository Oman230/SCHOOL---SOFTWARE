const pool = require('../config/db');
require('dotenv').config();

function currentAcademicYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 8 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

async function getStatementData(studentId) {
  const [studentResult, paymentsResult] = await Promise.all([
    pool.query(
      `SELECT s.id, s.student_id_number, s.full_name, s.email, s.parent_name, s.parent_email,
              s.parent_phone, s.total_fees_due, s.amount_paid, c.name AS classroom_name,
              c.level AS classroom_level,
              (SELECT r.academic_year FROM reports r WHERE r.student_id = s.id
               ORDER BY r.created_at DESC LIMIT 1) AS academic_year
       FROM students s
       LEFT JOIN classrooms c ON c.id = s.classroom_id
       WHERE s.id = $1`,
      [studentId]
    ),
    pool.query(
      `SELECT amount, paystack_reference, status, payment_method, academic_year, classroom_name, paid_at
       FROM payments
       WHERE student_id = $1 AND status = 'success'
       ORDER BY paid_at DESC, id DESC`,
      [studentId]
    ),
  ]);

  if (!studentResult.rows.length) return null;

  const student = studentResult.rows[0];
  const amountDue = Math.max(0, Number(student.total_fees_due || 0));
  const amountPaid = Math.max(0, Number(student.amount_paid || 0));

  return {
    school: {
      name: process.env.SCHOOL_NAME || 'Sunrise International School',
      address: process.env.SCHOOL_ADDRESS || '123 Independence Avenue, Accra, Ghana',
      phone: process.env.SCHOOL_PHONE || '+233 20 000 0000',
      email: process.env.SCHOOL_EMAIL || '',
    },
    financeOfficer: process.env.FINANCE_OFFICER_NAME || 'Finance Officer',
    student: {
      ...student,
      academic_year: student.academic_year || currentAcademicYear(),
      amount_due: amountDue,
      amount_paid: amountPaid,
      arrears: Math.max(0, amountDue - amountPaid),
    },
    payments: paymentsResult.rows,
    historyNote: 'Earlier fee balances were not stored by academic year or class. Only recorded payments are shown as historical transactions.',
  };
}

async function getStudentFeeStatement(req, res) {
  try {
    const statement = await getStatementData(req.user.id);
    if (!statement) return res.status(404).json({ message: 'Student not found.' });
    res.json(statement);
  } catch (error) {
    console.error('Student fee statement error:', error);
    res.status(500).json({ message: 'Could not load fee statement.' });
  }
}

async function getAdminStudentFeeStatement(req, res) {
  try {
    const statement = await getStatementData(req.params.id);
    if (!statement) return res.status(404).json({ message: 'Student not found.' });
    res.json(statement);
  } catch (error) {
    console.error('Admin fee statement error:', error);
    res.status(500).json({ message: 'Could not load fee statement.' });
  }
}

module.exports = { getStudentFeeStatement, getAdminStudentFeeStatement, getStatementData, currentAcademicYear };
