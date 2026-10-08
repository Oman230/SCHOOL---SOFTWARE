// public/js/student.js
// Powers the student dashboard: loads the student's profile + reports from
// the API, and handles paying fees through Paystack's inline popup.

const token = localStorage.getItem('token'); // the login token saved during login
const user = JSON.parse(localStorage.getItem('user') || 'null');

// If there's no token, the student isn't logged in — send them back to login
if (!token || !user || user.role !== 'student') {
  window.location.href = '/login.html';
}

// Small helper so we don't repeat "attach the token to every request"
async function apiGet(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    // token missing/expired — force a fresh login
    localStorage.clear();
    window.location.href = '/login.html';
  }
  return response.json();
}

let currentProfile = null; // keep the loaded profile around so the payment step can reuse the email

// ---------------------- LOAD PROFILE ----------------------
async function loadProfile() {
  const profile = await apiGet('/api/students/me');
  currentProfile = profile;

  // Fill in the welcome heading and profile table
  document.getElementById('welcome-heading').textContent = `Welcome, ${profile.full_name}!`;
  document.getElementById('profile-name').textContent = profile.full_name;
  document.getElementById('profile-id').textContent = profile.student_id_number;
  document.getElementById('profile-email').textContent = profile.email || '-';
  document.getElementById('profile-gender').textContent = profile.gender || '-';
  document.getElementById('profile-dob').textContent = profile.date_of_birth
    ? new Date(profile.date_of_birth).toLocaleDateString()
    : '-';
  document.getElementById('parent-name').textContent = profile.parent_name || '-';
  document.getElementById('parent-email').textContent = profile.parent_email || '-';
  document.getElementById('parent-phone').textContent = profile.parent_phone || '-';

  const profilePhoto = document.getElementById('profile-photo');
  const fallbackPhoto = '/assets/logo.png';
  profilePhoto.src = profile.photo_url || fallbackPhoto;
  profilePhoto.alt = `${profile.full_name || 'Student'} profile picture`;

  // Fill in the quick stat boxes
  document.getElementById('stat-classroom').textContent = profile.classroom_name || '-';
  document.getElementById('stat-level').textContent = profile.classroom_level || '-';
  document.getElementById('stat-fees-due').textContent = Number(profile.total_fees_due).toFixed(2);
  document.getElementById('stat-balance').textContent = Number(profile.balance).toFixed(2);

  // Fill in the fees section
  document.getElementById('fees-amount-paid').textContent = `GHS ${Number(profile.amount_paid).toFixed(2)}`;
  document.getElementById('fees-balance').textContent = `GHS ${Number(profile.balance).toFixed(2)}`;
}

async function loadAttendance() {
  const tbody = document.getElementById('student-attendance-table-body');
  try {
    const attendance = await apiGet('/api/students/me/attendance');
    const counts = attendance.counts || {};
    ['present', 'absent', 'late', 'excused'].forEach((status) => {
      document.getElementById(`attendance-${status}-count`).textContent = counts[status] || 0;
    });
    tbody.innerHTML = attendance.records.length
      ? attendance.records.map((record) => `<tr><td>${new Date(`${record.attendance_date}T00:00:00`).toLocaleDateString()}</td><td><span class="attendance-badge ${record.status}">${record.status[0].toUpperCase()}${record.status.slice(1)}</span></td><td>${record.notes || '-'}</td></tr>`).join('')
      : '<tr><td colspan="3">No attendance has been recorded yet.</td></tr>';
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="3">Attendance is unavailable right now.</td></tr>';
  }
}

function escapeAssignmentText(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function renderStudentAssignmentAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return '';

  return `<div class="assignment-attachments">${attachments.map((file) => {
    const name = escapeAssignmentText(file.name || 'Attachment');
    const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type || '') && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(file.data || '');
    return `
      <div class="student-assignment-attachment">
        ${isImage ? `<img src="${file.data}" alt="${name}" loading="lazy" />` : ''}
        <a href="${file.data}" download="${name}" class="btn btn-outline">Download ${name}</a>
      </div>`;
  }).join('')}</div>`;
}

async function loadAssignments() {
  const container = document.getElementById('student-assignment-list');
  try {
    const assignments = await apiGet('/api/students/me/assignments');
    container.innerHTML = assignments.length
      ? assignments.map((assignment) => `
        <article class="assignment-item">
          <div class="assignment-item-header"><div><span class="eyebrow">Assignment</span><h4>${escapeAssignmentText(assignment.title)}</h4></div><div class="student-assignment-actions"><span>${new Date(assignment.created_at).toLocaleDateString()}</span><a class="btn btn-outline assignment-print-button" href="/student-assignment-print.html?id=${encodeURIComponent(assignment.id)}" target="_blank" rel="noopener">Print / Save PDF</a></div></div>
          <div class="assignment-content">${assignment.content_html}</div>
          <div class="assignment-item-footer"><span>Teacher: ${escapeAssignmentText(assignment.teacher_name)}</span>${assignment.due_date ? `<strong>Due ${new Date(`${assignment.due_date}T00:00:00`).toLocaleDateString()}</strong>` : ''}</div>
          ${renderStudentAssignmentAttachments(assignment.attachments)}
        </article>`).join('')
      : '<p class="empty-state">No assignments have been posted for your class yet.</p>';
  } catch (error) {
    container.innerHTML = '<p class="empty-state">Assignments are unavailable right now.</p>';
  }
}

function generateStudentIdCard() {
  if (!currentProfile) return;

  let cardWindow;
  const handleCardReady = (event) => {
    if (event.origin !== window.location.origin || event.source !== cardWindow || event.data?.type !== 'student-id-card-ready') return;

    window.removeEventListener('message', handleCardReady);
    event.source.postMessage({
      type: 'student-id-card-data',
      profile: {
        name: currentProfile.full_name || '-',
        studentId: currentProfile.student_id_number || '-',
        classroom: currentProfile.classroom_name || '-',
        level: currentProfile.classroom_level || '-',
        photoUrl: currentProfile.photo_url || '',
      },
    }, window.location.origin);
  };

  window.addEventListener('message', handleCardReady);
  cardWindow = window.open('/student-id-card.html', '_blank');
  if (!cardWindow) {
    window.removeEventListener('message', handleCardReady);
    alert('Please allow pop-ups to generate your student ID card.');
  }
}

// ---------------------- LOAD REPORTS ----------------------
function getProficiencyFromScore(value) {
  if (value >= 80) return { level: 'L1', name: 'Highly Proficient / Advanced', remark: 'Excellent performance. Keep it up. Shows high understanding.' };
  if (value >= 65) return { level: 'L2', name: 'Proficient', remark: 'Very good performance. Could achieve more with little effort.' };
  if (value >= 50) return { level: 'L3', name: 'Approaching Proficiency', remark: 'Good effort shown. Needs improvement.' };
  if (value >= 35) return { level: 'L4', name: 'Developing', remark: 'Developing interest. Requires intensive support.' };
  return { level: 'L5-L6', name: 'Below Standard / Beginning', remark: 'Developing interest. Requires intensive support.' };
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

function renderTrendPill(element, trend) {
  if (!element || !trend) return;

  element.innerHTML = `
    <span class="trend-pill ${trend.tone}">
      <span class="trend-icon">${trend.icon}</span>
      ${trend.text}
    </span>
  `;
}

async function viewReportDetails(reportId) {
  try {
    const [report, reportHistory] = await Promise.all([
      apiGet(`/api/reports/${reportId}`),
      apiGet('/api/students/me/reports')
    ]);
    const panel = document.getElementById('report-detail-panel');
    const section = document.getElementById('report-details-section');

    const scores = Array.isArray(report.scores) ? report.scores : [];
    const totalScores = scores.map((score) => ({
      subject_name: score.subject_name || 'Subject',
      total: Number(score.total_score || 0),
    }));

    const bestSubject = totalScores.length
      ? totalScores.reduce((best, current) => (current.total > best.total ? current : best), totalScores[0])
      : { subject_name: '—', total: 0 };

    const weakestSubject = totalScores.length
      ? totalScores.reduce((lowest, current) => (current.total < lowest.total ? current : lowest), totalScores[0])
      : { subject_name: '—', total: 0 };

    const averageScore = totalScores.length
      ? totalScores.reduce((sum, item) => sum + item.total, 0) / totalScores.length
      : 0;

    let trend = { text: 'No previous report yet', tone: 'neutral', icon: '•' };

    const previousReport = Array.isArray(reportHistory)
      ? [...reportHistory]
          .filter((item) => Number(item.id) !== Number(reportId))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
      : null;

    if (previousReport) {
      const previousReportData = await apiGet(`/api/reports/${previousReport.id}`);
      const previousScores = Array.isArray(previousReportData.scores) ? previousReportData.scores : [];
      const previousAverage = previousScores.length
        ? previousScores.reduce((sum, score) => sum + Number(score.total_score || 0), 0) / previousScores.length
        : 0;

      trend = getTrendMeta(averageScore, previousAverage);
    }

    const overallProficiency = getProficiencyFromScore(averageScore);

    const scoresHtml = scores.length
      ? scores.map((score) => {
          const total = Number(score.total_score || 0);
          const proficiency = getProficiencyFromScore(total);
          return `
            <tr>
              <td>${score.subject_name}</td>
              <td><span class="score-badge">${Number(score.class_score).toFixed(2)} / 50</span></td>
              <td><span class="score-badge">${Number(score.exam_score).toFixed(2)} / 50</span></td>
              <td><span class="score-badge">${total.toFixed(2)}</span></td>
              <td><span class="grade-badge">${proficiency.level} — ${proficiency.name}</span></td>
              <td>${proficiency.remark}</td>
            </tr>`;
        }).join('')
      : '<tr><td colspan="6">No subject scores available for this report yet.</td></tr>';

    panel.innerHTML = `
      <div class="report-summary-strip">
        <div class="summary-box">
          <span>Best subject</span>
          <strong>${bestSubject.subject_name}</strong>
          <small>${bestSubject.total.toFixed(2)}%</small>
        </div>
        <div class="summary-box">
          <span>Weakest subject</span>
          <strong>${weakestSubject.subject_name}</strong>
          <small>${weakestSubject.total.toFixed(2)}%</small>
        </div>
        <div class="summary-box">
          <span>Overall proficiency</span>
          <strong>${averageScore.toFixed(2)}%</strong>
          <small class="grade-badge">${overallProficiency.level} — ${overallProficiency.name}</small>
        </div>
        <div class="summary-box">
          <span>Teacher</span>
          <strong>${report.teacher_name || '-'}</strong>
          <small>${report.attendance || 'N/A'}</small>
        </div>
      </div>

      <div class="trend-row">
        <span class="trend-label">Improvement trend</span>
        <span class="trend-pill ${trend.tone}"><span class="trend-icon">${trend.icon}</span> ${trend.text}</span>
      </div>

      <div class="report-detail-summary">
        <div class="summary-box">
          <span>Academic Year</span>
          <strong>${report.academic_year}</strong>
        </div>
        <div class="summary-box">
          <span>Term</span>
          <strong>${report.term}</strong>
        </div>
        <div class="summary-box">
          <span>Attendance</span>
          <strong>${report.attendance || '-'}</strong>
        </div>
      </div>

      <p style="margin:0 0 10px; color:var(--color-muted);"><strong>Class remark:</strong> ${report.class_teacher_remark || '-'}</p>
      <p style="margin:0 0 10px; color:var(--color-muted);"><strong>Attitude, values and core competencies:</strong> ${report.attitude_values_competencies || '-'}</p>
      <p style="margin:0 0 18px; color:var(--color-muted);"><strong>Head teacher's promotion decision:</strong> ${report.promotion_status || report.headteacher_remark || '-'}${report.promoted_to ? ` — ${report.promoted_to}` : ''}</p>

      <div class="table-scroll">
        <table class="report-detail-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>SBA / 50</th>
              <th>End-of-Term Exam / 50</th>
              <th>Final / 100</th>
              <th>Proficiency Level</th>
              <th>Teacher Remark</th>
            </tr>
          </thead>
          <tbody>${scoresHtml}</tbody>
        </table>
      </div>
    `;

    panel.classList.remove('is-visible');
    requestAnimationFrame(() => panel.classList.add('is-visible'));
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    console.error(error);
    alert('Could not load report details right now.');
  }
}

async function updateDashboardTrend(reports) {
  const classroomTrend = document.getElementById('stat-classroom-trend');
  const levelTrend = document.getElementById('stat-level-trend');

  if (!reports.length || !classroomTrend || !levelTrend) return;

  const latestReport = reports[0];
  const previousReport = [...reports]
    .filter((report) => Number(report.id) !== Number(latestReport.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

  if (!previousReport) {
    renderTrendPill(classroomTrend, { text: 'No previous report yet', tone: 'neutral', icon: '•' });
    renderTrendPill(levelTrend, { text: 'No previous report yet', tone: 'neutral', icon: '•' });
    return;
  }

  try {
    const [latestData, previousData] = await Promise.all([
      apiGet(`/api/reports/${latestReport.id}`),
      apiGet(`/api/reports/${previousReport.id}`),
    ]);

    const latestScores = Array.isArray(latestData.scores) ? latestData.scores : [];
    const previousScores = Array.isArray(previousData.scores) ? previousData.scores : [];

    const latestAverage = latestScores.length
      ? latestScores.reduce((sum, score) => sum + Number(score.total_score || 0), 0) / latestScores.length
      : 0;

    const previousAverage = previousScores.length
      ? previousScores.reduce((sum, score) => sum + Number(score.total_score || 0), 0) / previousScores.length
      : 0;

    const trend = getTrendMeta(latestAverage, previousAverage);
    renderTrendPill(classroomTrend, trend);
    renderTrendPill(levelTrend, trend);
  } catch (error) {
    console.error('Failed to load dashboard report trend:', error);
    renderTrendPill(classroomTrend, { text: 'Trend unavailable', tone: 'neutral', icon: '•' });
    renderTrendPill(levelTrend, { text: 'Trend unavailable', tone: 'neutral', icon: '•' });
  }
}

async function loadReports() {
  const reports = await apiGet('/api/students/me/reports');
  const tbody = document.getElementById('reports-table-body');

  if (!reports.length) {
    tbody.innerHTML = '<tr><td colspan="4">No reports have been published yet.</td></tr>';
    document.getElementById('report-details-section').style.display = 'none';
    return;
  }

  await updateDashboardTrend(reports);

  tbody.innerHTML = reports
    .map((report) => `
      <tr>
        <td>${report.academic_year}</td>
        <td>${report.term}</td>
        <td>${new Date(report.created_at).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-primary" style="padding:6px 14px;font-size:0.85rem;" onclick="viewReportDetails(${report.id})">View Details</button>
          <button class="btn btn-outline" style="padding:6px 14px;font-size:0.85rem; margin-left:8px;" onclick="printReport(${report.id})">Print PDF</button>
        </td>
      </tr>`)
    .join('');
}

async function loadAnnouncements() {
  const container = document.getElementById('student-announcement-list');

  try {
    const response = await fetch('/api/announcements/public');
    if (!response.ok) throw new Error('Failed to load announcements');
    const announcements = await response.json();

    if (!announcements.length) {
      container.innerHTML = '<p class="empty-state">No school announcements yet. Check back soon.</p>';
      return;
    }

    const sortedAnnouncements = [...announcements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    container.innerHTML = sortedAnnouncements.map((announcement) => `
      <article class="announcement-item">
        <div class="announcement-meta">
          <span>School notice</span>
          <span>${new Date(announcement.created_at).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <h3>${announcement.title}</h3>
        <p>${announcement.message}</p>
      </article>
    `).join('');
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="empty-state">Announcements are unavailable right now.</p>';
  }
}

// Open the tab during the tap; Safari blocks tabs opened after an async fetch.
async function printReport(reportId) {
  const pdfWindow = window.open('about:blank', '_blank');
  try {
    const response = await fetch(`/api/reports/${reportId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Could not open report PDF.');
    const fileUrl = URL.createObjectURL(await response.blob());
    if (pdfWindow) pdfWindow.location.href = fileUrl;
    else window.location.href = fileUrl;
  } catch (error) {
    if (pdfWindow) pdfWindow.close();
    alert(error.message || 'Could not open report PDF.');
  }
}

// ---------------------- PAY FEES (Paystack) ----------------------
function loadPaystackInlineCheckout() {
  if (window.PaystackPop) return Promise.resolve(true);

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.onload = () => resolve(Boolean(window.PaystackPop));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

document.getElementById('pay-fees-btn').addEventListener('click', async () => {
  const amountInput = document.getElementById('pay-amount');
  const amount = parseFloat(amountInput.value);
  const statusText = document.getElementById('payment-status');

  if (!amount || amount <= 0) {
    statusText.style.color = 'var(--color-danger)';
    statusText.textContent = 'Please enter a valid amount before paying.';
    return;
  }

  if (!currentProfile) return; // profile hasn't loaded yet, ignore the click

  if (!window.PAYSTACK_ENABLED) {
    statusText.style.color = 'var(--color-danger)';
    statusText.textContent = 'Paystack is not configured. Add your keys to the desktop settings file.';
    return;
  }

  if (!navigator.onLine) {
    statusText.style.color = 'var(--color-danger)';
    statusText.textContent = 'Paystack checkout requires an internet connection.';
    return;
  }

  if (!(await loadPaystackInlineCheckout())) {
    statusText.style.color = 'var(--color-danger)';
    statusText.textContent = 'Could not load Paystack. Check your internet connection and try again.';
    return;
  }

  // Open Paystack's popup checkout right here on the dashboard (no page reload needed)
  const handler = PaystackPop.setup({
    key: window.PAYSTACK_PUBLIC_KEY || 'pk_live_640af2ad6192f7fb1f3c02421b6ee947a14cdf74',
    email: currentProfile.email || `student${user.id}@school.local`,
    amount: Math.round(amount * 100), // Paystack expects the smallest currency unit (pesewas)
    currency: 'GHS',
    ref: `SIS-${Date.now()}`, // a unique reference for this transaction attempt

    // Runs automatically once the student completes payment in the popup
    callback: function (response) {
      statusText.style.color = 'var(--color-primary)';
      statusText.textContent = 'Payment received, confirming with the server...';
      verifyPaymentOnServer(response.reference);
    },

    // Runs if the student closes the popup without paying
    onClose: function () {
      statusText.style.color = 'var(--color-muted)';
      statusText.textContent = 'Payment window closed.';
    },
  });

  handler.openIframe(); // actually show the Paystack popup
});

// Confirms the payment with OUR backend (which double-checks with Paystack's
// servers) before trusting it, then refreshes the balance shown on screen.
async function verifyPaymentOnServer(reference) {
  const statusText = document.getElementById('payment-status');
  try {
    const response = await fetch(`/api/payments/verify/${reference}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();

    if (!response.ok) {
      statusText.style.color = 'var(--color-danger)';
      statusText.textContent = data.message || 'Could not confirm payment.';
      return;
    }

    statusText.style.color = 'var(--color-success)';
    statusText.textContent = `Payment of GHS ${data.amountPaid.toFixed(2)} confirmed! Balance updated. `;
    const receiptLink = document.createElement('a');
    receiptLink.href = `/api/payments/receipt/${encodeURIComponent(data.paymentId)}/pdf`;
    receiptLink.target = '_blank';
    receiptLink.rel = 'noopener';
    receiptLink.textContent = 'Print / download receipt';
    receiptLink.style.marginLeft = '8px';
    receiptLink.style.color = 'var(--color-primary)';
    receiptLink.style.textDecoration = 'underline';
    statusText.appendChild(receiptLink);
    if (!data.parentEmailSent && currentProfile.parent_email) {
      const emailNote = document.createElement('small');
      emailNote.textContent = ' Parent email could not be sent; your receipt is ready above.';
      emailNote.style.display = 'block';
      emailNote.style.color = 'var(--color-muted)';
      statusText.appendChild(emailNote);
    }

    // Reload the profile so the fee stats/balance on screen reflect the new payment
    loadProfile();
  } catch (error) {
    statusText.style.color = 'var(--color-danger)';
    statusText.textContent = 'Network error while confirming payment.';
  }
}

// ---------------------- LOGOUT ----------------------
document.getElementById('student-photo-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const photoInput = document.getElementById('studentPhotoUpload');
  if (!photoInput || !photoInput.files || !photoInput.files[0]) {
    alert('Please choose a profile photo to upload.');
    return;
  }

  const reader = new FileReader();
  const photoUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.readAsDataURL(photoInput.files[0]);
  });

  const response = await fetch('/api/students/me/photo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ photoUrl }),
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not upload profile photo.');
    return;
  }

  document.getElementById('profile-photo').src = photoUrl;
  currentProfile.photo_url = photoUrl;
  event.target.reset();
  alert('Profile photo updated successfully.');
});

document.getElementById('logout-link').addEventListener('click', (event) => {
  event.preventDefault();
  localStorage.clear(); // remove the saved token/user
  window.location.href = '/login.html';
});

document.getElementById('generate-id-card-btn').addEventListener('click', generateStudentIdCard);

// ---------------------- INITIAL LOAD ----------------------
loadProfile();
loadAttendance();
loadAssignments();
window.addEventListener('focus', loadAssignments);
window.setInterval(() => {
  if (document.visibilityState === 'visible') loadAssignments();
}, 60000);
loadReports();
loadAnnouncements();
