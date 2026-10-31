import { ai, MAX_DREAM_LENGTH, isAllowed, onlyPost, sendJson } from './_openai.js';

export default async function handler(req, res) {
  if (onlyPost(req, res)) return;
  if (!isAllowed(req)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуйте через минуту.' });

  const dream = typeof req.body?.dream === 'string' ? req.body.dream.trim() : '';
  if (dream.length < 20) return sendJson(res, 400, { error: 'Опишите сон хотя бы в 20 символах.' });
  if (dream.length > MAX_DREAM_LENGTH) return sendJson(res, 400, { error: 'Запись слишком длинная. Максимум 6 000 символов.' });

  try {
    return sendJson(res, 200, { analysis: await ai.analyze(dream) });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Не удалось получить ответ AI.' });
  }
}
