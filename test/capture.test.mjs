import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActions } from '../src/core/actions.js';
import { captureFromComment } from '../src/core/capture.js';
import { SOURCE, STATUS } from '../src/core/decisions.js';
import { commentText, detectDecision } from '../src/core/detect.js';
import { createGraphSync } from '../src/core/graph.js';
import { createService } from '../src/core/service.js';
import { createStore } from '../src/core/store.js';
import { fakeKvs, tickingClock } from './helpers.mjs';

// --- detection ---

test('the explicit form is read line by line', () => {
  assert.deepEqual(
    detectDecision('Thanks all.\nDecision: we keep prices uncached in checkout.\nWhy: a stale price is a legal problem.'),
    {
      title: 'we keep prices uncached in checkout',
      decision: 'we keep prices uncached in checkout.',
      rationale: 'A stale price is a legal problem.',
    },
  );
});

test('an explicit decision with an inline reason is split at "because"', () => {
  const found = detectDecision('Decision - use PostgreSQL for billing because we need transactions.');
  assert.equal(found.decision, 'use PostgreSQL for billing');
  assert.equal(found.rationale, 'We need transactions.');
});

test('a decision stated in passing is found, with the reason from the next sentence', () => {
  const found = detectDecision(
    'Talked to legal this morning. We decided not to store call recordings. Because consent laws differ per state. Will update the ticket.',
  );
  assert.equal(found.decision, 'We decided not to store call recordings.');
  assert.equal(found.rationale, 'Consent laws differ per state.');
  // The title drops the lead-in; the decision keeps the sentence as written.
  assert.equal(found.title, 'Not to store call recordings');
});

test('common phrasings are recognised', () => {
  for (const text of [
    'After the review the team agreed to ship weekly.',
    'It was decided that mobile ships first.',
    "We're going with Stripe for payments.",
    'A local cache was ruled out.',
    'We will not support IE11.',
    'Мы решили не хранить записи звонков.',
    'Решение: используем одну базу на все склады.',
  ]) {
    assert.ok(detectDecision(text), `should detect: ${text}`);
  }
});

test('talk about deciding is not a decision', () => {
  for (const text of [
    'Should we decide this before the release?',
    "We haven't decided on the database yet.",
    'We need to decide who owns this.',
    'Still undecided, will come back to it.',
    'To be decided next sprint.',
    'Мы ещё не решили, какую базу брать.',
    'Looks good to me, merging.',
    '',
  ]) {
    assert.equal(detectDecision(text), null, `should not detect: ${text}`);
  }
});

test('a long decision gets a shortened title and keeps its full text', () => {
  const long = `We decided ${'to keep every component small and independent '.repeat(4)}.`;
  const found = detectDecision(long);
  assert.ok(found.title.length <= 91);
  assert.ok(found.title.endsWith('…'));
  assert.ok(found.decision.length > 150);
});

test('comment bodies are read from plain text and from ADF', () => {
  assert.equal(commentText('plain'), 'plain');
  assert.equal(commentText(null), '');
  const adf = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Decision: ' }, { type: 'text', text: 'ship weekly.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Why: support needs dates.' }] },
    ],
  };
  assert.equal(commentText(adf), 'Decision: ship weekly.\nWhy: support needs dates.');
  assert.equal(detectDecision(commentText(adf)).rationale, 'Support needs dates.');
});

// --- from comment to proposal to decision ---

function setup() {
  const fake = fakeKvs();
  const store = createStore(fake);
  const published = [];
  const graphSync = createGraphSync({
    client: {
      async setObjects(request) {
        published.push(...request.objects.map((o) => o.id));
        return { success: true };
      },
    },
    settings: { getConnectionId: async () => 'conn', setConnectionId: async () => {}, clearConnectionId: async () => {} },
    resolveSiteUrl: async () => 'https://example.atlassian.net',
    logger: { error() {}, log() {} },
  });
  const service = createService({
    store,
    clock: tickingClock(),
    afterWrite: (decisions) => graphSync.publish(decisions),
  });
  return { service, store, published, graphSync, actions: createActions(service) };
}

const event = (overrides = {}) => ({
  eventType: 'avi:jira:commented:issue',
  issue: { id: '10055', key: 'MOBL-55' },
  comment: { id: '777', body: 'We decided not to store call recordings because of consent laws.' },
  atlassianId: 'acc-author',
  ...overrides,
});

const neverFetch = async () => {
  throw new Error('should not fetch');
};

test('a comment stating a decision becomes a proposal on its work item', async () => {
  const { service } = setup();
  const proposal = await captureFromComment(event(), { service, fetchCommentBody: neverFetch });

  assert.equal(proposal.status, STATUS.PROPOSED);
  assert.equal(proposal.source, SOURCE.COMMENT);
  assert.equal(proposal.sourceRef, 'comment:777');
  assert.equal(proposal.issueKey, 'MOBL-55');
  assert.equal(proposal.decidedBy, 'acc-author');
  assert.equal(proposal.decision, 'We decided not to store call recordings');
  assert.equal(proposal.rationale, 'Because of consent laws.');
  assert.equal(proposal.title, 'Not to store call recordings');
});

test('an ordinary comment, or one from the app itself, proposes nothing', async () => {
  const { service, store } = setup();
  const deps = { service, fetchCommentBody: neverFetch };
  assert.equal(await captureFromComment(event({ comment: { id: '1', body: 'LGTM' } }), deps), null);
  assert.equal(await captureFromComment(event({ selfGenerated: true }), deps), null);
  assert.equal(await captureFromComment({ issue: {}, comment: {} }, deps), null);
  assert.equal((await store.list()).length, 0);
});

test('editing a comment does not propose it a second time', async () => {
  const { service, store } = setup();
  const deps = { service, fetchCommentBody: neverFetch };
  assert.ok(await captureFromComment(event(), deps));
  assert.equal(await captureFromComment(event(), deps), null);
  assert.equal((await store.list()).length, 1);
});

test('the comment text is fetched when the event does not carry it', async () => {
  const { service } = setup();
  const asked = [];
  const proposal = await captureFromComment(event({ comment: { id: '9' } }), {
    service,
    fetchCommentBody: async (ref) => {
      asked.push(ref);
      return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Decision: ship weekly.' }] }] };
    },
  });
  assert.deepEqual(asked, [{ issueKey: 'MOBL-55', commentId: '9' }]);
  assert.equal(proposal.decision, 'ship weekly.');
});

test('a proposal guides nobody until a person confirms it', async () => {
  const { service, actions, published } = setup();
  const proposal = await captureFromComment(event(), { service, fetchCommentBody: neverFetch });

  assert.deepEqual(await service.find('call recordings'), []);
  assert.deepEqual((await service.find('call recordings', { includeHistory: true })), []);
  const plan = await service.checkPlan('store call recordings');
  assert.deepEqual([plan.relevant, plan.outdated, plan.unmatched], [[], [], []]);
  assert.deepEqual((await actions.getDecisionsForIssue({ issueKey: 'MOBL-55' })).decisions, []);
  assert.deepEqual(published, []);
  // The person looking at the work item does see it.
  assert.deepEqual((await service.forIssue('MOBL-55')).map((d) => d.id), [proposal.id]);
});

test('confirming makes it a decision in the confirming person’s name and publishes it', async () => {
  const { service, published } = setup();
  const proposal = await captureFromComment(event(), { service, fetchCommentBody: neverFetch });

  const confirmed = await service.confirm(
    proposal.id,
    { title: 'No stored call recordings' },
    { confirmedBy: 'acc-lead' },
  );
  assert.equal(confirmed.status, STATUS.ACTIVE);
  assert.equal(confirmed.title, 'No stored call recordings');
  assert.equal(confirmed.decision, proposal.decision);
  assert.equal(confirmed.decidedBy, 'acc-lead');
  assert.equal(confirmed.source, SOURCE.COMMENT);
  assert.ok(confirmed.decidedAt > proposal.decidedAt);

  assert.deepEqual((await service.find('call recordings')).map((r) => r.decision.id), [proposal.id]);
  assert.deepEqual(published, [proposal.id]);
  await assert.rejects(service.confirm(proposal.id), /not waiting for confirmation/);
});

test('dismissing removes the proposal; a recorded decision cannot be dismissed', async () => {
  const { service, store } = setup();
  const proposal = await captureFromComment(event(), { service, fetchCommentBody: neverFetch });
  await service.dismiss(proposal.id);
  assert.equal(await store.get(proposal.id), null);

  const recorded = await service.record({ title: 'Ship weekly', decision: 'We ship on Tuesdays.' });
  await assert.rejects(service.dismiss(recorded.id), /reverse or supersede it instead/);
  assert.ok(await store.get(recorded.id));
});

test('a proposal cannot be reversed or superseded as if it were a decision', async () => {
  const { service } = setup();
  const proposal = await captureFromComment(event(), { service, fetchCommentBody: neverFetch });
  await assert.rejects(service.reverse(proposal.id, 'x'), /already proposed/);
  await assert.rejects(service.supersede(proposal.id, { title: 't', decision: 'd' }), /already proposed/);
});

test('decisions say who recorded them: a person, an agent, or a comment', async () => {
  const { service, actions } = setup();
  const byPerson = await service.record({ title: 'A', decision: 'Alpha rule.' });
  assert.equal(byPerson.source, SOURCE.PERSON);

  const byAgent = await actions.recordDecision({ title: 'B', decision: 'Beta rule.', issueKey: 'MOBL-1' });
  assert.equal(byAgent.recorded.recordedBy, SOURCE.AGENT);

  const replaced = await actions.supersedeDecision({ decisionId: byPerson.id, title: 'A2', decision: 'Alpha rule, revised.' });
  assert.equal(replaced.replacement.recordedBy, SOURCE.AGENT);
  assert.equal(replaced.superseded.recordedBy, SOURCE.PERSON);
});
