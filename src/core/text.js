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

export function tokenize(text) {
  const words = String(text ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words) return [];
  return words
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}
