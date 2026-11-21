import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STATUS,
  ValidationError,
  newDecision,
  normaliseIssueKey,
  normaliseTags,
  reverse,
  supersede,
} from '../src/core/decisions.js';

const meta = (id) => ({ id, now: '2026-11-10T09:00:00.000Z', decidedBy: 'acc-1' });
const valid = { title: 'Use PostgreSQL', decision: 'Billing data lives in PostgreSQL.' };

test('a new decision is active and trimmed', () => {
  const d = newDecision({ ...valid, title: '  Use PostgreSQL  ', issueKey: 'pay-142' }, meta('DEC-1'));
  assert.equal(d.title, 'Use PostgreSQL');
  assert.equal(d.status, STATUS.ACTIVE);
  assert.equal(d.issueKey, 'PAY-142');
  assert.equal(d.decidedBy, 'acc-1');
  assert.equal(d.rationale, '');
});

test('title and decision are required', () => {
  assert.throws(() => newDecision({ ...valid, title: '   ' }, meta('DEC-1')), ValidationError);
  assert.throws(() => newDecision({ title: 'x' }, meta('DEC-1')), /decision is required/);
});

test('over-long fields are rejected, not truncated', () => {
  assert.throws(
    () => newDecision({ ...valid, title: 'x'.repeat(201) }, meta('DEC-1')),
    /title must be at most 200/,
  );
});

test('tags accept a comma string or an array, deduplicated and lower-cased', () => {
  assert.deepEqual(normaliseTags('Billing, database ,billing,,'), ['billing', 'database']);
  assert.deepEqual(normaliseTags(['A', 'a', ' b ']), ['a', 'b']);
  assert.deepEqual(normaliseTags(undefined), []);
  assert.throws(() => normaliseTags(Array.from({ length: 11 }, (_, i) => `t${i}`)), /at most 10/);
});

test('work item keys are validated', () => {
  assert.equal(normaliseIssueKey(''), null);
  assert.equal(normaliseIssueKey(' ab2-7 '), 'AB2-7');
  assert.throws(() => normaliseIssueKey('not a key'), ValidationError);
  assert.throws(() => normaliseIssueKey('PAY-'), ValidationError);
});

test('superseding links both records and leaves the inputs untouched', () => {
  const old = newDecision({ ...valid, tags: 'billing', issueKey: 'PAY-1' }, meta('DEC-1'));
  const next = newDecision({ title: 'Move to MySQL', decision: 'Billing moves to MySQL.' }, meta('DEC-2'));
  const result = supersede(old, next, '2026-12-01T00:00:00.000Z');

  assert.equal(result.previous.status, STATUS.SUPERSEDED);
  assert.equal(result.previous.supersededBy, 'DEC-2');
  assert.equal(result.previous.closedAt, '2026-12-01T00:00:00.000Z');
  assert.equal(result.replacement.supersedes, 'DEC-1');
  // The replacement inherits the context it did not restate.
  assert.equal(result.replacement.issueKey, 'PAY-1');
  assert.deepEqual(result.replacement.tags, ['billing']);

  assert.equal(old.status, STATUS.ACTIVE);
  assert.equal(next.supersedes, null);
});

test('a closed decision cannot be superseded or reversed again', () => {
  const old = newDecision(valid, meta('DEC-1'));
  const reversed = reverse(old, 'Vendor dropped support', '2026-12-01T00:00:00.000Z');
  assert.equal(reversed.status, STATUS.REVERSED);
  assert.equal(reversed.closedReason, 'Vendor dropped support');

  const next = newDecision(valid, meta('DEC-2'));
  assert.throws(() => supersede(reversed, next, 'now'), /already reversed/);
  assert.throws(() => reverse(reversed, 'again', 'now'), /already reversed/);
});
