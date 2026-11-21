import { commentText, detectDecision } from './detect.js';

/**
 * Handles a Jira "comment created or edited" event: if the comment states a decision,
 * keep it as a proposal on that work item for a person to confirm.
 *
 * Returns the proposal, or null when nothing was proposed. `fetchCommentBody` is only
 * used when the event does not carry the comment text.
 */
export async function captureFromComment(event, { service, fetchCommentBody }) {
  // A comment written by this app must not feed back into it.
  if (event?.selfGenerated) return null;

  const issueKey = event?.issue?.key;
  const commentId = event?.comment?.id;
  if (!issueKey || !commentId) return null;

  let body = event.comment.body;
  if (body === undefined || body === null || body === '') {
    body = await fetchCommentBody({ issueKey, commentId });
  }

  const found = detectDecision(commentText(body));
  if (!found) return null;

  return service.propose(
    { ...found, issueKey },
    {
      sourceRef: `comment:${commentId}`,
      proposedBy: event.atlassianId ?? event.comment.author?.accountId ?? null,
    },
  );
}
