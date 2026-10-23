// Resolve vocabulary against source text, never against an AI-generated example.
(() => {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  function locate(term, segments, preferred = {}) {
    term = clean(term);
    if (!term) return null;
    const rows = (segments || []).map(row => ({ ...row, text: clean(row.text) }));
    const source = rows.map(row => row.text).join(' ');
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_'’-])${escaped}(?![\\p{L}\\p{N}_'’-])`, 'giu');
    let offset = 0;
    const ranges = rows.map(row => {
      const range = { ...row, offset, end: offset + row.text.length };
      offset = range.end + 1;
      return range;
    });
    let matches = [...source.matchAll(pattern)].map(match => ({
      match, row: ranges.find(row => match.index < row.end),
    }));
    if (Number.isFinite(preferred.from)) {
      matches = matches.filter(({ match }) => match.index >= preferred.from && match.index < preferred.to);
    }
    if (!matches.length) return null;
    const hint = clean(preferred.context);
    // A copied sentence only disambiguates occurrences if it is real source text.
    const hinted = hint ? matches.filter(({ match }) => {
      let from = source.indexOf(hint);
      while (from >= 0) {
        if (match.index >= from && match.index + match[0].length <= from + hint.length) return true;
        from = source.indexOf(hint, from + 1);
      }
      return false;
    }) : [];
    if (hinted.length) matches = hinted;
    if (Number.isFinite(Number(preferred.timestampSeconds))) {
      matches.sort((a, b) => Math.abs((Number(a.row?.start) || 0) - Number(preferred.timestampSeconds))
        - Math.abs((Number(b.row?.start) || 0) - Number(preferred.timestampSeconds)));
    }
    const { match, row } = matches[0];
    const before = [...source.slice(0, match.index).matchAll(/[.!?。！？]["'”’）)\]]*\s+/g)].at(-1);
    const start = before ? before.index + before[0].length : 0;
    const after = /[.!?。！？]["'”’）)\]]*(?=\s|$)/.exec(source.slice(match.index + match[0].length));
    const end = after ? match.index + match[0].length + after.index + after[0].length : source.length;
    let context = source.slice(start, end).trim();
    // ASR often omits punctuation for a long run of captions. In that case
    // use the matching source row(s), rather than an entire paragraph reused
    // for many unrelated terms. Keep cross-caption phrases intact.
    if (context.length > 360 && row) {
      const lastRow = ranges.find(range => match.index + match[0].length <= range.end);
      context = source.slice(Math.max(start, row.offset), Math.min(end, lastRow?.end || row.end)).trim();
    }
    return { context, timestampSeconds: Math.max(0, Number(row?.start) || 0) };
  }
  globalThis.YTD_VOCABULARY_CONTEXT = { locate };
})();
