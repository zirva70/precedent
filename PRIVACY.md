# Precedent privacy policy

Last updated: 21 November 2026

Precedent is a Forge app for Jira. It keeps a team's decisions and the reasons behind
them. This page says what it stores, where, and for how long.

## What Precedent stores

- **Decisions** that people or AI agents record: the title, the decision, the
  rationale, topic tags, the Jira work item key, the status (in force, superseded,
  reversed) and the dates.
- **The Atlassian account ID** of the person who recorded, proposed, confirmed or
  superseded a decision.
- **Proposals from comments.** When a Jira comment states a decision, Precedent
  stores a proposal with the comment's id and the author's account ID. A person then
  confirms it, and it becomes a decision, or dismisses it, and it is deleted.
  Precedent reads the comment text to spot the decision; it does not keep the rest of
  the comment.
- **Dismissed warnings.** When a person closes a warning for good, Precedent stores
  their account ID and the work item key so the warning is not shown to them again.

Precedent does not store names, email addresses or any other profile data. The Jira
interface shows a person's name from their account ID.

## Where it is stored

Everything is stored in Forge storage, which Atlassian hosts for the site the app is
installed on. Precedent sends no data to the developer or to any service outside
Atlassian, and it has no analytics or tracking.

If a site administrator connects the Precedent Teamwork Graph connector, decisions are
also published to that site's Teamwork Graph, including the account ID of the person
who decided, so Rovo Search can find them. Disconnecting the connector stops this.

The app writes short log lines, such as a decision id and a work item key, to Forge
logs, which Atlassian hosts. The site administrator controls whether the developer can
read them.

## How long it is kept

Decisions are kept as the team's history until the app is uninstalled. Superseded and
reversed decisions are kept on purpose, so later work can see what was ruled out and
why. When the app is uninstalled, Atlassian deletes its stored data in line with
Forge's data retention policy.

## Contact

Questions and requests to delete data: open an issue at
<https://github.com/zirva70/precedent/issues>, or write to the support contact shown on
the app's installation page.
