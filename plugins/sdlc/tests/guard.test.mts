// The hook behind the findings ledger. Contract: inside a session that owns
// an open ledger, fix rounds converge or stop, the checker and the verifier
// run on opus, no plugin agent pushes or merges, and the turn does not end
// until every open finding is fixed or listed under Still open. Every other
// session passes untouched. Without it, a session that compacted mid-loop
// forgot the cap and ran a fourth round on the model that failed three.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { decide, type HookEvent } from '../scripts/guard.mts';
import { find, start } from '../scripts/ledger.mts';

const fixture = (name: string): HookEvent =>
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf-8'));

const SESSION = fixture('pre-tool-use-bash-main-session.json').session_id as string;

function owned(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-guard-'));
  const ledger = start(cwd, '12');
  decide({ ...fixture('pre-tool-use-bash-main-session.json'), hook_event_name: 'PostToolUse', cwd,
    tool_input: { command: 'node ledger.mts start 12' }, tool_response: { stdout: `Ledger 12 recorded in ${ledger.folder}\n` } });
  ledger.record('check', '- [high] a.rb:1: one\n- [high] a.rb:2: two');
  return cwd;
}

const fixer = (cwd: string, model?: string): HookEvent => ({
  ...fixture('pre-tool-use-agent-main-session.json'), session_id: SESSION, cwd,
  tool_input: { subagent_type: 'sdlc:fixer', prompt: 'check: fix round 1 of 3.\n- F1 ...', ...(model ? { model } : {}) },
});

const reason = (d: ReturnType<typeof decide>) => (d as any)?.hookSpecificOutput?.permissionDecisionReason ?? (d as any)?.reason;
const ledger = (cwd: string) => find(cwd, '12')!;
const refused = (cwd: string, node = 'check') => {
  const result = ledger(cwd).openRound(node);
  return 'refused' in result ? result.refused : null;
};

/** Open the node's next round and dispatch its fixer, returning the hook's decision. */
const fixRound = (cwd: string, model?: string) => {
  expect(refused(cwd)).toBeNull();
  return decide(fixer(cwd, model));
};

describe('fix rounds', () => {
  test('a fourth round for a node is refused', () => {
    const cwd = owned();
    expect(fixRound(cwd)).toBeNull();
    ledger(cwd).record('check', 'F1: fixed');
    expect(fixRound(cwd)).toBeNull();
    ledger(cwd).record('check', 'F2: fixed\n- [low] a.rb:3: three');
    expect(fixRound(cwd, 'opus')).toBeNull();
    ledger(cwd).record('check', 'F3: fixed\n- [low] a.rb:4: four');
    expect(refused(cwd)).toMatch(/3 fix rounds/);
  });

  test('a round after one that fixed none of the node\'s findings is refused', () => {
    const cwd = owned();
    expect(fixRound(cwd)).toBeNull();
    ledger(cwd).record('check', 'F1: open\nF2: open');
    expect(refused(cwd)).toMatch(/fixed none/);
  });

  test('the last round runs on opus', () => {
    const cwd = owned();
    fixRound(cwd);
    ledger(cwd).record('check', 'F1: fixed');
    fixRound(cwd);
    ledger(cwd).record('check', 'F2: fixed\n- [low] a.rb:3: three');
    expect(reason(fixRound(cwd, 'sonnet'))).toMatch(/model: opus/);
    expect(decide(fixer(cwd, 'opus'))).toBeNull();
  });

  test('a fixer takes only a round the ledger opened, and each round once', () => {
    const cwd = owned();
    expect(reason(decide(fixer(cwd)))).toMatch(/ledger\.mts round/);
    expect(fixRound(cwd)).toBeNull();
    expect(reason(decide(fixer(cwd)))).toMatch(/ledger\.mts round/);
  });

  test('a round opens only for a node with open findings, one round at a time', () => {
    const cwd = owned();
    expect(refused(cwd, 'walk')).toMatch(/nothing to fix/);
    expect(refused(cwd)).toBeNull();
    expect(refused(cwd)).toMatch(/is open: dispatch sdlc:fixer/);
  });
});

describe('models', () => {
  test('the checker and the verifier are refused on any model but opus', () => {
    const cwd = owned();
    const recorded = fixture('pre-tool-use-agent-main-session.json');
    for (const subagent_type of ['sdlc:checker', 'sdlc:verifier']) {
      const event = { ...recorded, session_id: SESSION, cwd, tool_input: { ...recorded.tool_input, subagent_type } };
      expect(reason(decide(event))).toMatch(/runs on opus/);
      expect(decide({ ...event, tool_input: { subagent_type, prompt: 'check' } })).toBeNull();
    }
  });
});

describe('outward steps', () => {
  const agentBash = (cwd: string, command: string): HookEvent =>
    ({ ...fixture('pre-tool-use-bash-subagent.json'), cwd, agent_type: 'sdlc:fixer', tool_input: { command } });

  test('a plugin agent may not push or merge', () => {
    const cwd = owned();
    expect(reason(decide(agentBash(cwd, 'git -C ws push origin HEAD')))).toMatch(/pushes/);
    expect(reason(decide(agentBash(cwd, 'gh pr merge 4 --squash')))).toMatch(/merges/);
    expect(decide(agentBash(cwd, 'git commit -m fix'))).toBeNull();
  });

  test('the conducting session may push', () => {
    const cwd = owned();
    expect(decide({ ...fixture('pre-tool-use-bash-main-session.json'), cwd, tool_input: { command: 'git push' } })).toBeNull();
  });
});

describe('stopping', () => {
  const stop = (cwd: string): HookEvent => ({ session_id: SESSION, cwd, hook_event_name: 'Stop' });

  test('an open ledger holds the turn, naming its open findings', () => {
    const cwd = owned();
    expect(reason(decide(stop(cwd)))).toMatch(/12: F1 F2 open/);
  });

  test('a closed or abandoned ledger lets the turn end', () => {
    const closed = owned();
    ledger(closed).close('F1 F2');
    expect(decide(stop(closed))).toBeNull();
    const abandoned = owned();
    ledger(abandoned).append('abandoned', { why: 'the user stopped' });
    expect(decide(stop(abandoned))).toBeNull();
  });

  test('another session in the same folder is never held by it', () => {
    const cwd = owned();
    expect(decide({ ...stop(cwd), session_id: 'someone-else' })).toBeNull();
  });

  test('a session with no ledger passes untouched', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-guard-'));
    expect(decide({ ...stop(cwd) })).toBeNull();
  });
});
