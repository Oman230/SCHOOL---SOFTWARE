const accessToken = localStorage.getItem('token');
const signedInUser = JSON.parse(localStorage.getItem('user') || 'null');
const statementStatus = document.getElementById('statement-status');
const statementSheet = document.getElementById('statement-sheet');
const studentPicker = document.getElementById('student-picker');
const selectedStudentId = new URLSearchParams(window.location.search).get('studentId');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setText(id, value) {
  document.getElementById(id).textContent = value || '-';
}

function formatMoney(value) {
  return `GHS ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleDateString();
}

async function authorizedGet(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (response.status === 401 || response.status === 403) {
    localStorage.clear();
    window.location.href = '/login.html';
  }
  if (!response.ok) throw new Error(data.message || 'Could not load fee statement.');
  return data;
}

function renderStatement(statement) {
  const { school, student, payments } = statement;
  setText('school-name', school.name);
  setText('school-address', school.address);
  setText('school-contact', [school.phone, school.email].filter(Boolean).join(' | '));
  setText('student-name', student.full_name);
  setText('student-id', student.student_id_number);
  setText('student-class', [student.classroom_name, student.classroom_level].filter(Boolean).join(' - '));
  setText('academic-year', student.academic_year);
  setText('parent-name', student.parent_name);
  setText('parent-contact', [student.parent_phone, student.parent_email].filter(Boolean).join(' | '));
  setText('finance-officer', statement.financeOfficer);
  setText('statement-date', new Date().toLocaleDateString());

  const owing = Number(student.arrears || 0);
  document.getElementById('account-row').innerHTML = `
    <tr>
      <td>${escapeHtml(student.academic_year || '-')}</td>
      <td class="amount ${owing > 0 ? 'owing' : 'paid'}">${formatMoney(student.amount_due)}</td>
      <td class="amount ${Number(student.amount_paid) > 0 ? 'paid' : 'neutral'}">${formatMoney(student.amount_paid)}</td>
      <td class="amount ${owing > 0 ? 'owing' : 'paid'}">${formatMoney(owing)}</td>
    </tr>`;

  const history = document.getElementById('payment-history');
  history.innerHTML = payments.length
    ? payments.map((payment) => `
      <tr>
        <td>${escapeHtml(formatDate(payment.paid_at))}</td>
        <td>${escapeHtml(payment.academic_year || 'Not recorded')}</td>
        <td>${escapeHtml(payment.classroom_name || 'Not recorded')}</td>
        <td>${escapeHtml(payment.payment_method === 'cash' ? 'Cash' : 'Paystack')}</td>
        <td>${escapeHtml(payment.paystack_reference || '-')}</td>
        <td class="amount paid">${formatMoney(payment.amount)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty-history">No successful payments have been recorded.</td></tr>';

  setText('history-note', statement.historyNote);
  statementSheet.hidden = false;
  statementStatus.textContent = `Fee statement for ${student.full_name}`;
  document.title = `${student.full_name} - Fee Statement`;
}

async function loadStatement(studentId) {
  if (!studentId) {
    statementSheet.hidden = true;
    statementStatus.textContent = 'Choose a student to view their fee statement.';
    return;
  }

  statementStatus.textContent = 'Loading fee statement...';
  try {
    const endpoint = signedInUser.role === 'admin'
      ? `/api/admin/students/${encodeURIComponent(studentId)}/fee-statement`
      : '/api/students/me/fee-statement';
    renderStatement(await authorizedGet(endpoint));
  } catch (error) {
    statementSheet.hidden = true;
    statementStatus.textContent = error.message || 'Could not load fee statement.';
  }
}

async function initialize() {
  if (!accessToken || !signedInUser || !['admin', 'student'].includes(signedInUser.role)) {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('print-statement').addEventListener('click', () => window.print());

  if (signedInUser.role === 'student') {
    await loadStatement(signedInUser.id);
    return;
  }

  document.getElementById('student-picker-label').hidden = false;
  studentPicker.hidden = false;
  studentPicker.addEventListener('change', () => loadStatement(studentPicker.value));

  try {
    const students = await authorizedGet('/api/admin/students');
    studentPicker.innerHTML = '<option value="">Choose a student</option>' + students.map((student) => (
      `<option value="${escapeHtml(student.id)}">${escapeHtml(student.full_name)} — ${escapeHtml(student.student_id_number)}</option>`
    )).join('');
    if (selectedStudentId && students.some((student) => String(student.id) === selectedStudentId)) {
      studentPicker.value = selectedStudentId;
    }
    await loadStatement(studentPicker.value);
  } catch (error) {
    statementStatus.textContent = error.message || 'Could not load students.';
  }
}

initialize();
