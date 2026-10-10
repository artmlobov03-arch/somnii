export const $ = selector => document.querySelector(selector);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
  catch { throw new Error('Нет соединения с сервером. Проверьте интернет и повторите.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Сервис пока недоступен. Откройте сайт на Render или запустите локальный сервер.');
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Не удалось выполнить запрос.'); error.status = response.status; throw error; }
  return result;
}
export const post = (path, data = {}, method = 'POST') => api(path, { method, body: JSON.stringify(data) });
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const dateLabel = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
export function themeSetup() {
  let theme = 'light';
  try { theme = localStorage.getItem('somnium-theme') || 'light'; } catch {}
  document.body.dataset.theme = theme;
  const button = $('#themeToggle');
  const sync = () => {
    const dark = document.body.dataset.theme === 'dark';
    button?.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    if ($('#moonIcon')) $('#moonIcon').style.display = dark ? 'none' : 'block';
    if ($('#sunIcon')) $('#sunIcon').style.display = dark ? 'block' : 'none';
  };
  sync();
  button?.addEventListener('click', () => {
    document.body.dataset.theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('somnium-theme', document.body.dataset.theme); } catch {}
    sync();
  });
}
export function analysisMarkup(analysis) {
  if (!analysis) return '';
  const list = values => (values || []).map(value => `<li>${escapeHtml(value)}</li>`).join('');
  return `<div class="analysis-copy"><span class="eyebrow">Наблюдение Сомния</span><h3>${escapeHtml(analysis.title)}</h3><p>${escapeHtml(analysis.summary)}</p>
    ${analysis.symbols?.length ? `<h4>Образы и личные ассоциации</h4>${analysis.symbols.map(item => `<p><strong>${escapeHtml(item.name)}</strong> — ${escapeHtml(item.reflection)}</p>`).join('')}` : ''}
    ${analysis.questions?.length ? `<h4>Вопросы для себя</h4><ul>${list(analysis.questions)}</ul>` : ''}
    ${analysis.grounding ? `<h4>Небольшая опора</h4><p>${escapeHtml(analysis.grounding)}</p>` : ''}<p class="muted small">${escapeHtml(analysis.note)}</p></div>`;
}
