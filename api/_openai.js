import { createAIService } from '../lib/ai-service.mjs';
export { MAX_DREAM_LENGTH, MAX_CHAT_MESSAGE_LENGTH, normalizeMessages } from '../lib/ai-policy.mjs';
export const ai = createAIService();
const rateLimits = new Map();

export function sendJson(res, status, data) { res.status(status).json(data); }

export function isAllowed(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const item = rateLimits.get(ip) || { count: 0, startedAt: now };
  if (now - item.startedAt > 60_000) { rateLimits.set(ip, { count: 1, startedAt: now }); return true; }
  item.count += 1;
  rateLimits.set(ip, item);
  return item.count <= 5;
}

export function onlyPost(req, res) {
  if (req.method === 'POST') return false;
  res.setHeader('Allow', 'POST');
  sendJson(res, 405, { error: 'Метод не поддерживается.' });
  return true;
}
