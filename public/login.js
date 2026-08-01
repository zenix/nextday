'use strict';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('error');
const submitBtn = document.getElementById('submitBtn');
const params = new URLSearchParams(location.search);
const redirectTo = params.get('next') && params.get('next').startsWith('/') ? params.get('next') : '/';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: document.getElementById('passphrase').value }),
    });
    if (res.ok) {
      location.href = redirectTo;
      return;
    }
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = res.status === 429
      ? (data.error || 'Too many attempts. Try again later.')
      : (data.error || 'Sign in failed.');
  } catch (err) {
    errorEl.textContent = 'Network error. Try again.';
  }
  submitBtn.disabled = false;
});
