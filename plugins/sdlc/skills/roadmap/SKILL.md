---
name: roadmap
description: "Say where a whole project stands across its epics, derived from the tracker, and keep its roadmap issue true; housekeep and audit on request. Use when asked what is done or next across epics, to close an epic, or to tidy or audit the roadmap."
argument-hint: "[status|housekeep|audit]"
---

# Keep the roadmap true

Progress is the tracker's state, never prose about it.
A roadmap that says "phase 5 is building" drifts the day phase 5 merges; a sub-issue's state cannot.
So this skill writes state, and derives every status line from it when asked.

## The state model

Three levels, each the sub-issues of the one above, so GitHub draws every progress bar from state alone:

```
 roadmap issue  --sub-issues-->  epics (in phase order)  --sub-issues-->  tickets
```

| A ticket is | when |
|---|---|
| **planned** | open, nothing merged for it, no open PR or branch |
| **building** | open, with an open PR or a pushed branch naming it |
| **shipped** | open, labelled `live-check`: merged, closed out by `/sdlc:close`, waiting only on a live check the user runs |
| **done** | closed |

An epic is **done** when it is closed, and it is closed only by housekeeping, below.
An epic whose open children are all `live-check` is **shipped**, and carries the label too.

- **The roadmap issue** is the one titled `[ROADMAP]` (or the project's equivalent named in its instructions). Its description holds the phases and why they are ordered so, its `## Implementation plan` section with each phase's order, and `/sdlc:pause`'s note. It holds no status.
- **The label** is created once: `gh label create live-check --color FBCA04 --description "Merged; open only on a live check the user runs"`.
- **Jira:** the same label; epics link to the roadmap through the parent field where the project has a level above epics, otherwise a `relates` link.

## Who owns what

Other tracker skills refer here rather than repeat it.

| Concern | Owner |
|---|---|
| a ticket's evidence and close; adding and removing `live-check` | `/sdlc:close` |
| the order inside an epic; each ticket's and PR's `## Sequence` | `/sdlc:plan` |
| new scope on near-ready work | `/sdlc:amend` |
| the order of epics; each epic's `## Sequence` and blocking links; epics hung under the roadmap; the roadmap's phase sections | **this skill** |
| closing an epic; collapsing a finished phase; retiring merged worktrees; the audit | **this skill**, `housekeep` |
| where a session stopped | `/sdlc:pause`, `/sdlc:resume` |
| a release once an epic closes | `/sdlc:release` |
| building a phase; closing its merged tickets | `/sdlc:build <epic>`, run again after the merge |

## 1. Status — the default, read-only

1. Find the roadmap: `gh issue list --search "[ROADMAP] in:title" --state all --json number,title`.
2. Its epics: `gh api repos/{o}/{r}/issues/R/sub_issues --paginate --jq '.[] | [.number, .state, .title, .sub_issues_summary.completed, .sub_issues_summary.total] | @tsv'`. Also list every issue labelled `epic` and report any that is not a sub-issue of the roadmap.
3. Per open epic, classify each child by the table above: `live-check` from labels, building from `gh pr list --state open --search "N in:body"` and `git branch -r`.
4. Print, phases in roadmap order:

   ```
   phase 5  Epic 18  #153  shipped   2/12 closed · 10 live-check          PR #179
   phase 7  Epic 20  #182  planned   0/24                                   <-- next
   phase 6  Epic 19  #172  planned   0/6   waits on #184
   ```

   then:
   - **Live checks waiting on you:** per epic, the tickets; the commands are in each one's closing comment.
   - **Mismatches:** an open epic with every child closed; an open ticket whose PR merged with no close run (it goes to `/sdlc:build`, which closes what a merged pull request carried); an epic not under the roadmap; an epic with no `## Sequence`, or one disagreeing with its neighbour or the roadmap's order; a roadmap phase table missing an epic.
   - **Next:** the first epic in roadmap order that is not done or shipped, provided the epic before it is done or shipped; its first ticket by its own plan.

Write nothing. Offer `housekeep` when there are mismatches.

## 2. Housekeep — writes, listed first and confirmed once

List every write the status implies, ask once, then make them.
Read, splice and write every description as `/sdlc:plan` does, and read it back.

1. **Hang every epic under the roadmap** in phase order (`gh api -X POST repos/{o}/{r}/issues/R/sub_issues -F sub_issue_id=<epic id>`). Give each epic a `## Sequence` at the top of its description — previous and next epic, its pull requests — as `/sdlc:plan` does for tickets. Epics in one phase are ordered for reading only: their Previous line says "order only" and they get no blocking link. A blocking link goes only where a later epic really waits on an earlier one, such as across a phase boundary that is a real dependency.
2. **Label shipped tickets.** `live-check` goes on an open ticket whose closing comment from `/sdlc:close` leaves only live checks unticked. An open ticket with merged work and no closing comment is not labelled: it is listed for a close run.
3. **Close finished epics.** An epic whose children are all closed is closed by `/sdlc:close`'s procedure applied to the epic: its done-when lines against the merged default branch, one closing comment. One whose open children are all `live-check` gets the label and stays open.
4. **Collapse finished phases.** When every epic of a phase is closed, its section of the roadmap's plan becomes one line: the epics, their PRs, the close date. A phase table in the roadmap's description lists every epic, each phase once; it never carries a state.
5. **Retire.** Worktrees and branches whose PR merged and whose tickets are closed: list them, then `git worktree remove <path>` and `git branch -d <b>` (never `-D`). A branch with commits the default branch lacks is reported, not removed.
6. **Release.** When an epic closes and the project tags releases, hand to `/sdlc:release`.

## 3. Audit — opt-in, after housekeeping closes an epic or a phase

Reviewing ticket by ticket rereads the same files and cannot see a concept built twice by two tickets, so the audit reads the code by subsystem.

1. **Map the subsystems** the closed epics' merged range touched (`git diff --stat <sha before the phase>..<base>`), and say how many there are: the audit costs one subagent per subsystem, so get the user's go-ahead.
   Launch them in one message. Each reads its subsystem through three lenses — idiom against how the industry builds that kind of part; one concept, one construct; and a sweep of the existing checks covering it, since a check earns its place by the realistic mistake that fails it — and returns each finding with its file, line, claim and fix. It edits nothing.
   **Refute each finding in this session** before keeping it: look for the code, test or decision record that makes it false. Keep the confirmed ones in a scratchpad file, never in the repository.
2. **Findings become tickets** under one standing epic, `Housekeeping — idiom and duplication`, created once, last on the roadmap, and reused by every later audit. Each finding is written as a ticket through `/sdlc:amend`'s procedure, after showing the list and confirming. Two findings fixed by one change are one ticket.
3. **An idiom ruling** that the project should keep, rather than fix, amends the decision record that owns the theme, as one line, so the next audit does not raise it again.
4. Delete the scratchpad file once its tickets exist. No audit leaves a report on disk or in the tracker beyond its tickets.

## 4. Report

The status block, then each write made as a link, then the one next action: a live check to run, a close run, an audit to approve, or the next epic's first ticket.
