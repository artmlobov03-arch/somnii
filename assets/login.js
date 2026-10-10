import { $, api, post, themeSetup } from './common.js';
themeSetup();
let mode = 'login';
const params = new URLSearchParams(location.search);
const dream = params.get('dream');
const destination = params.get('next') === 'chat' ? `chat.html${/^[a-f0-9-]{36}$/.test(dream || '') ? `?dream=${dream}` : ''}` : 'account.html';
function selectMode(value) {
  mode = value;
  const register = mode === 'register';
  $('#nameLabel').hidden = $('#confirmLabel').hidden = !register;
  $('#name').required = $('#confirmPassword').required = register;
  $('#password').autocomplete = register ? 'new-password' : 'current-password';
  $('#formTitle').textContent = register ? 'Начнём вашу историю' : 'С возвращением';
  $('#formSubtitle').textContent = register ? 'Создайте место для своих снов и наблюдений.' : 'Продолжим вашу историю сновидений.';
  $('#submitAuth').textContent = register ? 'Создать аккаунт' : 'Войти';
  for (const [id, selected] of [['loginTab', !register], ['registerTab', register]]) {
    $(
      `#${id}`
    ).setAttribute('aria-selected', String(selected));
    $(`#${id}`).tabIndex = selected ? 0 : -1;
  }
  $('#authError').textContent = '';
}
for (const [id, value] of [['loginTab', 'login'], ['registerTab', 'register']]) {
  $(`#${id}`).addEventListener('click', () => selectMode(value));
  $(`#${id}`).addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); selectMode(mode === 'login' ? 'register' : 'login');
      $(mode === 'login' ? '#loginTab' : '#registerTab').focus();
    }
  });
}
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#submitAuth');
  $('#authError').textContent = '';
  if (mode === 'register' && $('#password').value !== $('#confirmPassword').value) { $('#authError').textContent = 'Пароли не совпадают.'; $('#confirmPassword').focus(); return; }
  button.disabled = true; button.textContent = 'Подождите…';
  try {
    await post(`/api/auth/${mode}`, { name: $('#name').value, email: $('#email').value, password: $('#password').value });
    location.replace(destination);
  } catch (error) { $('#authError').textContent = error.message; $('#authError').focus(); }
  finally { button.disabled = false; button.textContent = mode === 'register' ? 'Создать аккаунт' : 'Войти'; }
});
api('/api/auth/me').then(({ user }) => { if (user) location.replace(destination); }).catch(() => {});
