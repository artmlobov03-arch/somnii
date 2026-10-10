import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../lib/database.mjs';
import { dreamStatistics } from '../lib/statistics.mjs';
import { createAppServer } from '../server.mjs';

async function exercise(t, db) {
  let shouldFail = false;
  const seen = [];
  const server = createAppServer({ database: async () => db,
    analyze: async content => ({ title: 'Наблюдение', summary: content, emotions: ['Интерес'], symbols: [{ name: 'Сад', reflection: 'Возможная личная ассоциация' }], themes: ['Отдых'], questions: ['Что вы чувствовали?'], note: 'Для саморефлексии.' }),
    chat: async (history, dream) => {
      if (shouldFail) throw new Error('Test upstream unavailable');
      seen.push({ history, dream }); return 'Какое ощущение было самым заметным?';
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, cookie, method = body ? 'POST' : 'GET', headers = {}) {
    const result = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await result.json();
    return { status: result.status, data, cookie: result.headers.get('set-cookie')?.split(';')[0], headers: result.headers };
  }
  const register = (email, name) => request('/api/auth/register', { email, name, password: 'somnii-test-password' });
  const alice = await register('alice@example.test', 'Алиса');
  assert.equal(alice.status, 201); assert.ok(alice.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(alice.headers.get('set-cookie').includes('SameSite=Lax'));
  const bob = await register('bob@example.test', 'Борис'); assert.equal(bob.status, 201);
  assert.equal((await register('alice@example.test', 'Дубликат')).status, 409);
  assert.equal((await request('/api/account/dreams')).status, 401);
  const [stored] = await db.query('SELECT * FROM users WHERE email = ?', ['alice@example.test']);
  assert.notEqual(stored.password_hash, 'somnii-test-password');
  const [session] = await db.query('SELECT * FROM sessions WHERE user_id = ?', [stored.id]);
  assert.ok(!alice.cookie.includes(session.token_hash));

  const dreamData = { title: '<script>Сад</script>', content: 'Мне приснился спокойный сад и шум дождя. Я гуляла среди деревьев.', date: '2026-10-10', emotions: ['Радость', 'радость'], symbols: ['Сад'], themes: ['Отдых'] };
  const created = await request('/api/account/dreams', dreamData, alice.cookie);
  assert.equal(created.status, 201); const dream = created.data.dream;
  assert.deepEqual(dream.emotions, ['Радость']);
  assert.equal((await request(`/api/account/dreams/${dream.id}`, null, bob.cookie)).status, 404);
  assert.equal((await request(`/api/account/dreams/${dream.id}`, dreamData, bob.cookie, 'PATCH')).status, 404);
  assert.equal((await request(`/api/account/dreams/${dream.id}`, null, bob.cookie, 'DELETE')).status, 404);
  assert.equal((await request('/api/account/dreams', { ...dreamData, date: '2026-02-30' }, alice.cookie)).status, 400);
  assert.equal((await request('/api/account/dreams', dreamData, alice.cookie, 'POST', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/api/account/dreams', dreamData, alice.cookie, 'POST', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/account/dreams?q=%D0%A1%D0%90%D0%94', null, alice.cookie)).data.total, 1);
  assert.equal((await request('/api/account/dreams?date=2026-10-09', null, alice.cookie)).data.total, 0);
  const analysis = await request(`/api/account/dreams/${dream.id}/analysis`, {}, alice.cookie);
  assert.equal(analysis.status, 200); assert.ok(analysis.data.dream.analysis);
  assert.deepEqual(analysis.data.dream.emotions, ['Радость']); // User's labels take priority.
  await request('/api/account/dreams', { ...dreamData, title: 'Снова сад' }, alice.cookie);
  const statistics = (await request('/api/account/statistics', null, alice.cookie)).data;
  assert.equal(statistics.total, 2); assert.deepEqual(statistics.symbols, [{ label: 'сад', count: 2 }]);
  assert.equal(statistics.calendar['2026-10-10'], 2);
  const update = await request(`/api/account/dreams/${dream.id}`, { ...dreamData, content: 'Я вспомнила, что сад был совершенно другим и я испытывала удивление.' }, alice.cookie, 'PATCH');
  assert.equal(update.status, 200); assert.equal(update.data.dream.analysis, null);

  const chat = await request('/api/account/conversations', { dreamId: dream.id }, alice.cookie);
  assert.equal(chat.status, 201); const id = chat.data.conversation.id;
  assert.equal((await request('/api/account/conversations', { dreamId: dream.id }, bob.cookie)).status, 404);
  assert.equal((await request(`/api/account/conversations/${id}`, null, bob.cookie)).status, 404);
  assert.equal((await request(`/api/account/conversations/${id}/messages`, { content: 'Чужой диалог' }, bob.cookie)).status, 404);
  const answer = await request(`/api/account/conversations/${id}/messages`, { content: 'Я почувствовала удивление.' }, alice.cookie);
  assert.equal(answer.status, 200); assert.ok(answer.data.text);
  assert.equal(seen[0].dream.id, dream.id); assert.equal(seen[0].history.at(-1).role, 'user');
  const second = await request(`/api/account/conversations/${id}/messages`, { content: 'Это было приятное удивление.' }, alice.cookie);
  assert.equal(second.status, 200); assert.equal(seen[1].history.length, 3);
  shouldFail = true;
  assert.equal((await request(`/api/account/conversations/${id}/messages`, { content: 'Проверка ошибки' }, alice.cookie)).status, 500);
  assert.equal((await request(`/api/account/conversations/${id}`, null, alice.cookie)).data.messages.length, 4);
  shouldFail = false;
  await request(`/api/account/dreams/${dream.id}`, null, alice.cookie, 'DELETE');
  assert.equal((await request(`/api/account/conversations/${id}`, null, alice.cookie)).data.conversation.dreamId, null);

  const login = await request('/api/auth/login', { email: 'ALICE@example.test', password: 'somnii-test-password' });
  assert.equal(login.status, 200);
  assert.equal((await request('/api/auth/login', { email: 'alice@example.test', password: 'wrong-password' })).status, 401);
  const password = await request('/api/account/password', { currentPassword: 'somnii-test-password', newPassword: 'a-new-test-password' }, alice.cookie);
  assert.equal(password.status, 200);
  assert.equal((await request('/api/auth/me', null, login.cookie)).data.user, null);
  assert.ok((await request('/api/auth/me', null, password.cookie)).data.user);
  await request('/api/auth/logout', {}, password.cookie);
  assert.equal((await request('/api/auth/me', null, password.cookie)).data.user, null);
  for (const path of ['/.env', '/server.mjs', '/lib/database.mjs', '/data/somnii.sqlite', '/.git/config', '/package-lock.json']) {
    assert.equal((await fetch(base + path)).status, 404, `${path} must not be public`);
  }
  for (const path of ['/', '/account.html', '/login.html', '/chat.html', '/assets/account.js', '/assets/account.css']) assert.equal((await fetch(base + path)).status, 200);
}

test('SQLite: full account lifecycle, access isolation, chat persistence, CSRF and private files', async t => {
  const db = await createDatabase({ filename: ':memory:' }); t.after(() => db.close()); await exercise(t, db);
});
test('SQLite persists after reopening and rolls back failed transactions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somnii-db-test-'));
  const filename = join(directory, 'test.sqlite');
  let db = await createDatabase({ filename });
  await db.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', ['persistent', 'persistent@example.test', 'Test', 'hash', new Date().toISOString()]);
  await assert.rejects(db.transaction(async tx => { await tx.query('DELETE FROM users WHERE id = ?', ['persistent']); throw new Error('rollback'); }));
  await db.close(); db = await createDatabase({ filename });
  assert.equal((await db.query('SELECT * FROM users')).length, 1); await db.close();
});
test('Statistics deduplicate labels per dream and only mark actual repetitions', () => {
  const data = dreamStatistics([
    { date: '2026-10-10', emotions: ['Радость', 'радость'], symbols: ['Дом'], themes: ['Учёба'] },
    { date: '2026-10-09', emotions: ['Страх'], symbols: ['дом', 'Поезд'], themes: ['Путешествие'], analysis: {} },
  ], new Date('2026-10-10T12:00:00Z'));
  assert.equal(data.total, 2); assert.equal(data.last30Days, 2); assert.equal(data.analyzed, 1);
  assert.deepEqual(data.symbols, [{ label: 'дом', count: 2 }]); assert.deepEqual(data.themes, []);
  assert.equal(data.emotions.find(item => item.label === 'радость').count, 1);
});
test('PostgreSQL SQL compatibility with a real embedded PostgreSQL engine', async t => {
  const { PGlite } = await import('@electric-sql/pglite');
  const postgres = new PGlite();
  const pool = {
    query: (sql, values) => postgres.query(sql, values),
    connect: async () => ({ query: (sql, values) => postgres.query(sql, values), release() {} }),
    end: () => postgres.close(),
  };
  const db = await createDatabase({ pool }); t.after(() => db.close());
  await exercise(t, db);
});

test('Responses API contract: JSON input marker, role history and sanitized upstream errors', async t => {
  const localFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-never-transmitted';
  t.after(() => { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; });
  let rejected = false;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url).startsWith('https://api.openai.com/'), true);
    if (String(url).endsWith('/moderations')) return Response.json({ results: [{ categories: {} }] });
    const request = JSON.parse(options.body);
    requests.push(request);
    if (rejected) return Response.json({ error: { message: 'SECRET detail must not reach browser' } }, { status: 401 });
    return Response.json({ output: [{ content: [{ type: 'output_text', text: request.text ? JSON.stringify({ title: 'Сад', summary: 'Спокойная прогулка' }) : 'Что вы чувствовали рядом с домом?' }] }] });
  });
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, body) => localFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await send('/api/dream-analysis', { dream: 'Я гулял по саду после дождя, и мне было спокойно.' });
  assert.equal(result.status, 200); assert.equal((await result.json()).analysis.title, 'Сад');
  assert.equal(requests[0].text.format.type, 'json_object');
  assert.match(JSON.stringify(requests[0].input), /json/i);
  assert.equal(requests[0].store, false); assert.ok(requests[0].instructions);
  const messages = [{ role: 'user', content: 'Я видел дом.' }, { role: 'assistant', content: 'Что чувствовали?' }, { role: 'user', content: 'Спокойствие.' }];
  const chat = await send('/api/dream-chat', { messages });
  assert.equal(chat.status, 200); assert.deepEqual(requests[1].input, messages);
  assert.match((await chat.json()).text, /чувствовали/);
  rejected = true;
  const failure = await send('/api/dream-chat', { messages });
  assert.equal(failure.status, 503); assert.ok(!JSON.stringify(await failure.json()).includes('SECRET'));
});
