import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore} from '../assets/drafts.js';
import {createVoiceInput} from '../assets/voice.js';
function memory(){const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),data};}
test('Drafts: account separation, tab autosave, opt-in persistence, withdrawal and logout purge',()=>{
  const session=memory(),local=memory(),store=createDraftStore('a',{session,local});
  const data={title:'',content:'Утренний сон',date:'2026-10-31',emotions:['Интерес']};
  assert.equal(store.save(data),true);assert.equal(local.data.size,0);assert.equal(store.read().content,data.content);
  assert.equal(createDraftStore('b',{session,local}).read(),null);
  assert.equal(createDraftStore('a',{session:memory(),local}).read(),null);
  store.setPersistent(true);assert.equal(createDraftStore('a',{session:memory(),local}).read().content,data.content);
  store.setPersistent(false);assert.equal(createDraftStore('a',{session:memory(),local}).read(),null);assert.equal(store.read().content,data.content);
  store.setPersistent(true);store.purge();assert.equal(store.read(),null);assert.equal(local.data.size,0);assert.equal(session.data.size,0);
});
test('Drafts handle denied storage, corrupt data and empty content without crashing',()=>{
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};
  const store=createDraftStore('a',{session:denied,local:denied});assert.equal(store.read(),null);assert.equal(store.save({title:'',content:'test'}),false);assert.equal(store.setPersistent(true),false);assert.equal(store.persistent,false);store.purge();
  const session=memory();session.setItem('somnii:draft:v1:a:new','not-json');const safe=createDraftStore('a',{session,local:memory()});assert.equal(safe.read(),null);safe.save({title:'',content:'Text'});safe.save({title:' ',content:' '});assert.equal(safe.read(),null);
});
test('Voice recognition is never started automatically; fallback, permission, stop and transcript are controlled',()=>{
  const button={textContent:'',disabled:false,setAttribute(){}},input={value:'Начало',readOnly:false},status={textContent:''};let changes=0,instance;
  const fallback=createVoiceInput({button,input,status,onChange(){},Recognition:null});assert.equal(fallback.supported,false);fallback.start();assert.equal(input.value,'Начало');assert.equal(button.disabled,true);
  class Recognition{constructor(){instance=this;}start(){this.onstart();}stop(){this.onend();}}
  const voice=createVoiceInput({button,input,status,onChange:()=>changes++,Recognition});assert.equal(instance,undefined);voice.start();assert.equal(voice.active,true);assert.equal(input.readOnly,true);
  const result=[{transcript:'продолжение'}];result.isFinal=true;instance.onresult({resultIndex:0,results:[result]});assert.equal(input.value,'Начало продолжение');assert.ok(changes>0);
  instance.onerror({error:'not-allowed'});assert.match(status.textContent,/не разрешён/);voice.stop();assert.equal(voice.active,false);assert.equal(input.readOnly,false);
  voice.start();const long=[{transcript:'a'.repeat(7000)}];long.isFinal=true;instance.onresult({resultIndex:0,results:[long]});assert.equal(input.value.length,6000);assert.equal(voice.active,false);
});
