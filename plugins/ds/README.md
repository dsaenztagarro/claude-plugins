# ds

The Claude Design handoff: design repositories, briefs, reading an export back and adopting it into the application.

```bash
claude plugin marketplace add dsaenztagarro/claude-plugins
claude plugin install ds@dsaenztagarro
```

Every name it reads — the design repository, its checkout, the artefact and its commands — comes from the block of names in the adopter's `AGENTS.md` design section; a name missing there is asked for, never guessed.

| | Does |
|---|---|
| `/ds:repo` | creates a design repository from one skeleton, or brings an existing one to the current skeleton |
| `/ds:handoff` | the Claude Design procedure: which repository is which, the routes into the design project, briefs, reading an export back; [`layout.md`](skills/handoff/layout.md) is a design repository's layout |
| `/ds:adopt` | vendors the design's one artefact under a revision stamp and digest ([`vendor-contract.md`](skills/adopt/vendor-contract.md)), reports what moved, and hands adoption to `curator` |
| `/ds:adopt-shared-release` | lands a shared design system's release in a product, deleting a stand-in only once the product's copy is current |
| `/ds:figma` | reads a Figma frame through the REST API when the Figma MCP refuses a call |
| `curator` (agent) | deletes the application's copies of what the design ships, and uses what it ships instead |
| `brief-closer` (agent) | verifies a brief's asks landed, then deletes or amends it |

[`sdlc`](../sdlc/README.md)'s `/sdlc:build` calls `/ds:handoff` at its design gate; nothing here calls back into the pipeline.
