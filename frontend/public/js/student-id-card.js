const statusMessage = document.getElementById('card-status');
const studentPhoto = document.getElementById('student-photo');
const photoInitials = document.getElementById('photo-initials');
const accessToken = localStorage.getItem('token');
let receivedProfile = false;

function printCard() {
  statusMessage.textContent = 'Student ID card is ready.';
  window.requestAnimationFrame(() => window.print());
}

function renderProfile(profile) {
  receivedProfile = true;
  const fullName = profile.name || 'Student';
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  document.getElementById('student-name').textContent = fullName;
  document.getElementById('student-number').textContent = profile.studentId || '-';
  document.getElementById('student-class').textContent = [profile.classroom, profile.level].filter((value) => value && value !== '-').join(' - ');
  photoInitials.textContent = initials || 'SI';

  if (!profile.photoUrl) {
    photoInitials.hidden = false;
    printCard();
    return;
  }

  studentPhoto.onload = () => {
    photoInitials.hidden = true;
    printCard();
  };
  studentPhoto.onerror = () => {
    studentPhoto.hidden = true;
    photoInitials.hidden = false;
    printCard();
  };
  studentPhoto.hidden = false;
  studentPhoto.src = profile.photoUrl;
}

async function loadAdminStudent(studentId) {
  const signedInUser = JSON.parse(localStorage.getItem('user') || 'null');
  if (!accessToken || signedInUser?.role !== 'admin') {
    statusMessage.textContent = 'Sign in as an administrator to print student ID cards.';
    return;
  }

  try {
    const response = await fetch('/api/admin/students', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const students = await response.json();
    if (!response.ok) throw new Error(students.message || 'Could not load student details.');

    const student = students.find((item) => String(item.id) === studentId);
    if (!student) throw new Error('Student not found.');

    renderProfile({
      name: student.full_name,
      studentId: student.student_id_number,
      classroom: student.classroom_name,
      level: student.classroom_level,
      photoUrl: student.photo_url || '',
    });
  } catch (error) {
    statusMessage.textContent = error.message || 'Could not load student details.';
  }
}

const studentId = new URLSearchParams(window.location.search).get('studentId');
if (studentId) {
  loadAdminStudent(studentId);
} else {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== window.opener || event.data?.type !== 'student-id-card-data' || receivedProfile) return;
    renderProfile(event.data.profile || {});
  });

  if (!window.opener || window.opener.closed) {
    statusMessage.textContent = 'Open this card from the student dashboard.';
  } else {
    window.opener.postMessage({ type: 'student-id-card-ready' }, window.location.origin);
  }
}

document.getElementById('school-logo').addEventListener('error', (event) => {
  event.currentTarget.hidden = true;
});
