// controllers/reportController.js
// Builds the full terminal report (student info + all subject scores)
// and streams it back to the browser as a downloadable/printable PDF,
// styled like a standard Ghana Education Service terminal report.

const pool = require('../config/db');
const PDFDocument = require('pdfkit'); // library that draws PDF documents
const { proficiencyForScore } = require('./proficiency');
require('dotenv').config();

// ---------------------------------------------------------------
// Shared helper: fetches everything needed to render one report
// (used by both the JSON endpoint and the PDF endpoint)
// ---------------------------------------------------------------
async function fetchFullReport(reportId, viewer) {
  // Get the report + student + classroom details in one query
  const reportResult = await pool.query(
        `SELECT r.*, s.full_name AS student_name, s.student_id_number,
          s.photo_url AS student_photo_url, s.date_of_birth AS student_date_of_birth,
          s.gender AS student_gender,
            COALESCE(r.classroom_name, c.name) AS classroom_name, c.level AS classroom_level,
            t.full_name AS teacher_name
     FROM reports r
     JOIN students s ON r.student_id = s.id
     LEFT JOIN classrooms c ON s.classroom_id = c.id
     LEFT JOIN teachers t ON r.teacher_id = t.id
     WHERE r.id = $1
       AND (
         $2 = 'admin'
         OR ($2 = 'student' AND s.id = $3)
         OR ($2 = 'teacher' AND EXISTS (
           SELECT 1 FROM teachers viewer_teacher
           WHERE viewer_teacher.id = $3
             AND (viewer_teacher.classroom_id = s.classroom_id OR r.teacher_id = viewer_teacher.id)
         ))
       )`,
    [reportId, viewer?.role || '', viewer?.id || null]
  );

  if (reportResult.rows.length === 0) return null;
  const report = reportResult.rows[0];

  // Get every subject score that belongs to this report
  const scoresResult = await pool.query(
    `SELECT rs.*, sub.name AS subject_name
     FROM report_scores rs
     JOIN subjects sub ON rs.subject_id = sub.id
     WHERE rs.report_id = $1
     ORDER BY sub.name ASC`,
    [reportId]
  );

  report.scores = scoresResult.rows; // attach the list of subject scores
  return report;
}

// ---------------------------------------------------------------
// GET /api/reports/:id  — plain JSON version (used if the frontend wants to
// show the report on-screen before printing)
// ---------------------------------------------------------------
async function getReportJson(req, res) {
  try {
    const report = await fetchFullReport(req.params.id, req.user);
    if (!report) return res.status(404).json({ message: 'Report not found.' });
    res.json(report);
  } catch (error) {
    console.error('Get report JSON error:', error);
    res.status(500).json({ message: 'Could not load report.' });
  }
}

// ---------------------------------------------------------------
// GET /api/reports/:id/pdf — generates and streams a PDF report card
// ---------------------------------------------------------------
async function getReportPdf(req, res) {
  try {
    const report = await fetchFullReport(req.params.id, req.user);
    if (!report) return res.status(404).json({ message: 'Report not found.' });

    // Tell the browser this response is a PDF file it can display/download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${report.student_name.replace(/\s+/g, '_')}_${report.term}_report.pdf"`
    );

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    const colors = {
      navy: '#172554',
      blue: '#1d4ed8',
      teal: '#0f766e',
      gold: '#f59e0b',
      ink: '#172033',
      muted: '#64748b',
      pale: '#eff6ff',
      line: '#dbe4f0',
      white: '#ffffff',
    };
    const left = 40;
    const width = 515;
    const logoPath = require('path').join(__dirname, '..', '..', 'frontend', 'assets', 'logo.png');
    const schoolName = process.env.SCHOOL_NAME || 'Sunrise International School';
    const schoolAddress = process.env.SCHOOL_ADDRESS || '123 School Road, Accra';
    const schoolPhone = process.env.SCHOOL_PHONE || '+233 24 000 0000';

    doc.rect(0, 0, 595, 842).fill('#f8fafc');
    doc.roundedRect(left, 28, width, 104, 12).fill(colors.navy);
    doc.rect(left, 28, width, 7).fill(colors.gold);

    try {
      doc.image(logoPath, 56, 48, { width: 64, height: 64 });
    } catch (error) {
      doc.roundedRect(56, 48, 64, 64, 10).fill(colors.blue);
      doc.fillColor(colors.white).font('Helvetica-Bold').fontSize(20).text('SIS', 56, 70, { width: 64, align: 'center' });
    }

    doc.fillColor(colors.white).font('Helvetica-Bold').fontSize(19).text(schoolName, 138, 51, { width: 390 });
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(9).text(schoolAddress, 138, 79, { width: 390 });
    doc.text(`Tel: ${schoolPhone}`, 138, 94, { width: 390 });
    doc.fillColor(colors.gold).font('Helvetica-Bold').fontSize(16).text('TERMINAL REPORT', left, 151, { width, align: 'center' });
    doc.fillColor(colors.muted).font('Helvetica').fontSize(9).text(`${report.term}  •  ${report.academic_year}`, left, 173, { width, align: 'center' });

    const drawLabel = (label, value, x, y, fieldWidth) => {
      doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(7).text(label.toUpperCase(), x, y);
      doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(10).text(value || '-', x, y + 11, { width: fieldWidth, ellipsis: true });
    };

    doc.roundedRect(left, 198, width, 82, 10).fill(colors.white).strokeColor(colors.line).stroke();
    doc.fillColor(colors.blue).font('Helvetica-Bold').fontSize(9).text('STUDENT PROFILE', 56, 213);
    drawLabel('Student name', report.student_name, 56, 232, 235);
    drawLabel('Student ID', report.student_id_number, 315, 232, 210);
    drawLabel('Classroom', report.classroom_name, 56, 258, 235);
    drawLabel('Attendance', report.attendance || '-', 315, 258, 210);

    const totalScores = report.scores.map((score) => Number(score.total_score));
    const average = totalScores.length ? totalScores.reduce((a, b) => a + b, 0) / totalScores.length : 0;
    const overallProficiency = proficiencyForScore(average);
    const tableTop = 302;
    const columns = [
      { label: 'SUBJECT', x: 56, width: 114 },
      { label: 'SBA / 50', x: 174, width: 44 },
      { label: 'EXAM / 50', x: 222, width: 48 },
      { label: 'FINAL / 100', x: 274, width: 48 },
      { label: 'LEVEL', x: 326, width: 66 },
      { label: 'TEACHER REMARK', x: 398, width: 145 },
    ];

    doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(8)
      .text('School-Based Assessment (SBA) 50% + End-of-Term Exam 50% = Final Score 100%', left, 285, { width, align: 'center' });
    doc.roundedRect(left, tableTop, width, 29, 7).fill(colors.blue);
    doc.fillColor(colors.white).font('Helvetica-Bold').fontSize(6.5);
    columns.forEach((column) => doc.text(column.label, column.x, tableTop + 10, {
      width: column.width,
      align: column.label === 'SUBJECT' || column.label === 'TEACHER REMARK' ? 'left' : 'center',
    }));

    let rowY = tableTop + 29;
    report.scores.forEach((score, index) => {
      const rowHeight = 31;
      const proficiency = proficiencyForScore(Number(score.total_score || 0));
      doc.rect(left, rowY, width, rowHeight).fill(index % 2 === 0 ? colors.white : colors.pale);
      doc.fillColor(colors.ink).font('Helvetica').fontSize(8);
      doc.text(score.subject_name || '-', 56, rowY + 9, { width: 114, ellipsis: true });
      doc.text(Number(score.class_score || 0).toFixed(1), 174, rowY + 9, { width: 44, align: 'center' });
      doc.text(Number(score.exam_score || 0).toFixed(1), 222, rowY + 9, { width: 48, align: 'center' });
      doc.font('Helvetica-Bold').text(Number(score.total_score || 0).toFixed(1), 274, rowY + 9, { width: 48, align: 'center' });
      doc.fillColor(colors.teal).font('Helvetica-Bold').fontSize(7).text(proficiency.level, 326, rowY + 9, { width: 66, align: 'center' });
      doc.fillColor(colors.muted).font('Helvetica').fontSize(6.5)
        .text(proficiency.remark, 398, rowY + 5, { width: 145, height: rowHeight - 8, ellipsis: true });
      doc.strokeColor(colors.line).moveTo(left, rowY + rowHeight).lineTo(left + width, rowY + rowHeight).stroke();
      rowY += rowHeight;
    });

    doc.roundedRect(left, rowY + 10, width, 46, 9).fill(colors.navy);
    doc.fillColor('#cbd5e1').font('Helvetica-Bold').fontSize(8)
      .text(`OVERALL PROFICIENCY: ${overallProficiency.level} — ${overallProficiency.name}`, 58, rowY + 20, { width: 330 });
    doc.fillColor(colors.white).font('Helvetica-Bold').fontSize(16)
      .text(`${average.toFixed(1)}%`, 420, rowY + 18, { width: 105, align: 'right' });
    rowY += 68;

    const remarkBox = (label, value, x, y, boxWidth) => {
      doc.roundedRect(x, y, boxWidth, 54, 8).fill(colors.white).strokeColor(colors.line).stroke();
      doc.fillColor(colors.blue).font('Helvetica-Bold').fontSize(7).text(label.toUpperCase(), x + 10, y + 9);
      doc.fillColor(colors.ink).font('Helvetica').fontSize(8)
        .text(value || '-', x + 10, y + 22, { width: boxWidth - 20, height: 25, ellipsis: true });
    };
    remarkBox('Class teacher\'s remark', report.class_teacher_remark, left, rowY, 250);
    remarkBox('Attitude, values and core competencies', report.attitude_values_competencies, 305, rowY, 250);
    rowY += 63;
    doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(8)
      .text(`Head Teacher's Decision: ${report.promotion_status || report.headteacher_remark || '-'}${report.promoted_to ? ` — Destination: ${report.promoted_to}` : ''}`, left, rowY, { width });
    rowY += 17;
    doc.fillColor(colors.muted).font('Helvetica').fontSize(6.5)
      .text('L1: 80–100% Highly Proficient / Advanced  |  L2: 65–<80% Proficient  |  L3: 50–<65% Approaching Proficiency', left, rowY, { width });
    rowY += 10;
    doc.text('L4: 35–<50% Developing  |  L5–L6: 0–<35% Below Standard / Beginning', left, rowY, { width });
    rowY += 11;
    doc.strokeColor(colors.line).moveTo(left, rowY + 17).lineTo(220, rowY + 17).stroke();
    doc.moveTo(315, rowY + 17).lineTo(555, rowY + 17).stroke();
    doc.fillColor(colors.muted).fontSize(8).text('Class Teacher\'s Signature', left, rowY + 24);
    doc.text('Head Teacher\'s Signature', 315, rowY + 24);
    doc.fillColor(colors.teal).font('Helvetica-Bold').fontSize(8).text('PROFICIENCY-BASED SCHOOL REPORT', left, 811);
    doc.fillColor(colors.muted).font('Helvetica').text(new Date().getFullYear().toString(), 510, 811, { width: 45, align: 'right' });

    doc.end();
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ message: 'Could not generate PDF report.' });
  }
}

module.exports = { getReportJson, getReportPdf };
