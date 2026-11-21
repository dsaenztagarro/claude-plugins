#!/usr/bin/env node

// What a skill takes from the user, checked before anything starts.
//
//   node item.mts mode
//   node item.mts parse <arg>
//   node item.mts resolve [--for build|review] <arg>
//   node item.mts check <owner/repo>...
//   node item.mts from-branch <branch>
//
// Every command runs from the session's folder. Prints the result, or the
// reason on stderr and exit 2. The logic is resolver.mts; this file only wires
// the adapters a session uses by default.
import { fileURLToPath } from 'node:url';
import { github } from './github.mts';
import { fromEnv, jira } from './jira.mts';
import { check, forms, fromBranch, mode, parse, resolve, type Ports, type Purpose } from './resolver.mts';

export function defaults(): Ports {
  const forge = github();
  return { trackers: [forge, jira(fromEnv())], forge };
}

const USAGE = 'usage: item.mts mode | parse <arg> | resolve [--for build|review] <arg> | check <owner/repo>... | from-branch <branch>\n';

export async function main(argv: string[], cwd = process.cwd(), ports: Ports = defaults()): Promise<number> {
  const [command, ...args] = argv;
  const out = (value: unknown) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  if (command === 'mode') out(mode(cwd));
  else if (command === 'parse' && args[0]) {
    const parsed = parse(args[0], ports);
    out('id' in parsed ? { tracker: parsed.tracker.name, id: parsed.id } : parsed);
  } else if (command === 'resolve') {
    const purpose = args[0] === '--for' ? args.splice(0, 2)[1] : 'any';
    if (!args[0] || !['build', 'review', 'any'].includes(purpose!)) {
      process.stderr.write(`${USAGE}${forms(ports)}\n`);
      return 2;
    }
    out(await resolve(args[0], { cwd, ...ports, for: purpose as Purpose }));
  } else if (command === 'check' && args.length) check(cwd, args, ports.forge);
  else if (command === 'from-branch' && args[0]) out(fromBranch(args[0], ports.trackers));
  else {
    process.stderr.write(USAGE);
    return 2;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err: Error) => {
    process.stderr.write(`item.mts: ${err.message}\n`);
    process.exit(2);
  });
}
