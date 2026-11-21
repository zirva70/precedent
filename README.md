# Precedent

The shared decision memory for a team's AI agents. Built for Codegeist 2026 on
Atlassian Forge.

When agents do most of the work, each one sees only its own session. It does not know
what a teammate's agent, or its own earlier session, decided and why. The code shows
what was chosen, never what was ruled out, so agents re-propose rejected ideas and
quietly undo earlier decisions. Precedent is the memory that outlives a session and is
shared by every agent and person on the team.

## How it is used

1. **Before a task**, an agent calls `check-plan-against-decisions` with what it is
   about to do, and gets back the active decisions on that topic with their rationale.
2. **After a task**, the agent calls `record-decision` for each choice later work must
   respect.
3. **People stay in control.** The Jira work item panel shows what was decided there
   and lets a person reverse a decision, with a reason. When a work item touches an
   earlier decision, a flag says so on opening it, whether or not the panel is shown.
   Only a person changes a decision; agents are told to stop and ask.
4. **Decisions are captured where they are made.** A comment that starts with
   "Decision: ..." becomes a proposal on its work item. A person confirms or dismisses
   it; nothing is recorded without that.

## What is in the app

- **MCP server (`rovo:mcp`).** Five tools, usable from Rovo Studio agents and from
  external MCP clients such as coding agents.
- **`skills/precedent/SKILL.md`.** An open instruction file that tells a third-party
  agent when to call those tools.
- **Rovo agent "Precedent".** The same memory in conversation, inside Jira and Confluence.
- **Jira work item panel and warning flag.** Oversight for people. A flag needs a
  match on a narrow tag or on two topic words; weaker matches are only listed in the
  panel as decisions in the same area.
- **Comment trigger.** Picks up "Decision: ..." comments as proposals.
- **Teamwork Graph connector.** Publishes every decision as a document, so Rovo Search
  finds it. An admin connects it once in Atlassian Administration; until then the
  panel says "Not in Teamwork Graph: connector is off" and everything else works.
- **History is kept.** A replaced decision is marked superseded and points to its
  replacement; it stops being guidance but stays findable.

## Layout

| Path | What is there |
|---|---|
| `manifest.yml` | Modules: MCP server, agent, five actions, issue panel, background script, graph connector, comment trigger |
| `src/core/` | Decision rules, search ranking, storage, action handlers. Forge storage is injected, so this runs under plain Node. |
| `src/app.js` | Wires the core to `@forge/kvs` |
| `src/resolvers/` | Backend for the issue panel |
| `src/frontend/` | Issue panel (UI Kit) |
| `skills/precedent/` | Skill file for third-party agents |
| `test/` | `node:test` suite for the core |

## Run the tests

```bash
npm test
```

## First deploy

```bash
npx forge login
```

```bash
npx forge register
```

```bash
npx forge site provision
```

```bash
npx forge deploy
```

```bash
npx forge install --demo-site
```

`forge register` replaces the placeholder app id in `manifest.yml` with a real one.

## After installing

Jira shows an app's work item panel only where someone added it. To have Precedent on
every work item, a Jira admin does this once: open any work item, click the apps
button under the title, choose **Precedent**, then in the panel's `···` menu choose
**Show for all work items**. The warning flag works without this step.

## Connect an outside agent

The MCP endpoint is `https://mcp.atlassian.com/forge/<app id>`, with the app id from
`manifest.yml`. The agent signs in with OAuth as a person on the site. To try the
calls without an agent:

```bash
node scripts/mcp-smoke.mjs
```

## Known limits

- Search loads all decisions and ranks them in memory (BM25 over title, tags, decision,
  rationale). It is capped at 2000 decisions per site; beyond that it needs Forge SQL.
- Relevance is by shared topic words, not meaning. Agents are told to compare the
  matched decisions with the plan rather than treat a match as a conflict.
- Nothing forces an agent to call the tools. Adoption depends on the skill file or the
  agent's own instructions.
