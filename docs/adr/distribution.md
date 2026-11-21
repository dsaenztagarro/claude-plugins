# Distribution

**Status:** Accepted

How the kit — the delivery pipeline, the design skills and the tools around them — reaches a machine and a project, and what ships at all.

## Context

The kit lived in four places at once: a package deployed into each project, a private config repository copying user-level skills onto each machine, a private package draft that never went live, and hand-forked copies inside projects.
Each copy drifted in its own way, and an adopter could not tell which one was current.
It also grew by accretion: commands with identical bodies under two names, skills that restated a built-in command, and workflows that spent tens of agents where one session reached the same outcome.

## Decisions

### The kit ships as Claude Code plugins from this repository's marketplace

This repository is the public marketplace `dsaenztagarro`, with two plugins: `sdlc`, the delivery pipeline, and `ds`, the Claude Design handoff.
They stay two because a project without a product-owned UI needs the pipeline and none of the design skills, and they meet at one seam: `/sdlc:build`'s design gate calls `/ds:handoff`, and nothing in `ds` calls back.
A public, project-agnostic plugin joins this marketplace with a `README.md` of its own in its directory; the root README indexes the plugins.
A plugin is installed once per machine, every project on that machine reads the same copy, and `claude plugin update` moves them all.
A project keeps only what is its own: its `AGENTS.md`, its path-scoped rules, and a skill only it uses.
A project never carries a copy of a plugin's skill or agent; what its copy did differently is a rule in its `AGENTS.md`.

### The plugins and the project template are two repositories

The marketplace is `dsaenztagarro/claude-plugins`; the template a project is created from is `dsaenztagarro/agent-sdlc`.
They change for different readers: a plugin moves every machine on `claude plugin update`, while the template is copied once into each new project and never updates in place.
Kept together, every adopter's first commit deleted the marketplace from its copy, and a plugin that is not about the delivery pipeline had no honest home.
The marketplace is named for its owner, not for one plugin, so installs read `sdlc@dsaenztagarro` and a new plugin joins without a rename; a generic name such as `claude-plugins` would read as Anthropic's own.
Workflow feedback from either goes to one `template-feedback` issue on the plugins repository, where the pipeline is maintained.

### The public boundary is a stranger's machine

A skill ships here only if it works, and is safe to publish, on a machine that is not the maintainer's: no home-directory path, no employer, tracker site or product name, no secret's location.
Anything tied to one machine, employer or person ships from a private marketplace instead.
A skill or script takes such a fact as a required argument, never a default.
A test holds what the plugins ship to that boundary: no home folder, no forge but GitHub, no owner but as the marketplace a plugin is installed from.

### A run lives below the folder the session started in

A session starts in one checkout, or in a workspace: a folder whose sub-folders are checkouts, one per repository.
Either way a run's worktrees sit in `.sdlc/runs/<item>/ws/<repo>` below it, where the findings ledger already is, so the hooks that find the ledger by walking up from a tool call guard every worktree, and the user's own checkouts are never written.
A GitHub issue belongs to one repository, so a ticket changes that repository alone unless a `### Repositories` section lists every one it changes; each gets its own worktree and pull request.
One checkout stays a first-class place to start, since most projects are one repository and a parent folder would buy them nothing.
Every skill that takes an item reads it through one script, `item.mts`, which refuses an argument it cannot use with every accepted form, or redirects a pull request passed for a ticket to the right command.

### The namespace replaces the prefix

The plugin's name already says what a skill belongs to, so a skill drops the prefix it carried at user level: `/sdlc:plan`, not `/sdlc:tracker-plan`.
Two components of one plugin never share a name: a workflow named like a skill shadows it, and only one of them is listed.

A plugin's name is never a generic word, and is checked against the official marketplaces' plugin lists before it ships: a call by `<plugin>:<skill>` is ambiguous on any machine where another plugin of the same name is installed.
A name is short, since every call types it, and kebab-case; `claude plugin validate` rejects a third party's `claude-` or `anthropic-` prefix.
The design plugin is `ds`, after the `<project>-ds` design repository it works on, not `design`: Anthropic's knowledge-work marketplace ships a `design` plugin with its own `design-handoff` skill, and a marketplace plugin outranks a synced one of the same name, so one would hide the other.

### A plugin can ship Workflow scripts, and ships none until real use needs one

A plugin's `workflows/` directory is discovered like its skills, and a script is invoked by its `meta.name` under the plugin's namespace, so a paused run is relaunched by name on any machine with the plugin.
The pipeline ships none: `/sdlc:build` builds an epic one ticket at a time with plain subagents, since parallel writers buy wall-clock only and pay for it in alignment, coherence review and integration, and `/sdlc:review` splits a large change into one fresh reviewer per pull request.
A workflow is written when real use shows a need these cannot hold, for that use.

### `sdlc` ships agents, two hooks and one Node script, to make fix rounds converge

Every stage that judges a change is a plugin agent whose file fixes its tools and model: the checker and the verifier run on opus, a different model from the builder and the fixer whose work they check.
Every checking agent writes a finding as `- [high|medium|low] <file>:<line>: <what>`; a verifier refutes each before any fix spends work on it, as Anthropic's own review plugins do; and a path-scoped rules agent holds each changed file to the `.claude/rules/` that match it, since a rule loads only when a matching file is read.

A findings ledger numbers each finding, records a recheck's answer by id, and counts fix rounds per node.
Its hooks hold, in the session that started a ledger only: three rounds per node, none after a round that fixed nothing, the third on opus; no plugin agent pushes or merges; a turn ending while a ledger is open is held once, since holding every stop would block each wait for an agent or a check.
They also record each checking agent's report as it finishes, so a session that forgets to record one loses no finding, and carry each open ledger's next step through a compaction.
Why hooks rather than skill text: a session that compacts mid-loop keeps "fixing review findings" and drops the round count, and the next round then runs past the cap on the model that already failed; the ledger on disk survives that, and a hook refuses the round.
A session below no `.sdlc/runs` folder never starts Node, so a project that never builds through the plugin pays nothing.
The plugin needs Node 22.18 or later, which runs the TypeScript directly; its tests and type check live in `plugins/sdlc/dev/`, so an install receives no dependency.

### The pipeline uses what Claude Code already ships

A stage reaches for a built-in before writing its own: `/security-review` feeds the security reviewer, the LSP tool gives the writing and checking agents diagnostics and references where a code-intelligence plugin is installed, the Monitor tool waits for CI instead of a polling loop, and a push notification tells the user when a run stops on them.
Two are kept out on purpose: `isolation: worktree` branches from the default branch, where an epic builds on its batch branch, and `/code-review --fix` would apply fixes outside the ledger's rounds.
`/simplify` and `/run` are left out until it is shown that the model can invoke them, which their documentation does not say.

### Only what earns its place ships

An item ships when nothing built in does its job, and its measured cost is worth its outcome.
A workflow stage that a later stage, or the calling session, already covers is removed rather than kept as a safety net.

## Rejected

- **APM packages deployed into each project.** Every project carried its own copy, and an update reached a project only when someone re-ran the install there.
- **`sdlc` declaring `ds` in its `plugin.json` `dependencies`.** It would install the design skills on every machine, UI or not; the design gate instead stops and names the install command when a project with a design section lacks the plugin.
- **Copying skills onto each machine from a config repository.** It is the same copy problem one level up, with no namespace and no version.
- **Depending on the `ralph-loop` plugin for the Stop hook.** It feeds one prompt back until a promised phrase appears, where a build is a pipeline of different nodes, and it would be a second install on every machine; the ledger copies its shape, a state file and a short Stop hook.

## Left open

- **A plugin per concern, such as a separate `git` or `release` plugin.** Reopens when a project wants one of the pipeline's skills without the rest.
- **A forge other than GitHub.** The skills and `item.mts` drive `gh`; an issue in Jira is resolved, but its pull requests are GitHub's. Reopens when an adopter on another forge asks.
- **Hooks that enforce the pipeline's order:** no pull request before the checks finished, no push before the gate is green. A push guard is only as sound as the gate result it reads, and the gate is a command in each project's `AGENTS.md` that records nothing; until then the forge holds the order, with branch protection, required checks and draft pull requests. Reopens when `sdlc` has a gate that records its own result against HEAD.

## References

`claude plugin validate .` checks both manifests and every skill, agent and workflow they ship.
`npm --prefix plugins/sdlc/dev test` states the ledger's and the hooks' rules.
