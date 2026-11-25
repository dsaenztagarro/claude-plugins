---
name: resume
description: "Pick a project back up from the pause note on its ticket, check it against git and the tracker, and brief the next action. Use when starting a session, when asked what's next or where we are, or before starting a ticket. Read-only unless confirmed."
---

# Resume work from the tracker

A new session starts with nothing, and that is the point: what matters from the last one was written down by `/sdlc:pause`, on a ticket.
You read that note first, check it still holds, and brief.
You change nothing without confirmation.

## 1. Find where you stopped

- Look for open tickets carrying a pause note: `gh search issues --repo {owner}/{repo} --state open "Where I stopped" in:body --json number,title,updatedAt`. In a workspace (`node ${CLAUDE_PLUGIN_ROOT}/scripts/item.mts mode` prints `workspace`), run it for the repository of each checkout. Read each one's section between `<!-- where-i-stopped:start -->` and `<!-- where-i-stopped:end -->`.
- If there is more than one, the most recently paused leads; list the others in one line each.
- **Jira:** the same search through the Atlassian MCP server or `acli`.
- **With no note,** say so in one line and go straight to step 3, scoped to the epic the current branch or recent commits reference. If there is none, run `/sdlc:roadmap`'s status and take its next epic; if the project has no roadmap issue, ask.

## 2. Check the note against reality

A note describes the moment it was written. Before trusting it, compare:

- **The branch:** is it the one checked out, and does it still exist?
- **Uncommitted files:** are they what the note lists, or did something change or disappear?
- **Commits since the pause date:** did someone, perhaps you on another machine, move on?
- **The ticket:** is it still open? Did its pull request merge?
- **The gate:** are the project's hooks installed in this checkout? If not, the first action is installing them.

Report each difference plainly. A note that no longer holds is not an error; it is the first thing to tell the user.

## 2a. Rebuild the runs the note lists

Skip this step when the note has no **Runs** line.
Otherwise follow [references/runs.md](references/runs.md): it rebuilds each run's worktree from its pushed branch and classifies the run for the brief.

## 3. Read the project

- **The epic:** `gh issue view N --json title,body,state,labels`. That includes the `## Implementation plan` section of its description, which holds the order and the design.
- **Its children:** `gh api repos/{o}/{r}/issues/N/sub_issues --jq '.[] | [.number, .state, .title] | @tsv'`. For each open child, read its done-when checklist and verification level.
- **The pull requests** that reference each child: `gh pr list --state all --search "N in:body"`.
- **Git:** branch, uncommitted changes, `git log --oneline -10`.

## 4. Reconcile

Report every mismatch between the tracker and reality, within the epic. Fix none of them without asking.
Mismatches across epics — an epic not under the roadmap, an open epic with every child closed, shipped tickets with no `live-check` label — are `/sdlc:roadmap`'s: name it rather than list them here.

- a closed ticket with a done-when line that neither its merged pull request nor a `/sdlc:close` comment proves
- an open ticket whose pull request merged
- a ticket being worked while its entry criteria or a lower verification level are still open
- code on the branch that no ticket asked for
- an epic whose description carries a checklist of its children, which the sub-issues list already is
- an epic whose sub-issue order disagrees with its plan, or a blocking link the plan does not name

## 5. Brief

Lead with the pause, because it is what the user came for:

- **You were on:** the ticket, the step, and **the next action**, exactly as the note gives it.
- **Open questions** the note carries, and who answers each.
- **Changed since:** the differences from step 2, if any.
- **Runs:** one line per paused run with its class from step 2a, and the relaunches awaiting the user's go-ahead.
- **Findings:** the note's open ids and rounds spent. A resumed build or review runs `ledger.mts start` with the same key: on the machine that paused it, that reopens the ledger with its findings and rounds; on another, it starts empty, a recheck records the findings still open before any fix round, and a node the note shows at its cap goes straight under Still open.

Then the project:

- **Progress:** N of M children closed and K shipped (`live-check`), from the tracker.
- **Shipped:** one line per closed child, with its pull request.
- **Mismatches:** from step 4, if any.
- **Next ticket:** if the paused one is finished, the next open sub-issue in the plan's order, provided its entry criteria are closed; otherwise the first ticket in the plan's order whose are. Give:
  - its rule
  - its done-when
  - its verification level and procedure
  - the tests to write first: the ticket's Tests section, rule tests and end-to-end scenarios, copied word for word as the names in the suite. That list is the specification to build to, and the coverage `/sdlc:close` will check name by name.

End with the one thing to do now, as a command or a file to open.
Leave the pause note in place: it is replaced by the next `/sdlc:pause` and removed by `/sdlc:close`, so a session that dies early loses nothing.
