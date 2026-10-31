// Browser speech recognition may use the browser vendor's remote service.
// Call start only after the user has explicitly accepted that disclosure.
export function createVoiceInput({button,input,status,onChange,isBlocked=()=>false,Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition}) {
  let recognition=null,active=false,base='',finalText='';
  const label = value => { button.textContent=value?'Остановить диктовку':'Надиктовать сон';button.setAttribute('aria-pressed',String(value)); };
  if(!Recognition){button.disabled=true;status.textContent='Голосовой ввод недоступен в этом браузере. Можно написать сон вручную.';}
  function stop(){try{recognition?.stop();}catch{} }
  function start(){
    if(!Recognition||isBlocked())return;
    if(active){stop();return;}
    base=input.value.trimEnd();finalText='';recognition=new Recognition();recognition.lang='ru-RU';recognition.continuous=true;recognition.interimResults=true;
    active=true;label(true);input.readOnly=true;onChange();
    recognition.onstart=()=>{active=true;label(true);status.textContent='Слушаю… Говорите спокойно. Текст можно исправить.';input.readOnly=true;onChange();};
    recognition.onresult=event=>{
      let interim='';
      for(let i=event.resultIndex;i<event.results.length;i++){
        const value=event.results[i][0]?.transcript||'';
        if(event.results[i].isFinal)finalText+=value+' ';else interim+=value;
      }
      const value=[base,finalText.trim(),interim.trim()].filter(Boolean).join(' ');
      input.value=value.slice(0,6000);onChange();
      if(value.length>=6000){status.textContent='Достигнут предел 6 000 символов.';stop();}
    };
    recognition.onerror=event=>{status.textContent=event.error==='not-allowed'?'Доступ к микрофону не разрешён. Продолжите ввод вручную.':event.error==='no-speech'?'Речь не распознана. Можно попробовать ещё раз.':'Не удалось распознать речь. Проверьте соединение или введите текст вручную.';};
    recognition.onend=()=>{active=false;input.readOnly=false;label(false);if(status.textContent.startsWith('Слушаю'))status.textContent='Диктовка завершена. Проверьте распознанный текст.';recognition=null;onChange();};
    try{recognition.start();}catch{active=false;input.readOnly=false;label(false);status.textContent='Не удалось включить диктовку. Попробуйте ещё раз.';recognition=null;onChange();}
  }
  return {start,stop,get active(){return active;},supported:Boolean(Recognition)};
}
