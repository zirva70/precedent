import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphSync, toGraphDocument } from '../src/core/graph.js';
import { createService } from '../src/core/service.js';
import { createStore } from '../src/core/store.js';
import { fakeKvs, tickingClock } from './helpers.mjs';

const SITE = 'https://example.atlassian.net';
const silent = { error() {} };

function fakeGraph({ respond } = {}) {
  const calls = [];
  return {
    calls,
    async setObjects(request) {
      calls.push(request);
      return respond ? respond(request) : { success: true, results: { accepted: [] } };
    },
  };
}

function setup({ connectionId = 'conn-1', siteUrl = SITE, respond } = {}) {
  const fake = fakeKvs();
  const store = createStore(fake);
  const client = fakeGraph({ respond });
  let connection = connectionId;
  let tick = 1000;
  const settings = {
    getConnectionId: async () => connection,
    setConnectionId: async (id) => {
      connection = id;
    },
    clearConnectionId: async () => {
      connection = null;
    },
  };
  const graphSync = createGraphSync({
    client,
    settings,
    resolveSiteUrl: async () => siteUrl,
    logger: silent,
    now: () => (tick += 1),
  });
  const service = createService({
    store,
    clock: tickingClock(),
    afterWrite: (decisions) => graphSync.publish(decisions),
  });
  return { service, store, client, graphSync, settings, kvs: fake.kvs };
}

const input = {
  title: 'Call audio is never stored',
  decision: 'Live monitoring keeps no recording.',
  rationale: 'Consent laws.',
  tags: 'calls, privacy',
  issueKey: 'MOBL-55',
};

test('a decision maps to a workspace-visible document linked to its work item', async () => {
  const { service } = setup();
  const decision = await service.record(input, { decidedBy: 'acc-1' });
  const doc = toGraphDocument(decision, { siteUrl: `${SITE}/`, sequence: 7 });

  assert.equal(doc.id, decision.id);
  assert.equal(doc.schemaVersion, '2.0');
  assert.equal(doc.updateSequenceNumber, 7);
  assert.equal(doc['atlassian:document'].type.category, 'DOCUMENT');
  assert.equal(doc.displayName, `Decision ${decision.id}: Call audio is never stored`);
  assert.equal(doc.url, `${SITE}/browse/MOBL-55`);
  assert.deepEqual(doc.permissions[0].accessControls[0].principals, [
    { type: 'ATLASSIAN_WORKSPACE' },
  ]);
  assert.deepEqual(doc.associations.set, [
    { associationType: 'issueIdOrKeys', values: ['MOBL-55'] },
  ]);
  assert.deepEqual(doc.createdBy, { accountId: 'acc-1', externalId: 'acc-1' });

  const body = doc['atlassian:document'];
  assert.match(body.content.text, /Status: ACTIVE/);
  assert.match(body.content.text, /Rationale: Consent laws\./);
  assert.deepEqual(body.labels, ['decision', 'decision-active', 'calls', 'privacy']);
});

test('a decision with no work item links to the site and has no association', async () => {
  const { service } = setup();
  const { issueKey, ...noIssue } = input;
  const doc = toGraphDocument(await service.record(noIssue), { siteUrl: SITE, sequence: 1 });
  assert.equal(doc.url, SITE);
  assert.equal(doc.associations, undefined);
  assert.equal(doc.createdBy, undefined);
});

test('recording a decision publishes it to the graph', async () => {
  const { service, client } = setup();
  const decision = await service.record(input);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].connectionId, 'conn-1');
  assert.deepEqual(client.calls[0].objects.map((o) => o.id), [decision.id]);
});

test('superseding republishes both decisions, and the old one says not to follow it', async () => {
  const { service, client } = setup();
  const old = await service.record(input);
  const { replacement } = await service.supersede(old.id, {
    title: 'Keep a 30-second buffer',
    decision: 'A 30-second in-memory buffer is allowed.',
  });

  const published = client.calls.at(-1).objects;
  assert.deepEqual(new Set(published.map((o) => o.id)), new Set([old.id, replacement.id]));

  const oldDoc = published.find((o) => o.id === old.id);
  assert.match(oldDoc.displayName, /^\[SUPERSEDED\] /);
  assert.match(oldDoc['atlassian:document'].content.text, new RegExp(`SUPERSEDED by ${replacement.id}`));
  // The newer state must replace the older one in the graph.
  const first = client.calls[0].objects[0];
  assert.ok(oldDoc.updateSequenceNumber > first.updateSequenceNumber);

  const newDoc = published.find((o) => o.id === replacement.id);
  assert.match(newDoc['atlassian:document'].content.text, new RegExp(`Replaces earlier decision ${old.id}`));
});

// The graph drops a write whose sequence number does not exceed the stored one, so
// a repair re-send of an unchanged decision needs a higher number than the first send.
test('re-sending an unchanged decision uses a higher sequence number', async () => {
  const { service, client, graphSync } = setup();
  const decision = await service.record(input);
  await graphSync.republishAll(() => service.listAll());

  const [first, second] = client.calls.map((call) => call.objects[0]);
  assert.equal(first.id, decision.id);
  assert.equal(second.id, decision.id);
  assert.ok(second.updateSequenceNumber > first.updateSequenceNumber);
});

test('with no connection, decisions are still saved and nothing is sent', async () => {
  const { service, store, client, graphSync } = setup({ connectionId: null });
  const decision = await service.record(input);
  assert.equal((await store.get(decision.id)).title, input.title);
  assert.equal(client.calls.length, 0);
  assert.deepEqual(await graphSync.publish([decision]), { synced: false, reason: 'not-connected' });
});

test('a graph failure never loses the decision', async () => {
  const failing = setup({ respond: () => ({ success: false, error: 'quota' }) });
  const saved = await failing.service.record(input);
  assert.ok(await failing.store.get(saved.id));
  assert.deepEqual(await failing.graphSync.publish([saved]), {
    synced: false,
    reason: 'graph-error',
    error: 'quota',
    sent: 0,
  });

  const throwing = setup({
    respond: () => {
      throw new Error('network down');
    },
  });
  const alsoSaved = await throwing.service.record(input);
  assert.ok(await throwing.store.get(alsoSaved.id));
});

test('objects the graph rejects are reported, not counted as synced', async () => {
  const { service, graphSync } = setup({
    respond: (request) => ({
      success: true,
      results: { rejected: [{ key: { id: request.objects[0].id }, errors: ['bad url'] }] },
    }),
  });
  const decision = await service.record(input);
  const result = await graphSync.publish([decision]);
  assert.equal(result.synced, false);
  assert.equal(result.reason, 'rejected');
  assert.equal(result.rejected.length, 1);
});

test('an unknown site URL stops publishing instead of sending broken links', async () => {
  const { service, client } = setup({ siteUrl: null });
  await service.record(input);
  assert.equal(client.calls.length, 0);
});

test('connecting backfills earlier decisions in batches; disconnecting stops publishing', async () => {
  const { service, client, graphSync, settings } = setup({ connectionId: null });
  for (let i = 0; i < 120; i += 1) await service.record({ ...input, title: `Decision ${i}` });
  assert.equal(client.calls.length, 0);

  const connected = await graphSync.onConnectionChange(
    { action: 'CREATED', connectionId: 'conn-9', name: 'Precedent' },
    () => service.listAll(),
  );
  assert.deepEqual(connected, { success: true, message: 'published 120 decisions' });
  assert.deepEqual(client.calls.map((c) => c.objects.length), [50, 50, 20]);
  assert.ok(client.calls.every((c) => c.connectionId === 'conn-9'));

  await graphSync.onConnectionChange({ action: 'DELETED', connectionId: 'conn-9' }, () => service.listAll());
  assert.equal(await settings.getConnectionId(), null);
  await service.record(input);
  assert.equal(client.calls.length, 3);
});
