const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const admin = require('../controllers/adminController');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('cash payment rejects zero and invalid amounts before opening a transaction', async () => {
  const originalConnect = pool.connect;
  let connected = false;
  pool.connect = async () => {
    connected = true;
    throw new Error('Unexpected database connection.');
  };

  try {
    for (const amount of [0, -2, 'not-an-amount', 10.123]) {
      const response = createResponse();
      await admin.recordCashPayment({ body: { amount }, params: { id: '4' } }, response);
      assert.equal(response.statusCode, 400);
    }
    assert.equal(connected, false);
  } finally {
    pool.connect = originalConnect;
  }
});

test('cash payment records a successful cash transaction and increments the student balance atomically', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  pool.connect = async () => ({
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('FROM students s')) {
        return {
          rows: [{
            id: 4,
            total_fees_due: 300,
            amount_paid: 40,
            classroom_name: 'Primary 2A',
            academic_year: '2026/2027',
          }],
        };
      }
      if (sql.startsWith('INSERT INTO payments')) {
        return {
          rows: [{
            id: 15,
            amount: values[1],
            paystack_reference: values[2],
            status: 'success',
            payment_method: 'cash',
            academic_year: values[3],
            classroom_name: values[4],
            paid_at: '2026-10-08T12:00:00.000Z',
          }],
        };
      }
      if (sql.startsWith('UPDATE students')) {
        return { rows: [{ total_fees_due: 300, amount_paid: 90 }] };
      }
      return { rows: [] };
    },
    release() {
      queries.push({ sql: 'RELEASE' });
    },
  });

  try {
    const response = createResponse();
    await admin.recordCashPayment({ body: { amount: 50 }, params: { id: '4' } }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.student.amount_paid, 90);
    assert.equal(response.body.student.arrears, 210);
    assert.equal(response.body.payment.payment_method, 'cash');
    assert.equal(response.body.payment.academic_year, '2026/2027');
    assert.equal(response.body.payment.classroom_name, 'Primary 2A');
    assert.match(response.body.payment.paystack_reference, /^CASH-/);
    assert.equal(queries[0].sql, 'BEGIN');
    assert.equal(queries.at(-2).sql, 'COMMIT');
  } finally {
    pool.connect = originalConnect;
  }
});
