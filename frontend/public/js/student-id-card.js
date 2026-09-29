const statusMessage = document.getElementById('card-status');
const studentPhoto = document.getElementById('student-photo');
const photoInitials = document.getElementById('photo-initials');
let receivedProfile = false;

function requestStudentProfile() {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: 'student-id-card-ready' }, window.location.origin);
    return;
  }

  statusMessage.textContent = 'Open this card from the student dashboard.';
}

function printCard() {
  statusMessage.textContent = 'Student ID card is ready.';
  window.requestAnimationFrame(() => window.print());
}

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.source !== window.opener || event.data?.type !== 'student-id-card-data' || receivedProfile) return;

  receivedProfile = true;
  const profile = event.data.profile || {};
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
});

requestStudentProfile();
const profileRequestInterval = window.setInterval(() => {
  if (receivedProfile) {
    window.clearInterval(profileRequestInterval);
    return;
  }
  requestStudentProfile();
}, 250);

document.getElementById('school-logo').addEventListener('error', (event) => {
  event.currentTarget.hidden = true;
});