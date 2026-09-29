const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const path = require('path');
require('dotenv').config();

function clean(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function makeApplicationNumber() {
  return `ADM-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
}

async function submitAdmission(req, res) {
  try {
    const {
      studentFullName, dateOfBirth, gender, applyingForLevel, previousSchool,
      parentName, parentEmail, parentPhone, homeAddress, medicalNotes,
      declarationAccepted, parentSignature,
    } = req.body;

    const values = {
      studentFullName: clean(studentFullName, 100),
      dateOfBirth: clean(dateOfBirth, 10),
      gender: clean(gender, 20),
      applyingForLevel: clean(applyingForLevel, 100),
      previousSchool: clean(previousSchool, 150),
      parentName: clean(parentName, 100),
      parentEmail: clean(parentEmail, 100),
      parentPhone: clean(parentPhone, 30),
      homeAddress: clean(homeAddress, 500),
      medicalNotes: clean(medicalNotes, 500),
      parentSignature: clean(parentSignature, 100),
    };

    if (!values.studentFullName || !values.applyingForLevel || !values.parentName || !values.parentEmail || !values.parentPhone || !values.parentSignature) {
      return res.status(400).json({ message: 'Please complete all required admission fields.' });
    }
    if (!declarationAccepted) {
      return res.status(400).json({ message: 'Please accept the admission declaration before submitting.' });
    }

    const result = await pool.query(
      `INSERT INTO admission_applications
        (application_number, student_full_name, date_of_birth, gender, applying_for_level,
         previous_school, parent_name, parent_email, parent_phone, home_address, medical_notes,
         declaration_accepted, parent_signature)
      VALUES ($1, NULLIF($2, ''), NULLIF($3, '')::date, NULLIF($4, ''), $5,
               NULLIF($6, ''), $7, $8, $9, NULLIF($10, ''), NULLIF($11, ''), $12, $13)
       RETURNING application_number`,
      [
        makeApplicationNumber(), values.studentFullName, values.dateOfBirth, values.gender,
        values.applyingForLevel, values.previousSchool, values.parentName, values.parentEmail,
        values.parentPhone, values.homeAddress, values.medicalNotes, Boolean(declarationAccepted),
        values.parentSignature,
      ]
    );

    res.status(201).json({ message: 'Admission application submitted successfully.', applicationNumber: result.rows[0].application_number });
  } catch (error) {
    console.error('Submit admission error:', error);
    res.status(500).json({ message: 'Could not submit admission application.' });
  }
}

async function getAdmissionApplications(req, res) {
  try {
    const result = await pool.query('SELECT * FROM admission_applications ORDER BY submitted_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get admission applications error:', error);
    res.status(500).json({ message: 'Could not load admission applications.' });
  }
}

async function getAdmissionApplicationPdf(req, res) {
  try {
    const result = await pool.query('SELECT * FROM admission_applications WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Admission application not found.' });

    const application = result.rows[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${application.application_number}_admission.pdf"`);

    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    doc.pipe(res);
    const schoolName = process.env.SCHOOL_NAME || 'Sunrise International School';
    const schoolAddress = process.env.SCHOOL_ADDRESS || '123 Independence Avenue, Accra, Ghana';
    const schoolPhone = process.env.SCHOOL_PHONE || '+233 20 000 0000';
    const logoPath = path.join(__dirname, '..', '..', 'frontend', 'assets', 'logo.png');

    try {
      doc.image(logoPath, 48, 38, { width: 52, height: 52 });
    } catch (error) {
      doc.fillColor('#1d4ed8').roundedRect(48, 38, 52, 52, 10).fill();
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text('SIS', 56, 55, { width: 36, align: 'center' });
    }

    doc.fillColor('#172033').font('Helvetica-Bold').fontSize(18).text(schoolName, 116, 43);
    doc.font('Helvetica').fontSize(9).text(schoolAddress, 116, 68).text(`Tel: ${schoolPhone}`, 116, 82);
    doc.fillColor('#1d4ed8').font('Helvetica-Bold').fontSize(15).text('ADMISSION APPLICATION FORM', 48, 122, { align: 'center', width: 499 });
    doc.fillColor('#5f6f8a').font('Helvetica').fontSize(9).text(`Application No: ${application.application_number}    Submitted: ${new Date(application.submitted_at).toLocaleDateString()}`, 48, 145, { align: 'center', width: 499 });

    const section = (title, y) => {
      doc.fillColor('#eff6ff').roundedRect(48, y, 499, 24, 5).fill();
      doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(10).text(title, 58, y + 7);
    };
    const field = (label, value, x, y, width = 240) => {
      doc.fillColor('#5f6f8a').font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x, y);
      doc.fillColor('#172033').font('Helvetica').fontSize(10).text(value || '-', x, y + 12, { width });
      doc.moveTo(x, y + 27).strokeColor('#cbd5e1').lineTo(x + width, y + 27).stroke();
    };

    section('STUDENT DETAILS', 170);
    field('Full name', application.student_full_name, 48, 207, 300);
    field('Date of birth', application.date_of_birth ? new Date(application.date_of_birth).toLocaleDateString() : '-', 370, 207, 177);
    field('Gender', application.gender, 48, 252, 150);
    field('Applying for level', application.applying_for_level, 220, 252, 327);
    field('Previous school', application.previous_school, 48, 297, 499);

    section('PARENT / GUARDIAN DETAILS', 342);
    field('Name', application.parent_name, 48, 379, 240);
    field('Telephone', application.parent_phone, 307, 379, 240);
    field('Email', application.parent_email, 48, 424, 499);
    field('Home address', application.home_address, 48, 469, 499);

    section('ADDITIONAL INFORMATION', 514);
    field('Medical notes or support needs', application.medical_notes, 48, 551, 499);
    doc.fillColor('#172033').font('Helvetica').fontSize(9).text('Declaration: I confirm that the information provided is complete and accurate.', 48, 606);
    doc.text(`Parent/Guardian signature: ${application.parent_signature}`, 48, 628);
    doc.text('Date: ____________________', 370, 628);

    doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(10).text('FOR SCHOOL USE', 48, 680);
    doc.fillColor('#172033').font('Helvetica').fontSize(9).text(`Application status: ${application.status[0].toUpperCase()}${application.status.slice(1)}`, 48, 700);
    doc.text('Admissions Officer signature: ______________________________', 48, 735);
    doc.text('Headteacher signature: _____________________________________', 48, 770);
    doc.text('Official stamp: ____________________', 370, 805);
    doc.end();
  } catch (error) {
    console.error('Generate admission PDF error:', error);
    res.status(500).json({ message: 'Could not generate admission PDF.' });
  }
}

async function getPublicAdmissionApplicationPdf(req, res) {
  try {
    const result = await pool.query(
      'SELECT id FROM admission_applications WHERE application_number = $1',
      [clean(req.params.applicationNumber, 30)]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Admission application not found.' });

    req.params.id = result.rows[0].id;
    return getAdmissionApplicationPdf(req, res);
  } catch (error) {
    console.error('Find public admission PDF error:', error);
    return res.status(500).json({ message: 'Could not open admission PDF.' });
  }
}

async function updateAdmissionStatus(req, res) {
  const status = clean(req.body.status, 20).toLowerCase();
  if (!['pending', 'reviewed', 'accepted', 'declined'].includes(status)) {
    return res.status(400).json({ message: 'Invalid admission status.' });
  }

  try {
    const result = await pool.query(
      'UPDATE admission_applications SET status = $1 WHERE id = $2 RETURNING id, status',
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Admission application not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update admission status error:', error);
    res.status(500).json({ message: 'Could not update admission status.' });
  }
}

async function deleteAdmissionApplication(req, res) {
  const applicationId = Number(req.params.id);
  if (!Number.isInteger(applicationId) || applicationId < 1) {
    return res.status(400).json({ message: 'Invalid admission application.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM admission_applications WHERE id = $1 RETURNING id, application_number',
      [applicationId]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Admission application not found.' });
    res.json({ message: 'Admission application removed.', application: result.rows[0] });
  } catch (error) {
    console.error('Delete admission application error:', error);
    res.status(500).json({ message: 'Could not remove admission application.' });
  }
}

module.exports = {
  submitAdmission,
  getAdmissionApplications,
  getAdmissionApplicationPdf,
  getPublicAdmissionApplicationPdf,
  updateAdmissionStatus,
  deleteAdmissionApplication,
};
