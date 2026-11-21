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

## How to use it

### Where to start a session

A session runs in one of two places, and the plugin tells which by looking at the folder:

```
 a checkout                          a workspace
 ~/code/api/          <-- claude     ~/code/              <-- claude
   .git                                api/        one checkout per repository,
   ...                                 web/        each a sub-folder
                                       docs/
```

Either way, a run lives below that folder, with one worktree per repository it changes. Your own checkouts are never touched:

```
 <folder>/.sdlc/runs/<item>/ws/<repo>/
```

A GitHub issue belongs to one repository, and **a ticket changes only its own repository** unless its description has a `### Repositories` section listing every repository it changes, its own included:

```markdown
### Repositories

acme/api
acme/web
```

`/sdlc:plan` writes that section only for a ticket that needs it.

### Naming a ticket or a pull request

| Passed | Taken as | Where |
|---|---|---|
| `12`, `#12` | issue or pull request 12 of the checkout's GitHub origin | in a checkout |
| `<folder>#12` | issue or pull request 12 of that sub-folder's origin | in a workspace |
| `owner/repo#12` | that repository's issue or pull request | anywhere |
| `https://github.com/owner/repo/issues/12`, `…/pull/12` | that item | anywhere |
| `PROJ-123`, or its Jira browse URL | that Jira issue | when an `AGENTS.md` here names the project `PROJ` |

Anything else is refused with this table. A wrong kind is redirected to the right command: a pull request passed to `/sdlc:build` names `/sdlc:review` for it and `/sdlc:build` for the ticket it closes, and a ticket passed to `/sdlc:review` with no pull request yet names `/sdlc:build`. A bare number in a workspace is ambiguous, so it names every `<folder>#12` that exists. With no argument, `/sdlc:build` proposes the ticket your branch names, the ticket of an open pause note, and the roadmap's next batch, and asks.

### Every combination, with what to type

| Session started in | Ticket lives in | `### Repositories` | What happens |
|---|---|---|---|
| a checkout | that repository | none | one worktree, one pull request |
| a checkout | another repository | none | refused: start in that repository's checkout |
| a checkout | that repository | lists others | refused: names the folder holding them all to start in |
| a workspace | one of its checkouts | none | one worktree in that repository, one pull request |
| a workspace | one of its checkouts | lists others | one worktree and one pull request per repository, naming each other |
| a workspace | a repository not cloned there | any | refused: names the repository to clone |

**One repository, from its checkout:** the everyday case.

```
cd ~/code/api && claude
/sdlc:build 12            # builds issue 12 of acme/api to a reviewed pull request
/sdlc:review 40           # reviews pull request 40, if you want a review round on its own
/sdlc:build 12            # after you merge: closes ticket 12 out with evidence
```

**One repository, from a workspace:**

```
cd ~/code && claude
/sdlc:build api#12        # same ticket, named by its folder
/sdlc:review web#40
/sdlc:close api#12
```

**A ticket that spans repositories:** issue 30 in acme/api lists acme/api and acme/web under `### Repositories`.

```
cd ~/code && claude
/sdlc:build api#30        # one worktree and one pull request in each of api and web
```

**From a worktree of a checkout:** for example, one made by `claude --worktree`. A ticket for that repository runs there as in a checkout. A ticket that spans repositories names the folder that holds your checkouts, not the worktree's.

**Any repository, by its full name or URL:**

```
/sdlc:build acme/api#12
/sdlc:review https://github.com/acme/web/pull/40
```

### Short names

A plugin's skill also answers to its bare name when nothing else has that name. So `/build`, `/close`, `/amend`, `/pause`, `/release` and `/roadmap` reach this plugin's skills. Claude Code ships its own `/plan`, `/resume` and `/review`, so those three keep the prefix: `/sdlc:plan`, `/sdlc:resume`, `/sdlc:review`.

## The contract, by hand

Without the plugin, follow its contract by hand:

- **A plan is a marked section of the parent issue's description**, replaced in place when it changes.
- **Every ticket and every pull request opens with `## Sequence`:** the previous and the next.
- **One worktree per writer, one pull request per batch and repository;** a person merges.
- **A ticket changes its own repository,** unless a `### Repositories` section lists every repository it changes.
- **Review findings are threads on the pull request**, fixed one commit each.
- **A finding has an id, and a recheck answers it by id**, fixed or open; at most three fix rounds, none after a round that fixed nothing, and what is left is listed under Still open in the pull request.
- **A ticket closes only with evidence:** each done-when line against a named test or a command's real output; a live check an agent cannot run goes to a person as exact commands.
- **A release versions from the Conventional Commit types** since the last tag, into a CHANGELOG entry and an annotated tag.
