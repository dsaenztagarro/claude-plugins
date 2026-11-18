# sdlc

The delivery pipeline on the issue tracker (GitHub Issues or Jira): plan, build, review, close and release, one ticket or one epic at a time.

```bash
claude plugin marketplace add dsaenztagarro/claude-plugins
claude plugin install sdlc@dsaenztagarro
```

Nothing in it names a project: what it needs to know, it reads from the adopter's `AGENTS.md`.

| | Does |
|---|---|
| `/sdlc:plan` | publishes a confirmed plan as a marked section of the epic, with the tickets it calls for |
| `/sdlc:build` | builds a ticket, or an epic's next batch one ticket at a time, to a reviewed and walked pull request, then closes it once merged |
| `/sdlc:review` | reviews a pull request, proves each finding by walking the product, fixes what pays for itself, and posts the rest on the pull request |
| `/sdlc:amend` | moves new scope on near-ready work into the ticket or epic that owns it |
| `/sdlc:close` | closes a ticket with evidence for each done-when line |
| `/sdlc:pause`, `/sdlc:resume` | leave and pick up a "Where I stopped" note on the ticket, including runs in flight |
| `/sdlc:release` | versions merged work from its Conventional Commit types, with a CHANGELOG entry and a tag |
| `/sdlc:roadmap` | says where the project stands across its epics, and housekeeps and audits on request |
| `/sdlc:git-push` | pushes with a rebase first, never forcing past a refusal |
| `/sdlc:template-feedback` | sends a reusable workflow improvement upstream, as one item on the template's open feedback issue |

A project with a product-owned UI also needs [`ds`](../ds/README.md): `/sdlc:build`'s design gate calls it, and stops when it is missing.

`/sdlc:build` and `/sdlc:review` dispatch the plugin's agents — builder, checker, rules, verifier, security, fixer, walker — each with its own tools and model, and keep a findings ledger whose hooks make fix rounds converge or stop. They need Node 22.18 or later. A session that never starts a ledger never runs Node. A code-intelligence plugin for the project's language gives the agents diagnostics and references through the LSP tool, and turning on push notifications in `/config` tells you when a run needs you.

Its tests: `npm --prefix plugins/sdlc/dev ci && npm --prefix plugins/sdlc/dev test`.

## The contract, by hand

Without the plugin, follow its contract by hand:

- **A plan is a marked section of the parent issue's description**, replaced in place when it changes.
- **Every ticket and every pull request opens with `## Sequence`:** the previous and the next.
- **One worktree per writer, one pull request per batch;** a person merges.
- **Review findings are threads on the pull request**, fixed one commit each.
- **A finding has an id, and a recheck answers it by id**, fixed or open; at most three fix rounds, none after a round that fixed nothing, and what is left is listed under Still open in the pull request.
- **A ticket closes only with evidence:** each done-when line against a named test or a command's real output; a live check an agent cannot run goes to a person as exact commands.
- **A release versions from the Conventional Commit types** since the last tag, into a CHANGELOG entry and an annotated tag.
