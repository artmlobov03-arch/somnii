import { $, api, post, themeSetup } from './common.js';
themeSetup();
const messagesEl = $('#messages'), input = $('#messageInput'), form = $('#chatForm'), errorEl = $('#error');
let history = [], user = null, conversation = null, conversations = [], busy = true;
let noticeTimer;
const dialog = $('#confirmDialog');
const chatIcon = '<svg class="conversation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V5a2 2 0 0 1 2-2h8a8 8 0 0 1 8 8Z"/><path d="M7 8h9M7 12h6"/></svg>';
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
  updateControls();
  form.setAttribute('aria-busy', String(value));
}
function updateControls() {
  $('#newConversation').disabled = busy;
  $('#clearConversation').disabled = busy || !history.length;
  $('#deleteConversation').disabled = busy || !conversation;
  for (const button of $('#conversationList').querySelectorAll('button')) button.disabled = busy;
}
function announce(text) {
  clearTimeout(noticeTimer); $('#chatNotice').textContent = text;
  noticeTimer = setTimeout(() => { $('#chatNotice').textContent = ''; }, 5000);
}
function confirmAction(title, description, label) {
  $('#confirmTitle').textContent = title; $('#confirmDescription').textContent = description;
  $('#confirmButton').textContent = label; dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    let accepted = false;
    const accept = () => { accepted = true; dialog.close(); };
    const cancel = () => dialog.close();
    $('#confirmButton').addEventListener('click', accept);
    $('#cancelConfirm').addEventListener('click', cancel);
    dialog.addEventListener('close', () => {
      $('#confirmButton').removeEventListener('click', accept);
      $('#cancelConfirm').removeEventListener('click', cancel);
      resolve(accepted);
    }, { once: true });
    dialog.showModal();
  });
}
dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); dialog.close(); });
function closeHistory() {
  if (matchMedia('(max-width:700px)').matches) {
    $('#chatHistory').dataset.expanded = 'false'; $('#historyToggle').setAttribute('aria-expanded', 'false');
  }
}
$('#historyToggle').addEventListener('click', () => {
  const expanded = $('#historyToggle').getAttribute('aria-expanded') !== 'true';
  $('#historyToggle').setAttribute('aria-expanded', String(expanded)); $('#chatHistory').dataset.expanded = String(expanded);
});
function inputChanged() { $('#count').textContent = `${input.value.length.toLocaleString('ru')} / 4 000`; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; }
function updateUrl() {
  const url = new URL(location.href); url.search = conversation ? `?conversation=${conversation.id}` : '';
  window.history.replaceState(null, '', url);
}
function renderMessages() {
  messagesEl.replaceChildren();
  if (!history.length) addMessage('assistant', conversation?.dreamId ? `Я вижу вашу запись «${conversation.title}». С чего хочется начать: с сюжета или с ощущения после пробуждения?` : 'Привет. Я рядом, чтобы спокойно разобрать сон или ощущение после него. Что сегодня запомнилось сильнее всего?');
  else history.forEach(message => addMessage(message.role, message.content));
  $('#currentConversation').textContent = conversation?.title || 'Новый чат';
  $('#currentConversation').title = conversation?.title || 'Новый чат';
  $('#historyNote').textContent = user ? (conversation?.dreamId ? 'Диалог связан с записью сна. Очистка чата не удалит сам сон.' : 'Сообщения сохраняются в аккаунте после ответа Сомния.') : 'Гостевой чат не сохраняется после закрытия страницы.';
  updateControls();
}
function renderHistory() {
  const list = $('#conversationList'); list.replaceChildren();
  $('#conversationCount').textContent = conversations.length;
  $('#historyEmpty').hidden = !user || conversations.length > 0;
  $('#historyEmpty').textContent = 'Здесь появятся ваши диалоги. Начните новый чат.';
  $('#guestNote').hidden = Boolean(user);
  for (const item of conversations) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'conversation-item';
    button.setAttribute('aria-current', String(item.id === conversation?.id));
    button.title = item.title;
    button.innerHTML = `${chatIcon}<span class="conversation-copy"><span class="conversation-name"></span><span class="conversation-date"></span></span>`;
    button.querySelector('.conversation-name').textContent = item.title;
    const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(item.updatedAt));
    button.querySelector('.conversation-date').textContent = `${item.dreamId ? 'Из дневника · ' : ''}${date}`;
    button.addEventListener('click', () => { if (item.id !== conversation?.id) switchConversation(() => openConversation(item.id)); });
    list.append(button);
  }
  list.setAttribute('aria-busy', 'false'); updateControls();
}
async function refreshOptions() {
  conversations = (await api('/api/account/conversations')).conversations;
  if (conversation) conversation = conversations.find(item => item.id === conversation.id) || conversation;
  renderHistory();
  $('#currentConversation').textContent = conversation?.title || 'Новый чат';
  $('#currentConversation').title = conversation?.title || 'Новый чат';
}
async function openConversation(id) {
  const data = await api(`/api/account/conversations/${id}`);
  conversation = data.conversation; history = data.messages; input.value = ''; inputChanged(); renderMessages(); updateUrl();
  renderHistory();
}
async function createConversation(dreamId) {
  const data = await post('/api/account/conversations', { dreamId });
  conversation = data.conversation; history = []; renderMessages(); updateUrl(); await refreshOptions();
}
async function switchConversation(action) {
  if (busy) return;
  if (input.value.trim() && !await confirmAction('Сменить диалог?', 'Неотправленный текст будет удалён. Сохранённые сообщения останутся в истории.', 'Продолжить')) return;
  if (busy) return;
  setBusy(true); errorEl.textContent = '';
  try { await action(); closeHistory(); }
  catch (error) { errorEl.textContent = error.message; }
  finally { setBusy(false); input.focus(); }
}
function resetChat() {
  conversation = null; history = []; input.value = ''; inputChanged(); renderMessages(); renderHistory(); updateUrl();
}
$('#newConversation').addEventListener('click', () => switchConversation(async () => {
  resetChat();
}));
$('#clearConversation').addEventListener('click', async () => {
  if (busy || !history.length) return;
  if (!await confirmAction('Очистить чат?', 'Все сообщения этого диалога будут удалены без возможности восстановления. Сам диалог останется в истории, запись сна не изменится. Неотправленный текст тоже будет удалён.', 'Очистить чат')) return;
  setBusy(true); errorEl.textContent = '';
  try {
    if (conversation) {
      const data = await api(`/api/account/conversations/${conversation.id}/messages`, { method: 'DELETE' });
      conversation = data.conversation;
      conversations = conversations.map(item => item.id === conversation.id ? conversation : item).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    history = []; input.value = ''; inputChanged(); renderMessages(); renderHistory(); closeHistory();
    announce(user ? 'Сообщения удалены. Диалог остался в истории.' : 'Гостевой чат очищен.');
  } catch (error) { errorEl.textContent = error.message; }
  finally { setBusy(false); input.focus(); }
});
$('#deleteConversation').addEventListener('click', async () => {
  if (busy || !conversation) return;
  if (!await confirmAction('Удалить диалог?', `Диалог «${conversation.title}» и все его сообщения будут удалены без возможности восстановления. Запись сна и остальные диалоги останутся. Неотправленный текст тоже будет удалён.`, 'Удалить диалог')) return;
  setBusy(true); errorEl.textContent = '';
  try {
    await api(`/api/account/conversations/${conversation.id}`, { method: 'DELETE' });
    conversations = conversations.filter(item => item.id !== conversation.id);
    resetChat();
    if (conversations.length) await openConversation(conversations[0].id);
    closeHistory(); announce('Диалог и его сообщения удалены.');
  } catch (error) { errorEl.textContent = error.message; }
  finally { setBusy(false); input.focus(); }
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
    updateControls();
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
  } finally { renderHistory(); renderMessages(); setBusy(false); }
}
init();
