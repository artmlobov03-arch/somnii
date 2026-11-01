import { writeFile } from 'node:fs/promises';
import { createAIService } from '../lib/ai-service.mjs';
import { POLICY_VERSION } from '../lib/ai-policy.mjs';
import { cases, checkCase } from '../evals/ai-cases.mjs';

const args = process.argv.slice(2);
if (!args.includes('--live')) {
  console.log(`Подготовлено сценариев: ${cases.length}. API не вызывается.\nДля платной проверки на синтетических данных: npm run eval:ai -- --live --limit=6\nОдин сценарий: npm run eval:ai -- --live --case=summary-without-questions`);
} else {
  try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!process.env.OPENAI_API_KEY) throw new Error('Настройте OPENAI_API_KEY на сервере или в локальном .env. Не отправляйте ключ в чат.');
  const requested = args.find(arg => arg.startsWith('--case='))?.slice(7);
  const limit = Number(args.find(arg => arg.startsWith('--limit='))?.slice(8) || 6);
  if (!Number.isInteger(limit) || limit < 1 || limit > cases.length) throw new Error('Некорректный --limit');
  const selected = requested ? cases.filter(example => example.id === requested) : cases.slice(0, limit);
  if (!selected.length) throw new Error('Сценарий не найден');
  const report = { date: new Date().toISOString(), policyVersion: POLICY_VERSION, model: process.env.OPENAI_MODEL || 'gpt-5', note: 'Автопроверки не заменяют ручную оценку качества и безопасности.', cases: [] };
  const ai = createAIService();
  console.log(`Проверка ${selected.length} синтетических сценариев. Запросы оплачиваются по условиям вашего API; максимум две генерации на сценарий при ошибке формата.`);
  for (const example of selected) {
    const started = Date.now();
    try {
      const result = example.task === 'analysis' ? await ai.analyze(example.dream) : await ai.chatReply(example.messages, example.dream, example.personal);
      const failures = checkCase(example, result);
      report.cases.push({ id: example.id, milliseconds: Date.now() - started, failures, result, manualReview: example.review });
      console.log(`${failures.length ? 'REVIEW' : 'PASS'} ${example.id}: ${failures.join(', ') || 'формальные проверки пройдены'}`);
    } catch (error) {
      report.cases.push({ id: example.id, error: error.code || 'ERROR', status: error.statusCode, milliseconds: Date.now() - started });
      console.log(`ERROR ${example.id}: ${error.message}`);
      // Don't burn quota on the rest of the suite when provider access is unavailable.
      if ([401, 403, 429, 503, 504].includes(error.statusCode)) break;
    }
  }
  const filename = requested ? `report-${selected[0].id}.json` : 'latest-report.json';
  await writeFile(new URL(`../evals/${filename}`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
  const passed = report.cases.filter(item => !item.error && !item.failures.length).length;
  console.log(`Отчёт: evals/${filename}. Формально пройдено ${passed}/${report.cases.length}; запрошено ${selected.length}. Прочитайте ответы и критерии manualReview.`);
  if (passed !== selected.length) process.exitCode = 1;
}
