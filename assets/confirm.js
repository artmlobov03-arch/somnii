let dialog, resolvePending;

// A native HTML dialog keeps focus in the page and avoids blocking browser-level prompts.
export function confirmChoice({title,description,accept='Продолжить',destructive=false}) {
  if(resolvePending)return Promise.resolve(false);
  if(!dialog){
    dialog=document.createElement('dialog');dialog.className='memory-modal choice-modal';dialog.setAttribute('aria-labelledby','choiceHeading');dialog.setAttribute('aria-describedby','choiceDescription');
    dialog.innerHTML='<header><h2 id="choiceHeading"></h2></header><p class="memory-intro" id="choiceDescription"></p><footer><button class="memory-btn" type="button" id="choiceCancel" autofocus>Отмена</button><button class="memory-btn" type="button" id="choiceAccept"></button></footer>';
    document.body.append(dialog);let accepted=false;
    dialog.querySelector('#choiceAccept').addEventListener('click',()=>{accepted=true;dialog.close();});
    dialog.querySelector('#choiceCancel').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{const resolve=resolvePending;resolvePending=null;const answer=accepted;accepted=false;resolve?.(answer);});
  }
  dialog.querySelector('#choiceHeading').textContent=title;dialog.querySelector('#choiceDescription').textContent=description;
  const button=dialog.querySelector('#choiceAccept');button.textContent=accept;button.className=`memory-btn ${destructive?'memory-danger':'memory-primary'}`;
  return new Promise(resolve=>{resolvePending=resolve;dialog.showModal();dialog.querySelector('#choiceCancel').focus();});
}
