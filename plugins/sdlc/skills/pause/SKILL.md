---
name: pause
description: "Write a \"Where I stopped\" note on the in-progress ticket, and secure any workflow runs in flight, so another session or machine can resume. Use when stopping for the day, switching projects or machines, or asked to pause, park or checkpoint work."
---

# Pause work on a ticket

A session's context dies with it.
What is worth keeping is small: where you were, what to do next, and whatever was learned but not yet recorded.
Write that onto the ticket, so `/sdlc:resume` can lead with it tomorrow and the session can be closed today.

## 1. Find the ticket

- Use the ticket the work is for: the one named in the conversation, the branch name, or recent commits (`#N`).
- **Work spanning several tickets,** such as planning an epic, pauses on the epic.
- **Work spanning several epics,** such as parallel batches of a roadmap, pauses on the issue they share: the roadmap, or the epic above them.
- **Work with no ticket** gets a proposed one — a title and a two-line body — filed only when the user confirms. A note with nowhere to live is lost.

## 2. Save what would otherwise be lost

Before writing the note, check each of these and tell the user:

- **Uncommitted work.** List it. Offer to commit it on the branch; never commit without asking.
- **A pushed branch with no pull request.** Offer a draft, so the work is visible from the ticket.
- **A conclusion that belongs in the ticket itself,** such as a corrected done-when line or a changed verification step. That is an amendment, made now and confirmed first. A pause note is not a place for rules.
- **A conclusion that belongs in a decision record or a test.** Name it as the next action, rather than parking it in prose.
- **The gate.** Note whether the project's hooks are installed on this machine (`git rev-parse --git-path hooks/pre-push` names a file that exists); a resume on another machine checks the same.
- **An open findings ledger.** `ledger.mts next <key>` for each one `/sdlc:build` or `/sdlc:review` started: the ledger lives on this machine's disk, so its open ids and rounds go into the note. Then abandon it with the pause as the reason, since the session that owns it is ending.

## 3. Secure the runs in flight

Skip this step when the session launched no workflow or background agent.
Otherwise follow [references/runs.md](references/runs.md) before writing the note: it stops or lands each run, pushes every branch it writes, and gives the note its **Runs** lines.

## 4. Write the note

Keep it short: whoever reads it has the ticket and the repository, and needs a direction, not a diary.
The note says where the session stopped, never where the project stands: that is `/sdlc:roadmap`'s status, derived from the tracker.

```
<!-- where-i-stopped:start -->
## Where I stopped

_Paused YYYY-MM-DD · branch `name` · last commit `abc1234`_

- **Doing:** the step reached, in one line.
- **Tests:** against the ticket's Tests section, which names are written and passing, and which are not yet written.
- **Next action:** one concrete action — a command to run or a file and function to open.
- **Uncommitted:** the files, or "nothing".
- **Gate:** hooks installed here, or which are missing.
- **Learned, not yet recorded:** facts found this session that no ticket, commit or record holds yet.
- **Open questions:** each with who has to answer it.
- **Findings:** only when a ledger was open. Per node, its rounds spent and the open ids, from `ledger.mts next` and `still-open`.
- **Runs:** only when step 3 ran. One line per run:
  `<what> · branch <b> · PR #P or none · <stage reached> · relaunch: <workflow name or script path> args=<json>`.
  Add one line listing the ticket branches pushed but not yet integrated.
<!-- where-i-stopped:end -->
```

- **A run's stage** comes from its log or a one-line digest of its `journal.jsonl`, such as `waves 1-3 integrated, #36 #37 left`. Never paste a run's report into the note.

- **Placement:** the note goes at the end of the ticket's description, before a trailing `---` footer if there is one, and after an `## Implementation plan` section.
- **Replace, never add.** Each pause replaces the section between the markers. There is only ever one note, and the tracker's edit history keeps the old ones.
- **Read, splice, write.** Read the live description immediately before writing (`gh issue view N --json body --jq .body`), change only what lies between the markers, write it back (`gh issue edit N --body-file body.md`), and read it back to check it landed. A description is replaced whole, so writing from a stale copy erases whatever changed since.
- **Jira:** the same section, through the Atlassian MCP server or `acli`. Check the markers survive a round trip; where they do not, bound the section with its heading and a closing horizontal rule instead.
- **Never write** a secret, a credential, or customer data into the note: a ticket is read by everyone who can see the tracker.

## 5. Report

Give the ticket link, the one next action, and anything from steps 2 and 3 still unresolved.
Then say the session can be closed: everything it needs tomorrow is on the ticket.
