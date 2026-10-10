import { api } from './common.js';
const link = document.getElementById('siteAccountLink');
api('/api/auth/me').then(({ user }) => { if (user && link) { link.textContent = 'Мой дневник'; link.href = 'account.html'; } }).catch(() => {});
document.getElementById('saveToDiary')?.addEventListener('click', () => {
  const draft = document.getElementById('dreamText')?.value.trim();
  try { if (draft) sessionStorage.setItem('somnii-dream-draft', draft); } catch {}
});
