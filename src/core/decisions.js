// The decision record and the rules for changing it. No I/O here.

export const STATUS = Object.freeze({
  // Found in a comment and waiting for a person. Not guidance, and never published.
  PROPOSED: 'proposed',
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  REVERSED: 'reversed',
});

// Who put the decision on record: a person in the Jira panel, an AI agent through
// an action or MCP tool, or a comment the app noticed and a person confirmed.
export const SOURCE = Object.freeze({ PERSON: 'person', AGENT: 'agent', COMMENT: 'comment' });

const LIMITS = { title: 200, decision: 4000, rationale: 4000, tags: 10, tag: 40 };
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${field} is required`);
  if (text.length > LIMITS[field]) {
    throw new ValidationError(`${field} must be at most ${LIMITS[field]} characters`);
  }
  return text;
}

function optionalText(value, field) {
  const text = String(value ?? '').trim();
  if (text.length > LIMITS[field]) {
    throw new ValidationError(`${field} must be at most ${LIMITS[field]} characters`);
  }
  return text;
}

export function normaliseTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const unique = [
    ...new Set(list.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)),
  ];
  if (unique.length > LIMITS.tags) {
    throw new ValidationError(`at most ${LIMITS.tags} tags are allowed`);
  }
  for (const tag of unique) {
    if (tag.length > LIMITS.tag) {
      throw new ValidationError(`tag "${tag.slice(0, 20)}..." is longer than ${LIMITS.tag} characters`);
    }
  }
  return unique;
}

export function normaliseIssueKey(issueKey) {
  const key = String(issueKey ?? '').trim().toUpperCase();
  if (!key) return null;
  if (!ISSUE_KEY.test(key)) {
    throw new ValidationError(`"${key}" is not a Jira work item key (expected something like PAY-142)`);
  }
  return key;
}

export function newDecision(
  input,
  { id, now, decidedBy = null, source = SOURCE.PERSON, sourceRef = null, status = STATUS.ACTIVE },
) {
  return {
    id,
    title: requiredText(input.title, 'title'),
    decision: requiredText(input.decision, 'decision'),
    rationale: optionalText(input.rationale, 'rationale'),
    tags: normaliseTags(input.tags),
    issueKey: normaliseIssueKey(input.issueKey),
    status,
    source,
    // For a decision found in a comment: the comment it came from.
    sourceRef,
    decidedBy,
    decidedAt: now,
    supersedes: null,
    supersededBy: null,
    closedAt: null,
    closedReason: '',
  };
}

/**
 * A person accepts a proposed decision, optionally correcting the wording. The
 * decision dates from the moment it is confirmed, and that person stands behind it.
 */
export function confirm(proposal, edits, { now, confirmedBy }) {
  if (proposal.status !== STATUS.PROPOSED) {
    throw new ValidationError(`decision ${proposal.id} is not waiting for confirmation`);
  }
  return {
    ...proposal,
    title: requiredText(edits?.title ?? proposal.title, 'title'),
    decision: requiredText(edits?.decision ?? proposal.decision, 'decision'),
    rationale: optionalText(edits?.rationale ?? proposal.rationale, 'rationale'),
    tags: edits?.tags === undefined ? proposal.tags : normaliseTags(edits.tags),
    status: STATUS.ACTIVE,
    decidedBy: confirmedBy ?? proposal.decidedBy,
    decidedAt: now,
  };
}

function assertActive(decision) {
  if (decision.status !== STATUS.ACTIVE) {
    throw new ValidationError(
      `decision ${decision.id} is already ${decision.status} and cannot be changed again`,
    );
  }
}

/** Returns the updated pair; neither argument is mutated. */
export function supersede(previous, replacement, now) {
  assertActive(previous);
  return {
    previous: {
      ...previous,
      status: STATUS.SUPERSEDED,
      supersededBy: replacement.id,
      closedAt: now,
    },
    replacement: {
      ...replacement,
      supersedes: previous.id,
      issueKey: replacement.issueKey ?? previous.issueKey,
      tags: replacement.tags.length ? replacement.tags : previous.tags,
    },
  };
}

export function reverse(decision, reason, now) {
  assertActive(decision);
  return {
    ...decision,
    status: STATUS.REVERSED,
    closedAt: now,
    closedReason: optionalText(reason, 'rationale'),
  };
}
