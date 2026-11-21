import { SOURCE, STATUS, ValidationError } from './decisions.js';

// What an agent sees for one decision. Kept flat and small: this goes into a prompt.
export function present(decision) {
  return {
    id: decision.id,
    title: decision.title,
    decision: decision.decision,
    rationale: decision.rationale || '(no rationale recorded)',
    status: decision.status,
    // Decisions recorded before sources were tracked came from the panel.
    recordedBy: decision.source ?? SOURCE.PERSON,
    tags: decision.tags,
    issueKey: decision.issueKey,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    supersedes: decision.supersedes,
    supersededBy: decision.supersededBy,
    closedReason: decision.closedReason || undefined,
  };
}

const BRIEF_LENGTH = 200;

// Enough to judge whether a decision is about the same thing, and no more: a caller
// may receive dozens of these.
function brief(decision) {
  const text = decision.decision;
  return {
    id: decision.id,
    title: decision.title,
    decision: text.length > BRIEF_LENGTH ? `${text.slice(0, BRIEF_LENGTH - 1)}…` : text,
    tags: decision.tags,
    issueKey: decision.issueKey,
  };
}

function presentRanked(ranked) {
  return ranked.map(({ decision, score, matchedTerms }) => ({
    ...present(decision),
    relevance: Number(score.toFixed(2)),
    matchedTerms,
  }));
}

// Rovo passes the work item the user is looking at in payload.context.
function viewedIssueKey(payload) {
  const jira = payload?.context?.jira;
  return jira && typeof jira.issueKey === 'string' ? jira.issueKey : null;
}

function accountId(context) {
  return context?.principal?.accountId ?? context?.accountId ?? null;
}

/**
 * Rovo action and MCP tool handlers. Each takes (payload, context) as Forge passes
 * them and returns plain data. Bad input comes back as { error } so the agent can
 * tell the user what to fix; anything else is a bug and is allowed to throw.
 */
export function createActions(service) {
  const guarded = (handler) => async (payload, context) => {
    try {
      return await handler(payload ?? {}, context);
    } catch (error) {
      if (error instanceof ValidationError) return { error: error.message };
      throw error;
    }
  };

  return {
    recordDecision: guarded(async (payload, context) => {
      const decision = await service.record(
        { ...payload, issueKey: payload.issueKey || viewedIssueKey(payload) },
        { decidedBy: accountId(context), source: SOURCE.AGENT },
      );
      return { recorded: present(decision) };
    }),

    findDecisions: guarded(async (payload) => {
      const ranked = await service.find(payload.query, {
        includeHistory: payload.includeHistory === true,
        keywords: payload.keywords ?? '',
      });
      return {
        decisions: presentRanked(ranked),
        note: ranked.length ? undefined : 'No recorded decision matches this topic.',
      };
    }),

    getDecisionsForIssue: guarded(async (payload) => {
      const issueKey = payload.issueKey || viewedIssueKey(payload);
      // Unconfirmed proposals are a person's business, not guidance for an agent.
      const decisions = (await service.forIssue(issueKey)).filter(
        (decision) => decision.status !== STATUS.PROPOSED,
      );
      return { issueKey, decisions: decisions.map(present) };
    }),

    checkPlan: guarded(async (payload) => {
      if (!String(payload.plan ?? '').trim()) throw new ValidationError('plan is required');
      const { relevant, outdated, unmatched, unmatchedOmitted } = await service.checkPlan(
        payload.plan,
        { keywords: payload.keywords ?? '' },
      );
      return {
        relevantActiveDecisions: presentRanked(relevant),
        outdatedDecisionsForContext: presentRanked(outdated),
        // Matching is by words. These shared no topic word with the plan, or a single
        // one next to better matches, but one of them may still be about the same
        // thing in other words.
        otherActiveDecisions: unmatched.map(brief),
        otherActiveDecisionsOmitted: unmatchedOmitted || undefined,
        note: [
          relevant.length
            ? 'relevantActiveDecisions matched the plan by topic words. Compare each with the plan before calling it a conflict.'
            : 'No active decision shares a topic word with this plan.',
          unmatched.length
            ? 'Read otherActiveDecisions too: a decision worded differently from the plan is only found there. If one applies, treat it like a relevant decision.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      };
    }),

    supersedeDecision: guarded(async (payload, context) => {
      const { previous, replacement } = await service.supersede(payload.decisionId, payload, {
        decidedBy: accountId(context),
        source: SOURCE.AGENT,
      });
      return { superseded: present(previous), replacement: present(replacement) };
    }),
  };
}
