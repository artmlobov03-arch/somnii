const MAX_DREAM_LENGTH = 6000;
const MAX_CHAT_MESSAGE_LENGTH = 4000;
const rateLimits = new Map();

export const ANALYSIS_INSTRUCTIONS = `Ты — «Сомний», AI-помощник для бережной рефлексии над снами. Используй принципы активного слушания: отделяй детали сна от возможных личных ассоциаций, признавай эмоции, формулируй гипотезы без уверенности и оставляй выбор пользователю. Не ставь диагнозы, не назначай лечение, не предсказывай будущее и не используй универсальные «сонники». При тревоге и кошмарах предложи мягкое заземление. При непосредственной опасности, намерении навредить себе или другому человеку рекомендуй срочно обратиться к местным экстренным службам или близкому человеку. Пиши по-русски, спокойно, конкретно, без эзотерики. Верни строго JSON без Markdown: {"title":"нейтральное название до 6 слов","summary":"2–3 предложения: детали, эмоции и осторожное наблюдение","emotions":["до 4 эмоций"],"symbols":[{"name":"образ","reflection":"личная возможная ассоциация, не универсальное толкование"}],"questions":["3 открытых вопроса для саморефлексии"],"grounding":"короткая практическая рекомендация или пустая строка","note":"оговорка о том, что это не медицинское заключение"}`;

export const CHAT_INSTRUCTIONS = `Ты — «Сомний», AI-собеседник для бережной рефлексии над снами. Применяй активное слушание: коротко отрази содержание и возможную эмоцию, отдели факт от гипотезы, предложи максимум две версии через «может», «иногда», «похоже» и задай один открытый вопрос. Не ставь диагнозы, не назначай лечение, не называй себя психологом, не делай предсказаний и не используй универсальные сонники. При тревоге и кошмарах предложи простой шаг заземления. При непосредственной опасности, намерении навредить себе или другому человеку приоритет — экстренные службы или близкий человек. Отвечай по-русски, спокойно, до 140 слов, без Markdown-заголовков.`;
export const CRISIS_RESPONSE = 'Мне очень жаль, что вам сейчас так тяжело. Я не могу помочь в ситуации непосредственной опасности, но важно не оставаться с этим одному: пожалуйста, прямо сейчас свяжитесь с местными экстренными службами или человеком, которому доверяете, и скажите, что вам нужна поддержка. Если можете, отойдите от всего, чем можно себе навредить, и останьтесь рядом с людьми.';

export { MAX_DREAM_LENGTH, MAX_CHAT_MESSAGE_LENGTH };

export function sendJson(res, status, data) {
  res.status(status).json(data);
}

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

function extractOutputText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const text = (data.output || []).flatMap(item => item.content || [])
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

export async function callOpenAI(input) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('Сервис анализа пока не настроен. Попробуйте позже.');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5', store: false, input }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Не удалось получить ответ от OpenAI.');
    error.statusCode = response.status;
    throw error;
  }
  return extractOutputText(data);
}

export async function needsUrgentSupport(text) {
  if (!process.env.OPENAI_API_KEY || !text) return false;
  try {
    const response = await fetch('https://api.openai.com/v1/moderations', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'omni-moderation-latest', input: text }) });
    if (!response.ok) return false;
    const result = (await response.json()).results?.[0];
    return Boolean(result?.categories?.['self-harm/intent'] || result?.categories?.['self-harm/instructions']);
  } catch { return false; }
}

export function onlyPost(req, res) {
  if (req.method === 'POST') return false;
  res.setHeader('Allow', 'POST');
  sendJson(res, 405, { error: 'Метод не поддерживается.' });
  return true;
}
