export function decodeDream(row) {
  return {
    id: row.id, title: row.title, content: row.content, date: row.dream_date,
    emotions: JSON.parse(row.emotions), symbols: JSON.parse(row.symbols), themes: JSON.parse(row.themes),
    analysis: row.analysis ? JSON.parse(row.analysis) : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
    favorite: Boolean(row.is_favorite),
  };
}

export function weeklyOverview(dreams, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || !Number.isFinite(Date.parse(endDate)) || new Date(endDate).toISOString().slice(0, 10) !== endDate) {
    throw Object.assign(new Error('Укажите существующую дату конца недели.'), { statusCode: 400 });
  }
  const start = new Date(`${endDate}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 6);
  const startDate = start.toISOString().slice(0, 10);
  const selected = dreams.filter(dream => dream.date >= startDate && dream.date <= endDate);
  const tags = key => {
    const groups = new Map();
    for (const dream of selected) for (const label of new Set(dream[key].map(item => item.trim().toLocaleLowerCase('ru-RU')).filter(Boolean))) {
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ id: dream.id, title: dream.title, date: dream.date });
    }
    return [...groups].map(([label, sources]) => ({ label, count: sources.length, sources }))
      .sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
  };
  return { startDate, endDate, total: selected.length, activeDays: new Set(selected.map(item => item.date)).size,
    days: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start); date.setUTCDate(date.getUTCDate() + index); const key = date.toISOString().slice(0,10);
      return { date: key, dreams: selected.filter(item => item.date === key).map(({id,title}) => ({id,title})) };
    }), emotions: tags('emotions'), symbols: tags('symbols').filter(item => item.count >= 2), themes: tags('themes').filter(item => item.count >= 2) };
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
