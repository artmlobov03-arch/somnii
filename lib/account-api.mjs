import { getDatabase } from './database.mjs';
import { currentUser, digest, hashPassword, publicUser, randomUUID, sessionCookie, sessionToken, startSession, verifyPassword } from './auth.mjs';
import { decodeDream, dreamStatistics } from './statistics.mjs';

const attempts = new Map();
const inFlight = new Set();
function fail(status, message) { const error = new Error(message); error.statusCode = status; throw error; }
function limit(key, maximum, window = 60_000) {
  const now = Date.now();
  if (attempts.size > 5000) for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
  const entry = attempts.get(key);
  if (!entry || entry.until <= now) { attempts.set(key, { count: 1, until: now + window }); return; }
  if (++entry.count > maximum) fail(429, 'Слишком много попыток. Подождите немного и повторите.');
}
export async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Нужен JSON-запрос.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 60_000) fail(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Неверный запрос.');
    return body;
  } catch { fail(400, 'Неверный JSON-запрос.'); }
}
export function verifyOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Запрос с другого сайта запрещён.');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { fail(403, 'Неверный источник запроса.'); }
    if (origin.host !== req.headers.host) fail(403, 'Запрос с другого сайта запрещён.');
  }
}
function string(value, min, max, message) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, message);
  return value.trim();
}
function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail(400, 'Пароль должен содержать от 10 до 128 символов.');
  return value;
}
function tags(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12 || value.some(tag => typeof tag !== 'string' || tag.trim().length > 50)) fail(400, 'Укажите не больше 12 меток длиной до 50 символов.');
  const seen = new Set();
  return value.map(tag => tag.trim()).filter(tag => {
    const key = tag.toLocaleLowerCase('ru-RU');
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function dreamFields(body) {
  const title = string(body.title, 1, 120, 'Добавьте название до 120 символов.');
  const content = string(body.content, 1, 6000, 'Описание должно содержать от 1 до 6 000 символов.');
  const date = body.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail(400, 'Укажите существующую дату.');
  return { title, content, date, emotions: tags(body.emotions), symbols: tags(body.symbols), themes: tags(body.themes) };
}
function cleanAnalysis(result) {
  const list = (value, maxLength = 120) => Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => item.slice(0, maxLength)).slice(0, 12) : [];
  return {
    title: String(result.title || 'Наблюдение о сне').slice(0, 120), summary: String(result.summary || '').slice(0, 5000),
    emotions: list(result.emotions, 50), themes: list(result.themes, 50),
    symbols: Array.isArray(result.symbols) ? result.symbols.filter(item => item && typeof item.name === 'string')
      .slice(0, 12).map(item => ({ name: item.name.slice(0, 50), reflection: String(item.reflection || '').slice(0, 1000) })) : [],
    questions: list(result.questions, 500), grounding: String(result.grounding || '').slice(0, 1000), note: String(result.note || '').slice(0, 1500),
  };
}
async function ownedDream(db, id, userId) {
  const [row] = await db.query('SELECT * FROM dreams WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) fail(404, 'Запись не найдена.');
  return row;
}
async function ownedConversation(db, id, userId) {
  const [row] = await db.query('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) fail(404, 'Диалог не найден.');
  return row;
}
const conversationInfo = row => ({ id: row.id, title: row.title, dreamId: row.dream_id, createdAt: row.created_at, updatedAt: row.updated_at });

// All records are scoped to the authenticated user, including nested resources.
export async function handleAccount(req, res, url, services) {
  if (!url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/account/')) return false;
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
    return true;
  };
  try {
    verifyOrigin(req);
    const db = await (services.database ? services.database() : getDatabase());
    const path = url.pathname;
    const ip = process.env.RENDER ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    if (['/api/auth/register', '/api/auth/login'].includes(path) && req.method === 'POST') {
      limit(`auth:${ip}`, 15, 15 * 60_000);
      const body = await readJson(req);
      const email = string(body.email, 3, 254, 'Введите email.').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Проверьте адрес электронной почты.');
      const pass = password(body.password);
      let [user] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
      if (path.endsWith('/register')) {
        if (user) fail(409, 'Этот email уже зарегистрирован. Войдите в аккаунт.');
        user = { id: randomUUID(), name: string(body.name, 1, 60, 'Укажите имя до 60 символов.'), email, password_hash: await hashPassword(pass), created_at: new Date().toISOString() };
        try { await db.query('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [user.id, user.name, user.email, user.password_hash, user.created_at]); }
        catch (error) { if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) fail(409, 'Этот email уже зарегистрирован.'); throw error; }
      } else {
        // Always run a password derivation, including when the account does not exist.
        const dummy = '00000000000000000000000000000000:' + '0'.repeat(128);
        const valid = await verifyPassword(pass, user?.password_hash || dummy);
        if (!user || !valid) fail(401, 'Неверный email или пароль.');
      }
      const token = await startSession(db, user.id);
      res.setHeader('Set-Cookie', sessionCookie(req, token));
      return json(path.endsWith('/register') ? 201 : 200, { user: publicUser(user) });
    }
    const user = await currentUser(db, req);
    if (path === '/api/auth/me' && req.method === 'GET') return json(200, { user: user ? publicUser(user) : null });
    if (path === '/api/auth/logout' && req.method === 'POST') {
      await db.query('DELETE FROM sessions WHERE token_hash = ?', [digest(sessionToken(req))]);
      res.setHeader('Set-Cookie', sessionCookie(req, '', true));
      return json(200, { ok: true });
    }
    if (!user) fail(401, 'Войдите в аккаунт, чтобы открыть личный дневник.');

    if (path === '/api/account/profile' && req.method === 'PATCH') {
      const body = await readJson(req);
      const name = string(body.name, 1, 60, 'Укажите имя до 60 символов.');
      await db.query('UPDATE users SET name = ? WHERE id = ?', [name, user.id]);
      return json(200, { user: publicUser({ ...user, name }) });
    }
    if (path === '/api/account/password' && req.method === 'POST') {
      limit(`password:${user.id}`, 5, 15 * 60_000);
      const body = await readJson(req);
      if (!await verifyPassword(password(body.currentPassword), user.password_hash)) fail(400, 'Текущий пароль неверный.');
      const hash = await hashPassword(password(body.newPassword));
      await db.transaction(async tx => {
        await tx.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
        await tx.query('DELETE FROM sessions WHERE user_id = ?', [user.id]);
      });
      res.setHeader('Set-Cookie', sessionCookie(req, await startSession(db, user.id)));
      return json(200, { ok: true });
    }
    if (path === '/api/account/statistics' && req.method === 'GET') {
      const dreams = (await db.query('SELECT * FROM dreams WHERE user_id = ?', [user.id])).map(decodeDream);
      return json(200, dreamStatistics(dreams));
    }
    if (path === '/api/account/dreams' && req.method === 'GET') {
      let rows = (await db.query('SELECT * FROM dreams WHERE user_id = ? ORDER BY dream_date DESC, created_at DESC', [user.id])).map(decodeDream);
      const q = (url.searchParams.get('q') || '').slice(0, 200).toLocaleLowerCase('ru-RU');
      if (q) rows = rows.filter(row => [row.title, row.content, ...row.emotions, ...row.symbols, ...row.themes].join(' ').toLocaleLowerCase('ru-RU').includes(q));
      const date = url.searchParams.get('date');
      if (date) rows = rows.filter(row => row.date === date);
      const total = rows.length;
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      return json(200, { dreams: rows.slice(offset, offset + 30), total });
    }
    if (path === '/api/account/dreams' && req.method === 'POST') {
      const value = dreamFields(await readJson(req));
      const id = randomUUID(), now = new Date().toISOString();
      await db.query('INSERT INTO dreams (id, user_id, title, content, dream_date, emotions, symbols, themes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, user.id, value.title, value.content, value.date, JSON.stringify(value.emotions), JSON.stringify(value.symbols), JSON.stringify(value.themes), now, now]);
      return json(201, { dream: decodeDream(await ownedDream(db, id, user.id)) });
    }
    const dreamMatch = path.match(/^\/api\/account\/dreams\/([a-f0-9-]{36})(\/analysis)?$/);
    if (dreamMatch) {
      const row = await ownedDream(db, dreamMatch[1], user.id);
      if (!dreamMatch[2] && req.method === 'GET') return json(200, { dream: decodeDream(row) });
      if (!dreamMatch[2] && req.method === 'PATCH') {
        const value = dreamFields(await readJson(req));
        await db.query('UPDATE dreams SET title = ?, content = ?, dream_date = ?, emotions = ?, symbols = ?, themes = ?, analysis = ?, updated_at = ? WHERE id = ? AND user_id = ?',
          [value.title, value.content, value.date, JSON.stringify(value.emotions), JSON.stringify(value.symbols), JSON.stringify(value.themes), value.content === row.content ? row.analysis : null, new Date().toISOString(), row.id, user.id]);
        return json(200, { dream: decodeDream(await ownedDream(db, row.id, user.id)) });
      }
      if (!dreamMatch[2] && req.method === 'DELETE') {
        await db.query('DELETE FROM dreams WHERE id = ? AND user_id = ?', [row.id, user.id]);
        return json(200, { ok: true });
      }
      if (dreamMatch[2] && req.method === 'POST') {
        if (row.content.length < 20) fail(400, 'Для анализа опишите сон хотя бы в 20 символах.');
        limit(`ai:${user.id}`, 5);
        const analysis = cleanAnalysis(await services.analyze(row.content));
        const old = decodeDream(row);
        const result = await db.query('UPDATE dreams SET analysis = ?, emotions = ?, symbols = ?, themes = ?, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at = ? RETURNING *',
          [JSON.stringify(analysis), JSON.stringify(old.emotions.length ? old.emotions : analysis.emotions), JSON.stringify(old.symbols.length ? old.symbols : analysis.symbols.map(item => item.name)), JSON.stringify(old.themes.length ? old.themes : analysis.themes), new Date().toISOString(), row.id, user.id, row.updated_at]);
        if (!result.length) fail(409, 'Запись изменилась во время анализа. Обновите её и повторите.');
        return json(200, { dream: decodeDream(result[0]) });
      }
    }
    if (path === '/api/account/conversations' && req.method === 'GET') {
      const rows = await db.query('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC', [user.id]);
      return json(200, { conversations: rows.map(conversationInfo) });
    }
    if (path === '/api/account/conversations' && req.method === 'POST') {
      const body = await readJson(req);
      const dream = body.dreamId ? await ownedDream(db, String(body.dreamId), user.id) : null;
      const id = randomUUID(), now = new Date().toISOString();
      await db.query('INSERT INTO conversations (id, user_id, dream_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, user.id, dream?.id || null, dream?.title || 'Новый разговор', now, now]);
      return json(201, { conversation: conversationInfo(await ownedConversation(db, id, user.id)), messages: [] });
    }
    const chatMatch = path.match(/^\/api\/account\/conversations\/([a-f0-9-]{36})(\/messages)?$/);
    if (chatMatch) {
      const conversation = await ownedConversation(db, chatMatch[1], user.id);
      if (!chatMatch[2] && req.method === 'GET') {
        const messages = await db.query('SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY position', [conversation.id]);
        return json(200, { conversation: conversationInfo(conversation), messages });
      }
      if (!chatMatch[2] && req.method === 'DELETE') {
        await db.query('DELETE FROM conversations WHERE id = ? AND user_id = ?', [conversation.id, user.id]);
        return json(200, { ok: true });
      }
      if (chatMatch[2] && req.method === 'POST') {
        const body = await readJson(req);
        const content = string(body.content, 1, 4000, 'Сообщение должно содержать от 1 до 4 000 символов.');
        limit(`ai:${user.id}`, 5);
        if (inFlight.has(conversation.id)) fail(409, 'Дождитесь ответа на предыдущее сообщение.');
        inFlight.add(conversation.id);
        try {
          const messages = await db.query('SELECT role, content, position FROM messages WHERE conversation_id = ? ORDER BY position DESC LIMIT 16', [conversation.id]);
          const dream = conversation.dream_id ? decodeDream(await ownedDream(db, conversation.dream_id, user.id)) : null;
          const history = messages.reverse().map(({ role, content }) => ({ role, content }));
          history.push({ role: 'user', content });
          const text = await services.chat(history, dream);
          const now = new Date().toISOString();
          const position = messages.length ? messages.at(-1).position + 1 : 0;
          await db.transaction(async tx => {
            const changed = await tx.query('UPDATE conversations SET updated_at = ?, title = ? WHERE id = ? AND user_id = ? AND updated_at = ? RETURNING id',
              [now, position === 0 && !dream ? content.slice(0, 60) : conversation.title, conversation.id, user.id, conversation.updated_at]);
            if (!changed.length) fail(409, 'Диалог изменился. Откройте его заново.');
            await tx.query('INSERT INTO messages (id, conversation_id, position, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), conversation.id, position, 'user', content, now]);
            await tx.query('INSERT INTO messages (id, conversation_id, position, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), conversation.id, position + 1, 'assistant', text, now]);
          });
          return json(200, { text });
        } finally { inFlight.delete(conversation.id); }
      }
    }
    return json(404, { error: 'Маршрут не найден.' });
  } catch (error) {
    const status = error.statusCode || 500;
    // Never expose SQL, connection strings or credentials in browser errors.
    return json(status, { error: status < 500 || status === 503 ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.' });
  }
}
