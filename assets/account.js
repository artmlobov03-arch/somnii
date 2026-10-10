import { $, api, post, escapeHtml as e, localDate, dateLabel, themeSetup, analysisMarkup } from './common.js';
themeSetup();
const emotions = ['Спокойствие', 'Радость', 'Тревога', 'Страх', 'Грусть', 'Удивление', 'Растерянность', 'Интерес'];
let user, stats, currentDream = null, selectedDate = localDate(), calendarMonth = new Date(), offset = 0, calendarOffset = 0, total = 0, requestNumber = 0, busy = false, baseline = '';
const dialog = $('#dreamDialog');
const views = { diary: ['Мой дневник', 'Оставьте здесь то, что хочется запомнить.'], calendar: ['Календарь сновидений', 'Маленькие воспоминания складываются в историю.'], statistics: ['Наблюдения', 'Замечайте, что повторяется в ваших снах.'], profile: ['Ваш профиль', 'Как к вам обращаться и как защитить аккаунт.'] };
const emptyIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M19 14a8 8 0 1 1-9-9 7 7 0 0 0 9 9Z"/></svg>';
const plural = (count, one, few, many) => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? many : count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many}`;
function message(text, error = false) { $('#pageMessage').textContent = text; $('#pageMessage').classList.toggle('error', error); }
function report(error) {
  if (error.status === 401) { location.replace('login.html'); return; }
  message(error.message, true);
}
function empty(title, detail, action = false) {
  return `<div class="empty">${emptyIcon}<h3>${e(title)}</h3><p>${e(detail)}</p>${action ? '<button class="btn primary" data-new>Записать первый сон</button>' : ''}</div>`;
}
function card(dream) {
  return `<button class="dream-card" data-dream="${e(dream.id)}"><div class="dream-meta"><span>${e(dateLabel(dream.date))}</span><span>${dream.analysis ? 'AI-наблюдение' : 'Личная запись'}</span></div><h3>${e(dream.title)}</h3><p>${e(dream.content)}</p><div class="chips">${dream.emotions.slice(0, 4).map(tag => `<span class="chip emotion">${e(tag)}</span>`).join('')}${dream.symbols.slice(0, 3).map(tag => `<span class="chip">${e(tag)}</span>`).join('')}</div></button>`;
}
async function loadList() {
  const number = ++requestNumber;
  const search = $('#searchDreams').value;
  $('#dreamList').setAttribute('aria-busy', 'true');
  try {
    const data = await api(`/api/account/dreams?q=${encodeURIComponent(search)}&offset=${offset}`);
    if (number !== requestNumber) return;
    total = data.total;
    $('#listCount').textContent = search ? `Найдено: ${total}` : plural(total, 'запись', 'записи', 'записей');
    $('#dreamList').innerHTML = data.dreams.map(card).join('') || (search ? empty('Ничего не нашлось', 'Попробуйте другое слово, образ или эмоцию.') : empty('Первый сон ещё впереди', 'Запишите то, что осталось после пробуждения. Начать можно с одной детали.', true));
    $('#pagination').hidden = total <= 30;
    $('#pageNumber').textContent = `${Math.floor(offset / 30) + 1} / ${Math.max(1, Math.ceil(total / 30))}`;
    $('#prevPage').disabled = offset === 0;
    $('#nextPage').disabled = offset + 30 >= total;
  } finally { if (number === requestNumber) $('#dreamList').removeAttribute('aria-busy'); }
}
function bars(items, target, hint) {
  const max = Math.max(1, ...items.map(item => item.count));
  $(target).innerHTML = items.length ? items.slice(0, 12).map(item => `<div class="bar-row"><span>${e(item.label)}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${item.count / max * 100}%"></div></div><span aria-label="${item.count} записей">${item.count}</span></div>`).join('') : `<p class="small muted">${e(hint)}</p>`;
}
async function loadStatistics() {
  stats = await api('/api/account/statistics');
  $('#totalDreams').textContent = stats.total;
  $('#monthDreams').textContent = stats.last30Days;
  $('#analyzedDreams').textContent = stats.analyzed;
  bars(stats.emotions, '#emotionStats', 'Добавьте эмоции к записям, чтобы увидеть первые наблюдения.');
  bars(stats.symbols, '#symbolStats', 'Пока нет образов с одинаковыми метками хотя бы в двух записях.');
  bars(stats.themes, '#themeStats', 'Повторяющиеся темы появятся, когда накопится несколько записей.');
  renderCalendar();
}
function renderCalendar() {
  $('#monthLabel').textContent = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(calendarMonth);
  const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - (first.getDay() + 6) % 7);
  let html = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => `<span class="weekday">${day}</span>`).join('');
  for (let i = 0; i < 42; i++) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const key = localDate(date), count = stats?.calendar[key] || 0;
    html += `<button class="day ${date.getMonth() !== first.getMonth() ? 'outside' : ''} ${key === localDate() ? 'today' : ''} ${key === selectedDate ? 'selected' : ''}" data-date="${key}" aria-pressed="${key === selectedDate}" aria-label="${e(dateLabel(key))}, ${plural(count, 'запись', 'записи', 'записей')}" ${key === localDate() ? 'aria-current="date"' : ''}><span>${date.getDate()}</span><span class="day-count">${count ? plural(count, 'сон', 'сна', 'снов') : '&nbsp;'}</span></button>`;
  }
  $('#calendarGrid').innerHTML = html;
}
async function loadCalendarDay(append = false) {
  const date = selectedDate;
  $('#selectedDateLabel').textContent = dateLabel(date);
  const data = await api(`/api/account/dreams?date=${date}&offset=${calendarOffset}`);
  if (date !== selectedDate) return;
  const markup = data.dreams.map(card).join('');
  if (append) $('#calendarDreams').insertAdjacentHTML('beforeend', markup);
  else $('#calendarDreams').innerHTML = markup || empty('В этот день нет записей', 'Выберите другой день или сохраните воспоминание.');
  $('#moreCalendarDreams').hidden = calendarOffset + 30 >= data.total;
}
function selectView() {
  const view = location.hash.slice(1) in views ? location.hash.slice(1) : 'diary';
  for (const name of Object.keys(views)) $(`#${name}View`).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#pageTitle').textContent = views[view][0]; $('#pageDescription').textContent = views[view][1];
  document.title = `${views[view][0]} — Сомний`;
  $('#summaryRow').hidden = view === 'profile'; $('#newDream').hidden = view === 'profile';
  if (view === 'calendar') { calendarOffset = 0; loadCalendarDay().catch(report); }
}
const split = value => value.split(',').map(item => item.trim()).filter(Boolean);
function editorData() {
  return {
    title: $('#dreamTitle').value.trim(), content: $('#dreamContent').value.trim(), date: $('#dreamDate').value,
    emotions: [...document.querySelectorAll('#emotionOptions input:checked')].map(input => input.value).concat(split($('#extraEmotions').value)),
    symbols: split($('#dreamSymbols').value), themes: split($('#dreamThemes').value),
  };
}
function setBusy(value, label = 'Сохранение…') {
  busy = value;
  dialog.setAttribute('aria-busy', String(value));
  dialog.querySelectorAll('input,textarea,button').forEach(control => control.disabled = value);
  $('#saveDream').textContent = value ? label : 'Сохранить';
}
function openEditor(dream = null, date = localDate()) {
  currentDream = dream;
  $('#dialogTitle').textContent = dream ? 'Запись сновидения' : 'Новая запись';
  $('#dreamTitle').value = dream?.title || '';
  $('#dreamContent').value = dream?.content || '';
  $('#dreamDate').value = dream?.date || date;
  const selected = dream?.emotions || [];
  $('#emotionOptions').innerHTML = emotions.map(emotion => `<label><input type="checkbox" value="${e(emotion)}" ${selected.some(tag => tag.toLocaleLowerCase('ru') === emotion.toLocaleLowerCase('ru')) ? 'checked' : ''}>${e(emotion)}</label>`).join('');
  $('#extraEmotions').value = selected.filter(tag => !emotions.some(emotion => tag.toLocaleLowerCase('ru') === emotion.toLocaleLowerCase('ru'))).join(', ');
  $('#dreamSymbols').value = (dream?.symbols || []).join(', ');
  $('#dreamThemes').value = (dream?.themes || []).join(', ');
  $('#deleteDream').hidden = !dream;
  $('#dreamAnalysis').innerHTML = analysisMarkup(dream?.analysis);
  $('#dreamError').textContent = '';
  baseline = JSON.stringify(editorData());
  dialog.showModal(); $('#dreamTitle').focus();
}
async function openDream(id) {
  try { const { dream } = await api(`/api/account/dreams/${id}`); openEditor(dream); }
  catch (error) { report(error); }
}
function closeEditor() {
  if (busy) return;
  if (baseline !== JSON.stringify(editorData()) && !confirm('Закрыть запись без сохранения изменений?')) return;
  dialog.close();
}
async function saveRecord() {
  if (!$('#dreamEditor').reportValidity()) return null;
  const data = editorData();
  if (currentDream && baseline === JSON.stringify(data)) return currentDream;
  const { dream } = await post(currentDream ? `/api/account/dreams/${currentDream.id}` : '/api/account/dreams', data, currentDream ? 'PATCH' : 'POST');
  currentDream = dream; baseline = JSON.stringify(data);
  $('#deleteDream').hidden = false;
  $('#dreamAnalysis').innerHTML = analysisMarkup(dream.analysis);
  return dream;
}
async function refresh() {
  await Promise.all([loadList(), loadStatistics(), loadCalendarDay()]);
}
function editorError(error) { $('#dreamError').textContent = error.message; $('#dreamError').focus(); }
$('#dreamEditor').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  if (!$('#dreamEditor').reportValidity()) return;
  setBusy(true); $('#dreamError').textContent = '';
  try { const dream = await saveRecord(); if (dream) { dialog.close(); await refresh(); message('Запись сохранена.'); } }
  catch (error) { editorError(error); }
  finally { setBusy(false); }
});
$('#analyzeDream').addEventListener('click', async () => {
  if (busy || !$('#dreamEditor').reportValidity()) return;
  if ($('#dreamContent').value.trim().length < 20) { editorError(new Error('Для анализа добавьте хотя бы 20 символов.')); return; }
  setBusy(true, 'Сомний читает сон…'); $('#dreamError').textContent = '';
  try {
    const saved = await saveRecord();
    const { dream } = await post(`/api/account/dreams/${saved.id}/analysis`);
    currentDream = dream;
    const changedEmotions = dream.emotions;
    document.querySelectorAll('#emotionOptions input').forEach(input => input.checked = changedEmotions.some(tag => tag.toLocaleLowerCase('ru') === input.value.toLocaleLowerCase('ru')));
    $('#extraEmotions').value = changedEmotions.filter(tag => !emotions.some(value => value.toLocaleLowerCase('ru') === tag.toLocaleLowerCase('ru'))).join(', ');
    $('#dreamSymbols').value = dream.symbols.join(', '); $('#dreamThemes').value = dream.themes.join(', ');
    baseline = JSON.stringify(editorData());
    $('#dreamAnalysis').innerHTML = analysisMarkup(dream.analysis);
    $('#dreamAnalysis').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    await refresh();
  } catch (error) { editorError(error); await refresh().catch(() => {}); }
  finally { setBusy(false); }
});
$('#discussDream').addEventListener('click', async () => {
  if (busy || !$('#dreamEditor').reportValidity()) return;
  setBusy(true);
  try { const dream = await saveRecord(); location.href = `chat.html?dream=${encodeURIComponent(dream.id)}`; }
  catch (error) { editorError(error); setBusy(false); }
});
$('#deleteDream').addEventListener('click', async () => {
  if (!currentDream || !confirm('Удалить эту запись? История обсуждения сохранится, но перестанет быть связана со сном.')) return;
  setBusy(true);
  try { await api(`/api/account/dreams/${currentDream.id}`, { method: 'DELETE' }); dialog.close(); await refresh(); message('Запись удалена.'); }
  catch (error) { editorError(error); }
  finally { setBusy(false); }
});
$('#closeDream').addEventListener('click', closeEditor);
dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('#newDream').addEventListener('click', () => openEditor());
$('#promptNewDream').addEventListener('click', () => openEditor());
$('#addOnDate').addEventListener('click', () => openEditor(null, selectedDate));
for (const id of ['dreamList', 'calendarDreams']) $(`#${id}`).addEventListener('click', event => {
  const button = event.target.closest('[data-dream]'); if (button) openDream(button.dataset.dream);
  if (event.target.closest('[data-new]')) openEditor();
});
let searchTimer;
$('#searchDreams').addEventListener('input', () => { clearTimeout(searchTimer); offset = 0; searchTimer = setTimeout(() => loadList().catch(report), 220); });
$('#prevPage').addEventListener('click', () => { offset = Math.max(0, offset - 30); loadList().catch(report); });
$('#nextPage').addEventListener('click', () => { if (offset + 30 < total) offset += 30; loadList().catch(report); });
$('#calendarGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-date]'); if (!button) return;
  selectedDate = button.dataset.date; calendarOffset = 0; renderCalendar(); loadCalendarDay().catch(report);
});
for (const [id, change] of [['prevMonth', -1], ['nextMonth', 1]]) $(`#${id}`).addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + change, 1); renderCalendar(); });
$('#calendarToday').addEventListener('click', () => { calendarMonth = new Date(); selectedDate = localDate(); calendarOffset = 0; renderCalendar(); loadCalendarDay().catch(report); });
$('#moreCalendarDreams').addEventListener('click', () => { calendarOffset += 30; loadCalendarDay(true).catch(report); });
window.addEventListener('hashchange', selectView);
$('#logout').addEventListener('click', async () => { try { await post('/api/auth/logout'); location.replace('login.html'); } catch (error) { report(error); } });
$('#profileForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const data = await post('/api/account/profile', { name: $('#profileName').value }, 'PATCH'); user = data.user; $('#accountName').textContent = user.name; $('#profileMessage').classList.add('success'); $('#profileMessage').textContent = 'Имя сохранено.'; }
  catch (error) { $('#profileMessage').classList.remove('success'); $('#profileMessage').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#passwordForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await post('/api/account/password', { currentPassword: $('#currentPassword').value, newPassword: $('#newPassword').value }); $('#passwordForm').reset(); $('#passwordMessage').classList.add('success'); $('#passwordMessage').textContent = 'Пароль обновлён. Другие сеансы завершены.'; }
  catch (error) { $('#passwordMessage').classList.remove('success'); $('#passwordMessage').textContent = error.message; }
  finally { button.disabled = false; }
});
async function init() {
  message('Открываем ваш дневник…');
  try {
    const data = await api('/api/auth/me');
    if (!data.user) { location.replace('login.html'); return; }
    user = data.user; $('#accountName').textContent = user.name;
    $('#profileName').value = user.name; $('#profileEmail').textContent = user.email;
    await refresh(); $('#accountContent').hidden = false; message(''); selectView();
    try {
      const draft = sessionStorage.getItem('somnii-dream-draft');
      if (draft) { openEditor(); $('#dreamContent').value = draft.slice(0, 6000); sessionStorage.removeItem('somnii-dream-draft'); }
    } catch {}
  } catch (error) { report(error); }
}
init();
