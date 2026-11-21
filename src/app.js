import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { graph as graphClient } from '@forge/teamwork-graph';
import { createGraphSync } from './core/graph.js';
import { createService } from './core/service.js';
import { createStore } from './core/store.js';

// Settings live beside the decisions but outside the "decision:" prefix, so they
// never show up in a decision listing.
const CONNECTION_KEY = 'config:graph-connection-id';
const SITE_URL_KEY = 'config:site-url';

const settings = {
  getConnectionId: async () => (await kvs.get(CONNECTION_KEY)) ?? null,
  setConnectionId: (connectionId) => kvs.set(CONNECTION_KEY, connectionId),
  clearConnectionId: () => kvs.delete(CONNECTION_KEY),
};

// Graph objects need an absolute URL. The site's base URL does not change, so it is
// looked up once and remembered.
async function resolveSiteUrl() {
  const cached = await kvs.get(SITE_URL_KEY);
  if (cached) return cached;

  const response = await api.asApp().requestJira(route`/rest/api/3/serverInfo`);
  if (!response.ok) return null;
  const { baseUrl } = await response.json();
  if (!baseUrl) return null;
  await kvs.set(SITE_URL_KEY, baseUrl);
  return baseUrl;
}

export const graphSync = createGraphSync({ client: graphClient, settings, resolveSiteUrl });

// One service per function instance, wired to Forge storage and Teamwork Graph.
export const service = createService({
  store: createStore({ kvs, WhereConditions }),
  afterWrite: (decisions) => graphSync.publish(decisions),
});
