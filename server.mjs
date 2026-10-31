import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAccount, verifyOrigin, readJson } from './lib/account-api.mjs';
import { createAIService } from './lib/ai-service.mjs';
import { MAX_DREAM_LENGTH, normalizeMessages } from './lib/ai-policy.mjs';

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
const rateLimits = new Map();

function contentType(file) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendAIError(res, error) {
  const status = error.statusCode || 500;
  console.error('AI request failed', { status, code: error.statusCode ? 'HANDLED' : 'INTERNAL' });
  return sendJson(res, status, { error: error.statusCode ? error.message : 'Не удалось получить ответ AI. Попробуйте позже.' });
}

function isAllowed(ip) {
  const now = Date.now();
  const item = rateLimits.get(ip) || { count: 0, startedAt: now };
  if (now - item.startedAt > 60_000) { rateLimits.set(ip, { count: 1, startedAt: now }); return true; }
  item.count += 1;
  rateLimits.set(ip, item);
  return item.count <= 5;
}

export function createAppServer(services = {}) {
const ai = createAIService();
const activeServices = { analyze: ai.analyze, chat: ai.chat, ...services };
return createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    try { verifyOrigin(req); } catch (error) { return sendJson(res, error.statusCode, { error: error.message }); }
    if (await handleAccount(req, res, url, activeServices)) return;
  }
  if (url.pathname === '/healthz' && req.method === 'GET') return sendJson(res, 200, { ok: true });
  if (req.method === 'POST' && url.pathname === '/api/dream-analysis') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!isAllowed(ip)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуй через минуту.' });
    try {
      const { dream } = await readJson(req);
      const text = typeof dream === 'string' ? dream.trim() : '';
      if (text.length < 20) return sendJson(res, 400, { error: 'Опиши сон хотя бы в 20 символах.' });
      if (text.length > MAX_DREAM_LENGTH) return sendJson(res, 400, { error: 'Запись слишком длинная. Максимум 6 000 символов.' });
      return sendJson(res, 200, { analysis: await activeServices.analyze(text) });
    } catch (error) {
      return sendAIError(res, error);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/dream-chat') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!isAllowed(ip)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуй через минуту.' });
    try {
      const { messages } = await readJson(req);
      return sendJson(res, 200, { text: await activeServices.chat(normalizeMessages(messages)) });
    } catch (error) {
      return sendAIError(res, error);
    }
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Маршрут API не найден.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD, POST, PATCH, DELETE' }); return res.end(); }
  let requested;
  try { requested = url.pathname === '/' ? PAGE : decodeURIComponent(url.pathname.slice(1)); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  // Only public assets are served. Source, database, .env and Git metadata stay private.
  const pages = new Set([PAGE, 'index.html', 'chat.html', 'account.html', 'login.html']);
  if (!pages.has(requested) && !/^assets\/[a-z0-9-]+\.(css|js|svg)$/.test(requested)) { res.writeHead(404); return res.end('Not found'); }
  const file = join(ROOT, requested);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': contentType(file), 'X-Content-Type-Options': 'nosniff' });
    return res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); return res.end('Not found'); }
});
}

if (process.argv[1] && normalize(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.listen(PORT, '0.0.0.0', () => console.log(`Сомний запущен: http://localhost:${PORT}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
