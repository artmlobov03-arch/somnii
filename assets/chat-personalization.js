import {$,api,post} from './common.js';
import {createMemoryEditor} from './memory-editor.js';

export function setupChatPersonalization({getState,setBusy,refreshOptions,announce,report}) {
  let profile=null,newChatEnabled=true;
  const editor=createMemoryEditor({onSaved:()=>announce('Ассоциация сохранена. Управлять ею и включить память можно в настройках Сомния.')});
  function update(){
    const {user,conversation,busy}=getState(),enabled=Boolean(user&&profile?.settings.enabled&&(conversation?conversation.personalization:newChatEnabled));
    const button=$('#personalizationToggle');button.disabled=busy||!user||!profile;button.setAttribute('aria-pressed',String(enabled));
    button.textContent=enabled?'Мои настройки включены':'Мои настройки выключены';
    $('#personalizationHint').textContent=!user?'Войдите, чтобы настроить Сомния под себя.':!profile?.settings.enabled?'Выберите стиль ответа и свои ассоциации.':enabled?(profile.settings.memoryEnabled?'Память включена. Передаём только подходящие ассоциации.':'Ваш формат ответа. Личные ассоциации не передаются.'):'В этом диалоге дополнительные настройки не передаются.';
    document.querySelectorAll('.remember-message').forEach(button=>button.disabled=busy);
  }
  $('#personalizationToggle').addEventListener('click',async()=>{
    const {user,conversation,busy}=getState();if(!user||busy||!profile)return;
    if(!profile.settings.enabled){location.href='account.html#ai';return;}
    const enabled=!(conversation?conversation.personalization:newChatEnabled);setBusy(true);
    try{if(conversation){await post(`/api/account/conversations/${conversation.id}/personalization`,{enabled},'PATCH');conversation.personalization=enabled;await refreshOptions();}else newChatEnabled=enabled;
      announce(enabled?'Личные настройки включены для следующих ответов.':'Личные настройки выключены. Уже отправленная переписка остаётся контекстом диалога.');
    }catch(error){report(error);}finally{setBusy(false);update();}
  });
  function addControls(container,message){
    if(!getState().user||!message.id)return;
    if(message.role==='user'){
      const button=document.createElement('button');button.type='button';button.className='remember-message';button.textContent='Сохранить ассоциацию';
      button.addEventListener('click',()=>{if(!getState().busy)editor.open(null,message.content);});container.append(button);
    }
    if(message.role==='assistant'&&message.ai_context){
      let context;try{context=JSON.parse(message.ai_context);}catch{return;}
      if(!context?.enabled){const label=document.createElement('span');label.className='ai-context-off';label.textContent='Без личных настроек';container.append(label);return;}
      const details=document.createElement('details');details.className='ai-context';const summary=document.createElement('summary');
      summary.textContent=`Контекст ответа · ассоциаций: ${context.memories?.length||0}`;details.append(summary);
      const format=document.createElement('p');format.textContent=`Передан выбранный формат: ${{warm:'тёплый',neutral:'нейтральный',structured:'структурированный'}[context.tone]||'личный'}, ${{brief:'кратко',balanced:'сбалансированно',detailed:'подробно'}[context.depth]||''}.`;details.append(format);
      if(context.memories?.length){const list=document.createElement('ul');for(const memory of context.memories){const item=document.createElement('li');item.textContent=memory.title;list.append(item);}details.append(list);}
      else{const p=document.createElement('p');p.textContent='Сохранённые ассоциации не передавались.';details.append(p);}
      const note=document.createElement('p');note.textContent='Это состав переданного контекста. Ответ модели может быть ошибочным.';details.append(note);container.append(details);
    }
  }
  async function load(){profile=await api('/api/account/ai-profile');update();}
  window.addEventListener('focus',()=>{const {user,busy}=getState();if(user&&!busy)load().catch(report);});
  return {update,addControls,load,newChatPreference:()=>newChatEnabled,reset(){newChatEnabled=true;update();}};
}
