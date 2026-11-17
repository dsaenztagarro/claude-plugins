---
name: amend
description: "Move new requirements that surface on near-ready work into the ticket or epic that owns them, so a clean session builds them. Use when reviewing an almost-ready PR turns up more scope, or when asked to extend a ticket or prepare work for a fresh session."
---

# Amend the tracker with new scope

New requirements often surface while an almost-ready PR is being analysed.
Building them in the same session goes badly twice over: the PR grows past the ticket it was reviewed against, and the long context gets compacted, which drops exactly the detail the new work needs.
The tracker is where the new scope lives, and a clean session builds it from there.

## 1. Split the scope

List each new requirement in one line.
For each one, check the current ticket's done-when:

- **Covered by the done-when:** it is current scope, and it gets finished here.
- **Not covered:** it goes to the tracker. A requirement for the current ticket that turns up after its PR is nearly ready still goes to the tracker; it does not grow the PR.
- **A real bug found along the way:** fix it here when it breaks what the current ticket delivers. Otherwise it gets its own issue.

## 2. Find each requirement's owner

- **A ticket whose scope the requirement extends, and that has not started:** amend that ticket.
- **No such ticket:** add the requirement as a row to the epic's plan. Create a sub-issue only when the user schedules it as its own change, and then one sub-issue for all the rows that ship together. Scope that needs an epic of its own is placed on the roadmap by `/sdlc:roadmap`.
- **A ticket the new requirements contradict** (a brief, a decision-record ticket, a dependency): amend only the lines that are wrong. Say where each correction came from.
- **Notes that cross tickets** go into the epic's plan section through `/sdlc:plan`, never as comments on each ticket.

**Confirm first.**
Invoking this skill authorises amending the current ticket and its epic.
Before creating an issue or editing any other ticket, list what will change and ask, unless the user named that ticket.

## 3. Write the ticket for a clean session

Its reader has the tracker and the repository, and never saw this conversation.
It holds, in this order:

- the `complexity · model · why` line;
- **Depends on**, plus the **entry criterion**: what must be true before anyone starts;
- **Context:** the current behaviour, read from source at a named commit, with an ASCII diagram marking what is wrong (`<-- the duplicate`);
- **Rules**, each one followed by the test that will hold it, named after the rule.
  Behaviour goes into tests, never into a decision record. A record changes only for a reason the code cannot state.
- **Tests**, which are the ticket's specification and, once built, its coverage:
  - the rule tests, one per rule, named for the rule, each with the realistic mistake that would fail it. A check earns its place by that mistake, so one with none is cut;
  - **End to end**: one named scenario per user flow, through the real path to the surface that shows the result, as the project's testing rule defines it. Existing scenarios the new scope changes are listed too, with what changes;
  - the mutation checks to record.

  Each test is stated by what it proves, never by where it lives: the file and the layer are decided while building, against the code as it stands then.

  The suite carries every name word for word, so `grep 'test "'` later reads back what the ticket asked for.
- **Work**, by area: the files and the existing functions to reuse, and any data-migration mapping as a table;
- **Done when**, **Verification** (commands, then the human acceptance steps), and **Out of scope**.

Strip conversation-speak ("as discussed", "your call"), local paths, status, and any narration of how the scope changed.
Where a design export or another input will decide a surface, say which one wins, and on what.

## 4. Publish

- **Read, splice, write.** Read the live description right before writing: `gh issue view N --json body --jq .body`. Change only what is yours to change, write it back with `gh issue edit N --body-file …`, then read it back and diff it.
- **A new issue** is linked under the epic as a sub-issue. On GitHub, use its numeric `id`, not its number:

  ```bash
  gh api repos/{o}/{r}/issues/N --jq .id
  gh api -X POST repos/{o}/{r}/issues/EPIC/sub_issues -F sub_issue_id=ID
  ```

- **The epic's order and dependency lines** are amended inside its implementation-plan section, as `/sdlc:plan` does it.
- **Jira:** follow the same steps through the Atlassian MCP server or `acli`.

## 5. Close the current scope

Commit what the current ticket covers; its evidence (fixes, mutation checks, suite and hook output) goes in the pull request's description, never on the ticket.
Leave the branch clean, so the next session starts from what is committed.

## 6. Hand off

Report:
- each ticket amended or created, as a link, with one line on what it now holds;
- the line that starts the clean session, for example `claude --worktree issue-<N>` and then `/sdlc:resume`;
- what the current PR still needs before it merges.

Recommend `/sdlc:pause` when the session ends.
Never run it from here: when to stop is the user's call.
