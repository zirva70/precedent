# Demo video script

Target length 3:30, hard limit 5:00. English. Screen recording with voice-over.
About 430 spoken words, which is 3 minutes at a calm pace.

The whole video follows one story on the test site: the team decided that call audio
is never stored, and later someone asks for call recording playback.

Rehearsed on the test site on 10 Nov 2026: scenes 2 to 8 behave as written. Scenes 6
and 8 were rehearsed on MOBL-22, which the video does not use; it now holds one
reversed decision, DEC-K2K829.

## Before recording

- Browser at 100% zoom, one window, notifications off, Jira in English if possible.
- The flag in scene 3 shows once per person. If you click "Got it, don't show again"
  on MOBL-58 in a rehearsal, it will not come back. Close it with the cross instead.
- Scene 4 leaves a comment and a decision on MOBL-36. Scene 8 reverses that decision.

## Scenes

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:25 | Title card: "Precedent. The shared decision memory for AI agents and people." Then the Jira board of Mobile Dev. | "AI agents now do a lot of our team's work. Each one sees only its own session. It doesn't know what another agent decided yesterday, or why. The code shows what was chosen. It never shows what was ruled out. So agents keep proposing ideas the team already rejected." |
| 2 | 0:25–0:55 | Open **MOBL-55** "Implement Live call monitoring". Scroll to the Precedent panel, section "Decided here": **DEC-P84AU5** "Call audio is never stored on our servers". Point at "In force", the reason, the author. | "Precedent keeps the team's decisions inside Jira, each with its reason. On this work item the team decided that call audio is never stored. Legal ruled recordings out. The panel shows who decided it and that it is still in force." |
| 3 | 0:55–1:30 | Open **MOBL-58** "Add call recording playback for supervisors". The flag appears: "An earlier decision touches this work. DEC-P84AU5 · Call audio is never stored on our servers." Then the panel block "Earlier decisions touch this work". | "Later, someone asks for call recording playback. Nobody searched for anything. Precedent raises a flag with the earlier decision and the reason behind it, before the work begins. Weaker matches are listed quietly as decisions in the same area, and never raise a flag." |
| 4 | 1:30–2:00 | Open **MOBL-36**. Add the comment: `Decision: we ship the mobile app weekly, because daily releases broke store review.` Reload. The panel shows "Is this a decision?" with the text and "Why: Daily releases broke store review." Click **Yes, record it**. | "Decisions are captured where they are made. I write a decision in a comment. Precedent proposes it, with the reason, and a person confirms with one click. Nothing is recorded without that confirmation." |
| 5 | 2:00–2:35 | home.atlassian.com/chat, agent picker, search "Precedent", pick **Precedent (Jira)**. Type: `I plan to save call recordings so supervisors can replay them later. Check my plan.` The answer lists DEC-P84AU5 and DEC-ZSPUND under "Conflicts" and suggests the 60-second in-memory buffer. | "The same memory is a Rovo agent. I describe a plan, and it checks it against the decisions in force. It says the plan contradicts two decisions, quotes their ids and reasons, and points to what the team allowed instead." |
| 6 | 2:35–3:05 | Terminal: `node scripts/mcp-smoke.mjs --demo MOBL-58`. Approve access in the browser (cut this from the video). The output shows `tools/call check-plan-against-decisions` returning DEC-P84AU5 and DEC-ZSPUND with their reasons, then `tools/call record-decision` and "Recorded DEC-... on MOBL-58". Then open MOBL-58: the new decision "Supervisor replay reads only the in-memory buffer" with the label "Recorded by an AI agent". | "And it is an MCP server, so any agent can use it, not only Rovo. Here an outside client makes the two calls a coding agent makes: it checks the plan before starting, and records what was decided at the end. That decision is now in Jira, labelled as recorded by an agent, for every other agent and person." |
| 7 | 3:05–3:20 | home.atlassian.com/search, query `call audio stored`. First result: "Decision DEC-P84AU5: Call audio is never stored on our servers". | "Every decision is also published to Teamwork Graph, so Rovo Search finds it next to the rest of the team's work." |
| 8 | 3:20–3:35 | Back on **MOBL-36**: click **Mark as reversed** on the weekly-release decision, type "Store review is now automatic", click **Reverse decision**. Then the end card: name, tagline, "Built on Atlassian Forge". | "People stay in control. Only a person reverses a decision, and the reason is kept, so agents don't propose it again. Precedent: decisions that outlive the session." |

## Notes

- The agent's answer in scene 5 is generated, so its wording changes between runs. In
  the rehearsal it named both decisions correctly. Record the take you like.
- Scene 7 uses Rovo Search, not the default Rovo Chat. Search finds decisions on the
  test site; the default chat does not.
- Scene 6 writes a real decision to MOBL-58, so run the command once, for the take.
  The script is a plain MCP client, not an AI agent, and the voice-over says so. To
  show a real coding agent instead, connect one to
  `https://mcp.atlassian.com/forge/160cdb44-8676-4ca9-831e-6c382efee441` and give it
  the task from MOBL-58; that variant was not rehearsed.
- The tool returned five decisions for the plan in scene 6; the top two are the right
  ones and the script prints only those, with a count of the rest.
- The Rovo agent's avatar is the letter P until the app avatar is uploaded in the
  developer console.
