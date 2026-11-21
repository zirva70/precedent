import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActions } from '../src/core/actions.js';
import { STATUS } from '../src/core/decisions.js';
import { createService } from '../src/core/service.js';
import { createStore } from '../src/core/store.js';
import { fakeKvs, sequence, tickingClock } from './helpers.mjs';

function setup({ pageSize, random } = {}) {
  const fake = fakeKvs({ pageSize });
  const store = createStore(fake);
  const service = createService({
    store,
    clock: tickingClock(),
    random: random ?? Math.random,
  });
  return { kvs: fake.kvs, store, service, actions: createActions(service) };
}

const postgres = {
  title: 'Use PostgreSQL for billing',
  decision: 'Billing data lives in PostgreSQL.',
  rationale: 'Transactions across invoices and payments.',
  tags: 'billing, database',
  issueKey: 'PAY-1',
};

test('a recorded decision can be found by topic', async () => {
  const { service } = setup();
  const recorded = await service.record(postgres, { decidedBy: 'acc-1' });
  assert.match(recorded.id, /^DEC-[2-9A-HJ-NP-Z]{6}$/);

  const [hit] = await service.find('which database for billing');
  assert.equal(hit.decision.id, recorded.id);
  assert.equal(hit.decision.decidedBy, 'acc-1');
});

test('an id collision is retried instead of overwriting a decision', async () => {
  // First six draws give one id, repeated for the second record, then a different one.
  const draws = [...Array(12).fill(0), ...Array(6).fill(0.5)];
  const { service, store } = setup({ random: sequence(draws) });
  const first = await service.record(postgres);
  const second = await service.record({ ...postgres, title: 'Another' });
  assert.notEqual(first.id, second.id);
  assert.equal((await store.list()).length, 2);
  assert.equal((await store.get(first.id)).title, postgres.title);
});

test('list reads every page from storage', async () => {
  const { service, store } = setup({ pageSize: 2 });
  for (let i = 0; i < 5; i += 1) await service.record({ ...postgres, title: `Decision ${i}` });
  assert.equal((await store.list()).length, 5);
});

test('superseding keeps history and takes the old decision out of search', async () => {
  const { service, store } = setup();
  const old = await service.record(postgres);
  const { replacement } = await service.supersede(old.id.toLowerCase(), {
    title: 'Move billing to MySQL',
    decision: 'Billing data moves to MySQL.',
    rationale: 'Company-wide database consolidation.',
  });

  const stored = await store.get(old.id);
  assert.equal(stored.status, STATUS.SUPERSEDED);
  assert.equal(stored.supersededBy, replacement.id);
  assert.equal(replacement.supersedes, old.id);
  assert.equal(replacement.issueKey, 'PAY-1');

  const active = await service.find('billing database');
  assert.deepEqual(active.map((r) => r.decision.id), [replacement.id]);

  const withHistory = await service.find('billing database', { includeHistory: true });
  assert.deepEqual(new Set(withHistory.map((r) => r.decision.id)), new Set([old.id, replacement.id]));
});

test('if storage fails midway through superseding, the old decision stays active', async () => {
  const { service, store, kvs } = setup();
  const old = await service.record(postgres);

  kvs.failOnWrite = (key, value) => value.status === STATUS.SUPERSEDED;
  await assert.rejects(
    service.supersede(old.id, { title: 'New', decision: 'New rule.' }),
    /storage unavailable/,
  );
  assert.equal((await store.get(old.id)).status, STATUS.ACTIVE);
  assert.equal((await store.get(old.id)).supersededBy, null);
});

test('checkPlan separates guidance from history', async () => {
  const { service } = setup();
  const old = await service.record({
    title: 'Cache prices in checkout',
    decision: 'Checkout caches prices for five minutes.',
  });
  const { replacement } = await service.supersede(old.id, {
    title: 'No caching in checkout',
    decision: 'Checkout reads prices from the source.',
    rationale: 'Stale prices are a legal risk.',
  });
  await service.record(postgres);

  const result = await service.checkPlan('Add a Redis cache to speed up the checkout page');
  assert.deepEqual(result.relevant.map((r) => r.decision.id), [replacement.id]);
  assert.deepEqual(result.outdated.map((r) => r.decision.id), [old.id]);
});

// Seen on the test site: "Legal Charter" raised a warning about a call-recording
// decision because its rationale said "Legal ruled it out".
test('checkPlan ignores a decision that only mentions the topic in its rationale', async () => {
  const { service } = setup();
  const recorded = await service.record({
    title: 'Call audio is never stored on our servers',
    decision: 'Live call monitoring streams audio in real time and keeps no recording.',
    rationale: 'Stored recordings fall under consent laws. Legal ruled it out.',
    tags: 'calls, monitoring, recording, privacy',
  });

  assert.deepEqual((await service.checkPlan('Legal Charter')).relevant, []);

  const onTopic = await service.checkPlan('Save recordings of monitored calls to cloud storage');
  assert.deepEqual(onTopic.relevant.map((r) => r.decision.id), [recorded.id]);

  // An explicit search still reaches the rationale.
  const searched = await service.find('legal');
  assert.deepEqual(searched.map((r) => r.decision.id), [recorded.id]);
});

// A plan worded differently from the decision shares no word with it. The caller,
// usually a language model, closes that gap: with synonyms, or by reading the list
// of decisions the ranking did not match.
test('a plan in different words is reachable through keywords and the unmatched list', async () => {
  const { service, actions } = setup();
  const audio = await service.record({
    title: 'Call audio is never stored on our servers',
    decision: 'Live call monitoring streams audio in real time and keeps no recording.',
    tags: 'calls, recording',
  });
  await service.record(postgres);
  const plan = 'Persist voice conversations to a bucket for compliance';

  const plain = await service.checkPlan(plan);
  assert.deepEqual(plain.relevant, []);
  assert.deepEqual(new Set(plain.unmatched.map((d) => d.id)).has(audio.id), true);
  assert.equal(plain.unmatched.length, 2);

  const expanded = await service.checkPlan(plan, { keywords: 'call recording, audio' });
  assert.deepEqual(expanded.relevant.map((r) => r.decision.id), [audio.id]);
  // A matched decision is not repeated in the unmatched list.
  assert.equal(expanded.unmatched.some((d) => d.id === audio.id), false);

  const result = await actions.checkPlan({ plan });
  assert.deepEqual(result.relevantActiveDecisions, []);
  const listed = result.otherActiveDecisions.find((d) => d.id === audio.id);
  assert.equal(listed.title, 'Call audio is never stored on our servers');
  assert.deepEqual(Object.keys(listed).sort(), ['decision', 'id', 'issueKey', 'tags', 'title']);
  assert.match(result.note, /otherActiveDecisions/);

  const found = await actions.findDecisions({ query: 'voice capture', keywords: 'recording' });
  assert.deepEqual(found.decisions.map((d) => d.id), [audio.id]);
});

test('the unmatched list is capped and reports how many were left out', async () => {
  const { service, actions } = setup();
  for (let i = 0; i < 45; i += 1) {
    await service.record({ title: `Rule ${i}`, decision: `Text of rule ${i}.` });
  }
  const direct = await service.checkPlan('unrelated wording entirely', { unmatchedLimit: 40 });
  assert.equal(direct.unmatched.length, 40);
  assert.equal(direct.unmatchedOmitted, 5);
  // Newest first, so a cap drops the oldest.
  assert.equal(direct.unmatched[0].title, 'Rule 44');

  const viaAction = await actions.checkPlan({ plan: 'unrelated wording entirely' });
  assert.equal(viaAction.otherActiveDecisionsOmitted, 5);
});

test('a long decision is shortened in the unmatched list', async () => {
  const { service, actions } = setup();
  await service.record({ title: 'Long one', decision: 'x'.repeat(500) });
  const result = await actions.checkPlan({ plan: 'something else' });
  assert.equal(result.otherActiveDecisions[0].decision.length, 200);
  assert.ok(result.otherActiveDecisions[0].decision.endsWith('…'));
});

test('checkPlan can leave out the work item being viewed', async () => {
  const { service } = setup();
  await service.record(postgres);
  const result = await service.checkPlan('billing database', { excludeIssueKey: 'PAY-1' });
  assert.deepEqual(result.relevant, []);
});

test('forIssue lists every decision on a work item, newest first', async () => {
  const { service } = setup();
  const first = await service.record(postgres);
  const second = await service.record({ ...postgres, title: 'Second' });
  await service.record({ ...postgres, issueKey: 'OPS-9' });

  const listed = await service.forIssue('pay-1');
  assert.deepEqual(listed.map((d) => d.id), [second.id, first.id]);
});

test('reversing an unknown decision is a validation error', async () => {
  const { service } = setup();
  await assert.rejects(service.reverse('DEC-NOPE22', 'x'), /no decision with id DEC-NOPE22/);
});

// --- action handlers, as Rovo and MCP clients call them ---

test('record-decision defaults to the work item the user is viewing', async () => {
  const { actions } = setup();
  const { issueKey, ...withoutKey } = postgres;
  const result = await actions.recordDecision(
    { ...withoutKey, context: { jira: { issueKey: 'OPS-7' } } },
    { principal: { accountId: 'acc-9' } },
  );
  assert.equal(result.recorded.issueKey, 'OPS-7');
  assert.equal(result.recorded.decidedBy, 'acc-9');
});

test('bad input comes back as an error message, not an exception', async () => {
  const { actions } = setup();
  assert.deepEqual(await actions.recordDecision({ title: 'No body' }), {
    error: 'decision is required',
  });
  assert.deepEqual(await actions.checkPlan({ plan: '  ' }), { error: 'plan is required' });
  assert.deepEqual(await actions.getDecisionsForIssue({}), { error: 'issueKey is required' });
  assert.deepEqual(await actions.supersedeDecision({ decisionId: 'DEC-XXXXXX', title: 't', decision: 'd' }), {
    error: 'no decision with id DEC-XXXXXX',
  });
});

test('a storage failure is not disguised as bad input', async () => {
  const { actions, kvs } = setup();
  kvs.failOnWrite = () => true;
  await assert.rejects(actions.recordDecision(postgres), /storage unavailable/);
});

test('find-decisions says so when nothing matches', async () => {
  const { actions } = setup();
  await actions.recordDecision(postgres);
  const miss = await actions.findDecisions({ query: 'office seating plan' });
  assert.deepEqual(miss.decisions, []);
  assert.match(miss.note, /No recorded decision/);

  const hit = await actions.findDecisions({ query: 'billing' });
  assert.equal(hit.decisions.length, 1);
  assert.equal(hit.note, undefined);
  assert.equal(hit.decisions[0].rationale, postgres.rationale);
});
