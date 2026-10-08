const reportStatus = document.getElementById('report-status');
const reportId = new URLSearchParams(window.location.search).get('id');
const accessToken = localStorage.getItem('token');

function setText(id, value) {
  document.getElementById(id).textContent = value || '-';
}

function proficiencyForScore(score) {
  if (score >= 80) return { level: 'L1', name: 'Highly Proficient / Advanced', remark: 'Excellent performance. Keep it up. Shows high understanding.' };
  if (score >= 65) return { level: 'L2', name: 'Proficient', remark: 'Very good performance. Could achieve more with little effort.' };
  if (score >= 50) return { level: 'L3', name: 'Approaching Proficiency', remark: 'Good effort shown. Needs improvement.' };
  if (score >= 35) return { level: 'L4', name: 'Developing', remark: 'Developing interest. Requires intensive support.' };
  return { level: 'L5-L6', name: 'Below Standard / Beginning', remark: 'Developing interest. Requires intensive support.' };
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
}

function appendScoreRow(score) {
  const row = document.createElement('tr');
  const values = [
    score.subject_name || '-',
    Number(score.class_score || 0).toFixed(2),
    Number(score.exam_score || 0).toFixed(2),
    Number(score.total_score || 0).toFixed(2),
    proficiencyForScore(Number(score.total_score || 0)).level,
    proficiencyForScore(Number(score.total_score || 0)).remark,
  ];

  values.forEach((value, index) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (index === 4) cell.className = 'proficiency-cell';
    if (index === 5) cell.className = 'teacher-remark-cell';
    row.appendChild(cell);
  });
  document.getElementById('score-rows').appendChild(row);
}

function showReport(report) {
  const scores = Array.isArray(report.scores) ? report.scores : [];
  const fullName = report.student_name || 'Student';
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const photo = document.getElementById('student-photo');
  const initialsElement = document.getElementById('student-initials');

  setText('student-name', fullName);
  setText('student-id', report.student_id_number);
  setText('student-birthday', formatDate(report.student_date_of_birth));
  setText('student-class', report.classroom_name);
  setText('student-gender', report.student_gender);
  setText('class-level', report.classroom_level);
  setText('academic-year', report.academic_year);
  setText('term', report.term);
  setText('attendance', report.attendance);
  setText('teacher-name', report.teacher_name);
  setText('report-period', `${report.term || 'Term'} | ${report.academic_year || ''}`);
  setText('class-remark', report.class_teacher_remark);
  setText('head-remark', report.promotion_status || report.headteacher_remark);
  setText('promotion-destination', report.promoted_to);
  setText('attitude-values-competencies', report.attitude_values_competencies);
  setText('report-issue', `${report.term || 'Term'} ${report.academic_year || ''} | Official student academic record`);
  initialsElement.textContent = initials || 'ST';

  const average = scores.length
    ? scores.reduce((total, score) => total + Number(score.total_score || 0), 0) / scores.length
    : 0;
  const overallProficiency = proficiencyForScore(average);
  setText('overall-grade', `${overallProficiency.level} — ${overallProficiency.name}`);
  setText('overall-average', `${average.toFixed(2)}%`);
  setText('subject-count', String(scores.length));

  const tableBody = document.getElementById('score-rows');
  if (scores.length) {
    scores.forEach(appendScoreRow);
  } else {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'No subject results have been recorded.';
    row.appendChild(cell);
    tableBody.appendChild(row);
  }

  if (report.student_photo_url) {
    photo.onload = () => { initialsElement.hidden = true; };
    photo.onerror = () => { photo.hidden = true; };
    photo.hidden = false;
    photo.src = report.student_photo_url;
  }

  document.getElementById('report-sheet').hidden = false;
  reportStatus.textContent = 'Report ready to print.';
  document.title = `${fullName} | ${report.term || 'Terminal'} Report`;
}

async function loadReport() {
  if (!reportId || !accessToken) {
    reportStatus.textContent = 'A valid report and signed-in account are required to view this page.';
    return;
  }

  try {
    const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const report = await response.json();
    if (!response.ok) throw new Error(report.message || 'Could not load this report.');
    showReport(report);
  } catch (error) {
    reportStatus.textContent = error.message || 'Could not load this report.';
  }
}

document.getElementById('school-logo').addEventListener('error', (event) => {
  event.currentTarget.hidden = true;
});
document.getElementById('student-photo').addEventListener('load', () => {
  document.getElementById('student-initials').hidden = true;
});

loadReport();