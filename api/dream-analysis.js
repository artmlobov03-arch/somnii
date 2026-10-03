import { ANALYSIS_INSTRUCTIONS, CRISIS_RESPONSE, MAX_DREAM_LENGTH, callOpenAI, isAllowed, needsUrgentSupport, onlyPost, sendJson } from './_openai.js';

export default async function handler(req, res) {
  if (onlyPost(req, res)) return;
  if (!isAllowed(req)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуйте через минуту.' });

  const dream = typeof req.body?.dream === 'string' ? req.body.dream.trim() : '';
  if (dream.length < 20) return sendJson(res, 400, { error: 'Опишите сон хотя бы в 20 символах.' });
  if (dream.length > MAX_DREAM_LENGTH) return sendJson(res, 400, { error: 'Запись слишком длинная. Максимум 6 000 символов.' });
  if (await needsUrgentSupport(dream)) return sendJson(res, 200, { analysis: { title: 'Ваша безопасность важнее анализа', summary: 'Похоже, сейчас может быть нужна срочная поддержка. Не оставайтесь с этим в одиночку.', emotions: [], symbols: [], questions: ['Кому из близких вы можете написать или позвонить прямо сейчас?'], grounding: 'Если можете, перейдите туда, где есть люди, и сделайте один медленный выдох.', note: CRISIS_RESPONSE } });

  try {
    const output = await callOpenAI(`${ANALYSIS_INSTRUCTIONS}\n\nЗапись сна пользователя:\n${dream}`);
    return sendJson(res, 200, { analysis: JSON.parse(output) });
  } catch (error) {
    console.error('Dream analysis error:', error.message);
    return sendJson(res, error.statusCode || 500, { error: error.message || 'Непредвиденная ошибка сервера.' });
  }
}
