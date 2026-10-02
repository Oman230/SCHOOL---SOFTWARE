document.addEventListener('click', (event) => {
  const toggle = event.target.closest('.password-toggle');
  if (!toggle) return;

  const passwordInput = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!passwordInput) return;

  const isVisible = passwordInput.type === 'text';
  passwordInput.type = isVisible ? 'password' : 'text';
  toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
  toggle.setAttribute('title', isVisible ? 'Show password' : 'Hide password');
  toggle.setAttribute('aria-pressed', String(!isVisible));
  toggle.closest('.password-field').classList.toggle('is-visible', !isVisible);
});