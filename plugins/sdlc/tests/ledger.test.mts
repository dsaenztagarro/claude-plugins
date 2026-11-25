// The findings ledger: how a checking agent's output becomes numbered
// findings, how an answer by id closes one, and what closing needs.
// Contract: the set of findings only shrinks once a fix round starts. A
// recheck answers the ids its round carried and adds nothing, a verdict
// counts only with its evidence, and a round that moved no file is not
// progress. Without it a recheck re-reviews from scratch, and nobody can tell
// a loop that converges from one that spins.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { find, forSession, start, type Ledger } from '../scripts/ledger.mts';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ledger-'));

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A real repository with one commit, in a folder made for it. */
function repository(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.rb'), 'total = 1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

/** A ledger whose run has one worktree, started in `base`. */
function run(base = folder()): { ledger: Ledger; worktree: string } {
  const ledger = start(base, '12');
  return { ledger, worktree: repository(path.join(ledger.folder, 'ws', 'api')) };
}

/** Open the node's next round and hand it to a fixer; the refusal when it may not open. */
function fixRound(ledger: Ledger, node = 'check'): string | null {
  const result = ledger.openRound(node);
  if ('refused' in result) return result.refused;
  ledger.take();
  return null;
}

describe('the ledger', () => {
  test('each finding line gets the next id, and prose around it is ignored', () => {
    const ledger = start(folder(), '12');
    const { added } = ledger.record('check', [
      'Two problems.',
      '- [high] app/order.rb:42: total ignores the discount',
      '- [medium] app/order.rb:7: tax is rounded twice',
    ].join('\n'));
    expect(added.map((f) => f.id)).toEqual(['F1', 'F2']);
    expect(ledger.open('check')).toHaveLength(2);
  });

  test('a recheck answering fixed or the verifier answering refuted closes the finding', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two\n- [high] a.rb:3: three');
    ledger.record('verify', 'F2: refuted — order_test.rb:12 covers it');
    expect(fixRound(ledger)).toBeNull();
    ledger.record('check', 'F1: fixed\nF3: open');
    expect(ledger.open().map((f) => f.id)).toEqual(['F3']);
  });

  test('a walk failure located by a screen and a step with spaces is a finding', () => {
    const ledger = start(folder(), '12');
    const { added } = ledger.record('walk', '- [high] /settings:step 2: pressing Save leaves the old value');
    expect(added.map((f) => [f.where, f.what])).toEqual([['/settings:step 2', 'pressing Save leaves the old value']]);
  });

  test('a finding reported again while still open keeps its id', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one');
    const { added } = ledger.record('check', 'F1: open\n- [high] a.rb:1: one');
    expect(added).toEqual([]);
    expect(ledger.open().map((f) => f.id)).toEqual(['F1']);
  });

  test('a refuted or accepted finding reported again keeps its id and stays out of the rounds', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    ledger.record('verify', 'F1: refuted — a.rb:1 already guards it');
    ledger.accept('F2', 'speculative');
    const { added } = ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    expect(added).toEqual([]);
    expect(ledger.open()).toEqual([]);
  });

  test('ids keep counting across nodes', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one');
    const { added } = ledger.record('rules', '- [medium] a.js:4: controller builds markup (stimulus.md)');
    expect(added[0]!.id).toBe('F2');
  });

  test('an accepted finding leaves the fix rounds and stays under Still open with its reason', () => {
    const ledger = start(folder(), '12');
    ledger.record('review', '- [high] a.rb:1: one\n- [medium] a.rb:2: could race');
    ledger.accept('F2', 'no walk reaches the race');
    const round = ledger.openRound('review');
    expect('brief' in round && round.brief).not.toMatch(/F2/);
    expect(ledger.stillOpen()).toMatch(/F2 .*could race — accepted: no walk reaches the race/);
  });

  test('a ledger closes only when every open finding is named under Still open', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    expect(ledger.close('## Still open\n- F1 [high] check: a.rb:1: one')).toEqual(['F2']);
    expect(ledger.active()).toBe(true);
    expect(ledger.close('## Still open\n- F1 ...\n- F2 ...')).toEqual([]);
    expect(ledger.active()).toBe(false);
  });

  test('the ledger is found from a folder below where it started, and ignores itself in git', () => {
    const base = folder();
    start(base, '12');
    fs.mkdirSync(path.join(base, 'app', 'models'), { recursive: true });
    expect(find(path.join(base, 'app', 'models'), '12')?.key).toBe('12');
    expect(fs.readFileSync(path.join(base, '.sdlc', '.gitignore'), 'utf-8')).toBe('*\n');
  });

  test('a ledger started in a folder that is not a git checkout lives in that folder', () => {
    const workspace = fs.realpathSync(folder());
    expect(start(workspace, '12').folder).toBe(path.join(workspace, '.sdlc', 'runs', '12'));
    const worktree = path.join(workspace, '.sdlc', 'runs', '12', 'ws', 'api');
    fs.mkdirSync(worktree, { recursive: true });
    expect(find(worktree, '12')?.key).toBe('12');
  });

  test("a ledger keyed by an owner/repo reference stays one folder that the hooks find", () => {
    const workspace = fs.realpathSync(folder());
    start(workspace, 'acme/api#30').claim('session-1');
    expect(fs.readdirSync(path.join(workspace, '.sdlc', 'runs'))).toEqual(['acme-api#30']);
    expect(find(workspace, 'acme/api#30')?.key).toBe('acme-api#30');
    expect(forSession(workspace, 'session-1').map((ledger) => ledger.key)).toEqual(['acme-api#30']);
  });

  test('a line of the ledger that cannot be read is skipped, and the rest still counts', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one');
    fs.appendFileSync(path.join(ledger.folder, 'ledger.jsonl'), '{"at":"2026-01-01T00:00:00.000Z","event":"fin\n');
    expect(find(path.dirname(path.dirname(path.dirname(ledger.folder))), '12')!.open().map((f) => f.id)).toEqual(['F1']);
  });

  test('next names the round due', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two\n- [high] a.rb:3: three');
    expect(fixRound(ledger)).toBeNull();
    ledger.record('check', 'F1: fixed');
    expect(fixRound(ledger)).toBeNull();
    ledger.record('check', 'F2: fixed');
    expect(ledger.next()).toBe('check: round 3 of 3, for F3');
  });

  test('a finding reported again with its path in another case keeps its id', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] App/Order.rb:42: total ignores the discount');
    const { added } = ledger.record('check', '- [high] app/order.rb:42: total ignores the discount');
    expect(added).toEqual([]);
  });
});

describe('a recheck', () => {
  const checked = () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    ledger.record('rules', '- [medium] a.js:4: controller builds markup (stimulus.md)');
    return ledger;
  };

  test("a recheck's answer counts only for the ids it was handed", () => {
    const ledger = checked();
    expect(fixRound(ledger)).toBeNull();
    const { answered } = ledger.record('check', 'F1: fixed\nF3: fixed');
    expect(answered).toEqual(['F1']);
    expect(ledger.open().map((f) => f.id)).toEqual(['F2', 'F3']);
  });

  test('a new finding in a recheck is not recorded', () => {
    const ledger = checked();
    expect(fixRound(ledger)).toBeNull();
    const { added, ignored } = ledger.record('check', 'F1: fixed\nF2: open\n- [high] a.rb:9: found while rechecking');
    expect(added).toEqual([]);
    expect(ignored).toBe(1);
    expect(ledger.of('finding').map((e) => e.id)).toEqual(['F1', 'F2', 'F3']);
  });

  test('a recheck recorded twice counts once, so its new finding stays unrecorded', () => {
    const ledger = checked();
    expect(fixRound(ledger)).toBeNull();
    const report = 'F1: fixed\nF2: open\n- [high] a.rb:9: found while rechecking';
    ledger.record('check', report);
    const again = ledger.record('check', `${report}\n`);
    expect(again.added).toEqual([]);
    const reworded = ledger.record('check', `## Recheck\n${report}`);
    expect(reworded.added).toEqual([]);
    expect(ledger.of('finding').map((e) => e.id)).toEqual(['F1', 'F2', 'F3']);
  });

  test('a report that answers none of the round\'s ids is not its recheck', () => {
    const ledger = checked();
    expect(fixRound(ledger)).toBeNull();
    ledger.record('check', '');
    const { added, answered } = ledger.record('check', 'F1: fixed\nF2: fixed\n- [high] a.rb:9: found while rechecking');
    expect(answered).toEqual(['F1', 'F2']);
    expect(added).toEqual([]);
  });

  test('an answer of fixed counts only from the recheck of a round', () => {
    const ledger = checked();
    ledger.record('check', 'F1: fixed');
    expect(ledger.open('check').map((f) => f.id)).toEqual(['F1', 'F2']);
  });

  test('the report after a recheck is a check again, and its findings are recorded', () => {
    const ledger = checked();
    expect(fixRound(ledger)).toBeNull();
    ledger.record('check', 'F1: fixed\nF2: fixed');
    const { added } = ledger.record('check', '- [high] b.rb:1: the next ticket has its own');
    expect(added.map((f) => f.id)).toEqual(['F4']);
  });
});

describe('severity and verdicts', () => {
  test('a low finding is a note, at most three per agent, never verified, fixed or rechecked', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', [
      '- [high] a.rb:1: one',
      '- [low] a.rb:2: a name could say more',
      '- [low] a.rb:3: a comment restates the code',
      '- [low] a.rb:4: a blank line is missing',
      '- [low] a.rb:5: a fourth note',
    ].join('\n'));
    expect(ledger.notes().map((f) => f.id)).toEqual(['F2', 'F3', 'F4']);
    expect(ledger.open().map((f) => f.id)).toEqual(['F1']);
    ledger.record('verify', 'F2: refuted — a.rb:2 says enough');
    expect(ledger.notes().map((f) => f.id)).toEqual(['F2', 'F3', 'F4']);
    const round = ledger.openRound('check');
    expect('brief' in round && round.brief).not.toMatch(/F2|F3|F4/);
    ledger.take();
    ledger.record('check', 'F1: fixed\nF2: fixed');
    expect(ledger.notes().map((f) => f.id)).toEqual(['F2', 'F3', 'F4']);
    expect(ledger.stillOpen()).toBe('No finding is open.');
    expect(ledger.notesText()).toMatch(/^- F2 \[low\] check: a\.rb:2: a name could say more\n- F3 /);
    expect(ledger.close('')).toEqual([]);
  });

  test('a refutation without the file and line that refute it leaves the finding holding', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    ledger.record('verify', 'F1: refuted — the code already handles it\nF2: refuted — order_test.rb:12 covers it');
    expect(ledger.open().map((f) => f.id)).toEqual(['F1']);
  });

  test('a time, a port or a step number is not the file and line that refute a finding', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', ['one', 'two', 'three', 'four', 'five'].map((what, i) => `- [high] a.rb:${i + 1}: ${what}`).join('\n'));
    ledger.record('verify', [
      'F1: refuted — I ran the suite at 10:42 and it passed',
      'F2: refuted — see http://localhost:3000/orders',
      'F3: refuted — step 2:3 of the ticket',
      'F4: refuted — bin/setup:4 already creates it',
      'F5: refuted — `order_test.rb:12` covers it',
    ].join('\n'));
    expect(ledger.open().map((f) => f.id)).toEqual(['F1', 'F2', 'F3']);
  });

  test('a refutation may name its file by an absolute path', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two\n- [high] a.rb:3: three');
    ledger.record('verify', [
      'F1: refuted — /Users/dev/app/models/order.rb:12 guards it',
      'F2: refuted — `/srv/app/a.rb:3` guards it',
      'F3: refuted — see https://example.com/app/a.rb:3',
    ].join('\n'));
    expect(ledger.open().map((f) => f.id)).toEqual(['F3']);
  });

  test('a refutation that does not count leaves a needs-design question standing', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one');
    ledger.record('verify', 'F1: needs-design — does an empty basket get free shipping?');
    ledger.record('verify', 'F1: refuted — the ticket says so');
    expect(ledger.questions().map((f) => f.id)).toEqual(['F1']);
    expect(fixRound(ledger)).toMatch(/nothing to fix/);
  });

  test('a needs-design finding never opens a fix round and is listed as a question', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one');
    ledger.record('verify', 'F1: needs-design — does an empty basket get free shipping?');
    expect(fixRound(ledger)).toMatch(/nothing to fix/);
    expect(ledger.stillOpen()).toMatch(/^- F1 .* — needs design: does an empty basket get free shipping\?$/);
    expect(ledger.next()).toMatch(/F1.*needs design/);
    expect(ledger.close('')).toEqual(['F1']);
  });

  test('a needs-design finding the verifier later settles goes back to the rounds', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one');
    ledger.record('verify', 'F1: needs-design — does an empty basket get free shipping?');
    ledger.record('verify', 'F1: holds — the ticket now says it does not');
    expect(fixRound(ledger)).toBeNull();
  });
});

// Each test here builds a real repository and hashes it several times, a dozen git processes in all.
describe('progress is content that moved', { timeout: 30_000 }, () => {
  const found = () => {
    const made = run();
    made.ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    return made;
  };

  test("a round after one in which no worktree's content moved is refused", () => {
    const { ledger } = found();
    expect(fixRound(ledger)).toBeNull();
    ledger.record('check', 'F1: open\nF2: open');
    expect(fixRound(ledger)).toMatch(/content moved/);
  });

  test('a commit that changes no file is not progress', () => {
    const { ledger, worktree } = found();
    expect(fixRound(ledger)).toBeNull();
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'fix: F1');
    ledger.record('check', 'F1: open\nF2: open');
    expect(fixRound(ledger)).toMatch(/content moved/);
  });

  test('a fixed answered for a round in which nothing moved leaves the finding open', () => {
    const { ledger } = found();
    expect(fixRound(ledger)).toBeNull();
    ledger.record('check', 'F1: fixed\nF2: open');
    expect(ledger.open().map((f) => f.id)).toEqual(['F1', 'F2']);
  });

  test('a round that changed a file, committed or not, closes what its recheck answers fixed and lets the next open', () => {
    const { ledger, worktree } = found();
    expect(fixRound(ledger)).toBeNull();
    fs.writeFileSync(path.join(worktree, 'a.rb'), 'total = 2\n');
    ledger.record('check', 'F1: fixed\nF2: open');
    expect(ledger.open().map((f) => f.id)).toEqual(['F2']);
    expect(fixRound(ledger)).toBeNull();
  });

  test("a ledger with no worktree of its own counts a fix made in another run's worktree", () => {
    const checkout = repository(folder());
    const { worktree } = run(checkout);
    const review = start(checkout, 'pr-5');
    review.record('review', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    expect(fixRound(review, 'review')).toBeNull();
    fs.writeFileSync(path.join(worktree, 'a.rb'), 'total = 2\n');
    review.record('review', 'F1: fixed\nF2: open');
    expect(review.open().map((f) => f.id)).toEqual(['F2']);
    expect(fixRound(review, 'review')).toBeNull();
  });

  test("a ledger with no worktree of its own counts a fix made in a linked worktree of its checkout", () => {
    const checkout = repository(folder());
    fs.writeFileSync(path.join(checkout, '.gitignore'), '.worktrees/\n');
    const worktree = path.join(checkout, '.worktrees', 'issue-9');
    git(checkout, 'worktree', 'add', '-q', worktree, '-b', 'issue-9');
    const review = start(checkout, 'pr-9');
    review.record('review', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
    expect(fixRound(review, 'review')).toBeNull();
    fs.writeFileSync(path.join(worktree, 'a.rb'), 'total = 2\n');
    git(worktree, 'commit', '-qam', 'fix: F1');
    review.record('review', 'F1: fixed\nF2: open');
    expect(review.open().map((f) => f.id)).toEqual(['F2']);
    expect(fixRound(review, 'review')).toBeNull();
  });

  test("a git failure refuses the round in git's own words", () => {
    const ledger = start(folder(), '12');
    fs.mkdirSync(path.join(ledger.folder, 'ws', 'api'), { recursive: true });
    ledger.record('check', '- [high] a.rb:1: one');
    expect(fixRound(ledger)).toMatch(/not a git repository/);
    expect(ledger.rounds('check')).toBe(0);
  });
});
