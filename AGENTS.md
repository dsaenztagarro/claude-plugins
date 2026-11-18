# AGENTS.md

Instructions for AI agents working on this repository: the `dsaenztagarro` marketplace of Claude Code plugins.

## What lives here

- `.claude-plugin/marketplace.json` lists the plugins; each plugin is a directory under `plugins/` with its own `.claude-plugin/plugin.json` and `README.md`.
- `sdlc` is the delivery pipeline, `ds` the Claude Design handoff. They meet at one seam: `/sdlc:build`'s design gate calls `/ds:handoff`, and nothing in `ds` calls back.
- The project template the plugins read from is [agent-sdlc](https://github.com/dsaenztagarro/agent-sdlc). A change to a contract a plugin reads from an adopter's `AGENTS.md` lands there in a pull request of its own.

## Commands

```bash
claude plugin validate .
npm --prefix plugins/sdlc/dev ci && npm --prefix plugins/sdlc/dev test
npm --prefix plugins/sdlc/dev run typecheck
```

## Rules

- **Decision records** live in `docs/adr/`, one per theme, amended in place, following [agent-sdlc's convention](https://github.com/dsaenztagarro/agent-sdlc/blob/master/docs/adr/README.md). What ships, and how, is the distribution record.
- **The public boundary is a stranger's machine:** nothing here names a home-directory path, an employer, a tracker site, a product or a secret's location.
- **Tests are the specification** for the plugins' scripts and hooks.
- **Markdown prose is one line per paragraph** (or semantic line breaks), and diagrams are plain ASCII.

## Development workflow

One coherent change is one branch, in its own worktree, and one pull request with a Conventional Commit title, squashed with that title. The CHANGELOG follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and a release is cut with `/sdlc:release`.

Every pull request opens with `## Sequence`: its ticket, if any, the previous pull request and the next.
