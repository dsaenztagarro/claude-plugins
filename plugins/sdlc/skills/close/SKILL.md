---
name: close
description: "Close a finished ticket with evidence: each done-when line against a named test or real command output, live checks handed to the user. Use when a merged PR did not close its ticket, or when asked to mark a ticket done or close it."
---

# Close a ticket with evidence

**A closed ticket is a claim that its rule holds.**
Close only what you can show; leave open what you cannot, and name what is missing.
Several tickets are closed one at a time, each against its own evidence, and reported together.

## 1. Read

Each ticket named resolves with `node ${CLAUDE_PLUGIN_ROOT}/scripts/item.mts resolve <argument>`; on exit 2, show its message and stop.

- The ticket's done-when, Tests section, verification level and procedure, parent epic, and the pull requests or commits that did the work.
- The comments that resolved its rows, when its done-when is a table resolved in comments.
- **Close against the merged default branch,** never a feature branch: the evidence is about what shipped.

## 2. Evidence

- **A rule:** a test named for it exists on the default branch and passes. Run it.
- **The Tests section, name by name:** each name exists word for word (`grep -rn 'test "<name>"'`) and passes.
  - A missing name keeps the ticket open.
  - A name changed after the ticket was written goes in the comment's `Renamed` field.
  - Mutation checks are cited from the PR or the ticket, or run now.
- **A command or behaviour:** run the procedure and quote its real output, trimmed.
- **Lower levels first:** the project's whole gate is green before any ticket closes.
- **Cite, do not re-run,** a gate, test or mutation check recorded against the exact tree that merged. A record against an earlier tree is cited as such, and the named tests are run on the tip.
- **A live check you cannot run** (the user's session, credentials, a device) stays unticked, goes to the user as exact commands with expected output, and is never reported as passed.
- **A row whose outcome needs judgement** — a decision that covers it by category but not by number — is closed on that reading and named in `Judged`, so the user can overturn it.

## 3. Tracker

- Tick only lines with evidence.
- **All ticked:** remove the `where-i-stopped` section (read the live description, cut between the markers, write it back), then close, or on Jira transition to done.
  A pause note left on a closed ticket sends `/sdlc:resume` back to finished work.
- **Anything unticked:** leave it open with its pause note.
- **Only live checks unticked:** label it `live-check`, the shipped state in `/sdlc:roadmap`'s model, so it no longer reads as unbuilt. Remove the label when the ticket closes.
- **How to test it:** add or replace a section in the ticket's description between `<!-- how-to-test:start -->` and `<!-- how-to-test:end -->`, before any implementation-plan or `where-i-stopped` section, so the user can verify the ticket by hand and learn the feature from it.
  Each scenario gives its purpose, its commands from the repository root on the default branch, and the real output you saw. A step the project's rules forbid you to run is marked "run it yourself", and a "Not testable yet" list names each blocked line with its ticket.
  Read the description right before writing, change only this section, and read it back.
- **Leave the epic's description alone:** its plan section is `/sdlc:plan`'s, and progress is the sub-issues' state.
  Closing the epic is `/sdlc:roadmap`'s housekeeping; when this was the epic's last open child, say so in the report.

### The comment

None when the PR's closing reference closed the ticket and nothing is renamed, judged or missing.
Otherwise one comment, only the fields that have a value, in this order:

```
Closed by #<PR>, #<PR>.
Rows: <n> tested · <n> to open issues (#<N>, …) · <n> deferred (#<N>) · <n> dropped
Renamed: row <r> → `<current test name>` (#<PR that renamed it>)
Judged: row <r> → <outcome>, by <the decision's category>
Missing: `<test name>` is not in the suite
```

`Closed by` becomes `Open:` with the reason when the ticket stays open.

## 4. Retire the inputs

An input the ticket says is deleted once its surface ships — a design brief, a review, a scratch document — is deleted now, or handed to the agent the project names for it, once its durable half is in a test, a record or a guide.

## 5. Report

One block per ticket, the same fields, then the batch's shared lines once:

```
#<N> closed — comment <link>
  Ran: <files>, <runs> runs, <failures> failures (<branch> <sha>)
  Judged: row <r> → <outcome>
Gate: <cited from #<PR> | run: <result line>>
Live checks: <none | the commands handed to the user>
Next: #<N>
```

A field with nothing to say is left out; `Live checks` and `Next` always appear.
When the epic has no open child left that is not `live-check`, name `/sdlc:roadmap housekeep` as the next step.
