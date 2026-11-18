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

An epic is built the same way, one ticket after another.
Parallel writers buy wall-clock only, and pay for it in accuracy: tickets started together cannot see each other's code, so they make conflicting choices that need an alignment pass before and a coherence review after, and their branches need integrating.
A ticket built on the branch its predecessors already committed reads their code, so none of that is needed.
No path builds tickets in parallel: an epic that ever needs one for wall-clock gets that workflow written then, for that need.

## What it costs

A ticket: about ten subagents — clarify, design gate, builder, checker, rules when a rule matches, verifier, a fixer and a recheck per fix round, security when it runs, acceptance walk — plus what `/sdlc:review` runs.
An epic: one clarify and one design gate for the whole batch, then a builder, a checker, a rules agent, a verifier and the fix rounds per ticket, and one review and one walk for the batch's pull request.
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
A project with a design section needs the `ds` plugin: when `/ds:handoff` is not among the available skills, the run stops and names `claude plugin install ds@agent-sdlc`. Another plugin's skill of a similar name is never a stand-in: its rules are not this gate's.
Otherwise it reads the design names in `AGENTS.md` and the design checkout at its current revision, by the `ds` plugin's `/ds:handoff`, and gives each surface the ticket adds or changes one verdict:

- **drawn** — the page that draws it, for the builder to build to;
- **undrawn** — an ask, written by `/ds:handoff`'s rules for a brief;
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

### The agents

Each stage is one of the plugin's agents, dispatched fresh; the agent's file holds its constraints, its tools and its model, and the brief holds only the task.

| stage | agent | brief |
|---|---|---|
| build | `sdlc:builder` | the ticket key, the worktree and base, the tickets already built on the branch, the `DESIGN:` pages and parked lines, any decision to record |
| check | `sdlc:checker` | the ticket key, the branch and the commit the ticket started from — never the builder's report |
| rules | `sdlc:rules` | the base and the branch; skipped when no `.claude/rules/*.md` matches a changed file |
| security | `sdlc:security` | the base, the branch and the output of `/security-review`, which the session runs on the branch first; only when the checker says `security: yes` |
| verify | `sdlc:verifier` | the base, the branch and the findings by id |
| fix | `sdlc:fixer` | what `ledger.mts round` printed — the node, the round and its open findings by id — then the worktree and base |

For the first ticket the session creates the worktree with its branch cut from the freshly fetched base, or continued from the branch when one exists locally or on origin; every later ticket of a batch works in the same worktree, on the commits its predecessors left.
The checker and the rules agent start together after the builder; both are read-only.

### Findings converge or stop

Every checking agent writes each finding as `- [high|medium|low] <file>:<line>: <what>`. The plugin's ledger gives each an id and counts fix rounds per node; its hooks hold the rules below in the session that started it, so they survive a compaction.
Why: a recheck that re-reviews from scratch cannot tell a finding still open from a new one, so nothing shows whether the loop converges.

```
 ledger.mts start <ticket>
 checker + rules (+ security)  -> recorded by the hook as they finish     F1 F2 F3
 verifier on the new ids       -> recorded by the hook                  F2: refuted
 ledger.mts round <ticket> <node> -> opens the round, prints F1 F3
 fixer with that brief         -> one commit per finding
 recheck by that node's agent  -> F1: fixed  F3: open  (answers before anything new)
 ...at most 3 rounds per node, the third on opus
 ledger.mts still-open <ticket> -> the pull request body's "## Still open"
 ledger.mts close <ticket> <body-file>
```

- `ledger.mts` is `node ${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mts`; it needs Node 22.18 or later. Start the ledger in the folder the session runs in, before the builder, and put the run's worktree below that folder: the hooks find the ledger by walking up from where each tool call runs, so a worktree beside the repository leaves a fixer's push and the session's turn unguarded.
- The plugin's checking agents — checker, rules, security, verifier, walker — are recorded by a hook when each finishes, recheck answers included. Any other reviewer's output, such as a fresh review agent or `/code-review`, is recorded by the session: written to a file in the finding format and passed to `ledger.mts node <ticket> <node> <file>`. An answer not recorded is a round that fixed nothing.
- The ledger survives a compaction: the hook writes each open ledger's next step into the summary and into the context of the session that follows.
- Only findings that **hold** go to a fixer. Each round is opened by `ledger.mts round <ticket> <node>`, one at a time, and taken by one fixer with all of that node's open ids. A finding left unfixed by decision, the user's or the review's triage, is taken out first with `ledger.mts accept <ticket> <id> "<why>"`; it stays under Still open with its reason.
- `round` refuses a fourth round and a round after one that fixed none of the node's findings; the hook refuses a fixer with no round open, a third round not on opus, and the checker or the verifier on any model but opus. When either refuses, carry on: the findings go under Still open.
- `ledger.mts next <ticket>` says what is due, for a session that lost its place.
- A finding never holds the pull request. A security finding is never left open for cost: it goes to the user.
- A turn that ends while a ledger is open is held once, with what is due; ending it again waits, for an agent or a check, with the ledger kept. Close it once Still open names every open id, or `ledger.mts abandon <ticket> "<why>"` when the user stops the run or it is blocked on them.

### Gate and pull request, in the session

- Run the full gate in the worktree after each ticket, and quote its output: a red gate found one ticket later is blamed on the wrong ticket.
- Once every ticket of the run is built, push with `/sdlc:git-push`.
- Open one pull request: `## Sequence` first — the ticket or the epic, the previous pull request, the next; a Conventional Commit title; a body that compares with the base branch, says what each ticket does, carries the gate's output and the mutation checks, lists parked lines, and holds `## Still open` from the ledger. Then close the ledger.
- `Closes #N` for each ticket with nothing parked; otherwise `Part of #N`. An epic is never closed by the pull request.
- Wait for CI with the Monitor tool on `gh pr checks <n> --watch` (or the forge's equivalent), never by polling, and quote its result in the report. A run that outlasts Monitor's deadline is reported as unfinished, never as green.
- Never merge: a person does.

### When the run needs the user

Send a `PushNotification` whenever the run stops on the user — clarify questions, a security finding, a hook refusal that leaves something only they can decide — and when the pull request is ready to merge, so a run left alone does not wait unseen. It reaches the user only when they turned notifications on in `/config`; the question itself is still asked in the session.

## 5. Review

Invoke `/sdlc:review <PR>`.
This session orchestrated the build, so that skill's rule for a session that wrote the change applies as written: its review runs in a fresh agent, and this session keeps the walk, the triage and the fix rounds.

## 6. The acceptance walk

One `sdlc:walker`, whose brief carries the ticket keys, the pull request, the branch and the project's run command — no account of the change, which would hand it the builder's reading.
An epic's batch gets one walk over all its tickets, on the finished branch: a walk per ticket would retread the same screens, and would miss what a later ticket broke in an earlier one.

The session writes the result into the pull request body between `<!-- acceptance-walk:start -->` and `<!-- acceptance-walk:end -->`, with the head commit it walked.
A failure is a finding of node `walk`, in a ledger the session starts for the walk: it gets the fix rounds above, each followed by a re-walk, and one still failing goes under Still open for the user.

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
