---
name: precedent
description: Check the team's recorded decisions before starting work, and record the decisions you make. Use at the start of any non-trivial task in a repository or project whose team uses Precedent, and again before finishing it.
---

# Precedent: the team's decision memory

You only know what is in this session. You do not know what a teammate's agent, or an
earlier session of your own, decided and why. The code shows what was chosen; it does
not show what was ruled out. The Precedent MCP server holds that record for the whole
team. Use it at two points in every non-trivial task.

Tool names below are the production names. On a development or staging install the
server adds the environment to each name, for example
`check-plan-against-decisions_development`; use the names the server lists.

## Before you start

Call `check-plan-against-decisions` with a plain description of what you intend to do.
Name the components, technologies and approach, because matching is by topic words:

> add a Redis cache to the checkout price lookup

The server matches words, not meaning. You supply the meaning in two ways:

- Pass `keywords`: other terms the team could have used for the same topic
  (`caching, memoize, stale prices`).
- Read `otherActiveDecisions` in the result. These shared no topic word with your
  plan, but one may still be about the same thing in different words. If one is,
  treat it exactly like a relevant decision.

Then, for each decision returned in `relevantActiveDecisions`:

- Read the `rationale`, not just the title. Decide whether your plan follows, extends,
  or contradicts the decision.
- If it contradicts one, **stop and tell the user**. Quote the decision id and its
  rationale, and say what you would have done. Do not work around the decision, and
  do not supersede it yourself.
- A returned decision is relevant by topic, which is not the same as a conflict.
  If it does not actually apply, say so in one line and continue.

Decisions in `outdatedDecisionsForContext` were replaced or reversed. Never follow
them. They are there so you recognise an old rule if you meet it in the code.

If you were given a Jira work item, also call `get-decisions-for-issue` with its key.

## Before you finish

Record each decision you made that later work must respect, with `record-decision`:

- a technology, library, or approach was chosen over an alternative;
- something was deliberately ruled out;
- a constraint was agreed with the user.

Write the `rationale` as if for someone who cannot ask you: the constraint, the
trade-off, and what was rejected. Pass the Jira work item key as `issueKey` when
there is one.

Do not record routine work ("renamed a variable", "fixed the failing test"). A
decision is something a future agent could unknowingly undo.

## Changing a decision

Only the user changes a decision. When they agree that an earlier decision no longer
holds, call `supersede-decision` with its id and the new decision. The old record is
kept and points to the new one.

## If a tool returns `error`

The message says what input to fix (for example a missing `decision`, or an unknown
decision id). Correct the call; do not retry unchanged.
