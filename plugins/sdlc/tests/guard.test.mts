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

  test('a round whose findings all close before its fixer is withdrawn', () => {
    const cwd = owned();
    ledger(cwd).record('rules', '- [low] a.js:4: builds markup (stimulus.md)');
    expect(refused(cwd)).toBeNull();
    ledger(cwd).record('verify', 'F1: refuted\nF2: refuted');
    expect(refused(cwd, 'rules')).toBeNull();
    expect(ledger(cwd).rounds('check')).toBe(0);
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

describe('recording reports', () => {
  const subagentStop = (cwd: string, fields: HookEvent): HookEvent =>
    ({ ...fixture('subagent-stop.json'), session_id: SESSION, cwd, agent_transcript_path: undefined, ...fields });

  test('a checking agent\'s report is recorded under its node, without the session calling the ledger', () => {
    const cwd = owned();
    decide(subagentStop(cwd, { agent_type: 'sdlc:rules', last_assistant_message: '- [medium] a.js:4: builds markup (stimulus.md)' }));
    expect(ledger(cwd).open('rules').map((f) => f.id)).toEqual(['F3']);
  });

  test('a verifier\'s answers close refuted findings', () => {
    const cwd = owned();
    decide(subagentStop(cwd, { agent_type: 'sdlc:verifier', last_assistant_message: 'F1: refuted — covered by order_test.rb:12\nF2: holds — reproduced' }));
    expect(ledger(cwd).open().map((f) => f.id)).toEqual(['F2']);
  });

  test('a report handed back through SubagentHandback is read from the agent\'s transcript', () => {
    const cwd = owned();
    const transcript = path.join(cwd, 'agent.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ message: { content: [
      { type: 'tool_use', name: 'SubagentHandback', input: { message: 'F1: fixed' } },
    ] } })}\n`);
    decide(subagentStop(cwd, { agent_type: 'sdlc:checker', agent_transcript_path: transcript, last_assistant_message: 'Handed back.' }));
    expect(ledger(cwd).open().map((f) => f.id)).toEqual(['F2']);
  });

  test('an agent that checks nothing records nothing', () => {
    const cwd = owned();
    decide(subagentStop(cwd, { agent_type: 'sdlc:fixer', last_assistant_message: '- [high] a.rb:9: not a finding' }));
    expect(ledger(cwd).open()).toHaveLength(2);
  });
});

describe('surviving a compaction', () => {
  test('the compaction keeps each open ledger\'s next step', () => {
    const cwd = owned();
    const text = decide({ session_id: SESSION, cwd, hook_event_name: 'PreCompact', trigger: 'auto' });
    expect(text).toMatch(/ledger 12[\s\S]*check: round 1 of 3, for F1 F2/);
  });

  test('a session starting after a compaction is told what is due', () => {
    const cwd = owned();
    const decision = decide({ session_id: SESSION, cwd, hook_event_name: 'SessionStart', source: 'compact' }) as any;
    expect(decision.hookSpecificOutput.additionalContext).toMatch(/check: round 1 of 3, for F1 F2/);
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

  test('a ledger abandoned to ask the user holds again once it is started again, with its rounds counted', () => {
    const cwd = owned();
    expect(fixRound(cwd)).toBeNull();
    ledger(cwd).append('abandoned', { why: 'a security finding goes to the user' });
    start(cwd, '12');
    expect(reason(decide(stop(cwd)))).toMatch(/12: F1 F2 open/);
    expect(ledger(cwd).rounds('check')).toBe(1);
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
