const form = document.querySelector('#login-form');
const password = document.querySelector('#login-password');
const error = document.querySelector('#login-error');
const submit = document.querySelector('#login-submit');

form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  error.classList.add('hidden');
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    const result = await response.json();
    if (!response.ok) {
      error.textContent = result.error || 'Não foi possível entrar.';
      error.classList.remove('hidden');
      password.select();
      return;
    }
    location.replace('/');
  } catch {
    error.textContent = 'O servidor não respondeu. Verifique a conexão segura.';
    error.classList.remove('hidden');
  } finally {
    submit.disabled = false;
  }
});
