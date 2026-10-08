const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const feeStatements = require('../controllers/feeStatementController');

test('fee statement reports current balance and keeps unrecorded legacy history explicit', async () => {
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    if (sql.includes('FROM payments')) {
      return {
        rows: [{
          amount: 100,
          paystack_reference: 'ref-1',
          status: 'success',
          academic_year: null,
          classroom_name: null,
          paid_at: '2025-04-10T00:00:00.000Z',
        }],
      };
    }
    return {
      rows: [{
        id: 12,
        student_id_number: 'SIS-2026-001',
        full_name: 'Test Student',
        parent_name: 'Parent',
        parent_phone: '0200000000',
        total_fees_due: 500,
        amount_paid: 100,
        classroom_name: 'Primary 1A',
        classroom_level: 'Primary 1',
        academic_year: '2025/2026',
      }],
    };
  };

  try {
    const statement = await feeStatements.getStatementData(12);
    assert.equal(statement.student.arrears, 400);
    assert.equal(statement.student.academic_year, '2025/2026');
    assert.equal(statement.payments[0].academic_year, null);
    assert.match(statement.historyNote, /not stored by academic year or class/);
  } finally {
    pool.query = originalQuery;
  }
});

test('academic year fallback follows the September school-year boundary', () => {
  assert.equal(feeStatements.currentAcademicYear(new Date(2026, 8, 1)), '2026/2027');
  assert.equal(feeStatements.currentAcademicYear(new Date(2026, 7, 31)), '2025/2026');
});
