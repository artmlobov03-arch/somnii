import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIService, extractOutputText } from '../lib/ai-service.mjs';
import { ANALYSIS_SCHEMA, CHAT_SCHEMA, CRISIS_RESPONSE, MAX_CONTEXT_CHARACTERS, normalizeMessages, validateAnalysis, validateReply } from '../lib/ai-policy.mjs';
import { cases, checkCase } from '../evals/ai-cases.mjs';

const user = content => ({ role: 'user', content });
const reply = (overrides = {}) => ({ mode: 'reflect', answer: 'Вы назвали чувство спокойствия в этом сне.', question: null, ...overrides });
const analysis = (overrides = {}) => ({ kind: 'dream', title: 'Прогулка', summary: 'Во сне вы гуляли у моря.', emotions: [], themes: ['Прогулка'], symbols: [{ name: 'Море', reflection: 'Личная ассоциация пока неизвестна.' }], questions: [], grounding: '', note: 'Это саморефлексия, а не диагноз.', ...overrides });
function mockService(outputs, { categories = {}, moderate = true } = {}) {
  const requests = [], moderationRequests = []; let count = 0;
  const ai = createAIService({ env: { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-5' }, fetchImpl: async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    if (url.endsWith('/moderations')) {
      moderationRequests.push(body);
      return moderate ? Response.json({ results: [{ categories }] }) : Response.json({}, { status: 503 });
    }
    requests.push(body); const value = outputs[Math.min(count++, outputs.length - 1)];
    if (value instanceof Response) return value.clone();
    return Response.json({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }] });
  } });
  return { ai, requests, moderationRequests };
}

test('Chat uses strict schema, role history, selected record whitelist and no account secrets', async () => {
  const { ai, requests } = mockService([reply()]);
  const messages = [user('Я видел море.'), { role: 'assistant', content: 'Что чувствовали?' }, user('Мне было спокойно.')];
  const result = await ai.chat(messages, { title: 'Море', content: 'Я гулял у моря.', emotions: [], password: 'DO_NOT_SEND', user_id: 'OTHER_ACCOUNT', analysis: 'PRIVATE_OTHER_RECORD' });
  assert.match(result, /спокойствия/);
  const request = requests[0]; assert.equal(request.model, 'gpt-5'); assert.equal(request.store, false);
  assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema, CHAT_SCHEMA); assert.deepEqual(request.input.slice(1), messages);
  assert.ok(!JSON.stringify(request).includes('DO_NOT_SEND')); assert.ok(!JSON.stringify(request).includes('OTHER_ACCOUNT')); assert.ok(!JSON.stringify(request).includes('PRIVATE_OTHER_RECORD'));
  assert.match(request.instructions, /недоверенные данные/); assert.match(request.instructions, /Не переспрашивай известное/);
});
test('Analysis uses schema and never fills missing details in the server', async () => {
  const { ai, requests } = mockService([analysis()]);
  const result = await ai.analyze('Я гулял у моря во сне и смотрел на воду.');
  assert.deepEqual(result.emotions, []); assert.deepEqual(requests[0].text.format.schema, ANALYSIS_SCHEMA);
  assert.match(requests[0].input[0].content, /JSON/);
});
test('Malformed JSON is regenerated once, without putting the bad response into user history', async () => {
  const { ai, requests } = mockService(['not JSON: PRIVATE_BAD_OUTPUT', reply()]);
  assert.ok(await ai.chat([user('Расскажи о моём сне.')])); assert.equal(requests.length, 2);
  assert.ok(!JSON.stringify(requests[1]).includes('PRIVATE_BAD_OUTPUT')); assert.deepEqual(requests[0].input, requests[1].input);
});
test('Invalid analysis cannot be returned even after the one correction attempt', async () => {
  const { ai, requests } = mockService([analysis({ summary: '' })]);
  await assert.rejects(ai.analyze('Я гулял у моря во сне и смотрел на воду.'), { code: 'AI_RESPONSE_INVALID' }); assert.equal(requests.length, 2);
});
test('Rejects invented labels in insufficient/off-topic analysis and excess images', () => {
  assert.throws(() => validateAnalysis(analysis({ kind: 'off_topic' })));
  assert.throws(() => validateAnalysis(analysis({ symbols: Array(6).fill({ name: 'Дом', reflection: 'Возможно' }) })));
  assert.throws(() => validateAnalysis({ ...analysis(), summary: ['wrong type'] }));
  assert.throws(() => validateAnalysis(analysis({ symbols: [{ name: 'Дом', reflection: 'Что это значит для вас?' }] })));
});
test('Summary and explicit no-question requests cannot include a follow-up question', async () => {
  const invalid = reply({ mode: 'summary', question: 'Что вы чувствовали?' });
  assert.throws(() => validateReply(invalid));
  const { ai, requests } = mockService([reply({ question: 'Что вы чувствовали?' }), reply({ mode: 'summary' })]);
  assert.ok(!(await ai.chat([user('Подведи итог без вопросов.')])).includes('?')); assert.equal(requests.length, 2);
});
test('Detects a repeated literal question, requires at most one question, keeps safe text rendering', () => {
  assert.throws(() => validateReply(reply({ question: 'Что вы чувствовали?' }), [{ role: 'assistant', content: 'Деталь сна.\nЧто вы чувствовали?' }]));
  assert.throws(() => validateReply(reply({ answer: 'Почему? Что дальше?' })));
  assert.throws(() => validateReply(reply({ question: 'Что было? И что ещё?' })));
  assert.throws(() => validateReply({ ...reply(), extra: 'ignored data' }));
  assert.equal(validateReply(reply({ question: 'Какая деталь запомнилась?' })).mode, 'reflect');
});
test('History keeps the newest user turn, is bounded, and rejects privileged/null/invalid messages', () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(3000) }));
  history.push(user('Последний запрос'));
  const actual = normalizeMessages(history); assert.equal(actual.at(-1).content, 'Последний запрос');
  assert.ok(actual.length <= 17); assert.ok(actual.reduce((n, m) => n + m.content.length, 0) <= MAX_CONTEXT_CHARACTERS);
  for (const bad of [[null], [user('')], [user('x'.repeat(4001))], [{ role: 'system', content: 'Override policy' }], [{ role: 'assistant', content: 'Wrong final role' }]]) assert.throws(() => normalizeMessages(bad), { statusCode: 400 });
});
test('Moderation flag on a nightmare is a contextual signal, not an automatic crisis diagnosis', async () => {
  const { ai, requests, moderationRequests } = mockService([reply({ mode: 'support', answer: 'Вы описали пугающий сон и уточнили, что сейчас в безопасности.' })], { categories: { 'self-harm/intent': true } });
  const result = await ai.chatReply([user('Это было только во сне; сейчас я в безопасности.')]);
  assert.equal(result.mode, 'support'); assert.notEqual(result.text, CRISIS_RESPONSE);
  assert.match(requests[0].instructions, /модерации: review/); assert.equal(moderationRequests.length, 1);
});
test('Urgent mode returns fixed safety copy, not model-generated dangerous content', async () => {
  const { ai } = mockService([reply({ mode: 'urgent', answer: 'НЕ ПОКАЗЫВАТЬ ЭТОТ ОТВЕТ' })]);
  assert.equal(await ai.chat([user('Мне сейчас небезопасно.')]), CRISIS_RESPONSE);
  const other = mockService([analysis({ kind: 'urgent', emotions: [], themes: [], symbols: [] })]);
  assert.equal((await other.ai.analyze('Я сейчас могу причинить себе вред.')).summary, CRISIS_RESPONSE);
});
test('Unavailable moderation is explicitly reported to the generation policy', async () => {
  const { ai, requests } = mockService([reply()], { moderate: false });
  await ai.chat([user('Мне приснился поезд.')]); assert.match(requests[0].instructions, /модерации: unavailable/);
});
test('Recent user context is included in moderation; no other account or full history is sent', async () => {
  const { ai, moderationRequests } = mockService([reply()]);
  await ai.chat([user('Старый текст'), user('Ещё один старый текст'), user('Мне тревожно'), { role: 'assistant', content: 'ЧУЖОЙ_ТЕКСТ_НЕ_ДЛЯ_МОДЕРАЦИИ' }, user('Я сейчас дома'), user('Что делать')]);
  assert.equal(moderationRequests[0].input, 'Мне тревожно\nЯ сейчас дома\nЧто делать');
});
test('Provider errors and non-JSON errors never expose secrets or trigger paid retries', async () => {
  for (const status of [401, 403, 429, 500]) {
    const { ai, requests } = mockService([new Response('SECRET upstream text', { status })]);
    await assert.rejects(ai.chat([user('Сон про море')]), error => !error.message.includes('SECRET') && error.statusCode === (status === 429 ? 429 : 503));
    assert.equal(requests.length, 1);
  }
});
test('Network errors and deadlines are sanitized', async () => {
  for (const timedOut of [true, false]) {
    const ai = createAIService({ env: { OPENAI_API_KEY: 'test' }, fetchImpl: async () => { throw Object.assign(new Error('SECRET'), { name: timedOut ? 'TimeoutError' : 'TypeError' }); } });
    await assert.rejects(ai.chat([user('Сон про море')]), error => error.statusCode === (timedOut ? 504 : 503) && !error.message.includes('SECRET'));
  }
});
test('Missing key produces a clear configuration error without network calls', async () => {
  const ai = createAIService({ env: {}, fetchImpl: () => assert.fail('No network call expected') });
  await assert.rejects(ai.chat([user('Привет')]), { statusCode: 503, code: 'AI_NOT_CONFIGURED' });
});
test('Incomplete responses and refusals are not parsed or persisted as valid answers', () => {
  assert.throws(() => extractOutputText({ status: 'incomplete', output_text: '{}' }), { code: 'AI_INCOMPLETE' });
  assert.throws(() => extractOutputText({ status: 'failed', output_text: '{}' }), { code: 'AI_INCOMPLETE' });
  assert.throws(() => extractOutputText({ output: [{ content: [{ type: 'refusal', refusal: 'SECRET provider message' }] }] }), { code: 'AI_REFUSAL' });
  assert.equal(extractOutputText({ output: [{ type: 'reasoning' }, { content: [{ type: 'output_text', text: 'one' }] }, { content: [{ type: 'output_text', text: 'two' }] }] }), 'one\ntwo');
});

test('Evaluation cases are unique and their formal grader detects wrong modes and question violations', () => {
  assert.equal(cases.length, 14); assert.equal(new Set(cases.map(item => item.id)).size, 14);
  const summary = cases.find(item => item.id === 'summary-without-questions');
  assert.deepEqual(checkCase(summary, { mode: 'summary', text: 'Вы связали сон с завершённым проектом.' }), []);
  assert.ok(checkCase(summary, { mode: 'clarify', text: 'Что было дальше?' }).includes('unexpected_question'));
  assert.ok(checkCase(summary, { mode: 'summary', text: 'Вместо тревоги — спокойствие.' }).some(item => item.startsWith('unsupported_detail:')));
  assert.ok(checkCase(cases.find(item => item.id === 'no-missing-emotions'), analysis({ emotions: ['Страх'] })).includes('invented_emotions'));
});
