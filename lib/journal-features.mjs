import { randomUUID } from 'node:crypto';
import { decodeDream, weeklyOverview } from './statistics.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { statusCode: status }); };
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label}: от 1 до ${max} символов.`);
  return value.trim();
}
const noteInfo = row => ({ id:row.id, title:row.title, content:row.content, conversationId:row.conversation_id, dreamId:row.dream_id, createdAt:row.created_at, updatedAt:row.updated_at });

// Extra diary features share the same authentication, CSRF check and owner scope as the main API.
export async function handleJournalFeatures(req, url, { db, user, services, limit, inFlight, readJson }, json) {
  const path = url.pathname;
  const conversation = async id => {
    const [row] = await db.query('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [id,user.id]);
    if (!row) fail(404,'Диалог не найден.'); return row;
  };
  const latestMessage = async id => (await db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY position DESC LIMIT 1',[id]))[0];
  if (path === '/api/account/weekly' && req.method === 'GET') {
    const range=weeklyOverview([],url.searchParams.get('end'));
    const dreams = (await db.query('SELECT * FROM dreams WHERE user_id = ? AND dream_date >= ? AND dream_date <= ? ORDER BY dream_date DESC, created_at DESC',[user.id,range.startDate,range.endDate])).map(decodeDream);
    return json(200,weeklyOverview(dreams,range.endDate));
  }
  const favorite = path.match(/^\/api\/account\/dreams\/([a-f0-9-]{36})\/favorite$/);
  if (favorite && req.method === 'PATCH') {
    const [row] = await db.query('SELECT * FROM dreams WHERE id = ? AND user_id = ?',[favorite[1],user.id]);
    if (!row) fail(404,'Запись не найдена.');
    const body=await readJson(req); if (typeof body.favorite !== 'boolean') fail(400,'Нужно указать favorite: true или false.');
    const rows=await db.query('UPDATE dreams SET is_favorite = ? WHERE id = ? AND user_id = ? RETURNING *',[body.favorite?1:0,row.id,user.id]);
    return json(200,{dream:decodeDream(rows[0])});
  }
  const rename=path.match(/^\/api\/account\/conversations\/([a-f0-9-]{36})$/);
  if (rename && req.method === 'PATCH') {
    const row=await conversation(rename[1]);
    if(inFlight.has(row.id)) fail(409,'Дождитесь ответа перед переименованием.');
    const title=text((await readJson(req)).title,120,'Название');
    await db.query('UPDATE conversations SET title = ?, title_custom = 1, updated_at = ? WHERE id = ? AND user_id = ?',[title,new Date().toISOString(),row.id,user.id]);
    return json(200,{ok:true});
  }
  const summary=path.match(/^\/api\/account\/conversations\/([a-f0-9-]{36})\/summary$/);
  if(summary && req.method === 'POST') {
    const row=await conversation(summary[1]);
    if(inFlight.has(row.id)) fail(409,'Дождитесь ответа перед подготовкой итога.');
    limit(`ai:${user.id}`,5); inFlight.add(row.id);
    try {
      const latest=await latestMessage(row.id); if(!latest || latest.role!=='assistant') fail(400,'Сначала дождитесь хотя бы одного ответа в диалоге.');
      const rows=await db.query('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY position DESC LIMIT 16',[row.id]);
      const history=rows.reverse().map(({role,content})=>({role,content}));
      history.push({role:'user',content:'Подведи итог этого разговора для отдельной личной заметки в дневнике. Только обсуждённые факты, мои названные эмоции и мои ассоциации. Отдели возможные гипотезы, не добавляй новых толкований. Не больше 150 слов, без вопросов и без заявления, что заметка уже сохранена.'});
      const [dream]=row.dream_id?await db.query('SELECT * FROM dreams WHERE id = ? AND user_id = ?',[row.dream_id,user.id]):[];
      const content=await services.chat(history,dream?decodeDream(dream):null);
      if(typeof content!=='string'||!content.trim()||content.length>6000) fail(502,'Не удалось подготовить итог. Повторите запрос.');
      if((await latestMessage(row.id))?.id!==latest.id) fail(409,'Диалог изменился. Подготовьте итог ещё раз.');
      return json(200,{proposal:{title:`Итог: ${row.title}`.slice(0,120),content:content.trim(),conversationId:row.id,dreamId:row.dream_id,sourceVersion:latest.id}});
    } finally {inFlight.delete(row.id);}
  }
  if(path==='/api/account/notes'&&req.method==='GET') {
    return json(200,{notes:(await db.query('SELECT * FROM journal_notes WHERE user_id = ? ORDER BY created_at DESC',[user.id])).map(noteInfo)});
  }
  if(path==='/api/account/notes'&&req.method==='POST') {
    const body=await readJson(req), row=await conversation(String(body.conversationId));
    const title=text(body.title,120,'Название'),content=text(body.content,6000,'Текст итога');
    const version=text(body.sourceVersion,36,'Версия диалога');
    const id=randomUUID(),now=new Date().toISOString();
    await db.transaction(async tx=>{
      // Lock the parent row on PostgreSQL (and serialize SQLite writes) before checking the version.
      const updated=await tx.query('UPDATE conversations SET title = title WHERE id = ? AND user_id = ? RETURNING id',[row.id,user.id]);
      if(!updated.length) fail(404,'Диалог не найден.');
      const [latest]=await tx.query('SELECT id FROM messages WHERE conversation_id = ? ORDER BY position DESC LIMIT 1',[row.id]);
      if(latest?.id!==version) fail(409,'Диалог изменился или очищен. Подготовьте итог заново.');
      await tx.query('INSERT INTO journal_notes (id,user_id,conversation_id,dream_id,source_version,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,user.id,row.id,row.dream_id,version,title,content,now,now]);
    });
    return json(201,{note:noteInfo((await db.query('SELECT * FROM journal_notes WHERE id = ? AND user_id = ?',[id,user.id]))[0])});
  }
  const note=path.match(/^\/api\/account\/notes\/([a-f0-9-]{36})$/);
  if(note&&['PATCH','DELETE'].includes(req.method)) {
    const [row]=await db.query('SELECT * FROM journal_notes WHERE id = ? AND user_id = ?',[note[1],user.id]);
    if(!row)fail(404,'Заметка не найдена.');
    if(req.method==='DELETE'){await db.query('DELETE FROM journal_notes WHERE id = ? AND user_id = ?',[row.id,user.id]);return json(200,{ok:true});}
    const body=await readJson(req);
    await db.query('UPDATE journal_notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?',[text(body.title,120,'Название'),text(body.content,6000,'Текст'),new Date().toISOString(),row.id,user.id]);
    return json(200,{ok:true});
  }
  if(path==='/api/account/feedback'&&req.method==='POST') {
    limit(`feedback:${user.id}`,30);
    const body=await readJson(req);
    if(!['helpful','misunderstood','repetitive'].includes(body.rating)||typeof body.shareText!=='boolean') fail(400,'Укажите оценку и явный выбор передачи фрагмента.');
    const [row]=await db.query('SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND c.user_id = ? AND m.role = ?',[String(body.messageId),user.id,'assistant']);
    if(!row)fail(404,'Ответ не найден.');
    const [previous]=body.shareText?await db.query('SELECT content FROM messages WHERE conversation_id = ? AND position < ? AND role = ? ORDER BY position DESC LIMIT 1',[row.conversation_id,row.position,'user']):[];
    const now=new Date().toISOString();
    await db.query(`INSERT INTO message_feedback (user_id,message_id,rating,share_text,shared_user_text,shared_assistant_text,consent_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,message_id) DO UPDATE SET rating = excluded.rating, share_text = excluded.share_text, shared_user_text = excluded.shared_user_text, shared_assistant_text = excluded.shared_assistant_text, consent_at = excluded.consent_at, updated_at = excluded.updated_at`,
      [user.id,row.id,body.rating,body.shareText?1:0,body.shareText?previous?.content||null:null,body.shareText?row.content:null,body.shareText?now:null,now,now]);
    return json(200,{feedback:{messageId:row.id,rating:body.rating,shareText:body.shareText}});
  }
  const feedback=path.match(/^\/api\/account\/feedback\/([a-f0-9-]{36})$/);
  if(feedback&&req.method==='DELETE') {
    await db.query('DELETE FROM message_feedback WHERE user_id = ? AND message_id = ?',[user.id,feedback[1]]);return json(200,{ok:true});
  }
  return false;
}
