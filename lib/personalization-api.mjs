import {randomUUID} from 'node:crypto';
import {loadAIProfile,validateAISettings,memoryInfo} from './personalization.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{statusCode:status});};
function memoryFields(body,previous={active:true}) {
  if(!body||Object.keys(body).some(key=>!['title','content','cues','active'].includes(key)))fail(400,'Проверьте поля личной ассоциации.');
  const value={...previous,...body};
  for(const [key,max,label] of [['title',90,'Название'],['content',700,'Ассоциация']]){
    if(typeof value[key]!=='string'||!value[key].trim()||value[key].trim().length>max)fail(400,`${label}: от 1 до ${max} символов.`);
    value[key]=value[key].trim();
  }
  const cues=value.cues===undefined?[value.title]:value.cues;
  if(!Array.isArray(cues)||!cues.length||cues.length>8||cues.some(cue=>typeof cue!=='string'||!cue.trim()||cue.trim().length>50))fail(400,'Укажите от 1 до 8 слов или фраз для поиска, до 50 символов каждая.');
  value.cues=[...new Set(cues.map(cue=>cue.trim().toLocaleLowerCase('ru-RU')))];
  if(typeof value.active!=='boolean')fail(400,'Укажите, использовать ли ассоциацию.');
  return value;
}
export async function handlePersonalization(req,url,{db,user,readJson,inFlight},json) {
  const path=url.pathname;
  if(path==='/api/account/ai-profile'){
    const profile=await loadAIProfile(db,user.id);
    if(req.method==='GET')return json(200,profile);
    if(req.method==='PATCH'){
      const settings=validateAISettings(await readJson(req),profile.settings),now=new Date().toISOString();
      await db.query('INSERT INTO ai_profiles (user_id,settings,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at',[user.id,JSON.stringify(settings),now]);
      return json(200,{settings,updatedAt:now});
    }
  }
  if(path==='/api/account/ai-memories'){
    if(req.method==='GET')return json(200,{memories:(await db.query('SELECT * FROM ai_memories WHERE user_id = ? ORDER BY updated_at DESC',[user.id])).map(memoryInfo)});
    if(req.method==='DELETE'){
      if((await readJson(req)).confirm!==true)fail(400,'Подтвердите удаление личных ассоциаций.');
      await db.transaction(async tx=>{await tx.query('UPDATE users SET name = name WHERE id = ?',[user.id]);await tx.query('DELETE FROM ai_memories WHERE user_id = ?',[user.id]);});
      return json(200,{ok:true});
    }
    if(req.method==='POST'){
      const value=memoryFields(await readJson(req)),id=randomUUID(),now=new Date().toISOString();
      await db.transaction(async tx=>{
        await tx.query('UPDATE users SET name = name WHERE id = ?',[user.id]);
        const [count]=await tx.query('SELECT COUNT(*) AS total FROM ai_memories WHERE user_id = ?',[user.id]);
        if(Number(count.total)>=40)fail(409,'Можно сохранить до 40 личных ассоциаций. Удалите ненужную, чтобы добавить новую.');
        await tx.query('INSERT INTO ai_memories (id,user_id,title,content,cues,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[id,user.id,value.title,value.content,JSON.stringify(value.cues),value.active?1:0,now,now]);
      });
      return json(201,{memory:memoryInfo((await db.query('SELECT * FROM ai_memories WHERE id = ? AND user_id = ?',[id,user.id]))[0])});
    }
  }
  const memory=path.match(/^\/api\/account\/ai-memories\/([a-f0-9-]{36})$/);
  if(memory&&['PATCH','DELETE'].includes(req.method)){
    const [row]=await db.query('SELECT * FROM ai_memories WHERE id = ? AND user_id = ?',[memory[1],user.id]);if(!row)fail(404,'Ассоциация не найдена.');
    if(req.method==='DELETE'){
      await db.query('DELETE FROM ai_memories WHERE id = ? AND user_id = ?',[row.id,user.id]);return json(200,{ok:true});
    }
    const value=memoryFields(await readJson(req),memoryInfo(row));
    await db.query('UPDATE ai_memories SET title = ?, content = ?, cues = ?, active = ?, updated_at = ? WHERE id = ? AND user_id = ?',[value.title,value.content,JSON.stringify(value.cues),value.active?1:0,new Date().toISOString(),row.id,user.id]);
    return json(200,{memory:memoryInfo((await db.query('SELECT * FROM ai_memories WHERE id = ? AND user_id = ?',[row.id,user.id]))[0])});
  }
  const chat=path.match(/^\/api\/account\/conversations\/([a-f0-9-]{36})\/personalization$/);
  if(chat&&req.method==='PATCH'){
    const [row]=await db.query('SELECT * FROM conversations WHERE id = ? AND user_id = ?',[chat[1],user.id]);if(!row)fail(404,'Диалог не найден.');
    if(inFlight.has(row.id))fail(409,'Дождитесь ответа, прежде чем менять персонализацию.');
    const body=await readJson(req);if(typeof body.enabled!=='boolean')fail(400,'Укажите, включить ли персонализацию.');
    await db.query('UPDATE conversations SET personalization = ?, updated_at = ? WHERE id = ? AND user_id = ?',[body.enabled?1:0,new Date().toISOString(),row.id,user.id]);
    return json(200,{enabled:body.enabled});
  }
  return false;
}
