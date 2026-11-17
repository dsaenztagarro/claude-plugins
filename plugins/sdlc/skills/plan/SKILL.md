---
name: plan
description: "Publish a confirmed plan to the issue tracker (GitHub Issues or Jira) as a marked section of the epic, with the tickets it calls for. Use right after a plan is approved, or when asked to save, publish or update a plan or epic."
---

# Publish a plan to the tracker

The tracker is the only place a plan lives.
A plan file on disk becomes a second ledger: its status table drifts the first time someone closes an issue without editing it, and nobody picking up the work thinks to look there.
Plan mode's own file is scratch, not a record.

## 1. Find the tracker and the item

- **Which tracker.** A GitHub remote means GitHub Issues through `gh`. A Jira project named in the project's instructions means Jira, through the Atlassian MCP server or `acli`, whichever this session has. If neither tells you, ask. Never guess, and if the tracker has no tool here, stop and say so.
- **Which item.** This is the epic or ticket the plan is for, usually named in the conversation. If there is none, propose one with a title and body, and create it only when the user confirms. A new epic's place among the others — under the roadmap issue, its own `## Sequence`, its phase section — is `/sdlc:roadmap`'s.

## 2. Write it for the person who picks up the work

That reader has the tracker and the repository and never saw this conversation.

- **Keep:**
  - the context and why this approach was chosen
  - the entry criteria
  - the units of work, each mapped to its ticket: each unit is one coherent change and one pull request, and tickets from one analysis are merged into one unit, not kept as siblings
  - the tests to write, as each ticket's Tests section (the shape is below)
  - the verification level and procedure, and the human acceptance steps
- **A ticket's Tests section is its specification.**
  - It has two parts.
    - **The rules:** one `test "…"` per rule, named for the rule and not the mechanics, with the realistic mistake that would fail it beside it. A check earns its place by that mistake: one with no realistic mistake behind it is cut here, before anyone builds it.
    - **End to end:** one named scenario per user flow, through the real path to the surface that shows the result; the project's testing rule says what that path is.
  - **It says what each test proves, never where it lives.** The file and the layer are decided while building, against the code as it stands then. A location written in advance pushes the builder to force a test into a place a refactor has since made wrong.
  - **The same list does three jobs.** Before the code, it is the ticket's specification. Once built, it is the coverage: the suite carries every name word for word. Afterwards, `grep 'test "'` reads it back as the app's specification.
  - **A name is only renamed on purpose.** When a test changes its name during the build, the ticket's line changes with it, with the reason.
  - **Mutation checks:** name each one to record (which code to break, and which test must go red).
- **Strip:**
  - a list of critical files: it goes stale, and each ticket's agent finds its own
  - conversation-speak such as "your decision", "as discussed" or "after approval"
  - local paths nobody else can open, such as `~/…` or a scratchpad
  - any status table: status is the sub-issues' own state
  - any checklist of the epic's children: the sub-issues list is the index, and a hand-kept copy drifts from it the first time a child is added
  - any narration of how the plan changed
- Its headings start at `###`, since the section heading is `## Implementation plan`.

## 3. Publish it in the epic's description

The plan is a section at the **end of the epic's description**, never a comment.
`gh issue view` and Jira's epic view show the description; a comment is hidden or buried under later discussion.
The spec above it stays untouched.

```
<!-- implementation-plan:start -->
## Implementation plan

Progress is the sub-issues' state; this section holds the design and the order, and is replaced in place when either changes.

### Context
…
<!-- implementation-plan:end -->
```

- **Read, splice, write.** Read the live description immediately before writing (`gh issue view N --json body --jq .body`), replace only what lies between the markers, or, when there is no section yet, insert it before any `where-i-stopped` note and any trailing `---` footer. Then write it back (`gh issue edit N --body-file body.md`). Never write from a stale copy: a description is replaced whole, so a stale copy erases whatever changed since it was read.
- **Check it landed.** Read the description back, and compare it with what you wrote.
- **One plan, one epic.** The section is replaced, never duplicated. The tracker keeps the edit history, so the old wording is not lost.
- **Size.** GitHub caps a description at 65,536 characters. A plan that would not fit is too big for one epic: split the epic.
- **A single ticket with no epic** carries the plan in the same section of its own description.
- **Other sections belong to other skills.** The `where-i-stopped` note is `/sdlc:pause`'s; never touch it, or anything else outside the plan's markers.
- **Jira:** the same section in the epic's description, through the Atlassian MCP server or `acli`. Check the markers survive a round trip; where they do not, bound the section with its heading and a closing horizontal rule instead.

## 4. Make the tracker match the plan

- **A unit with no ticket** gets a new sub-issue, in the project's ticket template, linked under the epic, only when this plan schedules it to be built. Findings, triage rows and "maybe later" items are rows in the ticket or epic that owns them. Two units the plan would ship in one pull request are one ticket.
  - On GitHub, sub-issues take the issue's numeric `id`, not its number: `gh api repos/{o}/{r}/issues/N --jq .id`, then `gh api -X POST repos/{o}/{r}/issues/EPIC/sub_issues -F sub_issue_id=ID`.
- **A ticket the research contradicted** is amended before anyone builds from it: done-when, verification procedure, commands, with the source for each correction. Edit only the lines that are wrong.
- **Order** is the epic's sub-issues list in plan order, plus the tracker's blocking link for each real dependency, previous blocks next (on Jira, `createIssueLink` type `Blocks` with `inwardIssue` = previous and `outwardIssue` = next). Read the links first and add only what is missing. An order that is not a dependency gets no link. Write no neighbour section into a ticket or a pull request.
- **Confirm first.** Creating or editing an issue is outward-facing. An approved plan that lists the edit authorises it; for anything it does not list, confirm first.

## 5. Report

Give the links: the epic, each amended ticket, each new one.
Keep no local copy.
