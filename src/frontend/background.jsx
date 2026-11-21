import React, { useEffect } from 'react';
import ForgeReconciler from '@forge/react';
import { invoke, showFlag } from '@forge/bridge';

// Runs on every work item view, with no UI of its own. If an earlier decision
// touches this work, say so without waiting for someone to open the panel. A person
// who has acknowledged a warning is not shown it again.
const Background = () => {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await invoke('getWarnings');
      if (cancelled || data?.error) return;

      const related = data.related ?? [];
      if (related.length > 0) {
        const [first, ...rest] = related;
        const more = rest.length ? ` and ${rest.length} more` : '';
        const flag = showFlag({
          id: `precedent-${data.issueKey}`,
          type: 'warning',
          title:
            related.length === 1
              ? 'An earlier decision touches this work'
              : `${related.length} earlier decisions touch this work`,
          description: `${first.id} · ${first.title}${more}. Open Precedent on this work item to read why before starting.`,
          isAutoDismiss: false,
          actions: [
            {
              text: "Got it, don't show again",
              onClick: () => {
                invoke('dismissWarnings', { decisionIds: related.map((item) => item.id) }).catch(
                  (error) => console.error('Precedent: could not save dismissal', error),
                );
                flag.close();
              },
            },
          ],
        });
        return;
      }

      if (data.proposedCount > 0) {
        showFlag({
          id: `precedent-proposed-${data.issueKey}`,
          type: 'info',
          title: 'Precedent found a possible decision in a comment',
          description: 'Open Precedent on this work item to confirm or dismiss it.',
          isAutoDismiss: true,
        });
      }
    })().catch((error) => {
      // A background check must never break the work item view.
      console.error('Precedent background check failed', error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <></>;
};

ForgeReconciler.render(
  <React.StrictMode>
    <Background />
  </React.StrictMode>,
);
