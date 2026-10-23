(() => {
  const normalize = term => String(term || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  function profile(entries) {
    const example = entry => ({ term: entry.term, meaning: entry.meaningEn || '', context: entry.context || '' });
    const known = entries.filter(entry => entry.mastered).sort((a, b) => normalize(a.term).localeCompare(normalize(b.term))).map(example);
    // An unmarked AI suggestion is not evidence of a knowledge gap.
    const needsPractice = entries.filter(entry => !entry.mastered && (entry.studyAgainAt || entry.manualSaved))
      .sort((a, b) => (b.studyAgainAt || b.createdAt || 0) - (a.studyAgainAt || a.createdAt || 0)).slice(0, 80).map(entry => ({ term: entry.term }));
    return { baseline: 'IELTS 7.0', known, needsPractice };
  }
  function recommended(entry) {
    return !entry.mastered && entry.recommended !== false;
  }
  function rank(entries) {
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) =>
      (Number(b.entry.priority) || 2) - (Number(a.entry.priority) || 2) || a.index - b.index).map(item => item.entry);
  }
  globalThis.YTD_VOCABULARY_LEARNING = { profile, recommended, rank, normalize };
})();
