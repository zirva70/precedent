import { STATUS } from './decisions.js';

// Teamwork Graph has no "decision" object type, so a decision is published as a
// document. Once it is in the graph, Rovo Search, Rovo Chat and every Rovo agent on
// the site can find it, not only the Precedent agent.
export const GRAPH_OBJECT_TYPE = 'atlassian:document';

const BATCH_SIZE = 50;

function statusLine(decision) {
  if (decision.status === STATUS.SUPERSEDED) {
    return `Status: SUPERSEDED by ${decision.supersededBy}. Do not follow this decision; follow ${decision.supersededBy} instead.`;
  }
  if (decision.status === STATUS.REVERSED) {
    const reason = decision.closedReason ? ` Reason: ${decision.closedReason}` : '';
    return `Status: REVERSED. This decision is no longer in force.${reason}`;
  }
  return 'Status: ACTIVE. This decision is in force and new work must respect it.';
}

/**
 * The graph document for one decision.
 *
 * The graph keeps whichever write has the greater `updateSequenceNumber`, and drops
 * a write that does not exceed the stored one. `sequence` is therefore the time of
 * publishing, not of the decision: a re-send after a mapping fix or an outage must
 * be able to replace what is already there.
 */
export function toGraphDocument(decision, { siteUrl, sequence }) {
  const base = siteUrl.replace(/\/+$/, '');
  const closed = decision.status !== STATUS.ACTIVE;
  const lastUpdatedAt = decision.closedAt ?? decision.decidedAt;

  const lines = [
    `Team decision ${decision.id}: ${decision.title}`,
    statusLine(decision),
    `Decision: ${decision.decision}`,
    `Rationale: ${decision.rationale || 'not recorded'}`,
  ];
  if (decision.supersedes) lines.push(`Replaces earlier decision ${decision.supersedes}.`);
  if (decision.issueKey) lines.push(`Decided on Jira work item ${decision.issueKey}.`);
  if (decision.tags.length) lines.push(`Topics: ${decision.tags.join(', ')}.`);
  lines.push(`Decided at ${decision.decidedAt}.`);

  const document = {
    schemaVersion: '2.0',
    id: decision.id,
    updateSequenceNumber: sequence,
    displayName: `${closed ? `[${decision.status.toUpperCase()}] ` : ''}Decision ${decision.id}: ${decision.title}`,
    description: decision.decision,
    url: decision.issueKey ? `${base}/browse/${decision.issueKey}` : base,
    createdAt: decision.decidedAt,
    lastUpdatedAt,
    // The app has no separate sign-in, so access follows the Atlassian workspace.
    permissions: [{ accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }] }],
    [GRAPH_OBJECT_TYPE]: {
      // Upper case. The Document object reference lists lower-case values, but the
      // ingestion API rejects 'document' with a 400 and accepts 'DOCUMENT'.
      type: { category: 'DOCUMENT', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text: lines.join('\n') },
      labels: ['decision', `decision-${decision.status}`, ...decision.tags],
    },
  };

  if (decision.decidedBy) {
    document.createdBy = { accountId: decision.decidedBy, externalId: decision.decidedBy };
  }
  if (decision.issueKey) {
    document.associations = {
      lastUpdatedAt,
      set: [{ associationType: 'issueIdOrKeys', values: [decision.issueKey] }],
    };
  }
  return document;
}

/**
 * Publishes decisions to Teamwork Graph.
 *
 * `settings` remembers the connection an admin created; `resolveSiteUrl` returns the
 * site's base URL or null. Publishing never throws: Forge storage is the source of
 * truth, and a decision must be saved even when the graph is unreachable. The result
 * says what happened so callers can report it.
 */
export function createGraphSync({
  client,
  settings,
  resolveSiteUrl,
  logger = console,
  now = () => Date.now(),
}) {
  async function publish(everything) {
    // A proposal is one person's unconfirmed comment; it does not belong in a graph
    // that every agent reads as the team's decisions.
    const decisions = everything.filter((decision) => decision.status !== STATUS.PROPOSED);
    if (decisions.length === 0) return { synced: true, sent: 0 };

    const connectionId = await settings.getConnectionId();
    if (!connectionId) return { synced: false, reason: 'not-connected' };

    const siteUrl = await resolveSiteUrl();
    if (!siteUrl) return { synced: false, reason: 'site-url-unknown' };

    // Always the current stored state, stamped with the moment it is sent.
    const sequence = now();
    let sent = 0;
    const rejected = [];
    for (let start = 0; start < decisions.length; start += BATCH_SIZE) {
      const batch = decisions.slice(start, start + BATCH_SIZE);
      const response = await client.setObjects({
        connectionId,
        objects: batch.map((decision) => toGraphDocument(decision, { siteUrl, sequence })),
      });
      if (!response.success) {
        return { synced: false, reason: 'graph-error', error: response.error ?? 'unknown', sent };
      }
      rejected.push(...(response.results?.rejected ?? []));
      sent += batch.length;
    }
    if (rejected.length) {
      return { synced: false, reason: 'rejected', sent, rejected };
    }
    return { synced: true, sent };
  }

  return {
    async publish(decisions) {
      try {
        const result = await publish(decisions);
        if (!result.synced && result.reason !== 'not-connected') {
          logger.error('Precedent: Teamwork Graph sync failed', JSON.stringify(result));
        }
        return result;
      } catch (error) {
        logger.error('Precedent: Teamwork Graph sync threw', error);
        return { synced: false, reason: 'graph-error', error: String(error?.message ?? error) };
      }
    },

    /** Called by Atlassian when an admin connects, edits or disconnects the connector. */
    async onConnectionChange(request, listAllDecisions) {
      if (request.action === 'DELETED') {
        // Atlassian removes the connection's objects itself.
        await settings.clearConnectionId();
        logger.log?.('Precedent: Teamwork Graph connection removed');
        return { success: true };
      }
      await settings.setConnectionId(request.connectionId);
      // Everything recorded before the connection existed goes in now.
      const result = await this.publish(await listAllDecisions());
      logger.log?.('Precedent: Teamwork Graph connection', request.action, JSON.stringify(result));
      return { success: true, message: `published ${result.sent ?? 0} decisions` };
    },

    /**
     * Where one decision stands in the graph: 'not-connected', 'missing' (never
     * arrived), or the index status the graph reports for it.
     */
    async status(decisionId) {
      const connectionId = await settings.getConnectionId();
      if (!connectionId) return { state: 'not-connected' };
      const request = { objectType: GRAPH_OBJECT_TYPE, externalId: decisionId, connectionId };
      try {
        const stored = await client.getObjectByExternalId(request);
        if (!stored.success || !stored.object) {
          return { state: 'missing', error: stored.error };
        }
        const index = await client.getObjectIndexStatusByExternalId(request);
        return { state: 'stored', indexStatus: index.status ?? null, message: index.message };
      } catch (error) {
        return { state: 'error', error: String(error?.message ?? error) };
      }
    },

    /** Re-send everything, for a connection made before a deploy or after an outage. */
    async republishAll(listAllDecisions) {
      return this.publish(await listAllDecisions());
    },
  };
}
