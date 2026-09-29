const nodemailer = require('nodemailer');
const pool = require('../config/db');
require('dotenv').config();

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true' || port === 465,
    auth: { user, pass },
  });
}

async function getRecipientEmails(req) {
  if (req.user.role === 'admin') {
    const result = await pool.query(
      `SELECT DISTINCT LOWER(TRIM(parent_email)) AS email
       FROM students
       WHERE parent_email IS NOT NULL AND TRIM(parent_email) <> ''`
    );
    return result.rows.map((row) => row.email).filter(isValidEmail);
  }

  return getRecipientEmailsForTeacher(req.user.id);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getRecipientEmailsForTeacher(teacherId) {
  const result = await pool.query(
    `SELECT DISTINCT LOWER(TRIM(s.parent_email)) AS email
     FROM students s
     JOIN teachers t ON t.classroom_id = s.classroom_id
     WHERE t.id = $1 AND s.parent_email IS NOT NULL AND TRIM(s.parent_email) <> ''`,
    [teacherId]
  );
  return result.rows.map((row) => row.email).filter(isValidEmail);
}

async function getRecipientEmailsForClassroom(classroomId) {
  const result = await pool.query(
    `SELECT DISTINCT LOWER(TRIM(parent_email)) AS email
     FROM students
     WHERE classroom_id = $1 AND parent_email IS NOT NULL AND TRIM(parent_email) <> ''`,
    [classroomId]
  );
  return result.rows.map((row) => row.email).filter(isValidEmail);
}

async function sendEmailToRecipients({ recipients, subject, text, html, attachments = [] }) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('Email service is not configured.');
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.SMTP_FROM || process.env.SMTP_USER,
    bcc: recipients,
    subject,
    text,
    html,
    attachments,
  });
}

async function sendParentNotice(req, res) {
  const subject = clean(req.body.subject, 160);
  const message = clean(req.body.message, 5000);

  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required.' });
  }

  const transporter = getTransporter();
  if (!transporter) {
    return res.status(503).json({
      message: 'Email service is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM in your environment.',
    });
  }

  try {
    const recipients = await getRecipientEmails(req);
    if (!recipients.length) {
      return res.status(400).json({ message: 'No parent email addresses are available for this notice.' });
    }

    await sendEmailToRecipients({
      recipients,
      subject,
      text: message,
      html: escapeHtml(message).replace(/\n/g, '<br />'),
    });

    res.json({ message: 'Parent notice sent successfully.', recipientCount: recipients.length });
  } catch (error) {
    console.error('Send parent notice error:', error);
    res.status(502).json({ message: 'The email service could not send this notice. Check the SMTP settings and try again.' });
  }
}

module.exports = { sendParentNotice, sendEmailToRecipients, getRecipientEmailsForClassroom };
