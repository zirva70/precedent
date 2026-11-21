# Devpost submission text

Paste each block into the matching Devpost field.

## Project name

Precedent

## Tagline (short description)

The shared decision memory for a team's AI agents and the people who direct them.

## Inspiration

AI agents now do a large share of a team's work, and each one sees only its own
session. It does not know what a teammate's agent decided yesterday, or what the same
agent decided last week. The code shows what was chosen. It never shows what was ruled
out, or why.

So the same thing keeps happening: an agent proposes the caching layer the team
rejected a month ago, or quietly undoes a constraint somebody agreed on for a good
reason. Nobody notices until review, or until production.

Teams already make these decisions in Jira, in comments and in agent chats. They are
just not kept anywhere an agent will look before it starts.

## What it does

Precedent keeps a team's decisions, with their reasons, in one place inside Jira, and
puts them in front of agents and people at the moment they are about to start work.

- **Agents check before they act.** An MCP server with five tools. An agent calls
  `check-plan-against-decisions` with what it is about to do and gets back the
  decisions in force on that topic, with the rationale, plus the outdated ones it must
  not follow. After the work it calls `record-decision`.
- **People are warned without asking.** When someone opens a Jira work item that
  touches an earlier decision, a flag appears with that decision and its reason. It
  does not depend on anyone opening a panel.
- **A panel on every work item** shows what was decided there, who decided it (a
  person, an AI agent, or picked up from a comment) and whether it is still in force.
- **Decisions are captured where they are made.** Write "Decision: ..." in a Jira
  comment and Precedent proposes it on the work item. A person confirms it with one
  click. Nothing is recorded without that confirmation.
- **A Rovo agent** answers "what did we decide about this, and why?" from the records
  only, and quotes the decision id.
- **Teamwork Graph connector.** Every decision is published to Teamwork Graph as a
  document, so Rovo Search finds it next to the team's other work.
- **History is kept.** A replaced decision is marked superseded and points to its
  replacement. A reversed decision keeps the reason it was reversed, so agents do not
  propose it again.

People stay in control: only a person reverses a decision, and an agent is told to
stop and ask instead of working around a decision that blocks its plan.

## How we built it

Precedent is a Forge app on the Node.js 22 runtime. It uses seven module types:
`rovo:mcp`, `rovo:agent`, `action`, `jira:issuePanel`,
`jira:issueViewBackgroundScript`, `graph:connector` and `trigger`.

- The core (decision rules, ranking, storage) is plain JavaScript with Forge storage
  injected, so the whole of it runs under `node:test` without a Forge tunnel. There are
  62 tests.
- Decisions live in Forge key-value storage. All data stays on the customer's site.
  The app calls no external service and no paid model.
- Relevance is BM25 over title, tags, decision and rationale, with field weights and
  stemming.
- The UI is UI Kit (`@forge/react`), so it looks native in Jira in light and dark
  themes.

## Challenges we ran into

- **False alarms.** With three demo decisions every match looked right. With 33, the
  work item "Implement live call monitoring" got four warnings and three were wrong.
  A warning nobody asked for has to be right, so unasked warnings now need stronger
  evidence than a search does: a match on a narrow tag, or two shared topic words.
  Weaker matches are listed in the panel as "Decisions in the same area" and never
  raise a flag.
- **Teamwork Graph details.** The ingestion API rejects the lower-case category value
  the object reference lists and accepts the upper-case one. The graph also silently
  drops a write whose sequence number does not exceed the stored one, so a re-send
  after a fix must be stamped with the time of publishing, not the time of the
  decision.
- **Panels are opt-in.** Jira shows an app's panel only where someone added it. The
  warning therefore runs in a background script, which works on every work item.

## Accomplishments that we're proud of

- One memory with four ways in: MCP tools for agents, a Rovo agent for conversation, a
  panel and a flag for people, and Teamwork Graph for search.
- It works with zero configuration and no external account. Install it and it runs.
- A decision recorded by an agent is labelled as such, so a person can see what was
  decided on their behalf.

## What we learned

- The reason is the valuable part. A decision without a rationale cannot be
  re-evaluated later, so every path into Precedent asks for one.
- Precision matters more than recall for anything shown unasked. People switch off a
  tool that cries wolf.
- Agents follow tool descriptions closely. Telling the agent that matching is by
  words, and asking it to pass synonyms, did more for recall than any ranking change.

## What's next for Precedent

- Matching by meaning as well as by words.
- Forge SQL storage for sites with more than 2000 decisions.
- Capturing decisions from Confluence pages and pull request reviews.
- A Marketplace listing.

## Built with

forge, atlassian, jira, rovo, mcp, teamwork-graph, javascript, node.js, react, ui-kit

## Testing instructions for judges

1. Install the app on a Jira site with the installation link.
2. Optional, once, as a Jira admin: open any work item, click the apps button under
   the title, choose **Precedent**, then in the panel's `···` menu choose **Show for
   all work items**. Without this step the warning flag still works; the panel appears
   only where it is added.
3. Open a work item and click **Record a decision**. For example: title "No caching in
   the checkout flow", decision "Prices are always read live at checkout", reason
   "Stale prices caused refunds", topics "checkout, caching".
4. Create a second work item named "Add a Redis cache to checkout price lookup" and
   open it. A flag shows the earlier decision and its reason.
5. On any work item add the comment "Decision: we ship the mobile app weekly, because
   daily releases broke review." Reload: the panel asks "Is this a decision?".
6. In Rovo Chat pick the **Precedent** agent and ask "What did we decide about
   checkout caching, and why?".
7. To see decisions in Rovo Search, connect the **Precedent** connector in Atlassian
   Administration under Rovo connectors, then search for a decision's title.
