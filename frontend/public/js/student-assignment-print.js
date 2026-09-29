const assignmentStatus = document.getElementById('print-status');
const assignmentId = new URLSearchParams(window.location.search).get('id');
const token = localStorage.getItem('token');

function formatAssignmentDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
}

function appendAttachment(file) {
  const list = document.getElementById('assignment-files');
  const validImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type || '')
    && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(file.data || '');

  if (validImage) {
    const figure = document.createElement('figure');
    figure.className = 'assignment-file-image';
    const image = document.createElement('img');
    image.src = file.data;
    image.alt = file.name || 'Assignment image';
    image.addEventListener('error', () => {
      figure.remove();
    }, { once: true });
    const caption = document.createElement('figcaption');
    caption.textContent = file.name || 'Attached image';
    figure.append(image, caption);
    list.appendChild(figure);
    return;
  }

  const link = document.createElement('a');
  link.className = 'assignment-file-link';
  link.href = file.data;
  link.download = file.name || 'assignment-attachment';
  link.textContent = `Download attachment: ${file.name || 'Assignment resource'}`;
  list.appendChild(link);
}

function renderAssignment(assignment) {
  document.getElementById('assignment-title').textContent = assignment.title || 'Assignment';
  document.getElementById('assignment-teacher').textContent = assignment.teacher_name || '-';
  document.getElementById('assignment-posted').textContent = formatAssignmentDate(assignment.created_at);
  document.getElementById('assignment-due').textContent = formatAssignmentDate(assignment.due_date);
  document.getElementById('assignment-content').innerHTML = assignment.content_html || '';

  const attachments = Array.isArray(assignment.attachments) ? assignment.attachments : [];
  const filesSection = document.getElementById('assignment-files-section');
  if (attachments.length) {
    attachments.forEach(appendAttachment);
    filesSection.hidden = false;
  }

  document.getElementById('assignment-sheet').hidden = false;
  document.title = `${assignment.title || 'Assignment'} | Sunrise International School`;
  assignmentStatus.textContent = 'Assignment ready to print or save as PDF.';
}

async function loadAssignment() {
  if (!assignmentId || !token) {
    assignmentStatus.textContent = 'Sign in through the student dashboard to view this assignment.';
    return;
  }

  try {
    const response = await fetch('/api/students/me/assignments', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const assignments = await response.json();
    if (!response.ok) throw new Error(assignments.message || 'Could not load this assignment.');

    const assignment = assignments.find((item) => String(item.id) === String(assignmentId));
    if (!assignment) throw new Error('This assignment is no longer available.');
    renderAssignment(assignment);
  } catch (error) {
    assignmentStatus.textContent = error.message || 'Could not load this assignment.';
  }
}

document.getElementById('school-logo').addEventListener('error', (event) => {
  event.currentTarget.hidden = true;
});

loadAssignment();