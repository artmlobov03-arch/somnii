import { $, api, post } from './common.js';

export function setupChatExtras({getState,setBusy,refreshOptions,announce,report}) {
  let proposal=null, selectedMessage=null, pending=false, originalSummary='';
  const ratings={helpful:'Полезно',misunderstood:'Не понял меня',repetitive:'Повторяется'};
  function setPending(dialog,value){pending=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=value);}
  const summaryData=()=>JSON.stringify({title:$('#summaryTitle').value,content:$('#summaryContent').value});
  function mayClose(id){return !pending&&(id!=='summaryDialog'||summaryData()===originalSummary||confirm('Закрыть итог без сохранения ваших правок?'));}
  for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>{if(mayClose(button.dataset.close))$(`#${button.dataset.close}`).close();});
  for(const id of ['renameDialog','summaryDialog','feedbackDialog'])$(`#${id}`).addEventListener('cancel',event=>{if(!mayClose(id))event.preventDefault();});
  $('#renameConversation').addEventListener('click',()=>{
    const {busy,conversation}=getState();if(busy||!conversation)return;
    $('#conversationTitle').value=conversation.title;$('#renameError').textContent='';$('#renameDialog').showModal();$('#conversationTitle').select();
  });
  $('#renameForm').addEventListener('submit',async event=>{
    event.preventDefault();const {conversation}=getState();if(pending||!conversation)return;
    const title=$('#conversationTitle').value.trim();if(!title){$('#renameError').textContent='Введите название.';return;}
    setPending($('#renameDialog'),true);setBusy(true);
    try{await post(`/api/account/conversations/${conversation.id}`,{title},'PATCH');conversation.title=title;await refreshOptions();$('#renameDialog').close();announce('Название диалога сохранено.');}
    catch(error){$('#renameError').textContent=error.message;}finally{setPending($('#renameDialog'),false);setBusy(false);}
  });
  $('#summarizeConversation').addEventListener('click',async()=>{
    const {busy,conversation}=getState();if(busy||!conversation)return;
    setBusy(true);$('#summarizeConversation').textContent='Готовим итог…';
    try{
      const data=await post(`/api/account/conversations/${conversation.id}/summary`);proposal=data.proposal;
      $('#summaryTitle').value=proposal.title;$('#summaryContent').value=proposal.content;$('#summaryError').textContent='';
      originalSummary=summaryData();
      $('#summaryDialog').showModal();$('#summaryContent').focus();
    }catch(error){report(error);}finally{$('#summarizeConversation').textContent='Итог в дневник';setBusy(false);}
  });
  $('#summaryForm').addEventListener('submit',async event=>{
    event.preventDefault();if(pending||!proposal)return;
    const title=$('#summaryTitle').value.trim(),content=$('#summaryContent').value.trim();
    if(!title||!content){$('#summaryError').textContent='Заполните название и текст заметки.';return;}
    setPending($('#summaryDialog'),true);
    try{await post('/api/account/notes',{...proposal,title,content});proposal=null;$('#summaryDialog').close();announce('Итог сохранён. Он доступен в дневнике, в разделе «Итоги разговоров».');}
    catch(error){$('#summaryError').textContent=error.message;}finally{setPending($('#summaryDialog'),false);}
  });
  function addFeedbackControls(container,message){
    if(!getState().user||message.role!=='assistant'||!message.id)return;
    const bar=document.createElement('div');bar.className='response-feedback';bar.dataset.feedback=message.id;bar.setAttribute('aria-label','Оценить ответ');
    for(const [rating,label]of Object.entries(ratings)){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.rating=rating;
      button.setAttribute('aria-pressed',String(message.feedback_rating===rating));
      button.addEventListener('click',()=>{
        if(getState().busy)return;selectedMessage=message;$('#feedbackRating').value=rating;$('#feedbackShare').checked=Boolean(message.feedback_share_text);
        $('#removeFeedback').hidden=!message.feedback_rating;$('#feedbackError').textContent='';$('#feedbackDialog').showModal();
      });bar.append(button);
    }container.append(bar);
  }
  function updateFeedback(message,rating,share){
    message.feedback_rating=rating;message.feedback_share_text=share?1:0;
    const bar=document.querySelector(`[data-feedback="${message.id}"]`);
    bar?.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.rating===rating)));
  }
  $('#feedbackForm').addEventListener('submit',async event=>{
    event.preventDefault();if(pending||!selectedMessage)return;
    const message=selectedMessage,rating=$('#feedbackRating').value,shareText=$('#feedbackShare').checked;
    setPending($('#feedbackDialog'),true);
    try{await post('/api/account/feedback',{messageId:message.id,rating,shareText});updateFeedback(message,rating,shareText);$('#feedbackDialog').close();announce(shareText?'Оценка и разрешённый фрагмент сохранены.':'Оценка сохранена без копии текста разговора.');}
    catch(error){$('#feedbackError').textContent=error.message;}finally{setPending($('#feedbackDialog'),false);}
  });
  $('#removeFeedback').addEventListener('click',async()=>{
    if(pending||!selectedMessage||!confirm('Удалить оценку и переданный с ней фрагмент?'))return;
    const message=selectedMessage;setPending($('#feedbackDialog'),true);
    try{await api(`/api/account/feedback/${message.id}`,{method:'DELETE'});updateFeedback(message,null,false);$('#feedbackDialog').close();announce('Оценка и переданный фрагмент удалены.');}
    catch(error){$('#feedbackError').textContent=error.message;}finally{setPending($('#feedbackDialog'),false);}
  });
  return {addFeedbackControls};
}
