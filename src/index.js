import api, { route } from '@forge/api';
import { graphSync, service } from './app.js';
import { createActions } from './core/actions.js';
import { captureFromComment } from './core/capture.js';

export { handler } from './resolvers/index.js';

const actions = createActions(service);

export const recordDecision = actions.recordDecision;
export const findDecisions = actions.findDecisions;
export const getDecisionsForIssue = actions.getDecisionsForIssue;
export const checkPlan = actions.checkPlan;
export const supersedeDecision = actions.supersedeDecision;

// Teamwork Graph connector: an admin connected, edited or disconnected it.
export const onGraphConnectionChange = (request) =>
  graphSync.onConnectionChange(request?.body ?? request, () => service.listAll());

async function fetchCommentBody({ issueKey, commentId }) {
  const response = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`);
  if (!response.ok) return '';
  return (await response.json()).body ?? '';
}

// Jira trigger: a comment was created or edited. If it states a decision, it becomes
// a proposal on that work item, waiting for a person to confirm it in the panel.
export const onIssueCommented = async (event) => {
  const proposal = await captureFromComment(event, { service, fetchCommentBody });
  if (proposal) {
    console.log(`Precedent: proposed ${proposal.id} from a comment on ${proposal.issueKey}`);
  }
};
