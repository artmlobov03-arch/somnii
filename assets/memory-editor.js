import {$,post,api} from './common.js';
import {confirmChoice} from './confirm.js';

export function createMemoryEditor({onSaved=()=>{},onDeleted=()=>{}}={}) {
  const dialog=document.createElement('dialog');dialog.className='memory-modal';dialog.setAttribute('aria-labelledby','memoryHeading');
  dialog.innerHTML=`<header><div><span class="memory-kicker">Личные ассоциации</span><h2 id="memoryHeading">Что Сомнию учитывать?</h2></div><button type="button" class="memory-btn" id="closeMemory" aria-label="Закрыть ассоциацию">×</button></header><form id="memoryForm"><p class="memory-intro">Сохраните только то, что считаете верным для себя. Это ваша формулировка, которую можно изменить или удалить.</p><label>Образ или тема<input id="memoryTitle" maxlength="90" required placeholder="Например, дом у озера"></label><label>Что это значит лично для вас<textarea id="memoryContent" maxlength="700" rows="5" required placeholder="Для меня этот дом связан с летними каникулами и отдыхом."></textarea></label><label>По каким словам находить ассоциацию<input id="memoryCues" maxlength="410" placeholder="дом, озеро, каникулы"><span class="memory-hint">До 8 слов или фраз через запятую. Если пусто, используем название.</span></label><label class="memory-check"><input type="checkbox" id="memoryActive" checked>Разрешить использовать эту ассоциацию</label><p class="memory-hint">При включённой персонализации и памяти подходящая ассоциация может передаваться OpenAI вместе с сообщением. Сохранение не включает память автоматически. Изменения действуют со следующего запроса; старые ответы и сведения о переданном контексте остаются в истории.</p><p id="memoryError" class="memory-error" role="alert" tabindex="-1"></p><footer><button type="button" class="memory-btn memory-danger" id="deleteMemory" hidden>Удалить</button><button type="button" class="memory-btn" id="cancelMemory">Отмена</button><button type="submit" class="memory-btn memory-primary" id="saveMemory">Сохранить ассоциацию</button></footer></form>`;
  document.body.append(dialog);
  let current=null,busy=false,original='';
  const data=()=>({title:$('#memoryTitle').value.trim(),content:$('#memoryContent').value.trim(),cues:$('#memoryCues').value.split(',').map(value=>value.trim()).filter(Boolean),active:$('#memoryActive').checked});
  function setBusy(value){busy=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=value);$('#saveMemory').textContent=value?'Сохраняем…':'Сохранить ассоциацию';}
  async function close(){if(busy)return;if(original!==JSON.stringify(data())&&!await confirmChoice({title:'Закрыть без сохранения?',description:'Изменения этой ассоциации не будут сохранены.',accept:'Закрыть без сохранения'}))return;dialog.close();}
  $('#closeMemory').addEventListener('click',close);$('#cancelMemory').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#memoryForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const value=data();if(!value.cues.length)value.cues=[value.title.slice(0,50)];
    if(!value.title||!value.content){$('#memoryError').textContent='Заполните образ и свою ассоциацию.';return;}
    setBusy(true);$('#memoryError').textContent='';
    try{const result=await post(current?`/api/account/ai-memories/${current.id}`:'/api/account/ai-memories',value,current?'PATCH':'POST');dialog.close();await onSaved(result.memory);}
    catch(error){$('#memoryError').textContent=error.message;$('#memoryError').focus();}finally{setBusy(false);}
  });
  $('#deleteMemory').addEventListener('click',async()=>{
    if(busy||!current)return;
    if(!await confirmChoice({title:'Удалить ассоциацию?',description:'Она перестанет передаваться в новых запросах. Старые ответы и сведения о контексте в истории останутся.',accept:'Удалить ассоциацию',destructive:true}))return;
    setBusy(true);
    try{await api(`/api/account/ai-memories/${current.id}`,{method:'DELETE'});dialog.close();await onDeleted(current.id);}
    catch(error){$('#memoryError').textContent=error.message;}finally{setBusy(false);}
  });
  return {open(memory=null,content=''){
    if(busy||dialog.open)return;current=memory;
    $('#memoryHeading').textContent=memory?'Ваша личная ассоциация':'Что Сомнию учитывать?';
    $('#memoryTitle').value=memory?.title||'';$('#memoryContent').value=memory?.content||content.slice(0,700);$('#memoryCues').value=memory?.cues.join(', ')||'';$('#memoryActive').checked=memory?.active??true;
    $('#deleteMemory').hidden=!memory;$('#memoryError').textContent='';original=JSON.stringify(data());dialog.showModal();$('#memoryTitle').focus();
  }};
}
