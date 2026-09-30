const setupForm = document.getElementById('admin-setup-form');
const setupError = document.getElementById('admin-setup-error');
const setupButton = document.getElementById('setup-admin-submit');

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setupError.style.display = 'none';

  const fullName = document.getElementById('setup-admin-name').value.trim();
  const email = document.getElementById('setup-admin-email').value.trim();
  const password = document.getElementById('setup-admin-password').value;
  const confirmation = document.getElementById('setup-admin-confirm-password').value;
  if (password !== confirmation) {
    setupError.textContent = 'The passwords do not match.';
    setupError.style.display = 'block';
    return;
  }

  setupButton.disabled = true;
  try {
    const response = await fetch('/api/auth/admin-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not create the admin login.');

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = '/admin-dashboard.html';
  } catch (error) {
    setupError.textContent = error.message || 'Could not reach the local server.';
    setupError.style.display = 'block';
    setupButton.disabled = false;
  }
});