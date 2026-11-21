import {
  SOURCE,
  STATUS,
  ValidationError,
  confirm,
  newDecision,
  normaliseIssueKey,
  reverse,
  supersede,
} from './decisions.js';
import { rankDecisions } from './search.js';

const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I: ids get read aloud

// History: once guidance, no longer. A proposal was never guidance and is not history.
const CLOSED = new Set([STATUS.SUPERSEDED, STATUS.REVERSED]);

function randomId(random) {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
  }
  return `DEC-${suffix}`;
}

/**
 * Application logic. `store` persists decisions; `clock` and `random` are injected
 * so behaviour is deterministic under test.
 *
 * `afterWrite` receives every decision that was just saved, so it can be mirrored
 * elsewhere (Teamwork Graph). It runs after storage has succeeded and must not throw.
 */
export function createService({
  store,
  clock = () => new Date().toISOString(),
  random = Math.random,
  afterWrite = async () => {},
}) {
  async function freshId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = randomId(random);
      if (!(await store.get(id))) return id;
    }
    throw new Error('could not allocate a decision id');
  }

  async function requireDecision(decisionId) {
    const id = String(decisionId ?? '').trim().toUpperCase();
    if (!id) throw new ValidationError('decisionId is required');
    const decision = await store.get(id);
    if (!decision) throw new ValidationError(`no decision with id ${id}`);
    return decision;
  }

  return {
    async record(input, { decidedBy, source = SOURCE.PERSON } = {}) {
      const decision = newDecision(input, {
        id: await freshId(),
        now: clock(),
        decidedBy,
        source,
      });
      await store.put(decision);
      await afterWrite([decision]);
      return decision;
    },

    /**
     * Something that looks like a decision was found in a comment. It is kept as a
     * proposal for a person to confirm; until then it guides nobody. A comment that
     * was already picked up (an edit fires the event again) is not proposed twice.
     * Returns the proposal, or null when the comment was seen before.
     */
    async propose(input, { sourceRef, proposedBy } = {}) {
      if (sourceRef) {
        const seen = (await store.list()).some((d) => d.sourceRef === sourceRef);
        if (seen) return null;
      }
      const proposal = newDecision(input, {
        id: await freshId(),
        now: clock(),
        decidedBy: proposedBy ?? null,
        source: SOURCE.COMMENT,
        sourceRef: sourceRef ?? null,
        status: STATUS.PROPOSED,
      });
      await store.put(proposal);
      return proposal;
    },

    async confirm(decisionId, edits, { confirmedBy } = {}) {
      const confirmed = confirm(await requireDecision(decisionId), edits, {
        now: clock(),
        confirmedBy,
      });
      await store.put(confirmed);
      await afterWrite([confirmed]);
      return confirmed;
    },

    /** A person says the comment was not a decision. The proposal is removed. */
    async dismiss(decisionId) {
      const proposal = await requireDecision(decisionId);
      if (proposal.status !== STATUS.PROPOSED) {
        throw new ValidationError(
          `decision ${proposal.id} is on record; reverse or supersede it instead of dismissing it`,
        );
      }
      await store.remove(proposal.id);
      return proposal;
    },

    listAll() {
      return store.list();
    },

    // `keywords` are extra words for the same topic. Matching is by words, and the
    // caller is usually a language model that can supply the synonyms a team might
    // have used ("recording" for "voice capture").
    async find(query, { includeHistory = false, limit = 5, keywords = '' } = {}) {
      const all = await store.list();
      const pool = all.filter(
        (d) => d.status === STATUS.ACTIVE || (includeHistory && CLOSED.has(d.status)),
      );
      return rankDecisions(pool, `${query} ${keywords}`, { limit });
    },

    async forIssue(issueKey) {
      const key = normaliseIssueKey(issueKey);
      if (!key) throw new ValidationError('issueKey is required');
      const all = await store.list();
      return all
        .filter((d) => d.issueKey === key)
        .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
    },

    /**
     * Decisions relevant to a piece of intended work. Active ones are guidance;
     * closed ones are returned separately so nobody follows a rule that was replaced.
     *
     * `unmatched` lists the other active decisions, newest first. Word matching misses
     * a decision phrased differently from the plan; a caller that understands meaning
     * can scan those titles and catch what the ranking could not.
     */
    async checkPlan(
      plan,
      { limit = 5, excludeIssueKey = null, keywords = '', unmatchedLimit = 40, strict = false } = {},
    ) {
      const all = (await store.list()).filter(
        (d) => !excludeIssueKey || d.issueKey !== excludeIssueKey,
      );
      const active = all.filter((d) => d.status === STATUS.ACTIVE);
      const text = `${plan} ${keywords}`;
      const ranked = rankDecisions(active, text, { limit: limit * 4, topicOnly: true, strict });
      // One shared word is offered only when there is nothing better: next to a real
      // match it reads as a second finding. The rest stay in `unmatched` to be scanned.
      const plausible = ranked.filter((hit) => hit.plausible);
      const relevant = (plausible.length ? plausible : ranked).slice(0, limit);
      const matched = new Set(relevant.map((hit) => hit.decision.id));
      const unmatched = active
        .filter((d) => !matched.has(d.id))
        .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
      return {
        relevant,
        outdated: rankDecisions(all.filter((d) => CLOSED.has(d.status)), text, {
          limit: 3,
          topicOnly: true,
        }),
        unmatched: unmatched.slice(0, unmatchedLimit),
        unmatchedOmitted: Math.max(0, unmatched.length - unmatchedLimit),
      };
    },

    async supersede(decisionId, input, { decidedBy, source = SOURCE.PERSON } = {}) {
      const previous = await requireDecision(decisionId);
      const draft = newDecision(
        { ...input, issueKey: input.issueKey ?? previous.issueKey },
        { id: await freshId(), now: clock(), decidedBy, source },
      );
      const result = supersede(previous, draft, clock());
      // Write the replacement first: if the second write fails, the old decision is
      // still active and nothing points at a record that does not exist.
      await store.put(result.replacement);
      await store.put(result.previous);
      await afterWrite([result.replacement, result.previous]);
      return result;
    },

    async reverse(decisionId, reason) {
      const updated = reverse(await requireDecision(decisionId), reason, clock());
      await store.put(updated);
      await afterWrite([updated]);
      return updated;
    },
  };
}
