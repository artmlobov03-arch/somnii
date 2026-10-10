import { $, api, post, themeSetup } from './common.js';
themeSetup();
const messagesEl = $('#messages'), input = $('#messageInput'), form = $('#chatForm'), errorEl = $('#error');
let history = [], user = null, conversation = null, conversations = [], busy = true;
const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 13A8 8 0 1 1 11 4a7 7 0 0 0 9 9Z"/></svg>';
const person = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>';
function addMessage(role, text) {
  const item = document.createElement('div'); item.className = `message ${role}`;
  item.innerHTML = `<div class="avatar">${role === 'user' ? person : moon}</div><div class="bubble"></div>`;
  item.querySelector('.bubble').textContent = text;
  messagesEl.append(item); messagesEl.scrollTop = messagesEl.scrollHeight; return item;
}
function setBusy(value) {
  busy = value; input.disabled = $('#sendButton').disabled = value;
  for (const id of ['conversationSelect', 'newConversation', 'deleteConversation']) $(`#${id}`).disabled = value;
  form.setAttribute('aria-busy', String(value));
}
function inputChanged() { $('#count').textContent = `${input.value.length.toLocaleString('ru')} / 4 000`; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; }
function updateUrl() {
  const url = new URL(location.href); url.search = conversation ? `?conversation=${conversation.id}` : '';
  window.history.replaceState(null, '', url);
}
function renderMessages() {
  messagesEl.replaceChildren();
  if (!history.length) addMessage('assistant', conversation?.dreamId ? `Я вижу вашу запись «${conversation.title}». С чего хочется начать: с сюжета или с ощущения после пробуждения?` : 'Привет. Я рядом, чтобы спокойно разобрать сон или ощущение после него. Что сегодня запомнилось сильнее всего?');
  else history.forEach(message => addMessage(message.role, message.content));
  $('#deleteConversation').hidden = !conversation;
  $('#historyNote').textContent = conversation?.dreamId ? `Обсуждаем запись «${conversation.title}». История сохраняется в аккаунте.` : 'Сообщения сохраняются в вашем аккаунте после ответа Сомния.';
}
async function refreshOptions() {
  conversations = (await api('/api/account/conversations')).conversations;
  const select = $('#conversationSelect'); select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Новый разговор'; select.append(placeholder);
  for (const item of conversations) {
    const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; select.append(option);
  }
  select.value = conversation?.id || '';
}
async function openConversation(id) {
  const data = await api(`/api/account/conversations/${id}`);
  conversation = data.conversation; history = data.messages; input.value = ''; inputChanged(); renderMessages(); updateUrl();
  $('#conversationSelect').value = conversation.id;
}
async function createConversation(dreamId) {
  const data = await post('/api/account/conversations', { dreamId });
  conversation = data.conversation; history = []; renderMessages(); updateUrl(); await refreshOptions();
}
async function switchConversation(action) {
  if (busy) return;
  if (input.value.trim() && !confirm('Сменить разговор и убрать неотправленный текст?')) { $('#conversationSelect').value = conversation?.id || ''; return; }
  setBusy(true); errorEl.textContent = '';
  try { await action(); }
  catch (error) { errorEl.textContent = error.message; $('#conversationSelect').value = conversation?.id || ''; }
  finally { setBusy(false); }
}
$('#conversationSelect').addEventListener('change', () => {
  const id = $('#conversationSelect').value;
  switchConversation(async () => { if (id) await openConversation(id); else { conversation = null; history = []; input.value = ''; inputChanged(); renderMessages(); updateUrl(); } });
});
$('#newConversation').addEventListener('click', () => switchConversation(async () => {
  conversation = null; history = []; input.value = ''; inputChanged(); renderMessages(); updateUrl(); $('#conversationSelect').value = '';
}));
$('#deleteConversation').addEventListener('click', () => {
  if (!conversation || !confirm('Удалить этот разговор вместе со всеми сообщениями?')) return;
  switchConversation(async () => {
    await api(`/api/account/conversations/${conversation.id}`, { method: 'DELETE' });
    conversation = null; history = []; renderMessages(); updateUrl(); await refreshOptions();
  });
});
input.addEventListener('input', inputChanged);
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!busy) form.requestSubmit(); } });
form.addEventListener('submit', async event => {
  event.preventDefault(); const content = input.value.trim();
  if (!content || busy) return;
  errorEl.textContent = ''; setBusy(true);
  let item, typing;
  try {
    if (user && !conversation) await createConversation();
    item = addMessage('user', content);
    typing = addMessage('assistant', 'Сомний размышляет…'); typing.classList.add('typing');
    typing.setAttribute('aria-label', 'Сомний готовит ответ');
    input.value = ''; inputChanged();
    const result = user ? await post(`/api/account/conversations/${conversation.id}/messages`, { content })
      : await post('/api/dream-chat', { messages: [...history, { role: 'user', content }].slice(-16) });
    history.push({ role: 'user', content }, { role: 'assistant', content: result.text });
    typing.remove(); addMessage('assistant', result.text);
    if (user) await refreshOptions().catch(() => {});
  } catch (error) {
    typing?.remove(); item?.remove(); input.value = content; inputChanged();
    errorEl.textContent = error.message;
    if (error.status === 401) errorEl.textContent += ' Сеанс завершён. Войдите в аккаунт заново.';
  } finally { setBusy(false); input.focus(); }
});
async function init() {
  setBusy(true); renderMessages();
  if (location.protocol === 'file:') { errorEl.textContent = 'Откройте сайт на Render или через localhost.'; return; }
  try {
    const result = await api('/api/auth/me'); user = result.user;
    if (user) {
      $('#accountLink').textContent = 'Мой дневник'; $('#accountLink').href = 'account.html';
      $('#chatHistory').hidden = false; $('#guestNote').hidden = true;
      await refreshOptions();
      const params = new URLSearchParams(location.search), dreamId = params.get('dream'), id = params.get('conversation');
      if (id) await openConversation(id);
      else if (dreamId) {
        const existing = conversations.find(item => item.dreamId === dreamId);
        if (existing) await openConversation(existing.id); else await createConversation(dreamId);
      } else if (conversations.length) await openConversation(conversations[0].id);
    } else if (new URLSearchParams(location.search).has('dream')) {
      const dreamId = new URLSearchParams(location.search).get('dream');
      location.replace(`login.html?next=chat&dream=${encodeURIComponent(dreamId)}`); return;
    }
  } catch (error) {
    if (user || new URLSearchParams(location.search).has('conversation')) errorEl.textContent = error.message;
    // A guest may still use the existing public chat if account storage is not connected yet.
  } finally { setBusy(false); }
}
init();
