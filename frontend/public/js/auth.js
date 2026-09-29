// public/js/auth.js
// Handles the login page: switching between Student/Teacher tabs,
// and sending login requests to our backend API.

// Switch between the Student, Teacher, and Admin login forms
function showTab(role) {
  // Toggle which tab looks "active"
  document.getElementById('tab-student').classList.toggle('active', role === 'student');
  document.getElementById('tab-teacher').classList.toggle('active', role === 'teacher');
  document.getElementById('tab-admin').classList.toggle('active', role === 'admin');

  // Show only the matching form, hide the other two
  document.getElementById('student-form').classList.toggle('form-hidden', role !== 'student');
  document.getElementById('teacher-form').classList.toggle('form-hidden', role !== 'teacher');
  document.getElementById('admin-form').classList.toggle('form-hidden', role !== 'admin');
}

// ---------------------- STUDENT LOGIN ----------------------
document.getElementById('student-form').addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the browser from doing a normal page-reload form submit

  const studentIdNumber = document.getElementById('studentIdNumber').value.trim();
  const password = document.getElementById('studentPassword').value;
  const errorBox = document.getElementById('student-error');
  errorBox.style.display = 'none'; // hide any previous error message

  try {
    // Send the login details to our backend
    const response = await fetch('/api/auth/student-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIdNumber, password }),
    });

    const data = await response.json(); // read the JSON response body

    if (!response.ok) {
      // Backend returned an error (e.g. wrong password) — show it to the user
      errorBox.textContent = data.message || 'Login failed.';
      errorBox.style.display = 'block';
      return;
    }

    // Save the token + user info in the browser so future pages can use them.
    // localStorage persists even after the tab is closed.
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    // Send the student to their dashboard
    window.location.href = '/student-dashboard.html';
  } catch (error) {
    errorBox.textContent = 'Could not reach the server. Please try again.';
    errorBox.style.display = 'block';
  }
});

// ---------------------- TEACHER LOGIN ----------------------
document.getElementById('teacher-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('teacherEmail').value.trim();
  const password = document.getElementById('teacherPassword').value;
  const errorBox = document.getElementById('teacher-error');
  errorBox.style.display = 'none';

  try {
    const response = await fetch('/api/auth/teacher-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      errorBox.textContent = data.message || 'Login failed.';
      errorBox.style.display = 'block';
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    window.location.href = '/teacher-dashboard.html';
  } catch (error) {
    errorBox.textContent = 'Could not reach the server. Please try again.';
    errorBox.style.display = 'block';
  }
});

// ---------------------- ADMIN LOGIN ----------------------
document.getElementById('admin-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const errorBox = document.getElementById('admin-error');
  errorBox.style.display = 'none';

  try {
    const response = await fetch('/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      errorBox.textContent = data.message || 'Login failed.';
      errorBox.style.display = 'block';
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    window.location.href = '/admin-dashboard.html';
  } catch (error) {
    errorBox.textContent = 'Could not reach the server. Please try again.';
    errorBox.style.display = 'block';
  }
});
