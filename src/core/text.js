// Text normalisation shared by indexing and querying.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'if', 'in', 'into', 'is', 'it', 'its',
  'of', 'on', 'or', 'our', 'should', 'so', 'than', 'that', 'the', 'their', 'then',
  'there', 'these', 'they', 'this', 'to', 'use', 'using', 'was', 'we', 'were', 'what',
  'when', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  // What every task title says, whatever it is about.
  'add', 'implement', 'create', 'fix', 'update', 'change', 'make', 'need',
]);

// Deliberately light: enough to match "caching" with "cache" and "services" with
// "service" without pulling in a stemming library.
function stem(token) {
  let stemmed = token;
  // Plural first, so "services" and "service" end up at the same stem.
  if (stemmed.length > 4 && stemmed.endsWith('ies')) stemmed = `${stemmed.slice(0, -3)}y`;
  else if (stemmed.length > 3 && stemmed.endsWith('s') && !stemmed.endsWith('ss')) {
    stemmed = stemmed.slice(0, -1);
  }
  if (stemmed.length > 5 && stemmed.endsWith('ing')) stemmed = stemmed.slice(0, -3);
  else if (stemmed.length > 4 && stemmed.endsWith('ed')) stemmed = stemmed.slice(0, -2);
  else if (stemmed.length > 4 && stemmed.endsWith('e')) stemmed = stemmed.slice(0, -1);
  return stemmed;
}

/**
 * "we ship weekly" -> "We ship weekly". A first word that already mixes cases, such
 * as "iOS" or "macOS", is a name and is left alone.
 */
export function capitalizeFirst(text) {
  const value = String(text ?? '');
  const firstWord = value.match(/^\S+/u)?.[0] ?? '';
  if (!/^\p{Ll}/u.test(firstWord) || /\p{Lu}/u.test(firstWord.slice(1))) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** True when two texts say the same words, ignoring case, spacing and end punctuation. */
export function sameWording(a, b) {
  const plain = (text) =>
    String(text ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[\s.!?…]+$/u, '')
      .trim();
  return plain(a) !== '' && plain(a) === plain(b);
}

export function tokenize(text) {
  const words = String(text ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words) return [];
  return words
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}
