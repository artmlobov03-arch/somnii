export function decodeDream(row) {
  return {
    id: row.id, title: row.title, content: row.content, date: row.dream_date,
    emotions: JSON.parse(row.emotions), symbols: JSON.parse(row.symbols), themes: JSON.parse(row.themes),
    analysis: row.analysis ? JSON.parse(row.analysis) : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export function dreamStatistics(dreams, now = new Date()) {
  const countTags = key => {
    const counts = new Map();
    for (const dream of dreams) {
      for (const tag of new Set(dream[key].map(value => value.toLocaleLowerCase('ru-RU').trim()))) {
        if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
  };
  const calendar = {};
  for (const dream of dreams) calendar[dream.date] = (calendar[dream.date] || 0) + 1;
  const since = new Date(now.getTime() - 29 * 86400_000).toISOString().slice(0, 10);
  return {
    total: dreams.length, last30Days: dreams.filter(dream => dream.date >= since && dream.date <= now.toISOString().slice(0, 10)).length,
    analyzed: dreams.filter(dream => dream.analysis).length,
    emotions: countTags('emotions'), symbols: countTags('symbols').filter(item => item.count >= 2),
    themes: countTags('themes').filter(item => item.count >= 2), calendar,
  };
}
