---
name: build
description: "Build a ticket, or an epic's next batch, to a pull request that is reviewed, walked and ready to merge, then close it once merged. Use when asked to build, implement or finish a ticket or an epic end to end, or to close it out after its PR merged."
argument-hint: "<ticket | epic>"
---

# Build a ticket or an epic to a ready pull request

A ticket fails in three places a build loop does not look: a requirement nobody stated, a surface nobody drew, and a rule the builder never read.
Each is cheapest before the code exists, so the first two stages run before anyone writes a line, and the third is part of every builder's brief.

The session is the conductor: it asks the user, writes to the tracker, runs the gate, pushes and opens the pull request.
It never writes the change itself, and every stage that judges the change runs in an agent that did not write it.
Why: a model misses most of the errors in its own output that it catches in someone else's, and an author reviewing its own work clears it.

## Why no workflow, and no parallel writers

A ticket has one writer and stages in a fixed order, two of them stopped by a person answering.
A workflow pays for parallel writers, their integration and replay of unchanged agent calls; a ticket uses none of them, and a run that has to wait for a person splits into several runs anyway.
Plain subagents also let the session hand the check's findings back to the builder that still holds the context.

An epic is built the same way, one ticket after another.
Parallel writers buy wall-clock only, and pay for it in accuracy: tickets started together cannot see each other's code, so they make conflicting choices that need an alignment pass before and a coherence review after, and their branches need integrating.
A ticket built on the branch its predecessors already committed reads their code, so none of that is needed.
No path builds tickets in parallel: an epic that ever needs one for wall-clock gets that workflow written then, for that need.

## What it costs

A ticket: about seven subagents — clarify, design gate, builder, checker, re-check, security when it runs, acceptance walk — plus what `/sdlc:review` runs.
An epic: one clarify and one design gate for the whole batch, then a builder, a checker and a re-check per ticket, and one review and one walk for the batch's pull request.
Say so when the run starts.

Every agent starts fresh with a brief, and returns a short digest; what it learns goes to the tracker or the commits.
The session keeps only digests, so a long epic does not grow its context with every ticket, and survives a compaction or a dead session through what the tracker holds.

## 0. Preflight

Stop, and say why, at the first of these that fails:

- **The tracker and the item** are found as `/sdlc:plan` finds them: never guessed. An item with child issues (sub-issues on GitHub, child issues on Jira), or labelled an epic, is an epic.
- **Its entry criteria are closed.** An open one names the ticket that closes it.
- **An epic has an implementation plan** in its description, giving the order of its tickets and the batches they ship in. With none, propose the order — dependencies first, each ticket after those whose code it needs — and publish it with `/sdlc:plan` once the user confirms it. The run builds the plan's next batch: its open tickets whose entry criteria are closed, in the plan's order.
- **The project's gate runs here:** the command its `AGENTS.md` names runs, and the hooks it installs are in place. A gate that cannot run cannot pass.
- **The main checkout is clean** and on the default branch: the builder cuts its worktree from a freshly fetched base.

## 1. Resume from what the tracker already holds

Each stage leaves its result where the next reader looks, so a run picks up where the last one stopped:

| found | skip to |
|---|---|
| a `CLARIFIED:` comment on the ticket, and no edit to its description since | 3 |
| also a `DESIGN:` comment that parks no line | 4 |
| an open pull request for the ticket | 5 |
| an acceptance-walk section in its body for the head commit | 7 |
| a merged pull request for the ticket | 8 |

For an epic, each row reads per ticket of the batch: clarification and the design gate skip only when every ticket has its comment, and a ticket with a `BUILT:` comment whose commits are on the batch branch is not built again.
A `DESIGN:` comment that parked lines sends the run back through the design gate, which finds whether the export has landed since.
A `Where I stopped` note from `/sdlc:pause` is read first, and wins where it disagrees.

## 2. Clarify, before any code

One fresh agent, read-only.
Its brief carries the ticket key, the repository path, the base branch and the checklist below — nothing of what this session thinks the ticket means.
It reads the ticket and its comments, its epic's plan, `AGENTS.md`, the decision records, `.claude/rules/` and the code the ticket touches.

The checklist:

- each done-when line can be proven by a test or a command as written;
- each name in the Tests section states a rule;
- every state the ticket implies but does not settle — empty, error, no permission, at the limit, recovery — has an answer;
- nothing in the ticket contradicts a decision record, a rule, the code as it stands, or the real `--help` and versioned docs of a tool it names.

It returns at most eight questions, each with why it blocks, two to four answers and the one it recommends.
A question whose every answer builds the same thing is dropped: unbudgeted, an agent over-asks, and each needless question costs the user more than the default it would replace.
No questions is a valid result.

The session asks them with `AskUserQuestion`, four at a time, recommended answer first.
Then, on the ticket:

- **amend only the lines an answer changes** — done-when, Tests, the verification steps; the user's answers authorise that edit and nothing more;
- **post one `CLARIFIED:` comment**, one line per question and its answer, so a later run and a later reader see that clarification ran;
- an answer that clears the decision-record bar is passed to the builder, which amends the theme's record.

A contradiction with a decision record is a question, never a silent amendment of either.

**An epic is clarified once, for its whole batch:** one agent reads every ticket of the batch and the epic's plan, and adds to the checklist the gaps between tickets — a name two tickets define differently, a state no ticket owns, an order the plan gets wrong.
It returns at most twelve questions for the batch, each naming the tickets it amends; the session asks them as above, amends each ticket an answer changes, and posts a `CLARIFIED:` comment on every ticket of the batch, even one with no questions.
Why once: questions asked ticket by ticket during the build stop the run once per ticket, and miss the gaps that only show between tickets.

## 3. The design gate

One fresh agent, read-only, given the clarified ticket.
A project whose `AGENTS.md` has no design section has no product-owned UI: the agent returns `no-ui` and stops.
Otherwise it reads the design names in `AGENTS.md` and the design checkout at its current revision, by the design plugin's `/design:design-handoff`, and gives each surface the ticket adds or changes one verdict:

- **drawn** — the page that draws it, for the builder to build to;
- **undrawn** — an ask, written by `/design:design-handoff`'s rules for a brief;
- **conflict** — the design and the codebase disagree: a localised one becomes a ticket comment, a structural one an ask.

The session then:

- adds each ask to its theme's open brief in the design repository, by that repository's own workflow, or opens a brief only for a theme none covers;
- **parks the done-when lines an undrawn surface needs**, and builds the rest: the parked lines wait for the export, since pasting a brief into Claude Design is a person's step;
- adds the ticket's checkbox for each ask leaving its brief;
- posts one `DESIGN:` comment: the verdict per surface, the pages to build to, and the parked lines.

**An epic passes the gate once, for its whole batch:** one agent gives every surface of every ticket its verdict, so a surface two tickets touch gets one verdict and one ask, and the session posts a `DESIGN:` comment on each ticket.
A ticket all of whose lines are parked leaves the batch, and any ticket that needs its code leaves with it.

## 4. Build

A ticket gets one branch.
An epic's batch gets one branch too, and its tickets are built on it **one at a time, in the plan's order**, each through the whole of this section — builder, checker, security, fixes, gate — before the next starts.
Each ticket gets a fresh builder and a fresh checker: a builder carried from one ticket to the next would bring a context that only grows, and its reading of the last ticket into the next.

```
 batch branch:  t1 build -> check -> fix -> gate -> BUILT: | t2 build (reads t1's code) -> ... | PR
```

After a ticket's gate passes, the session posts a `BUILT:` comment on it — its commits and its per-line tally — so a later run skips it.
When a builder reports that the code makes a later ticket's line wrong, the session posts a `QA:` comment on that ticket, which its builder reads; it never edits the later ticket's description during the run.
A ticket that still fails its gate after the fix rounds stops the batch: the tickets after it would build on a red branch. The pull request opens with what passed, and the report names where it stopped.

### The builder

One `general-purpose` agent working in the run's worktree: for the first ticket the session creates it with its branch cut from the freshly fetched base, or continued from the branch when one exists locally or on origin; every later ticket of a batch works in the same worktree, on the commits its predecessors left.
Its brief carries the ticket key, the base, the tickets already built on the branch, the `DESIGN:` comment's pages and parked lines, any decision to record, and these instructions:

- **Before writing or editing a file, read every `.claude/rules/*.md` whose `paths:` matches it, and the skill `AGENTS.md`'s routing table names for that kind of work, and follow them.** A path-scoped rule loads when a matching file is read, and a builder that creates a file without reading a neighbour never sees it.
- Read the ticket and its comments, including every `QA:` note: apply each or state why not.
- Write the tests the Tests section names, by those names; see them fail; implement; mutation-check the ones the ticket names.
- Amend the theme's decision record for a decision that clears the bar.
- Run the focused checks — the formatter, linter and type check on the changed files and the tests that cover them — and commit in the repository's style. Not the full gate: the session runs it once.
- Leave the parked lines alone, and name a line that depends on an unbuilt ticket as blocked, never faked.
- Final message: what was built in three sentences, the focused checks in one line, and the blocked lines.

### The checker

One fresh agent, read-only, given the ticket key, the branch and the commit the ticket started from — never the builder's report.

- Review the ticket's own commits (`git log -p <start>..HEAD`) adversarially, reading the earlier tickets' code only where this one depends on it: the project's conventions; tests that state rules and go red when the code they cover breaks — one mutation check on the changed lines, then restore and confirm `git status` is clean; nothing faked that should be real.
- **Hold each changed file to every rule whose `paths:` matches it**, quoting a broken rule with its file and line.
- Mark every done-when line: **done** with a named passing test or real output, **blocked** with the ticket it waits on, **missing** when buildable and not built or not proven.
- Return the problems, each with file, line and fix; the lines; and `security: yes` when the diff touches authentication or authorisation, input that reaches a query, shell, template or deserialiser, secrets or configuration, or dependencies.

### The security reviewer, only on `security: yes`

One fresh agent, read-only, started beside the checker's re-check.

- Run the static analysis and dependency audit the project's `AGENTS.md` names, and triage their output on the changed lines. Where it names none, say so and skip to judgment.
- Judge what tools cannot: who may reach each changed path, and what crosses each trust boundary the diff touches.
- Leave out what reviews of this kind report falsely far more often than truly: denial of service, rate limiting, input validation with no demonstrated impact, open redirects.
- Return each finding with file, line, the attack in one sentence and the fix.

Why a tool first: a scanner's recall and precision are measured, an agent's are not, and an agent triaging a scanner's output removes most of its false positives.

### Fix, at most twice

The session hands the checker's and the security reviewer's findings to **the same builder** with `SendMessage`; it fixes each with a test that fails first, and commits.
A fresh checker then re-checks the ticket's commits, fixes included.
After the second round, what is left goes into the pull request body as open, never into a third round: a check that still finds defects after one fix rarely converges on the next.
A security finding is never left open for cost: it goes to the user.

### Gate and pull request, in the session

- Run the full gate in the worktree after each ticket, and quote its output: a red gate found one ticket later is blamed on the wrong ticket.
- Once every ticket of the run is built, push with `/sdlc:git-push`.
- Open one pull request: `## Sequence` first — the ticket or the epic, the previous pull request, the next; a Conventional Commit title; a body that compares with the base branch, says what each ticket does, carries the gate's output and the mutation checks, and lists open problems and parked lines.
- `Closes #N` for each ticket with nothing parked; otherwise `Part of #N`. An epic is never closed by the pull request.
- Never merge: a person does.

## 5. Review

Invoke `/sdlc:review <PR>`.
This session orchestrated the build, so that skill's rule for a session that wrote the change applies as written: its review runs in a fresh agent, and this session keeps the walk, the triage and the fix rounds.

## 6. The acceptance walk

One fresh agent, with the Claude in Chrome tools, or for a product with no browser, its CLI or API driven as its user drives it.
Its brief carries the ticket keys, the pull request, the branch and the project's run command — no account of the change, which would hand it the builder's reading.
An epic's batch gets one walk over all its tickets, on the finished branch: a walk per ticket would retread the same screens, and would miss what a later ticket broke in an earlier one.

- Derive one scenario per done-when line that is not parked, one per human acceptance step, and one per end-to-end scenario in the Tests section.
- Run the application from the pull request's branch and walk each scenario through the product's own screens, with data a real user would plausibly have; a state seeded behind the product's back proves nothing.
- Record a GIF per scenario; read the console's errors and the failed network requests on every page; where the page allows a script, run axe on it.
- Return, per line: **pass**, **fail** with what the user meets, or **blocked** with its ticket, each with its evidence.

The session writes the result into the pull request body between `<!-- acceptance-walk:start -->` and `<!-- acceptance-walk:end -->`, with the head commit it walked.
A failure goes through one `/sdlc:review` fix round and one more walk; one still failing is reported to the user, not looped on.

## 7. Report

- the pull request URL, and per ticket and done-when line: done, blocked or parked;
- the review's rounds and its accepted edge cases, one line each;
- the open problems the checks left, and any security finding awaiting the user;
- the parked lines and the brief they wait on, and for an epic where the batch stopped;
- the next step: a person merges, then `/sdlc:build <ticket | epic>` again closes it out.

## 8. After the merge: close

A run that finds the pull request merged closes out instead of building.

- Run `/sdlc:close` on every ticket the pull request carried: it proves each line against the merged tree, and hands the live checks to the user.
- A ticket with parked lines stays open: once the export lands, `/sdlc:build <ticket>` builds them.
- For an epic, a batch left in its plan is the next run: report `/sdlc:build <epic>` as the next step. When every child is closed, the epic closes through `/sdlc:roadmap`, which owns closing epics with evidence.
