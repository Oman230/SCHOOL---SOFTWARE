// controllers/paymentController.js
// Handles school fee payments through Paystack.
//
// FLOW:
// 1. Student clicks "Pay Fees" on their dashboard.
// 2. Frontend calls POST /api/payments/initialize -> we ask Paystack to start
//    a transaction and get back an "authorization_url".
// 3. Frontend redirects the student to that Paystack checkout page.
// 4. After paying, Paystack redirects back to our site with a "reference".
// 5. Frontend calls GET /api/payments/verify/:reference -> we ask Paystack to
//    confirm the payment really succeeded, then update the student's balance.
//
// We always verify with Paystack's server before trusting a payment —
// never trust the frontend alone, since that could be faked.

const axios = require('axios'); // used to call Paystack's REST API
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { sendEmailToRecipients } = require('./emailController');
const { currentAcademicYear } = require('./feeStatementController');
require('dotenv').config();

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

async function getPaymentSchoolYear(studentId) {
  const result = await pool.query(
    `SELECT c.name AS classroom_name,
            (SELECT r.academic_year FROM reports r WHERE r.student_id = s.id
             ORDER BY r.created_at DESC LIMIT 1) AS academic_year
     FROM students s
     LEFT JOIN classrooms c ON c.id = s.classroom_id
     WHERE s.id = $1`,
    [studentId]
  );
  const context = result.rows[0];
  return {
    academicYear: context?.academic_year || currentAcademicYear(),
    classroomName: context?.classroom_name || null,
  };
}

function buildReceiptPdf(payment, student) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const colors = { navy: '#172554', blue: '#1d4ed8', teal: '#0f766e', gold: '#f59e0b', ink: '#172033', muted: '#64748b', line: '#dbe4f0' };
    const logoPath = require('path').join(__dirname, '..', '..', 'frontend', 'assets', 'logo.png');
    const schoolName = process.env.SCHOOL_NAME || 'Sunrise International School';
    const schoolAddress = process.env.SCHOOL_ADDRESS || '123 School Road, Accra';
    const schoolPhone = process.env.SCHOOL_PHONE || '+233 24 000 0000';

    doc.rect(0, 0, 595, 842).fill('#f8fafc');
    doc.roundedRect(48, 36, 499, 112, 12).fill(colors.navy);
    doc.rect(48, 36, 499, 7).fill(colors.gold);
    try {
      doc.image(logoPath, 66, 57, { width: 70, height: 70 });
    } catch (error) {
      doc.roundedRect(66, 57, 70, 70, 10).fill(colors.blue);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(22).text('SIS', 66, 82, { width: 70, align: 'center' });
    }
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text(schoolName, 158, 63, { width: 370 });
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(10).text(schoolAddress, 158, 94).text(`Tel: ${schoolPhone}`, 158, 110);
    doc.fillColor(colors.gold).font('Helvetica-Bold').fontSize(17).text('OFFICIAL FEE RECEIPT', 48, 174, { width: 499, align: 'center' });
    doc.fillColor(colors.muted).font('Helvetica').fontSize(9).text(`Receipt No: ${payment.id}  •  Reference: ${payment.paystack_reference}`, 48, 198, { width: 499, align: 'center' });

    doc.roundedRect(48, 232, 499, 116, 10).fill('#fff').strokeColor(colors.line).stroke();
    doc.fillColor(colors.blue).font('Helvetica-Bold').fontSize(9).text('PAYMENT DETAILS', 64, 249);
    const field = (label, value, x, y, width) => {
      doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x, y);
      doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(11).text(String(value || '-'), x, y + 12, { width, ellipsis: true });
    };
    field('Student name', student.full_name, 64, 273, 230);
    field('Student ID', student.student_id_number, 320, 273, 205);
    field('Payment date', new Date(payment.paid_at).toLocaleString(), 64, 315, 230);
    field('Payment status', 'PAID', 320, 315, 205);

    doc.roundedRect(48, 382, 499, 88, 10).fill(colors.teal);
    doc.fillColor('#d1fae5').font('Helvetica-Bold').fontSize(10).text('AMOUNT RECEIVED', 68, 405);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(28).text(`GHS ${Number(payment.amount).toFixed(2)}`, 68, 425);
    doc.fillColor('#d1fae5').font('Helvetica').fontSize(9).text('Thank you for your payment.', 350, 427, { width: 175, align: 'right' });
    doc.fillColor(colors.muted).font('Helvetica').fontSize(9).text('This receipt confirms that the payment was verified by Paystack and recorded by the school.', 48, 510, { width: 499, align: 'center' });
    doc.strokeColor(colors.line).moveTo(48, 735).lineTo(260, 735).stroke();
    doc.moveTo(335, 735).lineTo(547, 735).stroke();
    doc.fillColor(colors.muted).fontSize(8).text('Accounts Officer', 48, 744).text('Parent / Guardian', 335, 744);
    doc.fillColor(colors.teal).font('Helvetica-Bold').fontSize(8).text('OFFICIAL SCHOOL RECEIPT', 48, 792);
    doc.fillColor(colors.muted).font('Helvetica').text(new Date().getFullYear().toString(), 500, 792, { width: 47, align: 'right' });
    doc.end();
  });
}

async function handlePaystackWebhook(req, res) {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body;

    if (!signature || !rawBody || !Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ message: 'Invalid webhook payload.' });
    }

    const secret = process.env.PAYSTACK_SECRET_KEY || '';
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    const expected = Buffer.from(hash, 'hex');
    const provided = Buffer.from(signature || '', 'hex');

    if (!signature || expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return res.status(401).json({ message: 'Unauthorized webhook request.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    if (!payload || payload.event !== 'charge.success') {
      return res.status(200).json({ received: true, ignored: true });
    }

    const paymentData = payload.data || {};
    const reference = paymentData.reference;
    const amountPaidGhs = Number(paymentData.amount || 0) / 100;
    const email = paymentData.customer?.email || paymentData.email;
    const studentIdFromMetadata = paymentData.metadata?.studentId || paymentData.metadata?.student_id;

    if (!reference || !amountPaidGhs || !email) {
      return res.status(400).json({ message: 'Incomplete Paystack webhook payload.' });
    }

    let studentId = Number(studentIdFromMetadata);
    if (!studentId || Number.isNaN(studentId)) {
      const studentResult = await pool.query('SELECT id FROM students WHERE email = $1 LIMIT 1', [email]);
      if (studentResult.rowCount === 0) {
        return res.status(200).json({ received: true, ignored: true });
      }
      studentId = studentResult.rows[0].id;
    }

    const schoolYear = await getPaymentSchoolYear(studentId);
    const inserted = await pool.query(
      `INSERT INTO payments (student_id, amount, paystack_reference, status, academic_year, classroom_name)
       VALUES ($1, $2, $3, 'success', $4, $5)
       ON CONFLICT (paystack_reference) DO NOTHING
       RETURNING id`,
      [studentId, amountPaidGhs, reference, schoolYear.academicYear, schoolYear.classroomName]
    );

    if (inserted.rowCount > 0) {
      await pool.query(
        'UPDATE students SET amount_paid = amount_paid + $1 WHERE id = $2',
        [amountPaidGhs, studentId]
      );
    }

    return res.status(200).json({ received: true, status: 'success' });
  } catch (error) {
    console.error('Paystack webhook error:', error.message);
    return res.status(400).json({ message: 'Invalid Paystack webhook payload.' });
  }
}

// ---------------------------------------------------------------
// POST /api/payments/initialize
// Body: { amount }  (amount in Ghana Cedis, e.g. 500.00)
// ---------------------------------------------------------------
async function initializePayment(req, res) {
  try {
    const studentId = req.user.id; // from the verified JWT
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Please enter a valid amount to pay.' });
    }

    // Get the student's email (Paystack requires an email for every transaction)
    const studentResult = await pool.query('SELECT email, full_name FROM students WHERE id = $1', [studentId]);
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }
    const student = studentResult.rows[0];

    // Paystack amounts are in the SMALLEST currency unit (pesewas, like cents),
    // so we multiply by 100.
    const amountInPesewas = Math.round(amount * 100);

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

    // Ask Paystack to start a new transaction
    const paystackResponse = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email: student.email || `student${studentId}@school.local`, // fallback if no email on file
        amount: amountInPesewas,
        currency: 'GHS', // Ghana Cedis
        metadata: { studentId, fullName: student.full_name },
        // Paystack will send the student back to this page after paying
        callback_url: `${baseUrl}/payment-callback.html`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, // proves the request comes from our server
          'Content-Type': 'application/json',
        },
      }
    );

    // Send the checkout URL + reference back to the frontend so it can redirect the student
    res.json({
      authorizationUrl: paystackResponse.data.data.authorization_url,
      reference: paystackResponse.data.data.reference,
    });
  } catch (error) {
    console.error('Paystack initialize error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Could not start payment. Please try again.' });
  }
}

// ---------------------------------------------------------------
// GET /api/payments/verify/:reference
// Confirms with Paystack that the payment actually succeeded, then
// credits the student's account and logs the payment.
// ---------------------------------------------------------------
async function verifyPayment(req, res) {
  try {
    const studentId = req.user.id;
    const { reference } = req.params;

    // Ask Paystack directly whether this transaction really succeeded.
    // This step is essential — never just trust a "success" message from the browser.
    const verifyResponse = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    const paymentData = verifyResponse.data.data;

    if (paymentData.status !== 'success') {
      return res.status(400).json({ message: 'Payment was not successful.' });
    }

    const amountPaidGhs = paymentData.amount / 100; // convert back from pesewas to cedis
    const studentResult = await pool.query(
      'SELECT id, full_name, student_id_number, email, parent_email FROM students WHERE id = $1',
      [studentId]
    );
    if (!studentResult.rows.length) return res.status(404).json({ message: 'Student not found.' });
    const student = studentResult.rows[0];
    const metadataStudentId = Number(paymentData.metadata?.studentId || paymentData.metadata?.student_id);
    if (metadataStudentId && metadataStudentId !== Number(studentId)) {
      return res.status(403).json({ message: 'This payment does not belong to the logged-in student.' });
    }

    const schoolYear = await getPaymentSchoolYear(studentId);
    const inserted = await pool.query(
      `INSERT INTO payments (student_id, amount, paystack_reference, status, academic_year, classroom_name)
       VALUES ($1, $2, $3, 'success', $4, $5)
       ON CONFLICT (paystack_reference) DO NOTHING
       RETURNING id, amount, paystack_reference, status, paid_at`,
      [studentId, amountPaidGhs, reference, schoolYear.academicYear, schoolYear.classroomName]
    );
    let payment = inserted.rows[0];
    if (inserted.rowCount > 0) {
      await pool.query('UPDATE students SET amount_paid = amount_paid + $1 WHERE id = $2', [amountPaidGhs, studentId]);
    } else {
      const existing = await pool.query('SELECT id, amount, paystack_reference, status, paid_at FROM payments WHERE paystack_reference = $1', [reference]);
      payment = existing.rows[0];
    }

    const receiptPdf = await buildReceiptPdf(payment, student);
    let parentEmailSent = false;
    if (inserted.rowCount > 0 && student.parent_email) {
      try {
        await sendEmailToRecipients({
          recipients: [student.parent_email],
          subject: `Fee payment receipt for ${student.full_name}`,
          text: `A fee payment of GHS ${amountPaidGhs.toFixed(2)} has been received for ${student.full_name}. Receipt reference: ${reference}.`,
          html: `<p>A fee payment of <strong>GHS ${amountPaidGhs.toFixed(2)}</strong> has been received for ${student.full_name}.</p><p>Receipt reference: ${reference}.</p>`,
          attachments: [{ filename: `fee_receipt_${payment.id}.pdf`, content: receiptPdf, contentType: 'application/pdf' }],
        });
        parentEmailSent = true;
      } catch (emailError) {
        console.error('Payment receipt email error:', emailError.message);
      }
    }

    // Return the student's updated balance so the dashboard can refresh instantly
    const updated = await pool.query(
      'SELECT total_fees_due, amount_paid FROM students WHERE id = $1',
      [studentId]
    );

    res.json({
      message: 'Payment verified and recorded successfully.',
      amountPaid: amountPaidGhs,
      newBalance: updated.rows[0].total_fees_due - updated.rows[0].amount_paid,
      paymentId: payment.id,
      parentEmailSent,
    });
  } catch (error) {
    console.error('Paystack verify error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Could not verify payment.' });
  }
}

async function getPaymentReceiptPdf(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.amount, p.paystack_reference, p.status, p.paid_at,
              s.full_name, s.student_id_number
       FROM payments p JOIN students s ON s.id = p.student_id
       WHERE p.id = $1 AND p.student_id = $2`,
      [req.params.paymentId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Payment receipt not found.' });
    const payment = result.rows[0];
    const pdf = await buildReceiptPdf(payment, payment);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="fee_receipt_${payment.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('Payment receipt PDF error:', error);
    res.status(500).json({ message: 'Could not generate payment receipt.' });
  }
}

// ---------------------------------------------------------------
// GET /api/payments/history — a student's past payments
// ---------------------------------------------------------------
async function getPaymentHistory(req, res) {
  try {
    const studentId = req.user.id;
    const result = await pool.query(
      'SELECT amount, paystack_reference, status, paid_at FROM payments WHERE student_id = $1 ORDER BY paid_at DESC',
      [studentId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Payment history error:', error);
    res.status(500).json({ message: 'Could not load payment history.' });
  }
}

module.exports = { initializePayment, verifyPayment, getPaymentHistory, getPaymentReceiptPdf, handlePaystackWebhook, buildReceiptPdf };
