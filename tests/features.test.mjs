import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../lib/database.mjs';
import { createAppServer } from '../server.mjs';
import { weeklyOverview } from '../lib/statistics.mjs';

async function exercise(t, db) {
  const seen=[];
  const server=createAppServer({database:async()=>db,chat:async(history,dream)=>{seen.push({history,dream});return 'Вы описали спокойствие рядом с домом. Это ваше наблюдение.';}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function req(path,body,cookie,method=body?'POST':'GET'){
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const register=email=>req('/api/auth/register',{email,name:'Тест',password:'test-feature-password'});
  const a=await register('features-a@example.test'),b=await register('features-b@example.test');assert.equal(a.status,201);assert.equal(b.status,201);
  const dreamBody={title:'Дом у воды',content:'Я гулял около дома и чувствовал спокойствие.',date:'2026-10-31',emotions:['Спокойствие','спокойствие'],symbols:['Дом'],themes:['Отдых']};
  const created=await req('/api/account/dreams',dreamBody,a.cookie);assert.equal(created.status,201);const dream=created.data.dream;
  await req('/api/account/dreams',{...dreamBody,title:'Чужая запись'},b.cookie);
  assert.equal((await req(`/api/account/dreams/${dream.id}/favorite`,{favorite:true},b.cookie,'PATCH')).status,404);
  assert.equal((await req(`/api/account/dreams/${dream.id}/favorite`,{favorite:'true'},a.cookie,'PATCH')).status,400);
  assert.equal((await req(`/api/account/dreams/${dream.id}/favorite`,{favorite:true},a.cookie,'PATCH')).data.dream.favorite,true);
  assert.equal((await req('/api/account/dreams?favorite=true',null,a.cookie)).data.total,1);
  assert.equal((await req('/api/account/dreams?favorite=true',null,b.cookie)).data.total,0);
  await req(`/api/account/dreams/${dream.id}`,{...dreamBody,title:'Избранное сохранится'},a.cookie,'PATCH');
  assert.equal((await req(`/api/account/dreams/${dream.id}`,null,a.cookie)).data.dream.favorite,true);
  const week=await req('/api/account/weekly?end=2026-10-31',null,a.cookie);assert.equal(week.status,200);assert.equal(week.data.total,1);assert.equal(week.data.emotions[0].count,1);assert.equal(week.data.emotions[0].sources[0].id,dream.id);
  assert.equal((await req('/api/account/weekly?end=2026-02-30',null,a.cookie)).status,400);
  const chat=(await req('/api/account/conversations',{dreamId:dream.id},a.cookie)).data.conversation;
  const path=`/api/account/conversations/${chat.id}`;
  assert.equal((await req(path,{title:'Личные ассоциации'},b.cookie,'PATCH')).status,404);
  assert.equal((await req(path,{title:' '},a.cookie,'PATCH')).status,400);
  assert.equal((await req(path,{title:'Личные ассоциации'},a.cookie,'PATCH')).status,200);
  assert.equal((await req(path+'/summary',{},a.cookie)).status,400);
  const answer=await req(path+'/messages',{content:'Вижу ЖИРАФА, но рядом с домом спокойно.'},a.cookie);assert.equal(answer.status,200);
  assert.equal((await req(path,null,a.cookie)).data.conversation.title,'Личные ассоциации');
  assert.equal((await req('/api/account/conversations?q=жирафа',null,a.cookie)).data.conversations[0].id,chat.id);
  assert.equal((await req('/api/account/conversations?q=жирафа',null,b.cookie)).data.conversations.length,0);
  const [userMessage,assistant]=answer.data.messages;assert.equal(assistant.role,'assistant');assert.ok(assistant.id);assert.ok(userMessage.id);
  const feedback=body=>req('/api/account/feedback',body,a.cookie);
  assert.equal((await req('/api/account/feedback',{messageId:assistant.id,rating:'helpful',shareText:true},b.cookie)).status,404);
  assert.equal((await feedback({messageId:userMessage.id,rating:'helpful',shareText:false})).status,404);
  assert.equal((await feedback({messageId:assistant.id,rating:'helpful'})).status,400);
  assert.equal((await feedback({messageId:assistant.id,rating:'bad',shareText:false})).status,400);
  assert.equal((await feedback({messageId:assistant.id,rating:'helpful',shareText:false})).status,200);
  let row=(await db.query('SELECT * FROM message_feedback WHERE message_id = ?',[assistant.id]))[0];
  assert.equal(row.share_text,0);assert.equal(row.shared_user_text,null);assert.equal(row.shared_assistant_text,null);assert.equal(row.consent_at,null);
  await feedback({messageId:assistant.id,rating:'misunderstood',shareText:true});
  row=(await db.query('SELECT * FROM message_feedback WHERE message_id = ?',[assistant.id]))[0];assert.equal(row.shared_user_text,userMessage.content);assert.equal(row.shared_assistant_text,assistant.content);assert.ok(row.consent_at);
  await feedback({messageId:assistant.id,rating:'repetitive',shareText:false});
  row=(await db.query('SELECT * FROM message_feedback WHERE message_id = ?',[assistant.id]))[0];assert.equal(row.shared_user_text,null);assert.equal(row.shared_assistant_text,null);assert.equal(row.consent_at,null);
  assert.equal((await req(path,null,a.cookie)).data.messages[1].feedback_rating,'repetitive');
  await req(`/api/account/feedback/${assistant.id}`,null,b.cookie,'DELETE');assert.equal((await db.query('SELECT * FROM message_feedback')).length,1);
  await req(`/api/account/feedback/${assistant.id}`,null,a.cookie,'DELETE');assert.equal((await db.query('SELECT * FROM message_feedback')).length,0);
  const summary=await req(path+'/summary',{},a.cookie);assert.equal(summary.status,200);const proposal=summary.data.proposal;
  assert.equal(proposal.sourceVersion,assistant.id);assert.equal((await db.query('SELECT * FROM journal_notes')).length,0);assert.equal((await req(path,null,a.cookie)).data.messages.length,2);
  assert.equal(seen.at(-1).history.at(-1).role,'user');assert.match(seen.at(-1).history.at(-1).content,/без вопросов/);assert.equal(seen.at(-1).dream.id,dream.id);
  assert.equal((await req('/api/account/notes',proposal,b.cookie)).status,404);
  const note=await req('/api/account/notes',{...proposal,title:'Мой исправленный итог',content:'Именно мои наблюдения.'},a.cookie);assert.equal(note.status,201);
  assert.equal((await req('/api/account/statistics',null,a.cookie)).data.total,1);
  assert.equal((await req('/api/account/notes',null,b.cookie)).data.notes.length,0);
  const notePath=`/api/account/notes/${note.data.note.id}`;
  assert.equal((await req(notePath,{title:'Чужое изменение',content:'no'},b.cookie,'PATCH')).status,404);
  assert.equal((await req(notePath,{title:'Уточнение',content:'Я отредактировал свою заметку.'},a.cookie,'PATCH')).status,200);
  assert.equal((await req('/api/account/notes',null,a.cookie)).data.notes[0].title,'Уточнение');
  assert.equal((await req(path+'/messages',{content:'Ещё одна деталь.'},a.cookie)).status,200);
  assert.equal((await req('/api/account/notes',proposal,a.cookie)).status,409);
  const latest=(await req(path+'/summary',{},a.cookie)).data.proposal;
  await feedback({messageId:assistant.id,rating:'helpful',shareText:true});
  await req(path+'/messages',null,a.cookie,'DELETE');assert.equal((await db.query('SELECT * FROM message_feedback')).length,0);
  assert.equal((await req('/api/account/notes',latest,a.cookie)).status,409);
  await req(path,null,a.cookie,'DELETE');await req(`/api/account/dreams/${dream.id}`,null,a.cookie,'DELETE');
  const retained=(await req('/api/account/notes',null,a.cookie)).data.notes[0];assert.equal(retained.conversationId,null);assert.equal(retained.dreamId,null);assert.equal(retained.content,'Я отредактировал свою заметку.');
  assert.equal((await req(notePath,null,b.cookie,'DELETE')).status,404);assert.equal((await req(notePath,null,a.cookie,'DELETE')).status,200);assert.equal((await req('/api/account/notes',null,a.cookie)).data.notes.length,0);
  for(const asset of ['drafts','voice','account-extras','chat-extras'])assert.equal((await fetch(`${base}/assets/${asset}.js`)).status,200);
}

test('SQLite: favorites, search, weekly sources, editable summaries and consent-based feedback',async t=>{const db=await createDatabase({filename:':memory:'});t.after(()=>db.close());await exercise(t,db);});
test('PostgreSQL: new diary features and repeatable additive migrations',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');const pg=new PGlite();
  const pool={query:(sql,values)=>pg.query(sql,values),connect:async()=>({query:(sql,values)=>pg.query(sql,values),release(){}}),end:()=>pg.close()};
  let db=await createDatabase({pool});await db.query('ALTER TABLE dreams DROP COLUMN is_favorite');await db.query('ALTER TABLE conversations DROP COLUMN title_custom');db=await createDatabase({pool});t.after(()=>db.close());await exercise(t,db);
});
test('SQLite migration retains existing records and can run twice',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'somnii-migration-'));const filename=join(directory,'test.sqlite');let db;
  try{
    db=await createDatabase({filename});const now=new Date().toISOString();
    await db.query('INSERT INTO users VALUES (?,?,?,?,?)',['user','migration@example.test','Test','hash',now]);
    await db.query('INSERT INTO dreams (id,user_id,title,content,dream_date,emotions,symbols,themes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',['dream','user','Старый сон','Текст','2026-10-30','[]','[]','[]',now,now]);
    await db.query('INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)',['chat','user','Старый чат',now,now]);
    await db.query('INSERT INTO messages (id,conversation_id,position,role,content,created_at) VALUES (?,?,?,?,?,?)',['old-message','chat',0,'user','Старое сообщение',now]);
    await db.query('ALTER TABLE dreams DROP COLUMN is_favorite');await db.query('ALTER TABLE conversations DROP COLUMN title_custom');await db.query('ALTER TABLE conversations DROP COLUMN personalization');await db.query('ALTER TABLE messages DROP COLUMN ai_context');await db.close();db=null;
    for(let i=0;i<2;i++){db=await createDatabase({filename});assert.equal((await db.query('SELECT * FROM dreams'))[0].content,'Текст');assert.equal((await db.query('SELECT * FROM dreams'))[0].is_favorite,0);assert.equal((await db.query('SELECT * FROM conversations'))[0].title_custom,0);assert.equal((await db.query('SELECT * FROM conversations'))[0].personalization,1);const [message]=await db.query('SELECT * FROM messages');assert.equal(message.content,'Старое сообщение');assert.equal(message.ai_context,null);await db.close();db=null;}
  }finally{if(db)await db.close();await rm(directory,{recursive:true,force:true});}
});
test('Weekly window includes exactly seven local dates, deduplicates labels and cites only sources in range',()=>{
  const dream=(id,date)=>({id,date,title:id,emotions:['Радость',' радость '],symbols:['Дом'],themes:['Отдых']});
  const week=weeklyOverview([dream('old','2026-10-24'),dream('start','2026-10-25'),dream('end','2026-10-31'),dream('future','2026-11-01')],'2026-10-31');
  assert.equal(week.startDate,'2026-10-25');assert.equal(week.days.length,7);assert.equal(week.total,2);assert.equal(week.activeDays,2);assert.equal(week.emotions[0].count,2);assert.deepEqual(week.symbols[0].sources.map(s=>s.id),['start','end']);
  assert.equal(weeklyOverview([dream('leap','2024-02-29')],'2024-03-01').total,1);
  assert.equal(weeklyOverview([],'2026-01-02').startDate,'2025-12-27');
  assert.throws(()=>weeklyOverview([],'2026-02-29'));assert.throws(()=>weeklyOverview([],null));
});
test('Manual title survives first message in an empty chat; summary blocks conflicting actions',async t=>{
  const db=await createDatabase({filename:':memory:'});t.after(()=>db.close());let block=false,release,started;
  const ready=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve);
  const server=createAppServer({database:async()=>db,chat:async()=>{if(block){started();await pending;}return 'Только известные факты.';}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'summary-race@example.test',name:'Тест',password:'test-summary-password'})});assert.equal(registration.status,201);
  const headers={'Content-Type':'application/json',Cookie:registration.headers.get('set-cookie').split(';')[0]};
  const request=(path,body,method='POST')=>fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  const created=await(await request('/api/account/conversations',{})).json(),path=`/api/account/conversations/${created.conversation.id}`;
  await request(path,{title:'Моё название'},'PATCH');assert.equal((await request(path+'/messages',{content:'Иное сообщение'})).status,200);
  assert.equal((await(await request(path,null,'GET')).json()).conversation.title,'Моё название');
  block=true;const summary=request(path+'/summary',{});await ready;
  try{assert.equal((await request(path,{title:'Нельзя сейчас'},'PATCH')).status,409);assert.equal((await request(path+'/messages',null,'DELETE')).status,409);assert.equal((await request(path,null,'DELETE')).status,409);assert.equal((await request(path+'/messages',{content:'Ещё ответ'})).status,409);}
  finally{release();}
  assert.equal((await summary).status,200);assert.equal((await db.query('SELECT * FROM journal_notes')).length,0);
});
