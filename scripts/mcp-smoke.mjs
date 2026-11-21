// Smoke test for the Precedent MCP server, run as an external MCP client would.
//
//   node scripts/mcp-smoke.mjs
//
// It registers a throwaway OAuth client, prints an authorization URL for a person to
// approve in a browser, then lists the tools and calls the read-only ones. The access
// token stays in memory: it is never printed or written to disk. Run this way, no
// decision is created or changed.
//
//   node scripts/mcp-smoke.mjs --seed
//
// writes the decisions in seed-decisions.json through record-decision and then checks
// that plans find the right one. This creates decisions on the site.

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = 8976;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const WAIT_FOR_APPROVAL_MS = 9 * 60 * 1000;

const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
const appId = manifest.match(/ari:cloud:ecosystem::app\/([0-9a-f-]{36})/)?.[1];
if (!appId) throw new Error('app id not found in manifest.yml');
const RESOURCE = `https://mcp.atlassian.com/forge/${appId}`;

const b64url = (buffer) => buffer.toString('base64url');
const log = (...parts) => console.log(...parts);

async function json(response, what) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${what} failed: HTTP ${response.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// --- OAuth: discovery, dynamic client registration, PKCE authorization ---

const resourceMeta = await json(
  await fetch(`https://mcp.atlassian.com/.well-known/oauth-protected-resource/forge/${appId}`),
  'resource metadata',
);
const issuer = resourceMeta.authorization_servers[0];
const authMeta = await json(
  await fetch(`${issuer}/.well-known/oauth-authorization-server`),
  'authorization server metadata',
);

const client = await json(
  await fetch(authMeta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Precedent MCP smoke test',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  }),
  'client registration',
);

const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));

const authorizeUrl = new URL(authMeta.authorization_endpoint);
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: client.client_id,
  redirect_uri: REDIRECT_URI,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state,
  resource: RESOURCE,
}).toString();

const code = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, REDIRECT_URI);
    if (url.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    const failed = url.searchParams.get('error') || url.searchParams.get('state') !== state;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      failed
        ? '<p>Authorization failed. You can close this tab.</p>'
        : '<p>Precedent MCP smoke test is authorized. You can close this tab.</p>',
    );
    server.close();
    if (failed) {
      reject(new Error(`authorization failed: ${url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'state mismatch'}`));
    } else {
      resolve(url.searchParams.get('code'));
    }
  });
  server.listen(PORT, '127.0.0.1', () => {
    log('AUTHORIZE_URL', authorizeUrl.toString());
    log('Waiting for approval in the browser...');
  });
  setTimeout(() => {
    server.close();
    reject(new Error('timed out waiting for approval'));
  }, WAIT_FOR_APPROVAL_MS).unref();
});

const token = await json(
  await fetch(authMeta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  }),
  'token exchange',
);
log('Authorized. Granted scope:', token.scope ?? '(not reported)');

// --- MCP over streamable HTTP ---

let sessionId;
let nextId = 1;

async function rpc(method, params, { notification = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token.access_token}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const body = { jsonrpc: '2.0', method, params };
  if (!notification) body.id = nextId++;

  const response = await fetch(RESOURCE, { method: 'POST', headers, body: JSON.stringify(body) });
  sessionId = response.headers.get('mcp-session-id') ?? sessionId;
  const text = await response.text();
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${text.slice(0, 400)}`);
  if (notification || !text.trim()) return null;

  // The reply is either plain JSON or a server-sent event stream carrying it.
  const payload = (response.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).at(-1)
    : text;
  const message = JSON.parse(payload);
  if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
  return message.result;
}

const toolText = (result) =>
  (result?.content ?? []).map((part) => part.text ?? '').join('\n').slice(0, 1500);

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'precedent-mcp-smoke', version: '0.1.0' },
});
log('SERVER', JSON.stringify(init.serverInfo), 'protocol', init.protocolVersion);
await rpc('notifications/initialized', {}, { notification: true });

const { tools } = await rpc('tools/list', {});
log('TOOLS', tools.map((tool) => tool.name).join(', '));

async function call(name, args) {
  // Outside production the server suffixes each tool with its environment,
  // for example "find-decisions_development".
  const tool = tools.find(
    (candidate) => candidate.name === name || candidate.name.startsWith(`${name}_`),
  );
  if (!tool) {
    log(`CALL ${name}: tool not listed`);
    return;
  }
  log(`SCHEMA ${tool.name}`, JSON.stringify(tool.inputSchema).slice(0, 500));
  try {
    const result = await rpc('tools/call', { name: tool.name, arguments: args });
    log(`CALL ${tool.name} isError=${Boolean(result.isError)}`);
    log(toolText(result));
  } catch (error) {
    log(`CALL ${tool.name} FAILED`, error.message);
  }
}

const SEED = process.argv.includes('--seed');

// --demo <ISSUE-KEY>: what an outside agent does around one task. It checks its plan,
// reads what comes back, and records the choice it made. This DOES create one decision
// on the given work item.
const demoAt = process.argv.indexOf('--demo');
if (demoAt !== -1) {
  const issueKey = process.argv[demoAt + 1];
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey ?? '')) throw new Error('usage: --demo ISSUE-KEY');
  const use = async (name, args) => {
    const toolName = tools.find((tool) => tool.name === name || tool.name.startsWith(`${name}_`))?.name;
    log(`\n> tools/call ${name}`);
    log(JSON.stringify(args, null, 2));
    const result = await rpc('tools/call', { name: toolName, arguments: args });
    const text = (result?.content ?? []).map((part) => part.text ?? '').join('');
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text.slice(0, 600) };
    }
  };

  const checked = await use('check-plan-against-decisions', {
    plan: 'Store call recordings so supervisors can replay a call later',
    keywords: 'audio, recording, playback, save, replay',
  });
  if (checked.raw) log(checked.raw);
  // The list is ranked. An agent reads all of it; the screen shows the top two.
  const relevant = checked.relevantActiveDecisions ?? [];
  for (const found of relevant.slice(0, 2)) {
    log(`\n  ${found.id}  ${found.title}`);
    log(`  Decision: ${found.decision}`);
    log(`  Why: ${found.rationale}`);
  }
  if (relevant.length > 2) log(`\n  ... and ${relevant.length - 2} weaker matches`);

  const recorded = await use('record-decision', {
    title: 'Supervisor replay reads only the in-memory buffer',
    decision:
      'The replay button plays back the last 60 seconds from the in-memory buffer. Nothing is written to disk or uploaded.',
    rationale:
      'DEC-P84AU5 rules out stored call audio, and DEC-ZSPUND allows a 60-second in-memory buffer. Saving recordings was the original request and was dropped for that reason.',
    tags: 'calls, playback, recording',
    issueKey,
  });
  log(recorded.recorded ? `\n  Recorded ${recorded.recorded.id} on ${issueKey}` : JSON.stringify(recorded).slice(0, 600));
  log('DONE');
  process.exit(0);
}

if (!SEED) {
  await call('check-plan-against-decisions', {
    plan: 'Record supervisor-monitored calls and store the audio for later quality review',
  });
  await call('find-decisions', { query: 'playback buffer' });
  await call('get-decisions-for-issue', { issueKey: 'MOBL-55' });
  log('DONE');
  process.exit(0);
}

// --seed: write thirty realistic decisions through the MCP tools, as an external
// agent would, then check that plans find the right one among them. This DOES create
// decisions on the site. Titles already on record are skipped, so it can be re-run.

const toolNamed = (name) =>
  tools.find((candidate) => candidate.name === name || candidate.name.startsWith(`${name}_`))?.name;

async function invokeTool(name, args) {
  const started = performance.now();
  const result = await rpc('tools/call', { name: toolNamed(name), arguments: args });
  const text = (result?.content ?? []).map((part) => part.text ?? '').join('');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { data, isError: Boolean(result?.isError), ms: Math.round(performance.now() - started) };
}

const seed = JSON.parse(readFileSync(new URL('./seed-decisions.json', import.meta.url), 'utf8'));
let written = 0;
let skipped = 0;
const writeTimes = [];
for (const decision of seed) {
  const existing = await invokeTool('find-decisions', { query: decision.title });
  if ((existing.data.decisions ?? []).some((found) => found.title === decision.title)) {
    skipped += 1;
    continue;
  }
  const recorded = await invokeTool('record-decision', decision);
  if (recorded.isError || recorded.data.error || !recorded.data.recorded) {
    log('WRITE FAILED', decision.title, JSON.stringify(recorded.data).slice(0, 300));
    continue;
  }
  written += 1;
  writeTimes.push(recorded.ms);
  if (written === 1) log('FIRST WRITE', JSON.stringify(recorded.data.recorded).slice(0, 400));
}
const average = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);
log(`SEEDED written=${written} skipped=${skipped} avgWriteMs=${average(writeTimes)}`);

const CASES = [
  ['Add a Redis cache in front of the checkout price lookup', 'No caching of prices in checkout'],
  ['Move invoices and payments into a MongoDB database', 'PostgreSQL is the only database for billing'],
  ['Deploy the hotfix to production on Friday evening', 'Releases go out on Tuesdays'],
  ['Expose a GraphQL endpoint for partners', 'REST for public API, no GraphQL'],
  ['Send user email addresses in analytics events', 'No personal data in analytics events'],
  ['Let the AI assistant send support replies automatically', 'No AI-generated replies sent to customers without review'],
  ['Save recordings of monitored calls for quality review', 'Call audio is never stored on our servers'],
];
let passed = 0;
const readTimes = [];
for (const [plan, expected] of CASES) {
  const { data, ms } = await invokeTool('check-plan-against-decisions', { plan });
  readTimes.push(ms);
  const top = data.relevantActiveDecisions?.[0];
  const ok = top?.title === expected;
  if (ok) passed += 1;
  log(
    `${ok ? 'PASS' : 'FAIL'} ${ms}ms  "${plan}" -> ${top ? `${top.id} ${top.title}` : 'nothing'}` +
      `  (other listed: ${data.otherActiveDecisions?.length ?? 0})`,
  );
}
log(`PLAN CHECKS ${passed}/${CASES.length} avgReadMs=${average(readTimes)}`);
log('DONE');
