import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createService } from '../src/core/service.js';
import { createStore } from '../src/core/store.js';
import { fakeKvs, tickingClock } from './helpers.mjs';

const seed = JSON.parse(
  readFileSync(new URL('../scripts/seed-decisions.json', import.meta.url), 'utf8'),
);

async function seeded(extra = 0) {
  const fake = fakeKvs();
  const service = createService({ store: createStore(fake), clock: tickingClock() });
  const ids = {};
  for (const decision of seed) ids[decision.title] = (await service.record(decision)).id;
  for (let i = 0; i < extra; i += 1) {
    await service.record({
      title: `Filler rule ${i} about module ${i % 97}`,
      decision: `Component ${i} follows convention ${i % 13} for layout ${i % 7}.`,
      tags: `filler-${i % 29}`,
    });
  }
  return { service, ids };
}

// Realistic plans against thirty realistic decisions: the right one must come first.
const CASES = [
  ['Add a Redis cache in front of the checkout price lookup', 'No caching of prices in checkout'],
  ['Move invoices and payments into a MongoDB database', 'PostgreSQL is the only database for billing'],
  ['Keep order totals as floating point numbers', 'All money amounts are integers in minor units'],
  ['Deploy the hotfix to production on Friday evening', 'Releases go out on Tuesdays'],
  ['Expose a GraphQL endpoint for partners', 'REST for public API, no GraphQL'],
  ['Send user email addresses in analytics events', 'No personal data in analytics events'],
  ['Create the staging bucket by hand in the cloud console', 'Infrastructure is defined in Terraform'],
  ['Let the AI assistant send support replies automatically', 'No AI-generated replies sent to customers without review'],
  ['Log the full login request body for debugging', 'Passwords are never logged'],
];

test('among thirty decisions, the one a plan touches ranks first', async () => {
  const { service, ids } = await seeded();
  const misses = [];
  for (const [plan, expected] of CASES) {
    const { relevant } = await service.checkPlan(plan);
    if (relevant[0]?.decision.id !== ids[expected]) {
      misses.push(`${plan} -> ${relevant[0]?.decision.title ?? 'nothing'}`);
    }
  }
  assert.deepEqual(misses, []);
});

test('an unrelated plan matches nothing and gets the full list to scan', async () => {
  const { service } = await seeded();
  const result = await service.checkPlan('Organise the summer offsite in Lisbon');
  assert.deepEqual(result.relevant, []);
  assert.equal(result.unmatched.length, 30);
});

test('an unasked warning needs a tag match or two shared topic words', async () => {
  const { service, ids } = await seeded();
  const calls = await service.record({
    title: 'Increase in-memory playback buffer to 60 seconds',
    decision: 'The in-memory playback buffer is 60 seconds, still never written to disk.',
    tags: 'calls, playback',
  });
  const hits = async (summary) => (await service.checkPlan(summary, { strict: true })).relevant;
  const titles = async (summary) => (await hits(summary)).map((hit) => hit.decision.id);
  const strong = async (summary) =>
    (await hits(summary)).filter((hit) => hit.strong).map((hit) => hit.decision.title);

  // A tag many decisions carry lists them, but does not warn.
  assert.equal((await hits('Mobile sync bug')).length, 3);
  assert.deepEqual(await strong('Mobile sync bug'), []);
  // A second shared word, or a tag few decisions carry, does warn.
  assert.deepEqual(await strong('iOS Version Upgrade Notes'), [
    'Mobile apps support the last two OS versions',
  ]);
  assert.deepEqual(await strong('Expose a partner API'), [
    'REST for public API, no GraphQL',
    'Breaking API changes need 6 months notice',
  ]);
  // "Add" in a task title is not a topic.
  assert.deepEqual(await strong('Add security to mobile devices'), []);


  // "live" and "call" alone also occur in the secrets, billing and on-call decisions.
  assert.deepEqual(await titles('Implement Live call monitoring'), [calls.id]);
  // Two topic words in common, no tag.
  assert.deepEqual(await titles('Store money amounts as floats'), [
    ids['All money amounts are integers in minor units'],
  ]);
  assert.deepEqual(await titles('Update the team page'), []);
  // An agent that asks gets the real match; single-word ones move to the list it scans.
  const asked = await service.checkPlan('Implement Live call monitoring');
  assert.deepEqual(asked.relevant.map((hit) => hit.decision.id), [calls.id]);
  assert.ok(asked.unmatched.length >= 30);
  // With nothing better, a single shared word is still offered.
  const weakOnly = await service.checkPlan('Log the full login request body for debugging');
  assert.equal(weakOnly.relevant[0].decision.title, 'Passwords are never logged');
  // The work item names a tagged area (billing); a decision outside it does not warn.
  assert.deepEqual(await strong('Billing system is sending duplicate bills to customers'), []);
});

test('ranking stays fast and correct with 2000 decisions', async () => {
  const { service, ids } = await seeded(1970);
  const started = performance.now();
  const { relevant, unmatched, unmatchedOmitted } = await service.checkPlan(CASES[0][0]);
  const elapsed = performance.now() - started;

  assert.equal(relevant[0].decision.id, ids[CASES[0][1]]);
  assert.equal(unmatched.length, 40);
  assert.ok(unmatchedOmitted > 1900);
  // Generous: this guards against an accidental quadratic, not against a slow machine.
  assert.ok(elapsed < 1500, `checkPlan took ${Math.round(elapsed)} ms`);
});
