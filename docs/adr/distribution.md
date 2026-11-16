# Distribution

**Status:** Accepted

How the kit — the delivery pipeline, the design skills and the tools around them — reaches a machine and a project, and what ships at all.

## Context

The kit lived in four places at once: a package deployed into each project, a private config repository copying user-level skills onto each machine, a private package draft that never went live, and hand-forked copies inside projects.
Each copy drifted in its own way, and an adopter could not tell which one was current.
It also grew by accretion: commands with identical bodies under two names, skills that restated a built-in command, and workflows that spent tens of agents where one session reached the same outcome.

## Decisions

### The kit ships as Claude Code plugins from this repository's marketplace

This repository is the public marketplace `agent-sdlc`, with two plugins: `sdlc`, the delivery pipeline, and `design`, the Claude Design handoff.
A plugin is installed once per machine, every project on that machine reads the same copy, and `claude plugin update` moves them all.
A project keeps only what is its own: its `AGENTS.md`, its path-scoped rules, and a skill only it uses.
A project never carries a copy of a plugin's skill or agent; what its copy did differently is a rule in its `AGENTS.md`.

### The public boundary is a stranger's machine

A skill ships here only if it works, and is safe to publish, on a machine that is not the maintainer's: no home-directory path, no employer, tracker site or product name, no secret's location.
Anything tied to one machine, employer or person ships from a private marketplace instead.
A workflow takes such a fact as a required argument, never a default.

### The namespace replaces the prefix

The plugin's name already says what a skill belongs to, so a skill drops the prefix it carried at user level: `/sdlc:plan`, not `/sdlc:tracker-plan`.
Two components of one plugin never share a name: a workflow named like a skill shadows it, and only one of them is listed.

### Plugins ship Workflow scripts

A plugin's `workflows/` directory is discovered like its skills, and a script is invoked by its `meta.name` under the plugin's namespace: `/sdlc:build-batch`.
A paused run is relaunched by that name on any machine with the plugin, so no script path has to be synced between machines.

### Only what earns its place ships

An item ships when nothing built in does its job, and its measured cost is worth its outcome.
A workflow stage that a later stage, or the calling session, already covers is removed rather than kept as a safety net.

## Rejected

- **APM packages deployed into each project.** Every project carried its own copy, and an update reached a project only when someone re-ran the install there.
- **Copying skills onto each machine from a config repository.** It is the same copy problem one level up, with no namespace and no version.

## Left open

- **A plugin per concern, such as a separate `git` or `release` plugin.** Reopens when a project wants one of the pipeline's skills without the rest.

## References

`claude plugin validate .` checks both manifests and every skill, agent and workflow they ship.
