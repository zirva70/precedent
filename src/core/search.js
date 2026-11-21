import { tokenize } from './text.js';

// A match in the title or tags says more about relevance than one in the rationale.
const FIELD_WEIGHTS = { title: 3, tags: 3, decision: 2, rationale: 1 };

const K1 = 1.2;
const B = 0.75;

// The rationale says why, not what the decision is about. A decision that mentions
// "legal" only in its reasoning is not a decision about legal work.
const TOPIC_FIELDS = new Set(['title', 'tags', 'decision']);

function termFrequencies(decision) {
  const frequencies = new Map();
  const topicTerms = new Set();
  const tagTerms = new Set();
  let length = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const value = field === 'tags' ? (decision.tags ?? []).join(' ') : decision[field];
    for (const term of tokenize(value)) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + weight);
      if (TOPIC_FIELDS.has(field)) topicTerms.add(term);
      if (field === 'tags') tagTerms.add(term);
      length += weight;
    }
  }
  return { frequencies, topicTerms, tagTerms, length };
}

// One shared word is weak evidence: "Implement live call monitoring" shares "live"
// with "Secrets live in the vault". A tag is a deliberate topic label, so one tag
// match is enough; otherwise two different topic words must agree.
function plausibleMatch(document, matchedTerms) {
  if (matchedTerms.some((term) => document.tagTerms.has(term))) return true;
  return matchedTerms.filter((term) => document.topicTerms.has(term)).length >= 2;
}

// Worth interrupting someone for. A tag carried by many decisions ("mobile",
// "backend") names an area, not a topic: on its own it would warn on half the board.
const BROAD_TAG = 2;

function strongMatch(document, matchedTerms, tagFrequency, namesTaggedArea) {
  const tagged = matchedTerms.some((term) => document.tagTerms.has(term));
  // Two shared words warn, unless the work item names an area the team tags and this
  // decision is outside it: "Billing system is sending duplicate bills to customers"
  // shares "send" and "customer" with a decision about AI replies, not about billing.
  const topical = matchedTerms.filter((term) => document.topicTerms.has(term));
  if (topical.length >= 2 && (tagged || !namesTaggedArea)) return true;
  return matchedTerms.some(
    (term) => document.tagTerms.has(term) && tagFrequency.get(term) <= BROAD_TAG,
  );
}

/**
 * Rank decisions against free text with BM25 over weighted fields.
 * Returns [{ decision, score, matchedTerms, plausible }] sorted by descending score;
 * decisions that share no term with the query are left out. `plausible` is false
 * when the only evidence is a single shared word outside the tags.
 *
 * With `topicOnly`, a decision must match in its title, tags or decision text.
 * With `strict`, it must also match a tag or two different topic words, and each
 * result says whether it is `strong`: two topic words, or a tag few decisions carry.
 * Use it when nobody asked a question and a weak match would be a false alarm.
 */
export function rankDecisions(
  decisions,
  query,
  { limit = 5, topicOnly = false, strict = false } = {},
) {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || decisions.length === 0) return [];

  const documents = decisions.map((decision) => ({ decision, ...termFrequencies(decision) }));
  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1;

  const documentFrequency = new Map();
  for (const term of queryTerms) {
    documentFrequency.set(
      term,
      documents.filter((document) => document.frequencies.has(term)).length,
    );
  }

  const tagFrequency = new Map();
  if (strict) {
    for (const term of queryTerms) {
      tagFrequency.set(term, documents.filter((document) => document.tagTerms.has(term)).length);
    }
  }

  const namesTaggedArea = queryTerms.some((term) => tagFrequency.get(term) > 0);

  const ranked = [];
  for (const document of documents) {
    let score = 0;
    const matchedTerms = [];
    for (const term of queryTerms) {
      const frequency = document.frequencies.get(term);
      if (!frequency) continue;
      matchedTerms.push(term);
      const df = documentFrequency.get(term);
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const normalisation = 1 - B + B * (document.length / averageLength);
      score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * normalisation));
    }
    if (score === 0) continue;
    if (topicOnly && !matchedTerms.some((term) => document.topicTerms.has(term))) continue;
    if (strict && !plausibleMatch(document, matchedTerms)) continue;
    const hit = {
      decision: document.decision,
      score,
      matchedTerms,
      plausible: plausibleMatch(document, matchedTerms),
    };
    if (strict) hit.strong = strongMatch(document, matchedTerms, tagFrequency, namesTaggedArea);
    ranked.push(hit);
  }

  ranked.sort(
    (a, b) =>
      Number(b.strong ?? false) - Number(a.strong ?? false) ||
      b.score - a.score || b.decision.decidedAt.localeCompare(a.decision.decidedAt),
  );
  return ranked.slice(0, limit);
}
