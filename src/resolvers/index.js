import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import Resolver from '@forge/resolver';
import { graphSync, service } from '../app.js';
import { present } from '../core/actions.js';
import { SOURCE, STATUS, ValidationError } from '../core/decisions.js';

const resolver = new Resolver();

function issueKeyOf(req) {
  const key = req.context?.extension?.issue?.key;
  if (!key) throw new Error('This panel must be opened on a Jira work item.');
  return key;
}

// The work item's own summary is the "plan" we check against past decisions.
async function fetchSummary(issueKey) {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`);
  if (!response.ok) return '';
  const issue = await response.json();
  return issue.fields?.summary ?? '';
}

// The UI shows validation problems inline; everything else surfaces as a failure.
const guarded = (handler) => async (req) => {
  try {
    return await handler(req);
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    throw error;
  }
};

// Which warnings this person already waved away on this work item.
const seenKey = (accountId, issueKey) => `seen:${accountId}:${issueKey}`;

async function panelData(issueKey) {
  const [onIssue, summary] = await Promise.all([
    service.forIssue(issueKey),
    fetchSummary(issueKey),
  ]);
  const { relevant } = await service.checkPlan(summary, {
    excludeIssueKey: issueKey,
    // Nobody asked, so weak word matches are left out, and only strong ones warn.
    strict: true,
  });
  const shown = ({ decision, matchedTerms }) => ({ ...present(decision), matchedTerms });
  return {
    issueKey,
    proposed: onIssue.filter((d) => d.status === STATUS.PROPOSED).map(present),
    linked: onIssue.filter((d) => d.status !== STATUS.PROPOSED).map(present),
    related: relevant.filter((hit) => hit.strong).map(shown),
    // Same area, weaker evidence: listed in the panel, never raised as a warning.
    possiblyRelated: relevant.filter((hit) => !hit.strong).slice(0, 3).map(shown),
  };
}

resolver.define('getPanelData', guarded((req) => panelData(issueKeyOf(req))));

// For the background script: only what is new to this person, so a warning they
// closed does not come back every time they open the work item.
resolver.define(
  'getWarnings',
  guarded(async (req) => {
    const issueKey = issueKeyOf(req);
    const data = await panelData(issueKey);
    const accountId = req.context?.accountId;
    const seen = new Set(accountId ? ((await kvs.get(seenKey(accountId, issueKey))) ?? []) : []);
    return {
      issueKey,
      related: data.related.filter((decision) => !seen.has(decision.id)),
      proposedCount: data.proposed.length,
    };
  }),
);

resolver.define(
  'dismissWarnings',
  guarded(async (req) => {
    const issueKey = issueKeyOf(req);
    const accountId = req.context?.accountId;
    if (!accountId) return { saved: false };
    const key = seenKey(accountId, issueKey);
    const ids = (req.payload?.decisionIds ?? []).filter((id) => typeof id === 'string');
    const merged = [...new Set([...((await kvs.get(key)) ?? []), ...ids])].slice(-200);
    await kvs.set(key, merged);
    return { saved: true };
  }),
);

resolver.define(
  'recordDecision',
  guarded(async (req) => {
    const decision = await service.record(
      { ...req.payload, issueKey: issueKeyOf(req) },
      { decidedBy: req.context?.accountId ?? null, source: SOURCE.PERSON },
    );
    return { recorded: present(decision) };
  }),
);

resolver.define(
  'confirmProposal',
  guarded(async (req) => {
    const decision = await service.confirm(req.payload?.decisionId, req.payload?.edits, {
      confirmedBy: req.context?.accountId ?? null,
    });
    return { confirmed: present(decision) };
  }),
);

resolver.define(
  'dismissProposal',
  guarded(async (req) => {
    const proposal = await service.dismiss(req.payload?.decisionId);
    return { dismissed: proposal.id };
  }),
);

resolver.define(
  'reverseDecision',
  guarded(async (req) => {
    const decision = await service.reverse(req.payload?.decisionId, req.payload?.reason);
    return { reversed: present(decision) };
  }),
);

// Whether this work item's decisions have reached Teamwork Graph. Re-sends them
// first when asked, which repairs a decision that was saved while the graph was down.
resolver.define(
  'getGraphStatus',
  guarded(async (req) => {
    const linked = (await service.forIssue(issueKeyOf(req))).filter(
      (decision) => decision.status !== STATUS.PROPOSED,
    );
    const republished = req.payload?.republish
      ? await graphSync.republishAll(() => service.listAll())
      : undefined;
    const statuses = await Promise.all(
      linked.map(async (decision) => ({ id: decision.id, ...(await graphSync.status(decision.id)) })),
    );
    return { statuses, republished };
  }),
);

export const handler = resolver.getDefinitions();
