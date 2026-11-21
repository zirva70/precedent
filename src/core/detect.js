// Spots a decision in ordinary writing, such as a Jira comment, without a language
// model. It only proposes: a person confirms before anything becomes guidance, so
// the rules favour not missing a decision over never being wrong.

import { capitalizeFirst } from './text.js';

const TITLE_LENGTH = 90;

// "Decision: ..." / "Решение: ..." at the start of a line.
const EXPLICIT = /^\s*(?:decision|decided|we decided|agreed|решение|решили|договорились)\s*[:\-–—]\s*(.+)$/iu;
const EXPLICIT_REASON = /^\s*(?:why|because|reason|rationale|почему|причина|потому что)\s*[:\-–—]?\s*(.+)$/iu;

// A sentence that states a decision in passing.
const STATED = [
  /\b(?:we|the team|team)(?:'ve| have| has)? (?:decided|agreed|chosen|settled on)\b/i,
  /\bit (?:was|is|has been) (?:decided|agreed)\b/i,
  /\b(?:decision is|final decision|we are going with|we're going with|we will go with|we'll go with)\b/i,
  /\b(?:we will not|we won't|we are not going to|is ruled out|was ruled out|ruled (?:it|this|that) out)\b/i,
  /(?:^|[\s,.;])(?:мы решили|решили,? что|было решено|решено|договорились|принято решение|отказались от)(?=[\s,.:;]|$)/iu,
];

// The word "decide" without a decision behind it.
const NOT_A_DECISION = [
  /\b(?:not|never|haven't|hasn't|have not|has not|yet to|still need to|need to|needs to|should|must|let's|lets|to be|can't|cannot) (?:been )?(?:decide|decided|agree|agreed)\b/i,
  /\b(?:undecided|tbd|to be decided)\b/i,
  /(?:^|\s)(?:не решили|ещё не решено|еще не решено|надо решить|нужно решить|не договорились)(?=[\s,.:;]|$)/iu,
];

const REASON_CLAUSE = /\b(?:because|since|so that|due to|as a result of)\b|(?:^|\s)(?:потому что|так как|поскольку|из-за)(?=\s)/iu;
const REASON_SENTENCE = /^(?:because|reason|the reason|why|this is because|потому что|причина)\b/iu;

function sentences(text) {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// "We decided to keep X" reads better as the title "Keep X"; the full sentence stays
// in the decision text. "not to" is kept, since it carries the meaning.
const LEAD_IN = [
  /^(?:we|the team|team)(?:'ve| have| has)? (?:decided|agreed|chosen)(?: that| to(?! not))? ?/i,
  /^it (?:was|is|has been) (?:decided|agreed)(?: that| to(?! not))? ?/i,
  /^(?:мы решили|решили|было решено|решено|договорились),?(?: что)? ?/iu,
];

function titleFrom(decision) {
  let clean = decision.replace(/\s+/g, ' ').replace(/[.!…]+$/u, '').trim();
  for (const pattern of LEAD_IN) {
    const stripped = clean.replace(pattern, '');
    if (stripped !== clean && stripped.length >= 8) {
      clean = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      break;
    }
  }
  if (clean.length <= TITLE_LENGTH) return clean;
  const cut = clean.slice(0, TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// "X because Y" -> decision X, rationale Y.
function splitReason(sentence) {
  const match = sentence.match(REASON_CLAUSE);
  if (!match || match.index === 0) return { decision: sentence, rationale: '' };
  return {
    decision: sentence.slice(0, match.index).replace(/[,\s]+$/u, '').trim(),
    rationale: sentence.slice(match.index).trim(),
  };
}

function result(decision, rationale) {
  // "Decision: we ship weekly" is a sentence, so it starts with a capital like one.
  const text = capitalizeFirst(decision.replace(/\s+/g, ' ').trim());
  if (text.length < 8) return null;
  // The panel prints "Why: <rationale>", so a leading "because" would read twice.
  const reason = rationale
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:because(?! of\b)|since|потому что|так как|поскольку)\s+/iu, '');
  return {
    title: capitalizeFirst(titleFrom(text)),
    decision: text,
    rationale: reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : '',
  };
}

/**
 * Returns { title, decision, rationale } for the first decision stated in `text`,
 * or null when there is none.
 */
export function detectDecision(text) {
  const source = String(text ?? '').trim();
  if (!source) return null;

  // 1. The explicit form, line by line: unambiguous, so it wins.
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const explicit = lines[index].match(EXPLICIT);
    if (!explicit) continue;
    const reasonLine = lines.slice(index + 1).map((line) => line.match(EXPLICIT_REASON)).find(Boolean);
    if (reasonLine) return result(explicit[1], reasonLine[1]);
    const split = splitReason(explicit[1]);
    return result(split.decision, split.rationale);
  }

  // 2. A sentence that says a decision was made.
  const all = sentences(source);
  for (let index = 0; index < all.length; index += 1) {
    const sentence = all[index];
    if (sentence.endsWith('?')) continue;
    if (NOT_A_DECISION.some((pattern) => pattern.test(sentence))) continue;
    if (!STATED.some((pattern) => pattern.test(sentence))) continue;

    const split = splitReason(sentence);
    const next = all[index + 1] ?? '';
    const rationale = split.rationale || (REASON_SENTENCE.test(next) ? next : '');
    return result(split.decision, rationale);
  }

  return null;
}

/** Plain text of a Jira comment body, which arrives as a string or as an ADF tree. */
export function commentText(body) {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';

  const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'rule']);
  const parts = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
    if (node.type === 'hardBreak') parts.push('\n');
    if (node.type === 'mention' && node.attrs?.text) parts.push(node.attrs.text);
    for (const child of node.content ?? []) walk(child);
    if (BLOCKS.has(node.type)) parts.push('\n');
  })(body);
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}
