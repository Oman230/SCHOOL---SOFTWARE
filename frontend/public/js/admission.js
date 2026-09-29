const form = document.getElementById('admission-form');
const statusText = document.getElementById('admission-status');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const payload = Object.fromEntries(new FormData(form).entries());
  payload.declarationAccepted = document.getElementById('declarationAccepted').checked;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  statusText.className = '';
  statusText.textContent = 'Submitting your application...';

  try {
    const response = await fetch('/api/admissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not submit application.');

    form.reset();
    statusText.className = 'is-success';
    statusText.textContent = `Application received. Your reference is ${data.applicationNumber}. `;
    const pdfLink = document.createElement('a');
    pdfLink.className = 'admission-print-link';
    pdfLink.href = `/api/admissions/reference/${encodeURIComponent(data.applicationNumber)}/pdf`;
    pdfLink.target = '_blank';
    pdfLink.rel = 'noopener';
    pdfLink.textContent = 'Print / download your PDF copy';
    statusText.appendChild(pdfLink);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } catch (error) {
    statusText.className = 'is-error';
    statusText.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
