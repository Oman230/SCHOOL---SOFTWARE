// public/js/admin.js
// Powers the admin dashboard: loading stats, and the create/list/delete
// actions for classrooms, teachers, and students.

const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

// Redirect to login if not logged in as an admin
if (!token || !user || user.role !== 'admin') {
  window.location.href = '/login.html';
}

// ---------------------- SMALL FETCH HELPERS ----------------------
async function apiGet(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) {
    localStorage.clear();
    window.location.href = '/login.html';
  }
  return response.json();
}

async function apiSend(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: response.ok, data: await response.json() };
}

let classroomsCache = []; // reused to fill the classroom dropdowns in the teacher/student forms
let teacherEditId = null;
let studentEditId = null;
let admissionApplicationsCache = [];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    const reports = await apiGet(`/api/admin/students/${studentId}/reports`);
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

// ---------------------- OVERVIEW STATS ----------------------
async function loadStats() {
  const stats = await apiGet('/api/admin/stats');
  document.getElementById('welcome-heading').textContent = `Welcome, ${user.name}!`;
  document.getElementById('stat-students').textContent = stats.totalStudents;
  document.getElementById('stat-teachers').textContent = stats.totalTeachers;
  document.getElementById('stat-classrooms').textContent = stats.totalClassrooms;
  document.getElementById('stat-fees').textContent = stats.totalFeesCollected.toFixed(2);
}

async function loadSchoolFees() {
  const fees = await apiGet('/api/admin/school-fees');
  const tbody = document.getElementById('school-fees-table-body');

  tbody.innerHTML = fees.length
    ? fees.map((fee) => `
      <tr>
        <td>${escapeHtml(fee.school_level)}</td>
        <td>${escapeHtml(fee.term)}</td>
        <td>${Number(fee.amount).toFixed(2)}</td>
        <td>${new Date(fee.updated_at).toLocaleDateString()}</td>
      </tr>`).join('')
    : '<tr><td colspan="4">No school fees saved yet.</td></tr>';
}

async function loadAdmissions() {
  admissionApplicationsCache = await apiGet('/api/admin/admissions');
  renderAdmissionApplications();
}

function renderAdmissionApplications() {
  const tbody = document.getElementById('admissions-table-body');
  const query = document.getElementById('admission-search').value.trim().toLowerCase();
  const applications = admissionApplicationsCache.filter((application) => [
    application.application_number,
    application.student_full_name,
    application.applying_for_level,
    application.parent_name,
    application.parent_phone,
    application.parent_email,
  ].some((value) => String(value || '').toLowerCase().includes(query)));

  if (!applications.length) {
    tbody.innerHTML = `<tr><td colspan="8">${query ? 'No applications match this search.' : 'No admission applications have been submitted yet.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = applications.map((application) => `
    <tr>
      <td><strong>${escapeHtml(application.application_number)}</strong></td>
      <td>${escapeHtml(application.student_full_name)}</td>
      <td>${escapeHtml(application.applying_for_level)}</td>
      <td>${escapeHtml(application.parent_name)}<br /><small>${escapeHtml(application.parent_phone)}</small></td>
      <td>${new Date(application.submitted_at).toLocaleDateString()}</td>
      <td>
        <select class="admission-status-select" data-admission-id="${application.id}" aria-label="Application status">
          ${['pending', 'reviewed', 'accepted', 'declined'].map((status) => `<option value="${status}" ${status === application.status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}
        </select>
      </td>
      <td><button class="btn btn-outline admission-pdf-button" type="button" data-action="view-admission-pdf" data-id="${application.id}" style="padding:6px 10px;font-size:0.8rem;">View / Print PDF</button></td>
      <td><button class="btn btn-outline" type="button" data-action="delete-admission" data-id="${application.id}" style="padding:6px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);">Remove</button></td>
    </tr>`).join('');
}

async function openAdmissionPdf(applicationId) {
  const response = await fetch(`/api/admin/admissions/${applicationId}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const data = await response.json();
    return alert(data.message || 'Could not open admission PDF.');
  }
  const fileUrl = URL.createObjectURL(await response.blob());
  window.open(fileUrl, '_blank');
}

document.getElementById('admissions-table-body').addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'view-admission-pdf') openAdmissionPdf(target.dataset.id);
  if (target.dataset.action === 'delete-admission') removeAdmissionApplication(target.dataset.id, target);
});

document.getElementById('admission-search').addEventListener('input', renderAdmissionApplications);

async function removeAdmissionApplication(applicationId, button) {
  const application = admissionApplicationsCache.find((item) => String(item.id) === String(applicationId));
  if (!application || !window.confirm(`Remove admission application ${application.application_number} for ${application.student_full_name}?`)) return;

  button.disabled = true;
  const { ok, data } = await apiSend('DELETE', `/api/admin/admissions/${encodeURIComponent(applicationId)}`);
  if (!ok) {
    button.disabled = false;
    alert(data.message || 'Could not remove admission application.');
    return;
  }

  admissionApplicationsCache = admissionApplicationsCache.filter((item) => String(item.id) !== String(applicationId));
  renderAdmissionApplications();
}

document.getElementById('admissions-table-body').addEventListener('change', async (event) => {
  if (!event.target.matches('.admission-status-select')) return;
  const { ok, data } = await apiSend('PATCH', `/api/admin/admissions/${event.target.dataset.admissionId}/status`, { status: event.target.value });
  if (!ok) {
    alert(data.message || 'Could not update application status.');
    loadAdmissions();
  }
});

document.getElementById('school-fee-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    schoolLevel: document.getElementById('schoolFeeLevel').value,
    term: document.getElementById('schoolFeeTerm').value,
    amount: Number(document.getElementById('schoolFeeAmount').value),
  };

  if (!Number.isFinite(payload.amount) || payload.amount < 0) {
    return alert('Please enter a valid fee amount.');
  }

  const { ok, data } = await apiSend('POST', '/api/admin/school-fees', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadSchoolFees();
  loadStudents();
  alert(`School fees updated for ${payload.schoolLevel} (${payload.term}). Students in this level now show the new term fee.`);
});

// ---------------------- CLASSROOMS ----------------------
async function loadClassrooms() {
  const classrooms = await apiGet('/api/admin/classrooms');
  classroomsCache = classrooms;

  // Fill the classrooms table
  const tbody = document.getElementById('classrooms-table-body');
  tbody.innerHTML = classrooms.length
    ? classrooms
        .map(
          (c) => `
        <tr>
          <td>${c.name}</td>
          <td>${c.level}</td>
          <td><button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);" onclick="deleteClassroom(${c.id})">Delete</button></td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="3">No classrooms yet.</td></tr>';

  // Fill the classroom dropdowns used in the teacher and student "add" forms
  const optionsHtml = classrooms.map((c) => `<option value="${c.id}">${c.name} (${c.level})</option>`).join('');
  document.getElementById('teacherClassroom').innerHTML = '<option value="">Assign classroom (optional)</option>' + optionsHtml;
  document.getElementById('studentClassroom').innerHTML = '<option value="">Assign classroom</option>' + optionsHtml;
}

document.getElementById('classroom-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('classroomName').value.trim();
  const level = document.getElementById('classroomLevel').value.trim();

  const { ok, data } = await apiSend('POST', '/api/admin/classrooms', { name, level });
  if (!ok) return alert(data.message);

  event.target.reset();
  loadClassrooms();
  loadStats();
});

async function deleteClassroom(id) {
  if (!confirm('Delete this classroom? This only works if no students/teachers are assigned to it.')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/classrooms/${id}`);
  if (!ok) return alert(data.message);
  loadClassrooms();
  loadStats();
}

// ---------------------- TEACHERS ----------------------
function resolveClassroomIdByName(classroomName) {
  const trimmedName = (classroomName || '').trim();
  if (!trimmedName) return null;

  const match = classroomsCache.find((room) => room.name.toLowerCase() === trimmedName.toLowerCase());
  return match ? match.id : null;
}

async function editTeacher(teacher) {
  const fullName = prompt('Edit teacher full name:', teacher.full_name || '');
  if (fullName === null) return;

  const phone = prompt('Edit teacher phone number:', teacher.phone || '');
  if (phone === null) return;

  const classroomOptions = classroomsCache.length
    ? classroomsCache.map((room) => room.name).join(', ')
    : 'No classrooms available';
  const classroomName = prompt(`Edit classroom name (${classroomOptions}):`, teacher.classroom_name || '');
  if (classroomName === null) return;

  const classroomId = classroomName.trim() ? resolveClassroomIdByName(classroomName) : null;
  if (classroomName.trim() && !classroomId) {
    return alert('Classroom not found. Please use an exact classroom name from the list shown.');
  }

  const { ok, data } = await apiSend('PUT', `/api/admin/teachers/${teacher.id}`, {
    fullName: fullName.trim(),
    phone: phone.trim(),
    classroomId,
  });

  if (!ok) return alert(data.message);
  loadTeachers();
}

function getClassroomSelectHtml(selectedName = '') {
  const options = classroomsCache.length
    ? classroomsCache
        .map((room) => `<option value="${room.name}" ${room.name === selectedName ? 'selected' : ''}>${room.name}</option>`)
        .join('')
    : '<option value="">No classrooms available</option>';

  return `
    <select class="inline-edit-select" data-role="classroom">${options}</select>
  `;
}

async function loadTeachers() {
  const teachers = await apiGet('/api/admin/teachers');
  const tbody = document.getElementById('teachers-table-body');

  tbody.innerHTML = teachers.length
    ? teachers.map((t) => {
        if (teacherEditId === t.id) {
          return `
            <tr class="inline-edit-row">
              <td><input class="inline-edit-input" type="text" value="${escapeHtml(t.full_name)}" data-field="fullName" /></td>
              <td>${escapeHtml(t.email)}</td>
              <td>${getClassroomSelectHtml(t.classroom_name || '')}</td>
              <td>
                <div class="inline-edit-actions">
                  <button class="btn btn-primary" type="button" data-action="save-teacher" data-id="${t.id}">Save</button>
                  <button class="btn btn-outline" type="button" data-action="cancel-teacher" data-id="${t.id}" style="margin-left:8px;">Cancel</button>
                </div>
              </td>
            </tr>`;
        }

        return `
          <tr>
            <td>${escapeHtml(t.full_name)}</td>
            <td>${escapeHtml(t.email)}</td>
            <td>${escapeHtml(t.classroom_name || '-')}</td>
            <td>
              <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" data-action="edit-teacher" data-id="${t.id}">Edit</button>
              <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteTeacher(${t.id})">Delete</button>
            </td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="4">No teachers yet.</td></tr>';
}

document.getElementById('teachers-table-body').addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const teacherId = Number(target.dataset.id);

  if (action === 'edit-teacher') {
    teacherEditId = teacherId;
    loadTeachers();
    return;
  }

  if (action === 'cancel-teacher') {
    teacherEditId = null;
    loadTeachers();
    return;
  }

  if (action === 'save-teacher') {
    const row = target.closest('tr');
    const fullName = row.querySelector('[data-field="fullName"]').value.trim();
    const classroomName = row.querySelector('[data-role="classroom"]').value;
    const phoneInput = row.querySelector('[data-field="phone"]');
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!fullName) {
      return alert('Teacher name cannot be empty.');
    }

    const classroomId = classroomName ? resolveClassroomIdByName(classroomName) : null;
    if (classroomName && !classroomId) {
      return alert('Classroom not found. Please choose a valid classroom.');
    }

    const { ok, data } = await apiSend('PUT', `/api/admin/teachers/${teacherId}`, {
      fullName,
      phone,
      classroomId,
    });

    if (!ok) return alert(data.message);
    teacherEditId = null;
    loadTeachers();
  }
});

document.getElementById('teacher-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    fullName: document.getElementById('teacherFullName').value.trim(),
    email: document.getElementById('teacherEmail').value.trim(),
    password: document.getElementById('teacherPassword').value,
    phone: document.getElementById('teacherPhone').value.trim(),
    classroomId: document.getElementById('teacherClassroom').value || null,
  };

  const { ok, data } = await apiSend('POST', '/api/admin/teachers', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadTeachers();
  loadStats();
});

async function deleteTeacher(id) {
  if (!confirm('Delete this teacher account?')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/teachers/${id}`);
  if (!ok) return alert(data.message);
  loadTeachers();
  loadStats();
}

// ---------------------- STUDENTS ----------------------
async function renderStudentMomentumOverview(students) {
  const panel = document.getElementById('admin-momentum-panel');
  if (!panel) return;

  if (!students.length) {
    panel.innerHTML = '<div class="mini-momentum-item"><small>Student momentum</small><strong>No students yet</strong></div>';
    return;
  }

  const summaries = await Promise.all(students.map(async (student) => {
    try {
      const reports = await apiGet(`/api/admin/students/${student.id}/reports`);
      if (!Array.isArray(reports) || reports.length < 2) {
        return { student, change: 0, trend: { text: 'No previous report yet', tone: 'neutral', icon: '•' } };
      }

      const [latestReport, previousReport] = await Promise.all([
        apiGet(`/api/reports/${reports[0].id}`),
        apiGet(`/api/reports/${reports[1].id}`),
      ]);

      const latestAverage = averageFromScores(latestReport.scores);
      const previousAverage = averageFromScores(previousReport.scores);
      const change = latestAverage - previousAverage;
      return { student, change, trend: getTrendMeta(latestAverage, previousAverage) };
    } catch (error) {
      return { student, change: 0, trend: { text: 'Trend unavailable', tone: 'neutral', icon: '•' } };
    }
  }));

  const topImprover = [...summaries]
    .filter((entry) => entry.change > 0)
    .sort((a, b) => b.change - a.change)[0];

  const biggestDrop = [...summaries]
    .filter((entry) => entry.change < 0)
    .sort((a, b) => a.change - b.change)[0];

  const steadyCount = summaries.filter((entry) => Math.abs(entry.change) < 0.01).length;

  const topCard = topImprover
    ? `<div class="mini-momentum-item item-up"><div class="mini-momentum-header"><span class="mini-momentum-icon">↗</span><small>Top improver</small></div><div class="mini-momentum-row"><strong>${topImprover.student.full_name}</strong>${buildTrendMarkup(topImprover.trend)}</div></div>`
    : '<div class="mini-momentum-item item-up"><div class="mini-momentum-header"><span class="mini-momentum-icon">↗</span><small>Top improver</small></div><div class="mini-momentum-row"><strong>No gains yet</strong><span class="trend-pill neutral"><span class="trend-icon">•</span> No data</span></div></div>';

  const dropCard = biggestDrop
    ? `<div class="mini-momentum-item item-support"><div class="mini-momentum-header"><span class="mini-momentum-icon">⚠</span><small>Needs support</small></div><div class="mini-momentum-row"><strong>${biggestDrop.student.full_name}</strong>${buildTrendMarkup(biggestDrop.trend)}</div></div>`
    : '<div class="mini-momentum-item item-support"><div class="mini-momentum-header"><span class="mini-momentum-icon">⚠</span><small>Needs support</small></div><div class="mini-momentum-row"><strong>All stable</strong><span class="trend-pill neutral"><span class="trend-icon">→</span> Steady</span></div></div>';

  const steadyCard = `<div class="mini-momentum-item item-steady"><div class="mini-momentum-header"><span class="mini-momentum-icon">→</span><small>Steady</small></div><div class="mini-momentum-row"><strong>${steadyCount} students</strong><span class="trend-pill neutral"><span class="trend-icon">→</span> Stable</span></div></div>`;

  panel.innerHTML = `${topCard}${dropCard}${steadyCard}`;
}

async function editStudent(student) {
  const fullName = prompt('Edit student full name:', student.full_name || '');
  if (fullName === null) return;

  const gender = prompt('Edit student gender (Male/Female):', student.gender || '');
  if (gender === null) return;

  const classroomOptions = classroomsCache.length
    ? classroomsCache.map((room) => room.name).join(', ')
    : 'No classrooms available';
  const classroomName = prompt(`Edit classroom name (${classroomOptions}):`, student.classroom_name || '');
  if (classroomName === null) return;

  const classroomId = classroomName.trim() ? resolveClassroomIdByName(classroomName) : null;
  if (classroomName.trim() && !classroomId) {
    return alert('Classroom not found. Please use an exact classroom name from the list shown.');
  }

  const feesDue = Number(prompt('Edit total fees due (GHS):', Number(student.total_fees_due || 0)));
  if (Number.isNaN(feesDue)) {
    return alert('Please enter a valid fees amount.');
  }

  const { ok, data } = await apiSend('PUT', `/api/admin/students/${student.id}`, {
    fullName: fullName.trim(),
    classroomId,
    totalFeesDue: feesDue,
    gender: gender.trim() || null,
    dateOfBirth: null,
    photoUrl: student.photo_url || null,
  });

  if (!ok) return alert(data.message);
  loadStudents();
}

async function loadStudents() {
  const students = await apiGet('/api/admin/students');
  const tbody = document.getElementById('students-table-body');

  const rows = await Promise.all(students.map(async (s) => {
    const trendMarkup = await getStudentTrend(s.id);

    if (studentEditId === s.id) {
      return `
        <tr class="inline-edit-row">
          <td>${escapeHtml(s.student_id_number)}</td>
          <td><input class="inline-edit-input" type="text" value="${escapeHtml(s.full_name)}" data-field="fullName" /></td>
          <td>${getClassroomSelectHtml(s.classroom_name || '')}</td>
          <td><input class="inline-edit-input" type="number" min="0" step="0.01" value="${Number(s.total_fees_due || 0).toFixed(2)}" data-field="feesDue" /></td>
          <td>${Number(s.amount_paid).toFixed(2)}</td>
          <td>${trendMarkup}</td>
          <td>
            <div class="inline-edit-actions">
              <button class="btn btn-primary" type="button" data-action="save-student" data-id="${s.id}">Save</button>
              <button class="btn btn-outline" type="button" data-action="cancel-student" data-id="${s.id}" style="margin-left:8px;">Cancel</button>
            </div>
          </td>
        </tr>`;
    }

    return `
      <tr>
        <td>${escapeHtml(s.student_id_number)}</td>
        <td>${escapeHtml(s.full_name)}</td>
        <td>${escapeHtml(s.classroom_name || '-')}</td>
        <td>${Number(s.total_fees_due).toFixed(2)}</td>
        <td>${Number(s.amount_paid).toFixed(2)}</td>
        <td>${trendMarkup}</td>
        <td>
          <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" data-action="edit-student" data-id="${s.id}">Edit</button>
            <button class="btn btn-accent" type="button" style="padding:5px 10px;font-size:0.8rem;margin-left:8px;" data-action="print-student-id" data-id="${s.id}">Print ID</button>
          <button class="btn btn-outline" type="button" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteStudent(${s.id})">Delete</button>
        </td>
      </tr>`;
  }));

  tbody.innerHTML = students.length
    ? rows.join('')
    : '<tr><td colspan="7">No students yet.</td></tr>';

  renderStudentMomentumOverview(students);
}

document.getElementById('students-table-body').addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const studentId = Number(target.dataset.id);

  if (action === 'edit-student') {
    studentEditId = studentId;
    loadStudents();
    return;
  }

  if (action === 'cancel-student') {
    studentEditId = null;
    loadStudents();
    return;
  }

  if (action === 'print-student-id') {
    const student = (await apiGet('/api/admin/students')).find((item) => Number(item.id) === studentId);
    if (student) printStudentId(student);
    return;
  }

  if (action === 'save-student') {
    const row = target.closest('tr');
    const fullName = row.querySelector('[data-field="fullName"]').value.trim();
    const classroomName = row.querySelector('[data-role="classroom"]').value;
    const feesDue = Number(row.querySelector('[data-field="feesDue"]').value);
    const gender = row.querySelector('[data-field="gender"]') ? row.querySelector('[data-field="gender"]').value : null;

    if (!fullName) {
      return alert('Student name cannot be empty.');
    }

    if (Number.isNaN(feesDue)) {
      return alert('Please enter a valid fees amount.');
    }

    const classroomId = classroomName ? resolveClassroomIdByName(classroomName) : null;
    if (classroomName && !classroomId) {
      return alert('Classroom not found. Please choose a valid classroom.');
    }

    const { ok, data } = await apiSend('PUT', `/api/admin/students/${studentId}`, {
      fullName,
      classroomId,
      totalFeesDue: feesDue,
      gender: gender || null,
      dateOfBirth: null,
      photoUrl: null,
    });

    if (!ok) return alert(data.message);
    studentEditId = null;
    loadStudents();
  }
});

document.getElementById('student-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const fileInput = document.getElementById('studentPhoto');
  let photoUrl = null;

  if (fileInput && fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    const reader = new FileReader();
    const readFile = () => new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read image file.'));
      reader.readAsDataURL(file);
    });

    try {
      photoUrl = await readFile();
    } catch (error) {
      return alert(error.message);
    }
  }

  const payload = {
    studentIdNumber: document.getElementById('studentIdNumber').value.trim(),
    fullName: document.getElementById('studentFullName').value.trim(),
    email: document.getElementById('studentEmail').value.trim(),
    parentName: document.getElementById('studentParentName').value.trim(),
    parentEmail: document.getElementById('studentParentEmail').value.trim(),
    parentPhone: document.getElementById('studentParentPhone').value.trim(),
    password: document.getElementById('studentPassword').value,
    gender: document.getElementById('studentGender').value,
    classroomId: document.getElementById('studentClassroom').value || null,
    totalFeesDue: document.getElementById('studentFeesDue').value || 0,
    photoUrl,
  };

  const { ok, data } = await apiSend('POST', '/api/admin/students', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadStudents();
  loadStats();
});

function printStudentId(student) {
  const printWindow = window.open('', '_blank', 'width=420,height=720');
  if (!printWindow) {
    alert('Please allow pop-ups to print the student ID.');
    return;
  }

  const photo = student.photo_url || '/assets/logo.png';
  const safePhoto = escapeHtml(photo);
  const safeName = escapeHtml(student.full_name || '-');
  const safeId = escapeHtml(student.student_id_number || '-');
  const safeClass = escapeHtml(student.classroom_name || '-');
  const safeLevel = escapeHtml(student.classroom_level || '-');

  printWindow.document.write(`<!doctype html><html><head><title>Student ID - ${safeName}</title><style>
    @page{size:auto;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#172033}.card{position:relative;width:54mm;height:86mm;overflow:hidden;border:1px solid #263d85;border-radius:1mm;background:#fff}.topline{height:3mm;background:#304b9d}.wave{position:absolute;left:-12mm;width:78mm;border-radius:50%;pointer-events:none}.wave-one{top:7mm;height:25mm;background:#304b9d}.wave-two{top:19mm;height:27mm;background:#0878bb}.wave-three{top:30mm;height:24mm;background:#28a4d8}.header{position:relative;z-index:2;display:flex;align-items:center;flex-direction:column;gap:2mm;padding:5mm 4mm 0;color:#fff;text-align:center}.mark{display:grid;width:12mm;height:12mm;place-items:center;border:.7mm solid #fff;border-radius:50%;color:#fff;font-size:19px;font-weight:500}.header strong{font-size:8.5px;letter-spacing:.02em}.body{position:relative;z-index:3;display:flex;align-items:center;flex-direction:column;gap:2mm;padding:7mm 5mm 0;text-align:center}.body img{width:34mm;height:34mm;object-fit:cover;border:2mm solid #29a5d9;border-radius:50%;background:#dbeafe;box-shadow:0 0 0 1.2mm #fff,0 3px 8px rgba(23,37,84,.14)}.details{display:grid;width:100%;gap:.8mm;justify-items:center}.label{color:#64748b;font-size:6.5px;font-weight:800;letter-spacing:.08em}.details strong{overflow-wrap:anywhere;color:#0878bb;font-size:16px;line-height:1.05}.role{color:#29a5d9;font-size:10px}.number-badge{width:34mm;margin-top:1mm;padding:1.2mm 3mm;border-radius:1.5mm;background:#e0f2fe;border:.3mm solid #7dd3fc}.number-badge .label,.number-badge strong{display:block}.number-badge strong{color:#172554;font-size:10px;letter-spacing:.04em}.meta{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-top:2mm}.meta span,.meta strong{display:block}.signature{position:absolute;z-index:4;bottom:12mm;left:0;width:100%;color:#172033;font-family:cursive;font-size:11px;text-align:center}.footer{position:absolute;z-index:3;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:space-between;padding:2mm 4mm;background:#304b9d;color:#fff;font-size:6px}.footer strong{letter-spacing:.08em}.footer i{font-style:normal;color:#fef3c7}
  </style></head><body><div class="card"><div class="topline"></div><div class="wave wave-one"></div><div class="wave wave-two"></div><div class="wave wave-three"></div><div class="header"><div class="mark">U</div><strong>SUNRISE INTERNATIONAL SCHOOL</strong></div><div class="body"><img src="${safePhoto}" alt="Student ID photo"><div class="details"><span class="label">STUDENT</span><strong>${safeName}</strong><span class="role">Student</span><div class="number-badge"><span class="label">ID NUMBER</span><strong>${safeId}</strong></div><div class="meta"><div><span class="label">CLASS</span><strong>${safeClass}</strong></div><div><span class="label">LEVEL</span><strong>${safeLevel}</strong></div></div></div></div><div class="signature">________________</div><div class="footer"><span>Official student identification</span><strong>VALID <i>${new Date().getFullYear()}</i></strong></div></div><script>window.onload=function(){window.print()}<\/script></body></html>`);
  printWindow.document.close();
}

async function deleteStudent(id) {
  if (!confirm('Delete this student account? This also deletes their reports and payment history.')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/students/${id}`);
  if (!ok) return alert(data.message);
  loadStudents();
  loadStats();
}

// ---------------------- SUBJECTS ----------------------
function formatAnnouncementDate(dateValue) {
  return new Date(dateValue).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function loadAnnouncements() {
  const announcements = await apiGet('/api/admin/announcements');
  const tbody = document.getElementById('announcements-table-body');

  tbody.innerHTML = announcements.length
    ? announcements.map((announcement) => `
      <tr>
        <td>${announcement.title}</td>
        <td>${announcement.message}</td>
        <td>${formatAnnouncementDate(announcement.created_at)}</td>
        <td>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" onclick="editAnnouncement(${announcement.id}, '${announcement.title.replace(/'/g, "\\'")}', '${announcement.message.replace(/'/g, "\\'")}')">Edit</button>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteAnnouncement(${announcement.id})">Delete</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="4">No announcements yet.</td></tr>';
}

function editAnnouncement(id, currentTitle, currentMessage) {
  const title = prompt('Edit announcement title:', currentTitle || '');
  if (title === null) return;
  const message = prompt('Edit announcement message:', currentMessage || '');
  if (message === null) return;

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  if (!trimmedTitle || !trimmedMessage) {
    return alert('Title and message cannot be empty.');
  }

  apiSend('PUT', `/api/admin/announcements/${id}`, {
    title: trimmedTitle,
    message: trimmedMessage,
  }).then(({ ok, data }) => {
    if (!ok) return alert(data.message);
    loadAnnouncements();
  });
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/announcements/${id}`);
  if (!ok) return alert(data.message);
  loadAnnouncements();
}

document.getElementById('announcement-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    title: document.getElementById('announcementTitle').value.trim(),
    message: document.getElementById('announcementMessage').value.trim(),
  };

  const { ok, data } = await apiSend('POST', '/api/admin/announcements', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadAnnouncements();
});

async function loadSubjects() {
  const subjects = await apiGet('/api/admin/subjects');
  const tbody = document.getElementById('subjects-table-body');

  tbody.innerHTML = subjects.length
    ? subjects.map((subject) => `
      <tr>
        <td>${subject.name}</td>
        <td>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-primary);border-color:rgba(79,70,229,0.2);" onclick="editSubject(${subject.id}, '${subject.name.replace(/'/g, "\\'")}' )">Edit</button>
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.8rem;color:var(--color-danger);border-color:var(--color-danger);margin-left:8px;" onclick="deleteSubject(${subject.id})">Delete</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="2">No subjects yet.</td></tr>';
}

async function deleteSubject(id) {
  if (!confirm('Delete this subject? It may be linked to student report data.')) return;
  const { ok, data } = await apiSend('DELETE', `/api/admin/subjects/${id}`);
  if (!ok) return alert(data.message);
  loadSubjects();
}

function editSubject(id, currentName) {
  const nextName = prompt('Edit subject name:', currentName);
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) return alert('Subject name cannot be empty.');

  apiSend('PUT', `/api/admin/subjects/${id}`, { name: trimmed })
    .then(({ ok, data }) => {
      if (!ok) return alert(data.message);
      loadSubjects();
    });
}

document.getElementById('subject-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById('subjectName').value.trim(),
  };

  const { ok, data } = await apiSend('POST', '/api/admin/subjects', payload);
  if (!ok) return alert(data.message);

  event.target.reset();
  loadSubjects();
});

async function searchStudents(query) {
  const resultsTable = document.getElementById('student-search-results');
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    resultsTable.innerHTML = '<tr><td colspan="6">Start typing to search students.</td></tr>';
    return;
  }

  const students = await apiGet('/api/admin/students');
  const matches = students.filter((student) => student.full_name.toLowerCase().includes(trimmedQuery.toLowerCase()));

  if (!matches.length) {
    resultsTable.innerHTML = '<tr><td colspan="6">No student matches your search.</td></tr>';
    return;
  }

  const rows = await Promise.all(matches.map(async (student) => {
    const trendMarkup = await getStudentTrend(student.id);
    return `
      <tr>
        <td>${student.student_id_number}</td>
        <td>${student.full_name}</td>
        <td>${student.classroom_name || '-'}</td>
        <td>${Number(student.total_fees_due).toFixed(2)}</td>
        <td>${Number(student.amount_paid).toFixed(2)}</td>
        <td>${trendMarkup}</td>
      </tr>`;
  }));

  resultsTable.innerHTML = rows.join('');
}

document.getElementById('admin-student-search').addEventListener('input', (event) => {
  searchStudents(event.target.value);
});

document.getElementById('admin-parent-email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusText = document.getElementById('admin-parent-email-status');
  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  statusText.className = '';
  statusText.textContent = 'Sending notice...';

  const { ok, data } = await apiSend('POST', '/api/admin/parent-notices', {
    subject: document.getElementById('admin-parent-email-subject').value.trim(),
    message: document.getElementById('admin-parent-email-message').value.trim(),
  });

  submitButton.disabled = false;
  if (!ok) {
    statusText.className = 'is-error';
    statusText.textContent = data.message || 'Could not send notice.';
    return;
  }

  event.target.reset();
  statusText.className = 'is-success';
  statusText.textContent = `Notice sent to ${data.recipientCount} parent email${data.recipientCount === 1 ? '' : 's'}.`;
});

// ---------------------- LOGOUT ----------------------
document.getElementById('logout-link').addEventListener('click', (event) => {
  event.preventDefault();
  localStorage.clear();
  window.location.href = '/login.html';
});

// ---------------------- INITIAL LOAD ----------------------
loadStats();
loadSchoolFees();
loadAdmissions();
loadClassrooms();
loadTeachers();
loadStudents();
loadAnnouncements();
loadSubjects();
