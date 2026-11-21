import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Tag,
  TagGroup,
  Text,
  TextArea,
  Textfield,
  User,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS_LOZENGE = {
  active: { appearance: 'success', label: 'In force' },
  superseded: { appearance: 'moved', label: 'Superseded' },
  reversed: { appearance: 'removed', label: 'Reversed' },
};

// Who put the decision on record. People want to know when an agent decided for them.
const SOURCE_LOZENGE = {
  agent: { appearance: 'new', label: 'Recorded by an AI agent' },
  comment: { appearance: 'inprogress', label: 'Picked up from a comment' },
};

const EMPTY_FORM = { title: '', decision: '', rationale: '', tags: '' };

const cardStyle = xcss({
  padding: 'space.150',
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'radius.medium',
});

const proposalStyle = xcss({
  padding: 'space.150',
  borderRadius: 'radius.medium',
  backgroundColor: 'color.background.discovery',
});

function day(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// What the graph says about one decision, in words a person can act on.
function graphLabel(status) {
  if (!status) return null;
  if (status.state === 'not-connected') return 'Not in Teamwork Graph: connector is off';
  if (status.state === 'missing') return 'Not in Teamwork Graph yet';
  if (status.state === 'error') return 'Teamwork Graph check failed';
  const index = String(status.indexStatus ?? '').toLowerCase();
  return index === 'indexed' ? 'In Teamwork Graph, searchable' : 'In Teamwork Graph, indexing';
}

const Byline = ({ item }) => (
  <Inline space="space.100" alignBlock="center" shouldWrap>
    {item.decidedBy ? <User accountId={item.decidedBy} /> : null}
    <Text size="small" color="color.text.subtle">
      {day(item.decidedAt)}
    </Text>
    {item.issueKey ? (
      <Text size="small" color="color.text.subtle">
        {item.issueKey}
      </Text>
    ) : null}
  </Inline>
);

const DecisionCard = ({ item, graph, footer, showIssue = false }) => {
  const status = STATUS_LOZENGE[item.status] ?? { appearance: 'default', label: item.status };
  const source = SOURCE_LOZENGE[item.recordedBy];
  return (
    <Box xcss={cardStyle}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Lozenge appearance={status.appearance}>{status.label}</Lozenge>
          {source ? <Lozenge appearance={source.appearance}>{source.label}</Lozenge> : null}
          <Text size="small" color="color.text.subtle">
            {item.id}
          </Text>
        </Inline>
        <Heading as="h4" size="small">
          {item.title}
        </Heading>
        <Text>{item.decision}</Text>
        <Text color="color.text.subtle">Why: {item.rationale}</Text>
        {item.supersededBy ? <Text>Replaced by {item.supersededBy}.</Text> : null}
        {item.supersedes ? <Text>Replaces {item.supersedes}.</Text> : null}
        {item.closedReason ? <Text>Reversed because: {item.closedReason}</Text> : null}
        {item.tags?.length ? (
          <TagGroup>
            {item.tags.map((tag) => (
              <Tag key={tag} text={tag} />
            ))}
          </TagGroup>
        ) : null}
        <Byline item={showIssue ? item : { ...item, issueKey: null }} />
        {graphLabel(graph) ? (
          <Text size="small" color="color.text.subtlest">
            {graphLabel(graph)}
          </Text>
        ) : null}
        {footer}
      </Stack>
    </Box>
  );
};

const App = () => {
  const [data, setData] = useState(null);
  const [graph, setGraph] = useState({});
  const [failure, setFailure] = useState(null);
  const [formError, setFormError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [reversing, setReversing] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await invoke('getPanelData'));
      setFailure(null);
    } catch (error) {
      setFailure(String(error?.message ?? error));
      return;
    }
    // Secondary information: the panel is usable without it.
    try {
      const { statuses = [] } = await invoke('getGraphStatus');
      setGraph(Object.fromEntries(statuses.map((status) => [status.id, status])));
    } catch (error) {
      console.error('Precedent: graph status unavailable', error);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const run = async (name, payload, onDone) => {
    setBusy(true);
    setFormError(null);
    try {
      const result = await invoke(name, payload);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      onDone?.();
      await load();
    } catch (error) {
      setFormError(String(error?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run('recordDecision', form, () => {
      setForm(EMPTY_FORM);
      setShowForm(false);
    });

  if (failure) {
    return (
      <SectionMessage appearance="error" title="Precedent could not load">
        <Text>{failure}</Text>
      </SectionMessage>
    );
  }
  if (!data) return <Spinner />;

  const nothingHere = data.linked.length === 0 && data.proposed.length === 0;

  return (
    <Stack space="space.200">
      {data.related.length > 0 ? (
        <SectionMessage appearance="warning" title="Earlier decisions touch this work">
          <Stack space="space.150">
            <Text>Check that this work item follows them before starting.</Text>
            {data.related.map((item) => (
              <DecisionCard key={item.id} item={item} showIssue />
            ))}
          </Stack>
        </SectionMessage>
      ) : null}

      {(data.possiblyRelated ?? []).length > 0 ? (
        <SectionMessage appearance="information" title="Decisions in the same area">
          <Stack space="space.150">
            <Text>These share a tag with this work item. They may not apply.</Text>
            {data.possiblyRelated.map((item) => (
              <DecisionCard key={item.id} item={item} showIssue />
            ))}
          </Stack>
        </SectionMessage>
      ) : null}

      {data.proposed.map((item) => (
        <Box key={item.id} xcss={proposalStyle}>
          <Stack space="space.100">
            <Heading as="h4" size="small">
              Is this a decision?
            </Heading>
            <Text>Precedent noticed this in a comment on this work item.</Text>
            <Text weight="medium">{item.decision}</Text>
            {item.rationale !== '(no rationale recorded)' ? (
              <Text color="color.text.subtle">Why: {item.rationale}</Text>
            ) : (
              <Text color="color.text.subtle">No reason was given in the comment.</Text>
            )}
            <Byline item={{ ...item, issueKey: null }} />
            <ButtonGroup>
              <Button
                appearance="primary"
                isDisabled={busy}
                onClick={() => run('confirmProposal', { decisionId: item.id })}
              >
                Yes, record it
              </Button>
              <Button
                appearance="subtle"
                isDisabled={busy}
                onClick={() => run('dismissProposal', { decisionId: item.id })}
              >
                Not a decision
              </Button>
            </ButtonGroup>
          </Stack>
        </Box>
      ))}

      <Stack space="space.150">
        <Heading as="h3" size="small">
          Decided here
        </Heading>
        {data.linked.length === 0 ? (
          <Text color="color.text.subtle">
            {nothingHere
              ? 'Nothing decided on this work item yet. Record a decision here, ask the Precedent agent to, or write "Decision: ..." in a comment.'
              : 'Nothing on record yet. Confirm the comment above if it is a decision.'}
          </Text>
        ) : null}
        {data.linked.map((item) => (
          <DecisionCard
            key={item.id}
            item={item}
            graph={graph[item.id]}
            footer={
              item.status !== 'active' ? null : reversing?.id === item.id ? (
                // Agents read the reason, so that they do not propose the same thing again.
                <Stack space="space.100">
                  <Label labelFor={`reason-${item.id}`}>Why is this no longer in force?</Label>
                  <TextArea
                    id={`reason-${item.id}`}
                    value={reversing.reason}
                    onChange={(event) => setReversing({ id: item.id, reason: event.target.value })}
                  />
                  <ButtonGroup>
                    <Button
                      appearance="warning"
                      isDisabled={busy || !reversing.reason.trim()}
                      onClick={() =>
                        run(
                          'reverseDecision',
                          { decisionId: item.id, reason: reversing.reason.trim() },
                          () => setReversing(null),
                        )
                      }
                    >
                      Reverse decision
                    </Button>
                    <Button appearance="subtle" isDisabled={busy} onClick={() => setReversing(null)}>
                      Keep it
                    </Button>
                  </ButtonGroup>
                </Stack>
              ) : (
                <Inline>
                  <Button
                    appearance="subtle"
                    isDisabled={busy}
                    onClick={() => setReversing({ id: item.id, reason: '' })}
                  >
                    Mark as reversed
                  </Button>
                </Inline>
              )
            }
          />
        ))}
      </Stack>

      {formError ? (
        <SectionMessage appearance="error" title="Not saved">
          <Text>{formError}</Text>
        </SectionMessage>
      ) : null}

      {showForm ? (
        <Box xcss={cardStyle}>
          <Stack space="space.100">
            <Label labelFor="title">Title</Label>
            <Textfield id="title" value={form.title} onChange={setField('title')} />
            <Label labelFor="decision">What was decided</Label>
            <TextArea id="decision" value={form.decision} onChange={setField('decision')} />
            <Label labelFor="rationale">Why, and what was ruled out</Label>
            <TextArea id="rationale" value={form.rationale} onChange={setField('rationale')} />
            <Label labelFor="tags">Topics, comma-separated</Label>
            <Textfield id="tags" value={form.tags} onChange={setField('tags')} />
            <ButtonGroup>
              <Button appearance="primary" isDisabled={busy} onClick={save}>
                Save decision
              </Button>
              <Button appearance="subtle" isDisabled={busy} onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </ButtonGroup>
          </Stack>
        </Box>
      ) : (
        <Inline>
          <Button onClick={() => setShowForm(true)}>Record a decision</Button>
        </Inline>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
