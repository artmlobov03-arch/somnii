import { CHAT_INSTRUCTIONS, CRISIS_RESPONSE, MAX_CHAT_MESSAGE_LENGTH, callOpenAI, isAllowed, needsUrgentSupport, onlyPost, sendJson } from './_openai.js';

export default async function handler(req, res) {
  if (onlyPost(req, res)) return;
  if (!isAllowed(req)) return sendJson(res, 429, { error: 'Слишком много запросов. Попробуйте через минуту.' });

  if (!Array.isArray(req.body?.messages) || !req.body.messages.length) return sendJson(res, 400, { error: 'Напишите сообщение.' });
  const messages = req.body.messages.slice(-10).map(({ role, content }) => ({
    role: role === 'assistant' ? 'assistant' : 'user',
    content: typeof content === 'string' ? content.trim() : '',
  })).filter(message => message.content.length > 0 && message.content.length <= MAX_CHAT_MESSAGE_LENGTH);
  if (!messages.length) return sendJson(res, 400, { error: 'Сообщение должно быть от 1 до 4 000 символов.' });
  if (await needsUrgentSupport(messages.at(-1).content)) return sendJson(res, 200, { text: CRISIS_RESPONSE });

  try {
    const history = messages.map(({ role, content }) => `${role === 'assistant' ? 'Сомний' : 'Пользователь'}: ${content}`).join('\n\n');
    return sendJson(res, 200, { text: (await callOpenAI(`${CHAT_INSTRUCTIONS}\n\nДиалог:\n${history}`)).trim() });
  } catch (error) {
    console.error('Dream chat error:', error.message);
    return sendJson(res, error.statusCode || 500, { error: error.message || 'Непредвиденная ошибка сервера.' });
  }
}
