import { ai, normalizeMessages, isAllowed, onlyPost, sendJson } from './_openai.js';

export default async function handler(req, res) {
  if (onlyPost(req, res)) return;
  if (!isAllowed(req)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуйте через минуту.' });

  try {
    return sendJson(res, 200, { text: await ai.chat(normalizeMessages(req.body?.messages)) });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Не удалось получить ответ AI.' });
  }
}
