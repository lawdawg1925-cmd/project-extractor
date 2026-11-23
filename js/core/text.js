// Text helpers shared by all modules (browser + Node, no DOM).

/** Lowercase and strip everything except letters/digits (used for fuzzy label matching). */
export function normToken(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

/** Levenshtein edit distance (small strings only). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Allowed edit distance for a label of a given normalized length. Short labels must match exactly. */
export function allowedDistance(len) {
  if (len <= 4) return 0;
  if (len <= 9) return 1;
  return 2;
}

/** Collapse whitespace, unify dashes/quotes, trim stray punctuation at the ends. */
export function cleanValue(s) {
  return String(s || '')
    .replace(/[\u2010-\u2015\u2212~]/g, '-')
    .replace(/[\u2018\u2019\u201B`´]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.|_\-'"]+/, '')
    .replace(/[\s:;,|_'"]+$/, '')
    .trim();
}

/** Share of characters that are letters/digits (used to detect garbage OCR). */
export function alnumRatio(s) {
  const t = String(s || '').replace(/\s/g, '');
  if (!t) return 0;
  return (t.match(/[A-Za-z0-9\u00D1\u00F1]/g) || []).length / t.length;
}
