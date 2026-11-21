import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankDecisions } from '../src/core/search.js';
import { sameWording, tokenize } from '../src/core/text.js';

const decision = (id, fields) => ({
  id,
  title: '',
  decision: '',
  rationale: '',
  tags: [],
  decidedAt: '2026-01-01T00:00:00.000Z',
  ...fields,
});

const corpus = [
  decision('DEC-A', {
    title: 'Use PostgreSQL for the billing service',
    decision: 'All billing data lives in PostgreSQL.',
    rationale: 'We need transactions across invoices and payments.',
    tags: ['billing', 'database'],
  }),
  decision('DEC-B', {
    title: 'No caching in the checkout flow',
    decision: 'Checkout reads prices directly from the source.',
    rationale: 'A stale price shown to a customer is a legal problem.',
    tags: ['checkout'],
  }),
  decision('DEC-C', {
    title: 'Weekly release train',
    decision: 'We release every Tuesday.',
    rationale: 'Support needs predictable dates; the billing team asked for it.',
    tags: ['release'],
  }),
];

test('the decision about the topic ranks first', () => {
  const ranked = rankDecisions(corpus, 'which database do we use for billing?');
  assert.equal(ranked[0].decision.id, 'DEC-A');
});

test('decisions sharing no term with the query are left out', () => {
  const ranked = rankDecisions(corpus, 'add a cache to checkout');
  assert.deepEqual(ranked.map((r) => r.decision.id), ['DEC-B']);
});

test('word forms match: cache/caching, service/services, decide/decided', () => {
  assert.deepEqual(tokenize('cache'), tokenize('caching'));
  assert.deepEqual(tokenize('service'), tokenize('services'));
  assert.deepEqual(tokenize('decide'), tokenize('decided'));
  assert.deepEqual(tokenize('policy'), tokenize('policies'));
});

test('a title match outranks a mention in the rationale', () => {
  // "billing" is in DEC-A's title and tags, and only in DEC-C's rationale.
  const ranked = rankDecisions(corpus, 'billing');
  assert.deepEqual(ranked.map((r) => r.decision.id), ['DEC-A', 'DEC-C']);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('reports which query terms matched', () => {
  const [top] = rankDecisions(corpus, 'cache for checkout prices');
  assert.deepEqual(top.matchedTerms.sort(), [...tokenize('cache checkout prices')].sort());
});

test('a query of only stopwords, or an empty corpus, returns nothing', () => {
  assert.deepEqual(rankDecisions(corpus, 'what should we do with it?'), []);
  assert.deepEqual(rankDecisions(corpus, ''), []);
  assert.deepEqual(rankDecisions([], 'billing'), []);
});

test('limit caps the result count', () => {
  assert.equal(rankDecisions(corpus, 'billing', { limit: 1 }).length, 1);
});

test('non-Latin text is searchable', () => {
  const ranked = rankDecisions(
    [decision('DEC-R', { title: 'Склад ведём в одной базе', decision: 'Одна база на все склады.' })],
    'сколько баз нужно на склад',
  );
  assert.equal(ranked[0]?.decision.id, 'DEC-R');
});

test('the panel treats a title and decision with the same words as one line', () => {
  assert.equal(sameWording('We ship the mobile app weekly', 'We ship the mobile app weekly.'), true);
  assert.equal(sameWording('we ship weekly', 'We  ship weekly!'), true);
  assert.equal(sameWording('No caching in the checkout flow', 'Prices are always read live at checkout'), false);
  // A shortened title is not the full decision.
  assert.equal(sameWording('Keep the long title…', 'Keep the long title and everything after it.'), false);
  assert.equal(sameWording('', ''), false);
});
