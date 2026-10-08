// public/js/teacher.js
// Powers the teacher dashboard: loading the teacher's profile and class list,
// building the score-entry form for a chosen student, and saving reports.

const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

// Redirect to login if not logged in as a teacher
if (!token || !user || user.role !== 'teacher') {
  window.location.href = '/login.html';
}

let allSubjects = []; // cached list of subjects, loaded once and reused for every student
let teacherAssignmentsCache = [];
let editingAssignmentId = null;

function isValidImageDataUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) return false;

  const [, encoded] = trimmed.split(',', 2);
  if (!encoded) return false;

  try {
    const binary = atob(encoded);
    if (binary.length < 8) return false;
    const marker = binary.slice(0, 8);
    const pngHeader = '\x89PNG\r\n\x1a\n';
    const jpegHeader = '\xFF\xD8\xFF';
    const gifHeader = 'GIF87a';
    const gifHeader89a = 'GIF89a';

    if (trimmed.toLowerCase().startsWith('data:image/png')) return marker === pngHeader;
    if (trimmed.toLowerCase().startsWith('data:image/jpeg')) return binary.slice(0, 3) === jpegHeader;
    if (trimmed.toLowerCase().startsWith('data:image/gif')) return binary.slice(0, 6) === gifHeader || binary.slice(0, 6) === gifHeader89a;
    if (trimmed.toLowerCase().startsWith('data:image/webp')) return binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP';
  } catch (error) {
    return false;
  }

  return false;
}

function resolvePhotoSource(photoUrl, fallbackUrl) {
  if (typeof photoUrl === 'string' && isValidImageDataUrl(photoUrl)) {
    return photoUrl;
  }
  return fallbackUrl;
}

function averageFromScores(scores) {
  if (!Array.isArray(scores) || !scores.length) return 0;
  return scores.reduce((sum, score) => sum + Number(score.total_score || 0), 0) / scores.length;
}

function getTrendMeta(currentAverage, previousAverage) {
  const difference = currentAverage - previousAverage;

  if (!Number.isFinite(currentAverage) || !Number.isFinite(previousAverage) || Math.abs(difference) < 0.01) {
    return { text: 'Steady', tone: 'neutral', icon: '→' };
  }

  if (difference > 0) {
    return { text: `Up ${Math.abs(difference).toFixed(1)}%`, tone: 'up', icon: '↑' };
  }

  return { text: `Down ${Math.abs(difference).toFixed(1)}%`, tone: 'down', icon: '↓' };
}

function buildTrendMarkup(trend) {
  if (!trend) {
    trend = { text: 'No previous report yet', tone: 'neutral', icon: '•' };
  }

  return `
    <span class="trend-pill ${trend.tone}">
      <span class="trend-icon">${trend.icon}</span>
      ${trend.text}
    </span>
  `;
}

async function getStudentTrend(studentId) {
  try {
    const reports = await apiGet(`/api/teachers/students/${studentId}/reports`);
    if (!Array.isArray(reports) || reports.length < 2) {
      return buildTrendMarkup({ text: 'No previous report yet', tone: 'neutral', icon: '•' });
    }

    const [latestReport, previousReport] = await Promise.all([
      apiGet(`/api/reports/${reports[0].id}`),
      apiGet(`/api/reports/${reports[1].id}`),
    ]);

    const latestAverage = averageFromScores(latestReport.scores);
    const previousAverage = averageFromScores(previousReport.scores);

    return buildTrendMarkup(getTrendMeta(latestAverage, previousAverage));
  } catch (error) {
    console.error('Failed to load student trend:', error);
    return buildTrendMarkup({ text: 'Trend unavailable', tone: 'neutral', icon: '•' });
  }
}

// Helper for authenticated GET requests
async function apiGet(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) {
    localStorage.clear();
    window.location.href = '/login.html';
  }
  return response.json();
}

// Helper for authenticated POST requests
async function apiPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await response.json() };
}

function getLocalDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function renderAttendanceRows(students) {
  const tbody = document.getElementById('attendance-table-body');
  tbody.innerHTML = students.length
    ? students.map((student) => `
      <tr data-student-id="${student.id}">
        <td>${student.student_id_number}</td><td>${student.full_name}</td>
        <td><select class="attendance-status-input" aria-label="Attendance status for ${student.full_name}">
          ${['present', 'absent', 'late', 'excused'].map((status) => `<option value="${status}" ${status === student.status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}
        </select></td>
        <td><input class="attendance-note-input" type="text" maxlength="250" value="${student.notes || ''}" placeholder="Optional note" /></td>
      </tr>`).join('')
    : '<tr><td colspan="4">No students are assigned to your class.</td></tr>';
}

async function loadClassAttendance() {
  const attendanceDate = document.getElementById('attendance-date').value;
  const tbody = document.getElementById('attendance-table-body');
  if (!attendanceDate) return;
  tbody.innerHTML = '<tr><td colspan="4">Loading register...</td></tr>';
  try {
    const result = await apiGet(`/api/teachers/attendance?date=${encodeURIComponent(attendanceDate)}`);
    renderAttendanceRows(result.students || []);
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="4">Could not load attendance.</td></tr>';
  }
}

document.getElementById('attendance-date').value = getLocalDateString();
document.getElementById('load-attendance-btn').addEventListener('click', loadClassAttendance);
document.getElementById('save-attendance-btn').addEventListener('click', async () => {
  const attendanceDate = document.getElementById('attendance-date').value;
  const rows = [...document.querySelectorAll('#attendance-table-body tr[data-student-id]')];
  const statusText = document.getElementById('attendance-save-status');
  if (!attendanceDate || !rows.length) return;

  const records = rows.map((row) => ({
    studentId: Number(row.dataset.studentId),
    status: row.querySelector('.attendance-status-input').value,
    notes: row.querySelector('.attendance-note-input').value.trim(),
  }));
  const response = await fetch('/api/teachers/attendance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ attendanceDate, records }),
  });
  const data = await response.json();
  statusText.textContent = response.ok ? `${data.savedCount} attendance records saved.` : (data.message || 'Could not save attendance.');
  statusText.className = response.ok ? 'is-success' : 'is-error';
});

loadClassAttendance();

function readAssignmentFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function escapeAssignmentText(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function renderTeacherAssignments(assignments) {
  teacherAssignmentsCache = assignments;
  const container = document.getElementById('teacher-assignment-list');
  container.innerHTML = assignments.length
    ? assignments.map((assignment) => `
      <article class="assignment-history-item">
        <div class="assignment-history-meta"><strong>${escapeAssignmentText(assignment.title)}</strong><span>${new Date(assignment.created_at).toLocaleDateString()}</span></div>
        ${assignment.due_date ? `<small>Due ${new Date(`${assignment.due_date}T00:00:00`).toLocaleDateString()}</small>` : ''}
        <div class="assignment-history-actions">
          <button class="btn btn-outline assignment-edit-button" type="button" data-action="edit-assignment" data-id="${Number(assignment.id)}">Edit</button>
          <button class="btn btn-outline assignment-remove-button" type="button" data-action="remove-assignment" data-id="${Number(assignment.id)}">Remove</button>
        </div>
      </article>`).join('')
    : '<p class="empty-state">Your recent assignments will appear here.</p>';
}

async function loadTeacherAssignments() {
  try {
    renderTeacherAssignments(await apiGet('/api/teachers/assignments'));
  } catch (error) {
    document.getElementById('teacher-assignment-list').innerHTML = '<p class="empty-state">Assignments are unavailable right now.</p>';
  }
}

document.getElementById('teacher-assignment-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'edit-assignment') {
    const assignment = teacherAssignmentsCache.find((item) => Number(item.id) === Number(button.dataset.id));
    if (!assignment) return;
    beginAssignmentEdit(assignment);
    return;
  }
  if (button.dataset.action !== 'remove-assignment') return;

  if (!window.confirm('Remove this assignment? Students in your class will no longer see it.')) return;

  button.disabled = true;
  try {
    const response = await fetch(`/api/teachers/assignments/${encodeURIComponent(button.dataset.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error('The server did not recognize assignment removal. Restart the school app, then try again.');
    }
    if (!response.ok) throw new Error(data.message || 'Could not remove assignment.');

    await loadTeacherAssignments();
  } catch (error) {
    button.disabled = false;
    alert(error.message || 'Could not remove assignment. Please try again.');
  }
});

function beginAssignmentEdit(assignment) {
  editingAssignmentId = Number(assignment.id);
  document.getElementById('assignment-title').value = assignment.title || '';
  document.getElementById('assignment-editor').innerHTML = assignment.content_html || '';
  document.getElementById('assignment-due-date').value = assignment.due_date ? String(assignment.due_date).slice(0, 10) : '';
  document.getElementById('assignment-files').value = '';
  document.getElementById('clear-assignment-attachments').checked = false;

  const existingFiles = Array.isArray(assignment.attachments) ? assignment.attachments : [];
  document.getElementById('assignment-existing-attachments').textContent = existingFiles.length
    ? `Current files: ${existingFiles.map((file) => file.name).join(', ')}. Upload new files to replace them, or leave empty to keep.`
    : 'No current attachments. Upload files to add them.';
  document.getElementById('assignment-edit-attachments').hidden = false;
  document.getElementById('cancel-assignment-edit').hidden = false;
  document.getElementById('assignment-submit-button').textContent = 'Save assignment changes';
  document.getElementById('assignment-section-title').textContent = 'Edit Assignment';
  document.getElementById('assignment-status').textContent = '';
  document.getElementById('assignments-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetAssignmentEdit() {
  editingAssignmentId = null;
  const form = document.getElementById('assignment-form');
  form.reset();
  document.getElementById('assignment-editor').innerHTML = '';
  document.getElementById('assignment-edit-attachments').hidden = true;
  document.getElementById('cancel-assignment-edit').hidden = true;
  document.getElementById('assignment-submit-button').textContent = 'Post assignment and email parents';
  document.getElementById('assignment-section-title').textContent = 'Create Assignment';
}

document.getElementById('cancel-assignment-edit').addEventListener('click', resetAssignmentEdit);

document.querySelectorAll('[data-editor-command]').forEach((button) => {
  button.addEventListener('click', () => {
    document.getElementById('assignment-editor').focus();
    document.execCommand(button.dataset.editorCommand, false, button.dataset.editorValue || null);
  });
});

document.getElementById('assignment-link-button').addEventListener('click', () => {
  const url = window.prompt('Enter a web link:');
  if (!url) return;
  document.getElementById('assignment-editor').focus();
  document.execCommand('createLink', false, url);
});

document.getElementById('assignment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusText = document.getElementById('assignment-status');
  const editor = document.getElementById('assignment-editor');
  const files = [...document.getElementById('assignment-files').files];
  const submitButton = event.target.querySelector('button[type="submit"]');
  if (!editor.innerText.trim()) {
    statusText.className = 'is-error';
    statusText.textContent = 'Please type assignment instructions first.';
    return;
  }

  submitButton.disabled = true;
  statusText.className = '';
  statusText.textContent = editingAssignmentId ? 'Saving assignment changes...' : 'Posting assignment and notifying parents...';
  try {
    const payload = {
      title: document.getElementById('assignment-title').value.trim(),
      contentHtml: editor.innerHTML,
      dueDate: document.getElementById('assignment-due-date').value,
    };
    if (!editingAssignmentId) {
      payload.attachments = await Promise.all(files.map(readAssignmentFile));
    } else if (files.length) {
      payload.attachments = await Promise.all(files.map(readAssignmentFile));
    } else if (document.getElementById('clear-assignment-attachments').checked) {
      payload.attachments = [];
    }

    const isEditing = Boolean(editingAssignmentId);
    const url = isEditing ? `/api/teachers/assignments/${editingAssignmentId}` : '/api/teachers/assignments';
    const response = await fetch(url, {
      method: isEditing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || (isEditing ? 'Could not update assignment.' : 'Could not post assignment.'));
    statusText.className = isEditing || data.emailSent ? 'is-success' : 'is-error';
    statusText.textContent = isEditing
      ? 'Assignment updated. Students will see the changes on their dashboards.'
      : data.message;
    resetAssignmentEdit();
    await loadTeacherAssignments();
  } catch (error) {
    statusText.className = 'is-error';
    statusText.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

loadTeacherAssignments();

// ---------------------- LOAD TEACHER PROFILE ----------------------
async function loadProfile() {
  const profile = await apiGet('/api/teachers/me');
  document.getElementById('welcome-heading').textContent = `Welcome, ${profile.full_name}!`;
  document.getElementById('profile-name').textContent = profile.full_name;
  document.getElementById('profile-email').textContent = profile.email;
  document.getElementById('profile-phone').textContent = profile.phone || '-';
  document.getElementById('profile-classroom').textContent = profile.classroom_name
    ? `${profile.classroom_name} (${profile.classroom_level})`
    : 'Not yet assigned';

  const teacherPhoto = document.getElementById('teacher-photo');
  const fallbackPhoto = '/assets/logo.png';
  teacherPhoto.src = resolvePhotoSource(profile.photo_url, fallbackPhoto);
  teacherPhoto.alt = `${profile.full_name || 'Teacher'} portrait`;
}

// ---------------------- LOAD CLASS LIST ----------------------
async function loadClassList() {
  const students = await apiGet('/api/teachers/my-class');
  sessionStorage.setItem('teacherClassStudents', JSON.stringify(students));
  const tbody = document.getElementById('class-table-body');

  if (!Array.isArray(students) || !students.length) {
    tbody.innerHTML = '<tr><td colspan="5">No students found in your class yet.</td></tr>';
    return;
  }

  const rows = await Promise.all(students.map(async (student) => {
    const balance = (Number(student.total_fees_due) - Number(student.amount_paid)).toFixed(2);
    const trendMarkup = await getStudentTrend(student.id);

    return `
      <tr>
        <td>${student.student_id_number}</td>
        <td>${student.full_name}</td>
        <td>${balance}</td>
        <td>${trendMarkup}</td>
        <td>
          <button class="btn btn-primary" style="padding:6px 12px;font-size:0.82rem;"
                  onclick="startReport(${student.id}, '${student.full_name.replace(/'/g, "\\'")}')">
            Fill Report
          </button>
          <button class="btn btn-outline" style="padding:6px 12px;font-size:0.82rem; color:var(--color-primary); border-color:var(--color-primary);"
                  onclick="printLatestReport(${student.id})">
            View / Print
          </button>
          <button class="btn btn-accent" style="padding:6px 12px;font-size:0.82rem; background:linear-gradient(135deg, #ef4444 0%, #f97316 100%);"
                  onclick="deleteStudentFromClass(${student.id}, '${student.full_name.replace(/'/g, "\\'")}')">
            Delete
          </button>
        </td>
      </tr>`;
  }));

  tbody.innerHTML = rows.join('');
}

document.getElementById('teacher-photo-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const photoInput = document.getElementById('teacherPhotoUpload');
  if (!photoInput || !photoInput.files || !photoInput.files[0]) {
    alert('Please choose a passport photo to upload.');
    return;
  }

  const reader = new FileReader();
  const photoUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.readAsDataURL(photoInput.files[0]);
  });

  if (!isValidImageDataUrl(photoUrl)) {
    alert('Please upload a valid PNG, JPG, GIF, or WEBP image.');
    return;
  }

  const response = await fetch('/api/teachers/me/photo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ photoUrl }),
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not upload profile photo.');
    return;
  }

  document.getElementById('teacher-photo').src = photoUrl;
  event.target.reset();
  alert('Passport photo updated successfully.');
});

async function searchClassStudents(query) {
  const resultsTable = document.getElementById('teacher-search-results');
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    resultsTable.innerHTML = '<tr><td colspan="4">Start typing to search your class.</td></tr>';
    return;
  }

  const currentStudents = JSON.parse(sessionStorage.getItem('teacherClassStudents') || '[]');
  const matches = currentStudents.filter((student) => student.full_name.toLowerCase().includes(trimmedQuery.toLowerCase()));

  if (!matches.length) {
    resultsTable.innerHTML = '<tr><td colspan="4">No student matches your search.</td></tr>';
    return;
  }

  const rows = await Promise.all(matches.map(async (student) => {
    const trendMarkup = await getStudentTrend(student.id);
    return `
      <tr>
        <td>${student.student_id_number}</td>
        <td>${student.full_name}</td>
        <td>${(Number(student.total_fees_due) - Number(student.amount_paid)).toFixed(2)}</td>
        <td>${trendMarkup}</td>
      </tr>`;
  }));

  resultsTable.innerHTML = rows.join('');
}

document.getElementById('teacher-student-search').addEventListener('input', (event) => {
  searchClassStudents(event.target.value);
});

document.getElementById('teacher-parent-email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusText = document.getElementById('teacher-parent-email-status');
  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  statusText.className = '';
  statusText.textContent = 'Sending notice...';

  try {
    const response = await fetch('/api/teachers/parent-notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        subject: document.getElementById('teacher-parent-email-subject').value.trim(),
        message: document.getElementById('teacher-parent-email-message').value.trim(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not send notice.');

    event.target.reset();
    statusText.className = 'is-success';
    statusText.textContent = `Notice sent to ${data.recipientCount} parent email${data.recipientCount === 1 ? '' : 's'}.`;
  } catch (error) {
    statusText.className = 'is-error';
    statusText.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById('teacher-student-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const photoInput = document.getElementById('teacherStudentPhoto');
  let photoUrl = null;

  if (photoInput && photoInput.files && photoInput.files[0]) {
    const reader = new FileReader();
    photoUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the student image.'));
      reader.readAsDataURL(photoInput.files[0]);
    });
  }

  const payload = {
    fullName: document.getElementById('teacherStudentName').value.trim(),
    email: document.getElementById('teacherStudentEmail').value.trim(),
    password: document.getElementById('teacherStudentPassword').value,
    gender: document.getElementById('teacherStudentGender').value,
    parentName: document.getElementById('teacherParentName').value.trim(),
    parentEmail: document.getElementById('teacherParentEmail').value.trim(),
    parentPhone: document.getElementById('teacherParentPhone').value.trim(),
    photoUrl,
  };

  const response = await fetch('/api/teachers/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not add student.');
    return;
  }

  event.target.reset();
  loadClassList();
  alert(`Student added to your class. Generated ID: ${data.student_id_number}`);
});

async function deleteStudentFromClass(studentId, studentName) {
  const confirmed = window.confirm(`Delete ${studentName} from your class? This action cannot be undone.`);
  if (!confirmed) return;

  const response = await fetch(`/api/teachers/students/${studentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not delete student.');
    return;
  }

  loadClassList();
  alert(data.message || `${studentName} was deleted.`);
}

// ---------------------- START FILLING A REPORT FOR A STUDENT ----------------------
async function startReport(studentId, studentName) {
  document.getElementById('report-student-id').value = studentId;
  document.getElementById('report-student-label').textContent = `Filling report for: ${studentName}`;
  document.getElementById('report-form').style.display = 'block';
  document.getElementById('report-preview-link').hidden = true;
  document.getElementById('promotedTo').value = '';
  document.getElementById('promotionStatus').value = '';
  document.getElementById('classTeacherRemark').value = '';
  document.getElementById('attitudeValuesCompetencies').value = '';

  // Load the list of subjects once, then reuse it for every student
  if (!allSubjects.length) {
    allSubjects = await apiGet('/api/teachers/subjects');
  }

  // Build one input row per subject for entering class score + exam score
  const scoresBody = document.getElementById('subject-scores-body');
  scoresBody.innerHTML = allSubjects
    .map(
      (subject) => `
      <tr data-subject-id="${subject.id}">
        <td>${subject.name}</td>
        <td><input type="number" min="0" max="50" class="class-score-input" style="width:80px; padding:6px;" value="0" /></td>
        <td><input type="number" min="0" max="50" class="exam-score-input" style="width:80px; padding:6px;" value="0" /></td>
      </tr>`
    )
    .join('');

  // Scroll down so the teacher can see the form immediately
  document.getElementById('report-section').scrollIntoView({ behavior: 'smooth' });
}

// ---------------------- SAVE REPORT ----------------------
document.getElementById('report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusText = document.getElementById('report-save-status');
  statusText.textContent = 'Saving...';
  statusText.style.color = 'var(--color-muted)';

  // Gather every subject's scores from the table rows we generated
  const scores = Array.from(document.querySelectorAll('#subject-scores-body tr')).map((row) => ({
    subjectId: Number(row.dataset.subjectId),
    classScore: Number(row.querySelector('.class-score-input').value) || 0,
    examScore: Number(row.querySelector('.exam-score-input').value) || 0,
  }));

  const promotionStatus = document.getElementById('promotionStatus').value;
  const promotedTo = document.getElementById('promotedTo').value.trim();
  if (promotionStatus === 'Promoted' && !promotedTo) {
    statusText.textContent = 'Choose the destination classroom for a promoted student.';
    statusText.style.color = 'var(--color-danger)';
    document.getElementById('promotedTo').focus();
    return;
  }

  const payload = {
    studentId: Number(document.getElementById('report-student-id').value),
    academicYear: document.getElementById('academicYear').value,
    term: document.getElementById('term').value,
    attendance: document.getElementById('attendance').value,
    promotedTo,
    promotionStatus,
    classTeacherRemark: document.getElementById('classTeacherRemark').value,
    attitudeValuesCompetencies: document.getElementById('attitudeValuesCompetencies').value,
    scores,
  };

  const { ok, data } = await apiPost('/api/teachers/reports', payload);

  if (!ok) {
    statusText.textContent = data.message || 'Could not save report.';
    statusText.style.color = 'var(--color-danger)';
    return;
  }

  statusText.textContent = data.message || 'Report saved successfully!';
  statusText.style.color = 'var(--color-success)';
  const previewLink = document.getElementById('report-preview-link');
  previewLink.href = `/student-report.html?id=${encodeURIComponent(data.reportId)}`;
  previewLink.hidden = false;
});

// ---------------------- PRINT A STUDENT'S MOST RECENT REPORT ----------------------
async function printLatestReport(studentId) {
  const reports = await apiGet(`/api/teachers/students/${studentId}/reports`);

  if (!reports.length) {
    alert('This student does not have any saved reports yet.');
    return;
  }

  const latestReportId = reports[0].id; // reports are already sorted newest-first by the backend

  window.open(`/student-report.html?id=${encodeURIComponent(latestReportId)}`, '_blank', 'noopener');
}

// ---------------------- LOGOUT ----------------------
document.getElementById('logout-link').addEventListener('click', (event) => {
  event.preventDefault();
  localStorage.clear();
  window.location.href = '/login.html';
});

// ---------------------- INITIAL LOAD ----------------------
loadProfile();
loadClassList();
