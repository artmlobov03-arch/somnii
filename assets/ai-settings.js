import {$,api,post,escapeHtml as e} from './common.js';
import {createMemoryEditor} from './memory-editor.js';
import {confirmChoice} from './confirm.js';

export function setupAISettings({report}) {
  let loaded=false,loading=null,memories=[],busy=false,baseline='';
  const form=$('#aiSettingsForm');
  const data=()=>({enabled:$('#aiEnabled').checked,memoryEnabled:$('#aiMemoryEnabled').checked,preferredName:$('#aiPreferredName').value.trim(),tone:$('#aiTone').value,address:$('#aiAddress').value,depth:$('#aiDepth').value,questions:$('#aiQuestions').value,focus:$('#aiFocus').value});
  function status(text,error=false){if($('#aiSettingsStatus').textContent!==text)$('#aiSettingsStatus').textContent=text;$('#aiSettingsStatus').classList.toggle('memory-error',error);}
  const editor=createMemoryEditor({onSaved:async()=>{status('Ассоциация сохранена. Она используется только при включённой памяти.');await loadMemories().catch(report);},onDeleted:async()=>{status('Ассоциация удалена из памяти.');await loadMemories().catch(report);}});
  function preview(){
    const value=data();$('#aiMemoryEnabled').disabled=busy||!value.enabled;
    $('#aiFormatPreview').textContent=`${{warm:'Тёплый тон',neutral:'Нейтральный тон',structured:'Ответ по пунктам'}[value.tone]} · ${{brief:'Кратко',balanced:'Сбалансированно',detailed:'Подробно'}[value.depth]} · ${value.address==='formal'?'На «вы»':'На «ты»'}`;
    if(loaded&&!busy)status(JSON.stringify(value)!==baseline?'Есть несохранённые изменения.':'');
  }
  function setBusy(value){busy=value;form.setAttribute('aria-busy',String(value));form.querySelectorAll('input,select,button').forEach(el=>el.disabled=value);$('#saveAISettings').textContent=value?'Сохраняем…':'Сохранить настройки';$('#aiMemoryEnabled').disabled=value||!$('#aiEnabled').checked;}
  async function loadMemories(){
    memories=(await api('/api/account/ai-memories')).memories;$('#memoryCount').textContent=`${memories.length} / 40`;$('#addMemory').disabled=memories.length>=40;$('#forgetMemories').disabled=!memories.length;
    $('#memoryList').innerHTML=memories.length?memories.map(memory=>`<article class="ai-memory ${memory.active?'':'is-paused'}"><header><h3>${e(memory.title)}</h3><span class="memory-state">${memory.active?'Разрешена':'На паузе'}</span></header><p>${e(memory.content)}</p><div class="memory-cues">${memory.cues.map(cue=>`<span>${e(cue)}</span>`).join('')}</div><button class="memory-btn" type="button" data-edit-memory="${e(memory.id)}">Изменить ассоциацию</button></article>`).join(''):'<div class="ai-memory-empty"><span class="memory-kicker">Значения, которые знаете только вы</span><h3>Один образ — ваш собственный смысл</h3><p>Например, дом может напоминать вам о каникулах. Добавьте свою формулировку — Сомний сможет учитывать её в подходящем разговоре.</p></div>';
  }
  async function load(){
    setBusy(true);
    try{
    const profile=await api('/api/account/ai-profile');
    for(const [key,id]of Object.entries({enabled:'aiEnabled',memoryEnabled:'aiMemoryEnabled',preferredName:'aiPreferredName',tone:'aiTone',address:'aiAddress',depth:'aiDepth',questions:'aiQuestions',focus:'aiFocus'})){
      const el=$(`#${id}`);if(el.type==='checkbox')el.checked=profile.settings[key];else el.value=profile.settings[key];
    }
    baseline=JSON.stringify(data());loaded=true;preview();await loadMemories();
    }finally{setBusy(false);}
  }
  form.addEventListener('input',preview);form.addEventListener('change',preview);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!loaded)return;const settings=data();setBusy(true);status('');
    try{await post('/api/account/ai-profile',settings,'PATCH');baseline=JSON.stringify(settings);status(settings.enabled?'Настройки сохранены. Они применятся к следующему ответу в чате.':'Личные настройки выключены.');}
    catch(error){status(error.message,true);}finally{setBusy(false);}
  });
  $('#addMemory').addEventListener('click',()=>editor.open());
  $('#forgetMemories').addEventListener('click',async()=>{
    if(!memories.length)return;
    if(!await confirmChoice({title:'Удалить всю личную память?',description:'Все ассоциации будут удалены без возможности восстановления. Сны, переписка, итоги и настройки формата сохранятся. В старых ответах и сведениях о контексте останется уже переданная информация.',accept:'Удалить все ассоциации',destructive:true}))return;
    $('#forgetMemories').disabled=true;
    try{await post('/api/account/ai-memories',{confirm:true},'DELETE');await loadMemories();status('Все личные ассоциации удалены.');}catch(error){report(error);$('#forgetMemories').disabled=!memories.length;}
  });
  $('#memoryList').addEventListener('click',event=>{const button=event.target.closest('[data-edit-memory]');if(button)editor.open(memories.find(memory=>memory.id===button.dataset.editMemory));});
  window.addEventListener('beforeunload',event=>{if(loaded&&JSON.stringify(data())!==baseline){event.preventDefault();event.returnValue='';}});
  return {refresh(view){if(view!=='ai')return Promise.resolve();if(loaded)return loadMemories();if(!loading)loading=load().catch(error=>{report(error);}).finally(()=>loading=null);return loading;}};
}
