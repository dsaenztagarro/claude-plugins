#!/usr/bin/env node

// The findings ledger of one build or review: every finding a checking agent
// reports gets an id, every fix round is opened here and counted per node, and
// an answer by id closes a finding. The guard reads it to decide whether a
// fixer may be dispatched and whether the session may stop.
//
// A checking agent writes each finding on a line of its own,
// `- [high|medium|low] <file>:<line>: <what>`; a recheck or the verifier
// answers an open one by its id, `F<n>: fixed|open|holds|refuted`. Only the
// session accepts one, leaving it unfixed: it leaves the rounds and stays under
// Still open with its reason.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RUNS = path.join('.sdlc', 'runs');
export const MAX_FIX_ROUNDS = 3;
const FINDING = /^\s*-\s*\[(high|medium|low)\]\s+(\S+):\s+(.+?)\s*$/i;
const ANSWER = /^\s*-?\s*(F\d+):\s*(fixed|open|holds|refuted)\b/i;

export type Event = { at: string; event: string } & Record<string, any>;
export interface Finding { id: string; node: string; severity: string; where: string; what: string; open: boolean; accepted?: string }

export class Ledger {
  readonly folder: string;
  readonly events: Event[];

  constructor(folder: string) {
    this.folder = folder;
    this.events = fs.readFileSync(path.join(folder, 'ledger.jsonl'), 'utf-8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
  }

  get key(): string {
    return path.basename(this.folder);
  }

  of(event: string): Event[] {
    return this.events.filter((e) => e.event === event);
  }

  append(event: string, fields: Record<string, unknown> = {}): Event {
    const entry: Event = { at: new Date().toISOString(), event, ...fields };
    fs.appendFileSync(path.join(this.folder, 'ledger.jsonl'), `${JSON.stringify(entry)}\n`);
    this.events.push(entry);
    return entry;
  }

  /** Open until closed or abandoned; starting it again reopens it, with its findings and rounds. */
  active(): boolean {
    return this.events.findLast((e) => ['start', 'closed', 'abandoned'].includes(e.event))?.event === 'start';
  }

  owner(): string | null {
    return this.of('claimed').at(-1)?.session ?? null;
  }

  claim(session: string): void {
    if (this.owner() !== session) this.append('claimed', { session });
  }

  findings(): Finding[] {
    const closed = new Set(this.of('answer').filter((e) => e.verdict === 'fixed' || e.verdict === 'refuted').map((e) => e.id));
    const accepted = new Map(this.of('accepted').map((e) => [e.id, e.why as string]));
    return this.of('finding').map((e) => ({
      id: e.id, node: e.node, severity: e.severity, where: e.where, what: e.what,
      open: !closed.has(e.id) && !accepted.has(e.id), ...(accepted.has(e.id) ? { accepted: accepted.get(e.id) } : {}),
    }));
  }

  accepted(): Finding[] {
    return this.findings().filter((f) => f.accepted !== undefined);
  }

  /** Leave an open finding unfixed, for a reason the user can overrule; false when it is not open. */
  accept(id: string, why: string): boolean {
    if (!this.open().some((f) => f.id === id)) return false;
    this.append('accepted', { id, why });
    return true;
  }

  /** The pull request body's Still open: the open findings, then the accepted ones with their reason. */
  stillOpen(): string {
    const lines = [...this.open(), ...this.accepted()].map(stillOpenLine);
    return lines.length ? lines.join('\n') : 'No finding is open.';
  }

  open(node?: string): Finding[] {
    return this.findings().filter((f) => f.open && (node === undefined || f.node === node));
  }

  /** Read a checking agent's output: a new finding gets an id, an answer by id closes or keeps an open one. */
  record(node: string, text: string): { added: Finding[]; answered: string[] } {
    const added: Finding[] = [];
    const answered: string[] = [];
    let count = this.of('finding').length;
    for (const line of text.split('\n')) {
      const answer = ANSWER.exec(line);
      if (answer) {
        const id = answer[1]!.toUpperCase();
        const verdict = answer[2]!.toLowerCase();
        if (this.open().some((f) => f.id === id) && !answered.includes(id)) {
          this.append('answer', { id, verdict });
          answered.push(id);
        }
        continue;
      }
      const m = FINDING.exec(line);
      if (!m) continue;
      const [, severity, where, what] = m as unknown as [string, string, string, string];
      if ([...this.open(node), ...added].some((f) => f.where === where && f.what === what)) continue;
      const id = `F${++count}`;
      this.append('finding', { id, node, severity: severity.toLowerCase(), where, what });
      added.push({ id, node, severity: severity.toLowerCase(), where, what, open: true });
    }
    return { added, answered };
  }

  rounds(node: string): number {
    return this.of('fix-round').filter((e) => e.node === node).length;
  }

  /** The round `round` opened that no fixer has taken yet, or null; withdrawn once its node has nothing open. */
  pending(): Event | null {
    const last = this.events.findLast((e) => e.event === 'round-pending' || e.event === 'fix-round');
    return last?.event === 'round-pending' && this.open(last.node).length ? last : null;
  }

  /** Why the node may not have another fix round, or null when it may. */
  refusal(node: string): string | null {
    if (!this.open(node).length) return `${node} has no open finding: there is nothing to fix.`;
    if (this.rounds(node) >= MAX_FIX_ROUNDS) {
      return `${node} has had its ${MAX_FIX_ROUNDS} fix rounds. List its open findings under Still open `
        + `(\`ledger.mts still-open ${this.key}\`) and carry on.`;
    }
    if (!this.progressSinceLastRound(node)) {
      return `${node}'s last fix round fixed none of its findings, so another would repeat it. Make sure the recheck `
        + 'answered each open id (`F<n>: fixed|open`) and was recorded; if it was, list them under Still open and carry on.';
    }
    return null;
  }

  /** Open the node's next fix round for one fixer to take; returns the refusal instead when it may not start. */
  openRound(node: string): { refused: string } | { brief: string } {
    const pending = this.pending();
    if (pending) return { refused: `A round for ${pending.node} is open: dispatch sdlc:fixer for it first.` };
    const refused = this.refusal(node);
    if (refused) {
      this.append('fix-refused', { node, why: refused });
      return { refused };
    }
    const round = this.rounds(node) + 1;
    this.append('round-pending', { node, round });
    const last = round === MAX_FIX_ROUNDS ? ', the last: dispatch it with `model: opus`' : '';
    return { brief: `${node}: fix round ${round} of ${MAX_FIX_ROUNDS}${last}.\n${this.open(node).map(stillOpenLine).join('\n')}` };
  }

  /** Whether the node's last fix round fixed any of its findings; true before its first round. */
  progressSinceLastRound(node: string): boolean {
    const last = this.events.findLastIndex((e) => e.event === 'fix-round' && e.node === node);
    if (last < 0) return true;
    const ids = new Set(this.of('finding').filter((e) => e.node === node).map((e) => e.id));
    return this.events.slice(last).some((e) => e.event === 'answer' && e.verdict === 'fixed' && ids.has(e.id));
  }

  /** What to do now, for a session that lost its place. */
  next(): string {
    if (!this.active()) return `Ledger ${this.key} is ${this.of('closed').length ? 'closed' : 'abandoned'}.`;
    const nodes = [...new Set(this.open().map((f) => f.node))];
    if (!nodes.length) return `No finding is open: close it with \`ledger.mts close ${this.key}\`.`;
    return nodes.map((node) => {
      const ids = this.open(node).map((f) => f.id).join(' ');
      const rounds = this.rounds(node);
      if (rounds >= MAX_FIX_ROUNDS) return `${node}: ${rounds} rounds spent; list ${ids} under Still open`;
      if (!this.progressSinceLastRound(node)) return `${node}: last round fixed none; list ${ids} under Still open`;
      return `${node}: round ${rounds + 1} of ${MAX_FIX_ROUNDS}${rounds + 1 === MAX_FIX_ROUNDS ? ', on opus' : ''}, for ${ids}`;
    }).join('\n');
  }

  /** Close the ledger once every open finding is named in the Still open text; returns the ids missing from it. */
  close(stillOpen: string): string[] {
    const missing = [...this.open(), ...this.accepted()].filter((f) => !new RegExp(`\\b${f.id}\\b`).test(stillOpen)).map((f) => f.id);
    if (!missing.length) this.append('closed');
    return missing;
  }
}

export const stillOpenLine = (f: Finding) =>
  `- ${f.id} [${f.severity}] ${f.node}: ${f.where}: ${f.what}${f.accepted === undefined ? '' : ` — accepted: ${f.accepted}`}`;

/** The nearest folder at or above cwd that holds `.sdlc/runs`, or null. */
export function root(cwd: string): string | null {
  for (let folder = path.resolve(cwd); ; folder = path.dirname(folder)) {
    if (fs.statSync(path.join(folder, RUNS), { throwIfNoEntry: false })?.isDirectory()) return folder;
    if (folder === path.dirname(folder)) return null;
  }
}

function toplevel(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return path.resolve(cwd);
  }
}

export function start(cwd: string, key: string): Ledger {
  const base = root(cwd) ?? toplevel(cwd);
  const folder = path.join(base, RUNS, key);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(base, '.sdlc', '.gitignore'), '*\n');
  fs.appendFileSync(path.join(folder, 'ledger.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event: 'start', key })}\n`);
  return new Ledger(folder);
}

export function find(cwd: string, key: string): Ledger | null {
  const base = root(cwd);
  if (base === null || !fs.existsSync(path.join(base, RUNS, key, 'ledger.jsonl'))) return null;
  return new Ledger(path.join(base, RUNS, key));
}

/** The active ledgers this session owns. */
export function forSession(cwd: string, session: string | undefined): Ledger[] {
  const base = root(cwd);
  if (base === null || !session) return [];
  return fs.readdirSync(path.join(base, RUNS))
    .filter((key) => fs.existsSync(path.join(base, RUNS, key, 'ledger.jsonl')))
    .map((key) => new Ledger(path.join(base, RUNS, key)))
    .filter((ledger) => ledger.active() && ledger.owner() === session);
}

const USAGE = 'usage: ledger.mts start <key> | node <key> <node> <output-file> | round <key> <node> | next <key> | still-open <key> | accept <key> <id> <why> | close <key> [<still-open-file>] | abandon <key> <why>\n';

export function main(argv: string[], cwd = process.cwd()): number {
  const [command, key, ...rest] = argv;
  const out = (text: string) => process.stdout.write(`${text}\n`);
  if (!command || !key) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (command === 'start') {
    const ledger = start(cwd, key);
    out(`Ledger ${ledger.key} recorded in ${ledger.folder}`);
    return 0;
  }
  const ledger = find(cwd, key);
  if (ledger === null) {
    process.stderr.write(`no ledger ${key} here: start it first, from the folder the session runs in\n`);
    return 2;
  }
  switch (command) {
    case 'node': {
      const [node, file] = rest;
      if (!node || !file) break;
      const { added, answered } = ledger.record(node, fs.readFileSync(file, 'utf-8'));
      const open = ledger.open();
      out(`${node}: ${added.length} new, ${answered.length} answered, ${open.length} open`);
      if (open.length) out(open.map(stillOpenLine).join('\n'));
      return 0;
    }
    case 'round': {
      if (!rest[0]) break;
      const result = ledger.openRound(rest[0]);
      if ('refused' in result) {
        process.stderr.write(`${result.refused}\n`);
        return 1;
      }
      out(result.brief);
      return 0;
    }
    case 'next':
      out(ledger.next());
      return 0;
    case 'still-open':
      out(ledger.stillOpen());
      return 0;
    case 'accept': {
      const [id, ...why] = rest;
      if (!id || !why.length) break;
      if (!ledger.accept(id.toUpperCase(), why.join(' '))) {
        process.stderr.write(`${id} is not an open finding of ledger ${key}\n`);
        return 1;
      }
      out(`${id.toUpperCase()} accepted; it stays under Still open.`);
      return 0;
    }
    case 'close': {
      const missing = ledger.close(rest[0] ? fs.readFileSync(rest[0], 'utf-8') : '');
      if (missing.length) {
        process.stderr.write(`still open and not listed: ${missing.join(' ')}. Name each under Still open in the pull request body, then pass that file.\n`);
        return 1;
      }
      out(`Ledger ${ledger.key} closed.`);
      return 0;
    }
    case 'abandon': {
      if (!rest[0]) break;
      ledger.append('abandoned', { why: rest.join(' ') });
      out(`Ledger ${ledger.key} abandoned.`);
      return 0;
    }
  }
  process.stderr.write(USAGE);
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
