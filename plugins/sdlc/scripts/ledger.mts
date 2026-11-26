#!/usr/bin/env node

// The findings ledger of one build or review: every finding a checking agent
// reports gets an id, every fix round is opened here and counted per node, and
// an answer by id closes a finding. The guard reads it to decide whether a
// fixer may be dispatched and whether the session may stop.
//
// A checking agent writes each finding on a line of its own,
// `- [high|medium|low] <file>:<line>: <what>`. A low one is a note: it is
// kept, three per node at most, and never verified, fixed or rechecked.
//
// The verifier answers an open finding by its id: `F<n>: holds`,
// `F<n>: refuted — <file>:<line> ...`, which is ignored without that location,
// or `F<n>: needs-design — <question>`, which keeps it out of the fix rounds
// as a question for the user. A report that answers an id of its node's last
// fix round is that round's recheck: `F<n>: fixed|open` count there, for
// the ids the round carried, and a finding it adds is not recorded, so
// the set a loop works on only shrinks. Only the session accepts a finding, leaving it
// unfixed: it leaves the rounds and stays under Still open with its reason.
//
// A round records each worktree's content hash. One in which no content moved
// fixed nothing, whatever its recheck answers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RUNS = path.join('.sdlc', 'runs');
export const MAX_FIX_ROUNDS = 3;
export const MAX_NOTES = 3;
const FINDING = /^\s*-\s*\[(high|medium|low)\]\s+(.+?):\s+(.+?)\s*$/i;
const ANSWER = /^\s*-?\s*(F\d+):\s*(fixed|open|holds|refuted|needs-design)\b[\s—–:-]*(.*?)\s*$/i;
/** A path and a line: a name with an extension, or a path with a folder, never a time, a port or a URL. */
const LOCATION = /(?<![\w/:.-])\/?(?:(?:[\w.-]+\/)+[\w.-]+|[\w-]+(?:\.[\w-]+)*\.[A-Za-z]\w*):\d+/;

export type Event = { at: string; event: string } & Record<string, any>;
export interface Finding {
  id: string; node: string; severity: string; where: string; what: string;
  /** Neither fixed, refuted nor accepted; a note is never open. */
  open: boolean;
  accepted?: string;
  /** The verifier's question for the user, which keeps an open finding out of the fix rounds. */
  question?: string;
  note?: true;
}
/** A worktree's content hash by its path. */
export type Trees = Record<string, string>;

/** Git's own message, for a refusal that quotes it. */
export class GitFailure extends Error {}

function git(worktree: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  try {
    return execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf-8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error: any) {
    throw new GitFailure(`git ${args[0]} in ${worktree}: ${String(error.stderr ?? '').trim() || error.message}`);
  }
}

/** The tree of everything in the worktree, committed or not, built in an index of its own so the worktree's is untouched. */
export function contentHash(worktree: string): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-index-'));
  try {
    const index = git(worktree, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
    if (fs.existsSync(index)) {
      fs.copyFileSync(index, env.GIT_INDEX_FILE);
      // Git trusts a cached entry only when the file is older than the index. A copy is newer than
      // its original, so it gets the original's time, floored: a file edited in that second is hashed again.
      const written = Math.floor(fs.statSync(index).mtimeMs / 1000);
      fs.utimesSync(env.GIT_INDEX_FILE, written, written);
    }
    git(worktree, ['add', '-A'], env);
    return git(worktree, ['write-tree'], env);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** The checkout and every worktree git links to it that is still on disk. */
function linkedWorktrees(checkout: string): string[] {
  const listed = git(checkout, ['worktree', 'list', '--porcelain']).split('\n')
    .filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
  return [checkout, ...listed.filter((worktree) => fs.existsSync(path.join(worktree, '.git')))];
}

const isCheckout = (folder: string) => fs.existsSync(path.join(folder, '.git'));

const folders = (parent: string): string[] =>
  !fs.existsSync(parent) ? [] : fs.readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(parent, entry.name)).sort();

const sameTrees = (a: Trees, b: Trees) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class Ledger {
  readonly folder: string;
  readonly events: Event[];

  constructor(folder: string) {
    this.folder = folder;
    // A line cut short by a crash is skipped: one bad line must not fail every hook that reads the ledger.
    this.events = fs.readFileSync(path.join(folder, 'ledger.jsonl'), 'utf-8').split('\n').filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Event];
        } catch {
          return [];
        }
      });
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
    const verified = new Map(this.of('answer').filter((e) => e.verdict === 'holds' || e.verdict === 'needs-design').map((e) => [e.id, e]));
    return this.of('finding').map((e) => {
      const note = e.severity === 'low';
      const open = !note && !closed.has(e.id) && !accepted.has(e.id);
      const question = open && verified.get(e.id)?.verdict === 'needs-design' ? verified.get(e.id)!.question as string : undefined;
      return {
        id: e.id, node: e.node, severity: e.severity, where: e.where, what: e.what, open,
        ...(accepted.has(e.id) ? { accepted: accepted.get(e.id) } : {}),
        ...(question === undefined ? {} : { question }),
        ...(note ? { note: true as const } : {}),
      };
    });
  }

  /** The low findings: kept for the pull request's Notes, and never verified, fixed or rechecked. */
  notes(node?: string): Finding[] {
    return this.findings().filter((f) => f.note && (node === undefined || f.node === node));
  }

  /** The pull request body's Notes. */
  notesText(): string {
    const lines = this.notes().map(stillOpenLine);
    return lines.length ? lines.join('\n') : 'No notes.';
  }

  /** The open findings the verifier turned into a question for the user. */
  questions(): Finding[] {
    return this.open().filter((f) => f.question !== undefined);
  }

  /** The node's open findings a fixer may take: every one but a question. */
  fixable(node: string): Finding[] {
    return this.open(node).filter((f) => f.question === undefined);
  }

  /** The node's findings refuted or accepted: one reported again keeps its id instead of reopening. */
  dismissed(node: string): Finding[] {
    const refuted = new Set(this.of('answer').filter((e) => e.verdict === 'refuted').map((e) => e.id));
    return this.findings().filter((f) => f.node === node && (refuted.has(f.id) || f.accepted !== undefined));
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

  /**
   * Read a checking agent's output. A report that answers an id of the node's last fix round `fixed` or `open`
   * is that round's recheck, whole or in part, first or repeated: its answers count for the round's ids, and
   * a finding the report adds is ignored. Any other report is a check: it adds findings, and only a verifier's
   * verdict counts in it.
   */
  record(node: string, text: string): { added: Finding[]; answered: string[]; ignored: number; recheck: number | null } {
    const last = this.lastRound(node);
    const ids: string[] = last ? last.ids ?? this.open(node).map((f) => f.id) : [];
    const rechecks = text.split('\n').some((line) => {
      const answer = ANSWER.exec(line);
      return answer !== null && /^(fixed|open)$/i.test(answer[2]!) && ids.includes(answer[1]!.toUpperCase());
    });
    const round: Event | null = last && rechecks ? { ...last, ids } : null;
    const added: Finding[] = [];
    const answered: string[] = [];
    let ignored = 0;
    let count = this.of('finding').length;
    let moved: boolean | undefined;
    for (const line of text.split('\n')) {
      const answer = ANSWER.exec(line);
      if (answer) {
        const id = answer[1]!.toUpperCase();
        const evidence = answer[3]!;
        let verdict = answer[2]!.toLowerCase();
        if (!this.open().some((f) => f.id === id) || answered.includes(id)) continue;
        if (round && !round.ids.includes(id)) continue;
        if (!round && (verdict === 'fixed' || verdict === 'open')) continue;
        if (verdict === 'refuted' && !LOCATION.test(evidence)) continue;
        if (verdict === 'needs-design' && !evidence) continue;
        if (verdict === 'fixed' && !(moved ??= this.movedSince(round!))) verdict = 'open';
        this.append('answer', { id, verdict, ...(verdict === 'needs-design' ? { question: evidence } : evidence ? { evidence } : {}) });
        answered.push(id);
        continue;
      }
      const m = FINDING.exec(line);
      if (!m) continue;
      if (round) {
        ignored++;
        continue;
      }
      const [, level, where, what] = m as unknown as [string, string, string, string];
      const severity = level.toLowerCase();
      if ([...this.open(node), ...this.dismissed(node), ...this.notes(node), ...added].some((f) => samePath(f.where, where) && f.what === what)) continue;
      if (severity === 'low' && this.notes(node).length >= MAX_NOTES) continue;
      const id = `F${++count}`;
      this.append('finding', { id, node, severity, where, what });
      added.push({ id, node, severity, where, what, open: severity !== 'low', ...(severity === 'low' ? { note: true as const } : {}) });
    }
    if (round && answered.length) this.append('recheck', { node, round: round.round, ignored });
    return { added, answered, ignored, recheck: round ? round.round as number : null };
  }

  rounds(node: string): number {
    return this.of('fix-round').filter((e) => e.node === node).length;
  }

  /** The node's last fix round a fixer took, or null. */
  lastRound(node: string): Event | null {
    return this.events.findLast((e) => e.event === 'fix-round' && e.node === node) ?? null;
  }

  /** The ids a recheck has answered `fixed` or `open` since the node's last fix round. */
  rechecked(node: string): string[] {
    const from = this.events.findLastIndex((e) => e.event === 'fix-round' && e.node === node);
    return from < 0 ? [] : this.events.slice(from).filter((e) => e.event === 'answer' && (e.verdict === 'fixed' || e.verdict === 'open')).map((e) => e.id);
  }

  /**
   * Where this ledger's fixers work: the run's own worktrees, `ws/<repo>` below it. A ledger with none, such as a
   * review's or a walk's, fixes where the change already is: every other run's worktrees, and the checkout that
   * holds the ledger or the workspace's checkouts, each with its linked worktrees.
   */
  worktrees(): string[] {
    const own = folders(path.join(this.folder, 'ws'));
    if (own.length) return own;
    const runs = path.dirname(this.folder);
    const base = path.dirname(path.dirname(runs));
    const checkouts = isCheckout(base) ? [base] : folders(base).filter(isCheckout);
    return [...new Set([
      ...folders(runs).flatMap((run) => folders(path.join(run, 'ws'))).filter(isCheckout),
      ...checkouts.flatMap(linkedWorktrees),
    ])];
  }

  /** Each worktree's content hash; throws GitFailure when git cannot say. */
  trees(): Trees {
    return Object.fromEntries(this.worktrees().map((worktree) => [worktree, contentHash(worktree)]));
  }

  /** Whether any worktree's content differs from what the round recorded when it opened; a git failure moves nothing. */
  movedSince(round: Event): boolean {
    if (!round.trees || !Object.keys(round.trees).length) return true;
    try {
      return !sameTrees(round.trees, this.trees());
    } catch (error) {
      if (error instanceof GitFailure) return false;
      throw error;
    }
  }

  /** The round `round` opened that no fixer has taken yet, or null; withdrawn once its node has nothing to fix. */
  pending(): Event | null {
    const last = this.events.findLast((e) => e.event === 'round-pending' || e.event === 'fix-round');
    return last?.event === 'round-pending' && this.fixable(last.node).length ? last : null;
  }

  /** Hand the pending round to a fixer; false when none is open. */
  take(model: string | null = null): boolean {
    const pending = this.pending();
    if (!pending) return false;
    this.append('fix-round', { node: pending.node, round: pending.round, ids: pending.ids, trees: pending.trees, model });
    return true;
  }

  /** Why the node may not have another fix round, or null when it may. `trees` are the worktrees' hashes now. */
  refusal(node: string, trees: Trees = {}): string | null {
    if (!this.fixable(node).length) return `${node} has no open finding: there is nothing to fix.`;
    if (this.rounds(node) >= MAX_FIX_ROUNDS) {
      return `${node} has had its ${MAX_FIX_ROUNDS} fix rounds. List its open findings under Still open `
        + `(\`ledger.mts still-open ${this.key}\`) and carry on.`;
    }
    const last = this.lastRound(node)?.trees as Trees | undefined;
    if (last && Object.keys(last).length && sameTrees(last, trees)) {
      return `No worktree's content moved in ${node}'s last fix round, so another would repeat it. `
        + 'List its open findings under Still open and carry on.';
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
    let trees: Trees;
    try {
      trees = this.trees();
    } catch (error) {
      if (!(error instanceof GitFailure)) throw error;
      return this.refuse(node, `${node}'s round cannot open, since git could not hash a worktree's content: ${error.message}`);
    }
    const refused = this.refusal(node, trees);
    if (refused) return this.refuse(node, refused);
    const round = this.rounds(node) + 1;
    const findings = this.fixable(node);
    this.append('round-pending', { node, round, ids: findings.map((f) => f.id), trees });
    const last = round === MAX_FIX_ROUNDS ? ', the last' : '';
    return { brief: `${node}: fix round ${round} of ${MAX_FIX_ROUNDS}${last}.\n${findings.map(stillOpenLine).join('\n')}` };
  }

  private refuse(node: string, why: string): { refused: string } {
    this.append('fix-refused', { node, why });
    return { refused: why };
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
    if (!this.open().length) {
      const accepted = this.accepted().map((f) => f.id);
      return accepted.length
        ? `${accepted.join(' ')} accepted: list them under Still open from \`ledger.mts still-open ${this.key}\`, then \`ledger.mts close ${this.key} <body-file>\`.`
        : `No finding is open: close it with \`ledger.mts close ${this.key}\`.`;
    }
    const nodes = [...new Set(this.open().filter((f) => f.question === undefined).map((f) => f.node))];
    const lines = nodes.map((node) => {
      const ids = this.fixable(node).map((f) => f.id).join(' ');
      const rounds = this.rounds(node);
      if (rounds && !this.rechecked(node).length) return `${node}: recheck of round ${rounds} due, for ${ids}`;
      if (rounds >= MAX_FIX_ROUNDS) return `${node}: ${rounds} rounds spent; list ${ids} under Still open`;
      if (!this.progressSinceLastRound(node)) return `${node}: last round fixed none; list ${ids} under Still open`;
      return `${node}: round ${rounds + 1} of ${MAX_FIX_ROUNDS}, for ${ids}`;
    });
    const questions = this.questions().map((f) => f.id);
    if (questions.length) {
      lines.push(`${questions.join(' ')}: needs design; ask the user, then have the verifier answer again with the ticket amended, `
        + 'or accept it. Unanswered, it stays under Still open as a question');
    }
    return lines.join('\n');
  }

  /** Close the ledger once every open finding is named in the Still open text; returns the ids missing from it. */
  close(stillOpen: string): string[] {
    const missing = [...this.open(), ...this.accepted()].filter((f) => !new RegExp(`\\b${f.id}\\b`).test(stillOpen)).map((f) => f.id);
    if (!missing.length) this.append('closed');
    return missing;
  }
}

export const stillOpenLine = (f: Finding) =>
  `- ${f.id} [${f.severity}] ${f.node}: ${f.where}: ${f.what}`
  + `${f.accepted === undefined ? '' : ` — accepted: ${f.accepted}`}${f.question === undefined ? '' : ` — needs design: ${f.question}`}`;

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

/** A key names one folder under `.sdlc/runs`, even when it is an `owner/repo#N` reference: the hooks read only its children. */
const folderOf = (key: string) => key.replace(/[\\/]/g, '-');

export function start(cwd: string, key: string): Ledger {
  const base = root(cwd) ?? toplevel(cwd);
  const folder = path.join(base, RUNS, folderOf(key));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(base, '.sdlc', '.gitignore'), '*\n');
  fs.appendFileSync(path.join(folder, 'ledger.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event: 'start', key })}\n`);
  return new Ledger(folder);
}

export function find(cwd: string, key: string): Ledger | null {
  const base = root(cwd);
  if (base === null || !fs.existsSync(path.join(base, RUNS, folderOf(key), 'ledger.jsonl'))) return null;
  return new Ledger(path.join(base, RUNS, folderOf(key)));
}

/** The active ledgers below the nearest folder that holds runs, whoever started them. */
export function activeLedgers(cwd: string): Ledger[] {
  const base = root(cwd);
  if (base === null) return [];
  return fs.readdirSync(path.join(base, RUNS))
    .filter((key) => fs.existsSync(path.join(base, RUNS, key, 'ledger.jsonl')))
    .map((key) => new Ledger(path.join(base, RUNS, key)))
    .filter((ledger) => ledger.active());
}

/** The active ledgers this session owns. */
export function forSession(cwd: string, session: string | undefined): Ledger[] {
  return session ? activeLedgers(cwd).filter((ledger) => ledger.owner() === session) : [];
}

const USAGE = 'usage: ledger.mts start <key> | node <key> <node> <output-file> | round <key> <node> | next <key> | still-open <key> | notes <key> | accept <key> <id> <why> | close <key> [<still-open-file>] | abandon <key> <why>\n';

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
      const { added, answered, ignored, recheck } = ledger.record(node, fs.readFileSync(file, 'utf-8'));
      const open = ledger.open();
      out(recheck === null
        ? `${node}: ${added.length} new, ${answered.length} answered, ${open.length} open`
        : `${node}: recheck of round ${recheck}, ${answered.length} answered, ${ignored} new ignored, ${open.length} open`);
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
    case 'notes':
      out(ledger.notesText());
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
