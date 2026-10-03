import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Локально настройки берутся из .env, а на хостинге — из переменных окружения.
// Файл .env отсутствует на Render и не должен быть частью репозитория.
async function loadLocalEnv() {
  try {
    const source = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const PAGE = 'somnium_1 (1).html';
const MAX_DREAM_LENGTH = 6000;
const MAX_CHAT_MESSAGE_LENGTH = 4000;
const rateLimits = new Map();

const ANALYSIS_INSTRUCTIONS = `Ты — «Сомний», AI-помощник для бережной рефлексии над снами. Используй принципы активного слушания: отделяй наблюдаемые детали сна от возможных личных ассоциаций, признавай эмоции, формулируй гипотезы без уверенности и оставляй выбор пользователю. Не ставь психиатрические или психологические диагнозы, не назначай лечение, не предсказывай будущее и не используй универсальные «сонники». Не утверждай, что сон раскрывает скрытые истины. Если пользователь описывает травму, тревогу или кошмар, предложи мягкое заземление: назвать 3 предмета вокруг, сделать медленный выдох, записать ощущение. При непосредственной опасности, намерении навредить себе или другому человеку рекомендуй срочно обратиться к местным экстренным службам или близкому человеку. Пиши по-русски, спокойно, конкретно, без эзотерики. Верни строго JSON без Markdown: {"title":"нейтральное название до 6 слов","summary":"2–3 предложения: детали, эмоции и осторожное наблюдение","emotions":["до 4 эмоций"],"symbols":[{"name":"образ","reflection":"личная возможная ассоциация, не универсальное толкование"}],"questions":["3 открытых вопроса для саморефлексии"],"grounding":"короткая практическая рекомендация или пустая строка","note":"оговорка о том, что это не медицинское заключение"}`;
const CHAT_INSTRUCTIONS = `Ты — «Сомний», AI-собеседник для бережной рефлексии над снами. Применяй активное слушание и психологически осторожный подход: 1) коротко отрази содержание и возможную эмоцию; 2) отдели факт из рассказа от гипотезы; 3) предложи максимум две личностно-зависимые версии через «может», «иногда», «похоже»; 4) задай один открытый вопрос. Не ставь диагнозы, не назначай лечение, не называй себя психологом, не делай предсказаний и не используй универсальные сонники. Не утверждай, что сон доказывает скрытые мотивы или события. При тревоге и кошмарах предложи простой шаг заземления. Если пользователь сообщает о непосредственной опасности, намерении навредить себе или другому человеку, приоритет — немедленно посоветовать обратиться к местным экстренным службам или близкому человеку. Отвечай на русском, спокойно, до 140 слов, без Markdown-заголовков.`;
const CRISIS_RESPONSE = 'Мне очень жаль, что вам сейчас так тяжело. Я не могу помочь в ситуации непосредственной опасности, но важно не оставаться с этим одному: пожалуйста, прямо сейчас свяжитесь с местными экстренными службами или человеком, которому доверяете, и скажите, что вам нужна поддержка. Если можете, отойдите от всего, чем можно себе навредить, и останьтесь рядом с людьми.';

function contentType(file) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const text = (payload.output || []).flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' || part.type === 'text')
    .map(part => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();
  if (text) return text;
  const error = new Error('OpenAI не вернул текстовый ответ. Попробуйте ещё раз.');
  error.statusCode = 502;
  throw error;
}

function isAllowed(ip) {
  const now = Date.now();
  const item = rateLimits.get(ip) || { count: 0, startedAt: now };
  if (now - item.startedAt > 60_000) { rateLimits.set(ip, { count: 1, startedAt: now }); return true; }
  item.count += 1;
  rateLimits.set(ip, item);
  return item.count <= 5;
}

async function parseJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 50_000) throw new Error('Слишком большой запрос');
  }
  return JSON.parse(body || '{}');
}

async function needsUrgentSupport(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text) return false;
  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
    });
    if (!response.ok) return false;
    const result = (await response.json()).results?.[0];
    return Boolean(result?.categories?.['self-harm/intent'] || result?.categories?.['self-harm/instructions']);
  } catch {
    return false;
  }
}

async function analyzeDream(dream) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const error = new Error('OPENAI_API_KEY не задан. Добавь ключ в переменные окружения сервера.');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5', store: false, input: `${ANALYSIS_INSTRUCTIONS}\n\nЗапись сна пользователя:\n${dream}` }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Не удалось получить ответ от OpenAI.');
    error.statusCode = response.status;
    throw error;
  }
  try { return JSON.parse(extractOutputText(payload)); }
  catch {
    const error = new Error('Модель вернула ответ в неподходящем формате. Попробуй ещё раз.');
    error.statusCode = 502;
    throw error;
  }
}

async function chatAboutDreams(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const error = new Error('OPENAI_API_KEY не задан. Добавь ключ в переменные окружения сервера.');
    error.statusCode = 503;
    throw error;
  }
  const history = messages.slice(-10).map(({ role, content }) => `${role === 'assistant' ? 'Сомний' : 'Пользователь'}: ${content}`).join('\n\n');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5', store: false, input: `${CHAT_INSTRUCTIONS}\n\nДиалог:\n${history}` }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Не удалось получить ответ от OpenAI.');
    error.statusCode = response.status;
    throw error;
  }
  return extractOutputText(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && url.pathname === '/api/dream-analysis') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!isAllowed(ip)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуй через минуту.' });
    try {
      const { dream } = await parseJsonBody(req);
      const text = typeof dream === 'string' ? dream.trim() : '';
      if (text.length < 20) return sendJson(res, 400, { error: 'Опиши сон хотя бы в 20 символах.' });
      if (text.length > MAX_DREAM_LENGTH) return sendJson(res, 400, { error: 'Запись слишком длинная. Максимум 6 000 символов.' });
      if (await needsUrgentSupport(text)) return sendJson(res, 200, { analysis: { title: 'Ваша безопасность важнее анализа', summary: 'Похоже, сейчас может быть нужна срочная поддержка. Не оставайтесь с этим в одиночку.', emotions: [], symbols: [], questions: ['Кому из близких вы можете написать или позвонить прямо сейчас?'], grounding: 'Если можете, перейдите туда, где есть люди, и сделайте один медленный выдох.', note: CRISIS_RESPONSE } });
      return sendJson(res, 200, { analysis: await analyzeDream(text) });
    } catch (error) {
      console.error('Dream analysis error:', error.message);
      return sendJson(res, error.statusCode || 500, { error: error.message || 'Непредвиденная ошибка сервера.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/dream-chat') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!isAllowed(ip)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуй через минуту.' });
    try {
      const { messages } = await parseJsonBody(req);
      if (!Array.isArray(messages) || messages.length === 0) return sendJson(res, 400, { error: 'Напиши сообщение.' });
      const cleanMessages = messages.slice(-10).map(({ role, content }) => ({
        role: role === 'assistant' ? 'assistant' : 'user',
        content: typeof content === 'string' ? content.trim() : '',
      })).filter(message => message.content.length > 0 && message.content.length <= MAX_CHAT_MESSAGE_LENGTH);
      if (!cleanMessages.length) return sendJson(res, 400, { error: 'Сообщение должно быть от 1 до 4 000 символов.' });
      if (await needsUrgentSupport(cleanMessages.at(-1).content)) return sendJson(res, 200, { text: CRISIS_RESPONSE });
      return sendJson(res, 200, { text: await chatAboutDreams(cleanMessages) });
    } catch (error) {
      console.error('Dream chat error:', error.message);
      return sendJson(res, error.statusCode || 500, { error: error.message || 'Непредвиденная ошибка сервера.' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD, POST' }); return res.end(); }
  const requested = url.pathname === '/' ? PAGE : decodeURIComponent(url.pathname.slice(1));
  const file = normalize(join(ROOT, requested));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': contentType(file), 'X-Content-Type-Options': 'nosniff' });
    return res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); return res.end('Not found'); }
});

server.listen(PORT, () => console.log(`Сомний запущен: http://localhost:${PORT}`));
