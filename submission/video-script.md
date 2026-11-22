# Demo video script

Target length 3:50, hard limit 5:00. English. Screen recording with voice-over.
About 460 spoken words, which is a little over 3 minutes at a calm pace.

The whole video follows one story on the demo site (one-atlas-xmys): the team decided
that call audio is never stored, and later someone asks for call recording playback.

Rehearsed on 10 Nov 2026: scenes 2 to 8 behaved as written, with the scripted MCP
client in scene 6. Scenes 6 and 8 were rehearsed on MOBL-22, which the video does not
use; it now holds one reversed decision, DEC-K2K829. Checked again on 21 Nov 2026:
MOBL-55, MOBL-58 and MOBL-36 are in the state scenes 2, 3, 4 and 8 need, the Precedent
agent is listed, and Rovo Search finds DEC-P84AU5 first. Scene 6 now uses a real coding
agent; that version is not rehearsed yet.

## Before recording

- Browser at 100% zoom, one window, notifications off, Jira in English. With Jira in
  English the panel header shows a "DEVELOPMENT" label, because the demo site runs the
  development build; that is expected.
- The flag in scene 3 shows once per person. If you click "Got it, don't show again"
  on MOBL-58 in a rehearsal, it will not come back. Close it with the cross instead.
  The flag takes 15–20 seconds to appear after the work item opens; cut the wait.
- Scene 4 leaves a comment and a decision on MOBL-36. Scene 8 reverses that decision.
- Scene 6, once, before the first rehearsal: see "Setting up scene 6" below.

## Scenes

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:25 | Title card: "Precedent. The shared decision memory for AI agents and people." Then the Jira board of Mobile Dev. | "AI agents now do a lot of our team's work. Each one sees only its own session. It doesn't know what another agent decided yesterday, or why. The code shows what was chosen. It never shows what was ruled out. So agents keep proposing ideas the team already rejected." |
| 2 | 0:25–0:55 | Open **MOBL-55** "Implement Live call monitoring". Scroll to the Precedent panel, section "Decided here": **DEC-P84AU5** "Call audio is never stored on our servers". Point at "In force", the reason, the author. | "Precedent keeps the team's decisions inside Jira, each with its reason. On this work item the team decided that call audio is never stored. Legal ruled recordings out. The panel shows who decided it and that it is still in force." |
| 3 | 0:55–1:30 | Open **MOBL-58** "Add call recording playback for supervisors". The flag appears: "An earlier decision touches this work. DEC-P84AU5 · Call audio is never stored on our servers." Then the panel block "Earlier decisions touch this work". | "Later, someone asks for call recording playback. Nobody searched for anything. Precedent raises a flag with the earlier decision and the reason behind it, before the work begins. Weaker matches are listed quietly as decisions in the same area, and never raise a flag." |
| 4 | 1:30–2:00 | Open **MOBL-36**. Add the comment: `Decision: we ship the mobile app weekly, because daily releases broke store review.` Reload. The panel shows "Is this a decision?" with the text and "Why: Daily releases broke store review." Click **Yes, record it**. | "Decisions are captured where they are made. I write a decision in a comment. Precedent proposes it, with the reason, and a person confirms with one click. Nothing is recorded without that confirmation." |
| 5 | 2:00–2:35 | home.atlassian.com/chat, agent picker, search "Precedent", pick **Precedent (Jira)**. Type: `I plan to save call recordings so supervisors can replay them later. Check my plan.` The answer lists DEC-P84AU5 and DEC-ZSPUND under "Conflicts" and suggests the 60-second in-memory buffer. | "The same memory is a Rovo agent. I describe a plan, and it checks it against the decisions in force. It says the plan contradicts two decisions, quotes their ids and reasons, and points to what the team allowed instead." |
| 6 | 2:35–3:20 | Terminal in `D:\MyMoney\precedent-demo` with Claude Code running; start recording after its welcome banner. Type: `Pick up MOBL-58: supervisors want to replay calls later. Save each monitored call's audio to storage and add a replay endpoint.` The agent calls `check-plan-against-decisions`, gets DEC-P84AU5 and DEC-ZSPUND, and stops: the plan contradicts DEC-P84AU5, and it offers to replay from the 60-second in-memory buffer instead. Type: `Yes, replay from the buffer.` It changes the code, runs the tests and asks to run `record-decision`; approve. Speed up the waits 2–4×. Then open MOBL-58: the new decision with the label "Recorded by an AI agent". | "And it is an MCP server, so any agent can use it. Here a coding agent picks up MOBL-58 and is asked to save call recordings. Before it writes any code, it checks the plan with Precedent, finds the decision that rules stored audio out, and stops to ask. I tell it to use the in-memory buffer instead. When it's done, it records that decision on the work item, labelled as recorded by an AI agent." |
| 7 | 3:20–3:35 | home.atlassian.com/search, query `call audio stored`. First result: "Decision DEC-P84AU5: Call audio is never stored on our servers". Keep the frame on the Rovo overview and the first result. | "Every decision is also published to Teamwork Graph, so Rovo Search finds it next to the rest of the team's work." |
| 8 | 3:35–3:50 | Back on **MOBL-36**: click **Mark as reversed** on the weekly-release decision, type "Store review is now automatic", click **Reverse decision**. Then the end card: name, tagline, "Built on Atlassian Forge". | "People stay in control. Only a person reverses a decision, and the reason is kept, so agents don't propose it again. Precedent: decisions that outlive the session." |

## Setting up scene 6

The agent works in `D:\MyMoney\precedent-demo`, a small "Mobile support console"
repository with a 60-second playback buffer. It holds three things a real team would
add: `.mcp.json` (the Precedent MCP server), `.claude/skills/precedent/SKILL.md` (the
skill from this repository) and `CLAUDE.md` (one line: use the precedent skill). The
code itself says nothing about stored audio being ruled out; only Precedent knows that.

Once:

1. Install Claude Code and sign in.
2. In `D:\MyMoney\precedent-demo` run `claude`, and approve the project's `precedent`
   MCP server when asked.
3. Type `/mcp`, choose **precedent**, then **Authenticate**. In the browser, choose the
   site **one-atlas-xmys** and accept.

One take, no rehearsal (to spare the Claude plan's usage limit):

- The search side is checked without the agent: with DEC-P84AU5 and DEC-ZSPUND as they
  are on the demo site, the task wording above and two other phrasings all return
  DEC-P84AU5 first and DEC-ZSPUND second (21 Nov 2026, local check of Precedent's
  ranking).
- Start Claude Code as `claude.cmd` (PowerShell blocks the `claude.ps1` wrapper on
  this machine). Before the take, press Shift+Tab until the footer reads "accept
  edits on": code edits then go through without prompts, while the Precedent calls and
  the test run still ask, so the approval of `record-decision` is on tape. In auto mode
  nothing asks.
- Start the screen recording before typing the task, so the one run is on tape.
- When the agent asks to run `check-plan-against-decisions`, allow it. When it asks to
  run `record-decision`, allow it: that writes the real decision to MOBL-58.
- What must hold: it calls the check before editing, names DEC-P84AU5, and stops to
  ask. If it does not, stop there, reset the repository (`git checkout .` and
  `git clean -fd`) and use the fallback below instead of a second run.

Done on 22 Nov 2026, one run: the agent loaded the skill, called the check, named
DEC-P84AU5 and stopped before writing code; after "Yes, replay from the buffer" it
added replay from the live buffer with tests (5 pass) and recorded **DEC-KF2SH9**
"MOBL-58 replay serves only the live in-memory buffer" on MOBL-58, shown there as
"Recorded by an AI agent". The reply was pasted twice in that run; trim it in the edit.
Do not run the scene again: it would record a second decision.

The screen recording of that run was lost, so scene 6 is a replay built from the
session log: `D:\MyMoney\precedent-video\scene6_agent.mp4` (37 s, 1920×1080). Its
header says "Replay of a real coding-agent session · 22 Nov 2026 · text from the
session log"; every line on screen is quoted from the log, with omissions marked "…",
and it ends on a capture of the real DEC-KF2SH9 card on MOBL-58. To rebuild it, run
`python tools\render_scene6.py frames` in `D:\MyMoney\precedent-video\scene6`, then the
ffmpeg concat step. The voice-over above fits it as written.

Fallback if the agent misbehaves on the day: the scripted client from the 10 Nov
rehearsal, `node scripts/mcp-smoke.mjs --demo MOBL-58`, with the old voice-over: "Here
an outside client makes the two calls a coding agent makes: it checks the plan before
starting, and records what was decided at the end."

## Notes

- The agent's answer in scene 5 is generated, so its wording changes between runs. In
  the rehearsal it named both decisions correctly. Record the take you like.
- Scene 7 uses Rovo Search, not the default Rovo Chat. Search finds decisions on the
  demo site; the default chat does not. The third result is "[REVERSED] Decision
  DEC-K2K829: Supervisor replay reads only the in-memory buffer", left from the
  rehearsal; keep it out of the frame so it is not mistaken for the decision scene 6
  recorded (DEC-KF2SH9).
- The contest rules ask that videos avoid third-party trademarks without permission.
  In scene 6, start recording after the agent's welcome banner and keep the frame on
  the conversation.
