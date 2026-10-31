import { $, api, post, escapeHtml as e, localDate, dateLabel } from './common.js';

export function setupAccountExtras({ openDream, report }) {
  let weekRequest = 0, notes = [], currentNote = null, noteBusy = false, original = '';
  const noteDialog = $('#noteDialog');
  $('#weekEnd').value = localDate();
  const sources = items => items.map(item => `<li><button type="button" data-source="${e(item.id)}">${e(item.title)} · ${e(dateLabel(item.date))}</button></li>`).join('');
  async function loadWeek() {
    const request = ++weekRequest;
    $('#weeklyReport').setAttribute('aria-busy', 'true');
    try {
      const data = await api(`/api/account/weekly?end=${encodeURIComponent($('#weekEnd').value)}`);
      if (request !== weekRequest) return;
      const group = (heading, items, hint) => `<article class="panel"><h3>${heading}</h3>${items.length ? items.map(item => `<details class="week-tag"><summary>${e(item.label)} · ${item.count}</summary><ul>${sources(item.sources)}</ul></details>`).join('') : `<p>${hint}</p>`}</article>`;
      $('#weeklyReport').innerHTML = `<p>${e(dateLabel(data.startDate))} — ${e(dateLabel(data.endDate))} · Записей: <strong>${data.total}</strong> · Дней с записями: <strong>${data.activeDays} из 7</strong></p><div class="week-days">${data.days.map(day => `<div class="week-day"><span>${e(new Intl.DateTimeFormat('ru', {weekday:'short',day:'numeric'}).format(new Date(day.date+'T12:00:00')))}</span><strong>${day.dreams.length}</strong></div>`).join('')}</div><div class="week-grid">${group('Эмоции', data.emotions, 'Добавьте метки эмоций к снам этой недели.')}${group('Повторяющиеся образы', data.symbols, 'Пока нет одинаковых меток хотя бы в двух снах.')}${group('Повторяющиеся темы', data.themes, 'Темы появятся, когда одна метка встретится в двух снах.')}</div><p class="weekly-footnote muted">Числа показывают количество записей с меткой, а не силу эмоций. Нажмите на метку, чтобы открыть источники. AI-итоги разговоров в эти числа не входят.</p>`;
    } finally { if (request === weekRequest) $('#weeklyReport').removeAttribute('aria-busy'); }
  }
  async function loadNotes() {
    notes = (await api('/api/account/notes')).notes;
    $('#noteList').innerHTML = notes.length ? notes.map(note => `<button type="button" class="note-card" data-note="${e(note.id)}"><span class="eyebrow">Итог разговора · ${e(new Intl.DateTimeFormat('ru').format(new Date(note.createdAt)))}</span><h3>${e(note.title)}</h3><p>${e(note.content.slice(0, 220))}${note.content.length > 220 ? '…' : ''}</p><span class="small">Открыть и изменить →</span></button>`).join('') : '<article class="panel"><h3>Здесь будут ваши итоги</h3><p>В чате нажмите «Итог в дневник», проверьте текст и подтвердите сохранение.</p><a href="chat.html">Открыть чат →</a></article>';
  }
  const noteData = () => JSON.stringify({ title:$('#noteTitle').value.trim(), content:$('#noteContent').value.trim() });
  function closeNote() {
    if (noteBusy || (original !== noteData() && !confirm('Закрыть заметку без сохранения изменений?'))) return;
    noteDialog.close();
  }
  function setNoteBusy(value) {
    noteBusy=value; noteDialog.setAttribute('aria-busy',String(value));
    noteDialog.querySelectorAll('button,input,textarea').forEach(control=>control.disabled=value);
  }
  $('#noteList').addEventListener('click', event => {
    const button=event.target.closest('[data-note]'); if(!button)return;
    currentNote=notes.find(note=>note.id===button.dataset.note); if(!currentNote)return;
    $('#noteTitle').value=currentNote.title; $('#noteContent').value=currentNote.content;
    $('#noteError').textContent=''; original=noteData(); noteDialog.showModal(); $('#noteTitle').focus();
  });
  $('#closeNote').addEventListener('click',closeNote);
  noteDialog.addEventListener('cancel',event=>{event.preventDefault();closeNote();});
  $('#noteEditor').addEventListener('submit',async event=>{
    event.preventDefault(); if(noteBusy||!currentNote)return;
    setNoteBusy(true); $('#noteError').textContent='';
    try { await post(`/api/account/notes/${currentNote.id}`,JSON.parse(noteData()),'PATCH'); noteDialog.close(); await loadNotes(); }
    catch(error){$('#noteError').textContent=error.message;} finally{setNoteBusy(false);}
  });
  $('#deleteNote').addEventListener('click',async()=>{
    if(noteBusy||!currentNote||!confirm('Удалить эту заметку без возможности восстановления? Диалог и сон сохранятся.'))return;
    setNoteBusy(true);
    try{await api(`/api/account/notes/${currentNote.id}`,{method:'DELETE'});noteDialog.close();await loadNotes();}
    catch(error){$('#noteError').textContent=error.message;}finally{setNoteBusy(false);}
  });
  $('#weekEnd').addEventListener('change',()=>{if($('#weekEnd').reportValidity())loadWeek().catch(report);});
  $('#weeklyReport').addEventListener('click',event=>{const button=event.target.closest('[data-source]');if(button)openDream(button.dataset.source);});
  return { refresh(view=location.hash.slice(1)){if(view==='weekly')return loadWeek();if(view==='notes')return loadNotes();return Promise.resolve();} };
}
