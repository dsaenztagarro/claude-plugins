---
name: review
description: "Review a pull request, or a ticket's or epic's pull requests, prove each finding by walking the running product, fix what pays for itself, and post the rest on the pull request. Use when a change is complete, before merging."
argument-hint: "<PR# | ticket | epic> [level]"
---

# Review a pull request on the pull request

A pull request is where its defects are fixed.
A finding goes there, on the line it concerns, and is fixed on the branch before the merge.
A new issue for a defect in work that has not merged yet splits the fix from the change that needs it, and the merge stops meaning anything.

A code review reads code and guesses at failures; only the running product shows which are real.
A failure the walk cannot reach with what a real user would do is an edge case the product accepts: chasing every one costs more delivery than it ever saves a user.

A review is worth what it costs in the loop: findings that arrive after an hour and a large token bill are worth less than the same findings in five minutes.
So the cost scales with the change, and the default is the cheap path.
The same holds for fixing: a fix is worth the failure it prevents, weighed against what it costs to build, test and review.

## 1. Find the pull request

The argument is a pull request (number or URL), a ticket or epic key, or nothing.

- **A pull request:** review that one.
- **A ticket:** its pull requests are the ones that close it: `gh pr list --state all --search "<N> in:body"`, and on Jira the issue's development panel.
- **An epic:** the open pull requests of its children.
- **Nothing:** use the pull request of the current branch: `gh pr view --json number,url`, or the forge's equivalent.

With no open pull request, stop and say so. A review needs a change to comment on, and there is none to review yet.

## 2. Review: pick the path by size, not by forge

**Direct review — the default.** One pull request, or one ticket whose work sits in one or two pull requests, whatever the forge.

1. Read the requirements once: the ticket's done-when and its Tests section. They are already the catalogue; do not rebuild one.
2. Read the whole diff (`git diff <base>...HEAD`) and, around it, only the code the diff's risky branches depend on: a changed query, a new constraint and every writer it binds, a filter whose callers changed meaning, a removed reader's callers.
3. Check each done-when line against the diff and a named test. A line with no test is a finding; a test the ticket names but the diff lacks is a finding.
4. Refute each finding yourself: look for the code or test that makes it false, and drop it if you find one.
5. Do not re-run the gate. Cite CI on the head commit, or the run the author recorded on the ticket or the PR; run it only when neither exists for this commit.

On GitHub, `/code-review <level> <PR>` may do steps 2–4 for you, at `medium` unless the user names a level. Leave out `--comment`: its findings are candidates for step 3, not yet something to post.

**When this session wrote, planned or discussed the change, steps 1–4 run in one fresh agent.**
Why: an author reads the diff through what it meant the code to do, and an author refuting its own findings clears its own work; a review that came back clean that way proves nothing.
- Its prompt carries only the pull request, the ticket key, the base branch and the steps above: no summary of the change, no view of what is fine, no list of where to look. A brief that carries the author's reading brings the anchoring back with it.
- It refutes its own findings, and returns each surviving one with its file, line, claim and the failure a user would meet. It posts nothing and fixes nothing.
- The session keeps the walk, the triage, the fixes and the posting: findings from outside can be fixed by the author.
- A later round after a fix round is again a fresh agent, since this session wrote those fixes.
A session that met the change only by being asked to review it is already independent and reviews directly.

**The workflow — only when the direct path cannot hold the change.** An epic, or a ticket spanning three or more repositories, or design sources (Figma frames, documents) whose requirements are not already in the ticket.
It extracts requirements from every source, traces them per area across the repositories and refutes each gap with a fresh agent, so it costs a dozen agents or more: say so and get the user's go-ahead before launching.
Launch it as `/sdlc:review-epic` with `ticket`, `scratch`, `tracker` (required: the tracker and its site), and `repos` with each repository's `pr` URL. Pass `publish: false`: the workflow then posts nothing, skips its Verify phase because step 3's walk refutes the same gaps, and leaves its gaps in `<scratch>/gaps.json`, the candidates for step 3. It does not run the gate unless you pass `runSuites: true`, which you do only when neither CI nor the author has run it on the head commit. Put the project's standing decisions (what is deliberately not a finding) and the triage rules of step 4 in `context`.

## 3. Reproduce each finding in the product

Every finding that claims something goes wrong for a user is walked before it counts.
Walk the pull request's branch in a real browser — Claude in Chrome — or, for a product without one, by driving it the way its user does: its CLI, its API, its smoke suite against the real stub.
When a peer session that walks the product is running (`ListAgents`), ask it: an independent walk is not anchored on the review's reasoning.

- **Reach the failure the way a user would:** through the product's own screens or commands, with data a real user would plausibly have. Seeding a state the product never lets anyone create, a console call, or a forced race does not count as reproducing it.
- **An efficiency claim** is walked too: the server log, the query count or the timing on a realistic page shows it or does not.
- **Reproduced:** the finding is demonstrated, and its evidence is the steps and what the walk showed. A test that fails on the branch for a reason a user meets counts as well.
- **Not reproduced**, because the walk shows the product behaving or cannot reach the state: speculative.
- **A security hole or a loss of data** is never excluded on the walk alone: report it and let the user decide.
- **A finding that claims no failure** — a simplification, a duplication — is not walked. Keep it only when it is cheap and in lines the pull request adds; otherwise drop it.

## 4. Triage: fix the 20% that brings 80% of the value

Each finding gets two marks, and the pair decides what happens to it.

- **Cost:** cheap (a few lines and a test, in the files the PR already touches) or costly (a new mechanism, a schema or contract change, another repository, a redesign of what the PR built).
- **Evidence:** demonstrated or speculative, from step 3.

| | Demonstrated | Speculative |
|---|---|---|
| **Cheap** | fix it | fix it only if it is in lines the PR adds, else an accepted edge case |
| **Costly** | fix it | an accepted edge case: not fixed, with what would make it real |

- A finding that already existed on the base branch is reported, not fixed, whatever its marks: the PR finishes its own change.
- An accepted edge case is not posted as a finding, not fixed and not ticketed, and is not raised again in a later round. The summary names it in one line, with what would make it real, so the user can overrule; then it goes through `/sdlc:amend`.
- When a fix grows past what its marks promised, stop, revert it, and mark the finding costly.

## 5. Rounds: review, fix, review again, at most four

1. **Review round:** steps 2–4 on the branch's current head. A later round reviews the whole PR again, but posts only findings that are new: not one already fixed, accepted or reported.
2. **Fix round:** on the PR's branch, each fix-it finding gets a test that fails first, then the fix, one commit per finding. Run the project's gate once for the round, push with `/sdlc:git-push`, and reply on each finding's thread with the commit and resolve it.
3. **Stop** when a review round leaves nothing to fix, or after the fourth fix round. Whatever a fifth review would still need goes into the last summary for the user, unfixed.
4. **Learn,** when the project's instructions name a step that turns fixed findings into rules: once the rounds stop, run it on the pull request and the findings fixed in it, with each one's commit.

## 6. Where each kept finding goes

Post a round's kept findings through the forge: on GitHub one review, `gh api repos/<owner>/<repo>/pulls/<n>/reviews` with a comments array; on another forge, one inline comment per finding through its CLI or API, then one summary comment. Each carries the claim, its reproduction, its marks and whether it will be fixed.

- **A line in the diff:** an inline comment on that line, on the pull request.
- **No line in the diff** (a missing test, a requirement not built): the round's summary. The ticket gets a `QA:` comment only when there is no pull request yet.
- **Scope that would outlive the pull request:** ask the user, then hand it to `/sdlc:amend`. Never open an issue for a finding on your own.

## 7. Report

Give, per pull request: the review URL, the rounds run, and per round the counts fixed, accepted and reported, with the commits each fix round pushed.
When a learn step ran, add its output's link and one line per fixed finding: the rule it produced, or why it taught nothing.
End on what is left: one line per accepted edge case, with why the walk could not reproduce it and what would make it real.
