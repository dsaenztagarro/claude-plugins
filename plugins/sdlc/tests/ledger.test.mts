// The findings ledger: how a checking agent's output becomes numbered
// findings, how an answer by id closes one, and what closing needs.
// Without it a recheck re-reviews from scratch, and nobody can tell a loop
// that converges from one that spins.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { find, start } from '../scripts/ledger.mts';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ledger-'));

describe('the ledger', () => {
  test('each finding line gets the next id, and prose around it is ignored', () => {
    const ledger = start(folder(), '12');
    const { added } = ledger.record('check', [
      'Two problems.',
      '- [high] app/order.rb:42: total ignores the discount',
      '- [low] app/order.rb:7: unused variable',
    ].join('\n'));
    expect(added.map((f) => f.id)).toEqual(['F1', 'F2']);
    expect(ledger.open('check')).toHaveLength(2);
  });

  test('a recheck answering fixed or the verifier answering refuted closes the finding', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two\n- [high] a.rb:3: three');
    ledger.record('check', 'F1: fixed\nF2: refuted\nF3: open');
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
    ledger.record('verify', 'F1: refuted');
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
    ledger.record('review', '- [high] a.rb:1: one\n- [low] a.rb:2: could race');
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

  test('next names the round due, and the last one on opus', () => {
    const ledger = start(folder(), '12');
    ledger.record('check', '- [high] a.rb:1: one');
    ledger.append('fix-round', { node: 'check' });
    ledger.record('check', 'F1: open\n- [high] a.rb:2: two');
    ledger.append('fix-round', { node: 'check' });
    ledger.record('check', 'F2: fixed');
    expect(ledger.next()).toBe('check: round 3 of 3, on opus, for F1');
  });
});
