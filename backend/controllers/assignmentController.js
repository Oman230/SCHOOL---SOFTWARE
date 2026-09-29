const pool = require('../config/db');
const sanitizeHtml = require('sanitize-html');
const { sendEmailToRecipients, getRecipientEmailsForClassroom } = require('./emailController');

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isValidDate(value) {
  return !value || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function sanitizeAssignmentContent(content) {
  return sanitizeHtml(content, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  }).trim();
}

function parseAttachments(input) {
  if (!Array.isArray(input) || input.length === 0) return [];
  if (input.length > 5) throw new Error('You can upload up to five assignment files.');

  let totalBytes = 0;
  return input.map((file) => {
    const name = clean(file?.name, 160);
    const type = clean(file?.type, 80).toLowerCase();
    const data = typeof file?.data === 'string' ? file.data.trim() : '';
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!name || !ALLOWED_ATTACHMENT_TYPES.has(type) || !match || match[1].toLowerCase() !== type) {
      throw new Error('Only PDF, PNG, JPG, GIF, and WEBP assignment files are allowed.');
    }

    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('Each assignment file must be 5 MB or smaller.');
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('The total assignment upload size must be 8 MB or smaller.');
    return { name, type, data };
  });
}

async function getTeacherClassroom(teacherId) {
  const result = await pool.query('SELECT classroom_id FROM teachers WHERE id = $1', [teacherId]);
  return result.rows[0]?.classroom_id || null;
}

async function createAssignment(req, res) {
  const title = clean(req.body.title, 160);
  const contentHtml = sanitizeAssignmentContent(req.body.contentHtml);
  const dueDate = clean(req.body.dueDate, 10) || null;

  if (!title || !contentHtml) return res.status(400).json({ message: 'Assignment title and instructions are required.' });
  if (!isValidDate(dueDate)) return res.status(400).json({ message: 'Please provide a valid due date.' });

  let attachments;
  try {
    attachments = parseAttachments(req.body.attachments);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const classroomId = await getTeacherClassroom(req.user.id);
    if (!classroomId) return res.status(400).json({ message: 'You are not assigned to a classroom yet.' });

    const result = await pool.query(
      `INSERT INTO assignments (teacher_id, classroom_id, title, content_html, due_date, attachments)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, title, content_html, due_date, attachments, created_at`,
      [req.user.id, classroomId, title, contentHtml, dueDate, JSON.stringify(attachments)]
    );
    const assignment = result.rows[0];
    let emailSent = false;
    let emailMessage = 'Assignment posted. Email service is not configured, so parents were not emailed.';

    try {
      const recipients = await getRecipientEmailsForClassroom(classroomId);
      if (recipients.length) {
        await sendEmailToRecipients({
          recipients,
          subject: `New assignment: ${title}`,
          text: `${title}\n\n${sanitizeHtml(contentHtml, { allowedTags: [] })}${dueDate ? `\n\nDue date: ${dueDate}` : ''}`,
          html: `<h2>${sanitizeHtml(title, { allowedTags: [] })}</h2>${contentHtml}${dueDate ? `<p><strong>Due date:</strong> ${dueDate}</p>` : ''}`,
          attachments: attachments.map((file) => ({ filename: file.name, content: Buffer.from(file.data.split(',')[1], 'base64'), contentType: file.type })),
        });
        emailSent = true;
        emailMessage = `Assignment posted and emailed to ${recipients.length} parent email${recipients.length === 1 ? '' : 's'}.`;
      } else {
        emailMessage = 'Assignment posted, but no parent email addresses are saved for this class.';
      }
    } catch (error) {
      console.error('Assignment email error:', error);
      emailMessage = 'Assignment posted, but the parent email could not be sent. Check SMTP settings.';
    }

    res.status(201).json({ message: emailMessage, assignment, emailSent });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ message: 'Could not post assignment.' });
  }
}

async function getTeacherAssignments(req, res) {
  try {
    const classroomId = await getTeacherClassroom(req.user.id);
    if (!classroomId) return res.status(400).json({ message: 'You are not assigned to a classroom yet.' });
    const result = await pool.query(
      `SELECT id, title, content_html, due_date, attachments, created_at
       FROM assignments WHERE classroom_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [classroomId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get teacher assignments error:', error);
    res.status(500).json({ message: 'Could not load assignments.' });
  }
}

async function deleteTeacherAssignment(req, res) {
  const assignmentId = Number(req.params.id);
  if (!Number.isInteger(assignmentId) || assignmentId < 1) {
    return res.status(400).json({ message: 'Invalid assignment.' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM assignments
       WHERE id = $1
         AND classroom_id = (SELECT classroom_id FROM teachers WHERE id = $2)
       RETURNING id`,
      [assignmentId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Assignment not found in your classroom.' });
    res.json({ message: 'Assignment removed from your class.', assignmentId: result.rows[0].id });
  } catch (error) {
    console.error('Delete teacher assignment error:', error);
    res.status(500).json({ message: 'Could not remove assignment.' });
  }
}

async function updateTeacherAssignment(req, res) {
  const assignmentId = Number(req.params.id);
  const title = clean(req.body.title, 160);
  const contentHtml = sanitizeAssignmentContent(req.body.contentHtml);
  const dueDate = clean(req.body.dueDate, 10) || null;

  if (!Number.isInteger(assignmentId) || assignmentId < 1) {
    return res.status(400).json({ message: 'Invalid assignment.' });
  }
  if (!title || !contentHtml) {
    return res.status(400).json({ message: 'Assignment title and instructions are required.' });
  }
  if (!isValidDate(dueDate)) {
    return res.status(400).json({ message: 'Please provide a valid due date.' });
  }

  let attachments;
  try {
    attachments = req.body.attachments === undefined ? undefined : parseAttachments(req.body.attachments);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const result = await pool.query(
      `UPDATE assignments
       SET title = $3, content_html = $4, due_date = $5,
           attachments = CASE WHEN $6 THEN $7::jsonb ELSE attachments END
       WHERE id = $1
         AND classroom_id = (SELECT classroom_id FROM teachers WHERE id = $2)
       RETURNING id, title, content_html, due_date, attachments, created_at`,
      [assignmentId, req.user.id, title, contentHtml, dueDate, attachments !== undefined, JSON.stringify(attachments || [])]
    );

    if (!result.rows.length) return res.status(404).json({ message: 'Assignment not found in your classroom.' });
    res.json({ message: 'Assignment updated successfully.', assignment: result.rows[0] });
  } catch (error) {
    console.error('Update teacher assignment error:', error);
    res.status(500).json({ message: 'Could not update assignment.' });
  }
}

async function getStudentAssignments(req, res) {
  try {
    const result = await pool.query(
      `SELECT a.id, a.title, a.content_html, a.due_date, a.attachments, a.created_at,
              t.full_name AS teacher_name
       FROM assignments a
       JOIN students s ON s.classroom_id = a.classroom_id
       JOIN teachers t ON t.id = a.teacher_id
       WHERE s.id = $1
       ORDER BY a.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get student assignments error:', error);
    res.status(500).json({ message: 'Could not load assignments.' });
  }
}

module.exports = { createAssignment, getTeacherAssignments, deleteTeacherAssignment, updateTeacherAssignment, getStudentAssignments, sanitizeAssignmentContent, parseAttachments };
