# claude-plugins

My Claude Code plugins, published as the `dsaenztagarro` marketplace.

```bash
claude plugin marketplace add dsaenztagarro/claude-plugins
```

| Plugin | Does | Install |
|---|---|---|
| [`sdlc`](plugins/sdlc/README.md) | the delivery pipeline on the issue tracker: plan, build, amend, review, close, pause, resume, release and roadmap | `claude plugin install sdlc@dsaenztagarro` |
| [`ds`](plugins/ds/README.md) | the Claude Design handoff: design repositories, briefs, reading an export back and adopting it | `claude plugin install ds@dsaenztagarro` |

Each plugin's README lists its skills and agents.
A plugin is installed once per machine, never copied into a project: every project on the machine reads the same copy, and `claude plugin update` moves them all.

The project template these plugins read from, `AGENTS.md` and its routing table, the bounded decision records and the testing rule, is [agent-sdlc](https://github.com/dsaenztagarro/agent-sdlc).

## Developing

```bash
claude plugin validate .                                   # both manifests, every skill and agent
npm --prefix plugins/sdlc/dev ci && npm --prefix plugins/sdlc/dev test
npm --prefix plugins/sdlc/dev run typecheck
claude --plugin-dir plugins/sdlc                           # try a plugin from this checkout
```

## License

[MIT](LICENSE) © David Saenz
