// The hook behind the findings ledger. Contract: inside a session that owns
// an open ledger, fix rounds converge or stop, each plugin agent runs on the
// model its file sets, no plugin agent pushes or merges, and a turn ending
// before every open finding is fixed or listed under Still open is held once.
// Two rules hold whoever asks: nothing writes a ledger but its script, and a
// checking agent's report is recorded. Every other session passes untouched.
// Without it, a session that compacted mid-loop forgot the cap and ran a
// fourth round, and a session short of an answer wrote it into the ledger.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
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
    ledger(cwd).record('check', '- [high] a.rb:3: three\n- [high] a.rb:4: four');
    for (const id of ['F1', 'F2', 'F3']) {
      expect(fixRound(cwd)).toBeNull();
      ledger(cwd).record('check', `${id}: fixed`);
    }
    expect(refused(cwd)).toMatch(/3 fix rounds/);
  });

  test('a round after one that fixed none of the node\'s findings is refused', () => {
    const cwd = owned();
    expect(fixRound(cwd)).toBeNull();
    ledger(cwd).record('check', 'F1: open\nF2: open');
    expect(refused(cwd)).toMatch(/fixed none/);
  });

  test('a fixer takes only a round the ledger opened, and each round once', () => {
    const cwd = owned();
    expect(reason(decide(fixer(cwd)))).toMatch(/ledger\.mts round/);
    expect(fixRound(cwd)).toBeNull();
    expect(reason(decide(fixer(cwd)))).toMatch(/ledger\.mts round/);
  });

  test('a round whose findings all close before its fixer is withdrawn', () => {
    const cwd = owned();
    ledger(cwd).record('rules', '- [medium] a.js:4: builds markup (stimulus.md)');
    expect(refused(cwd)).toBeNull();
    ledger(cwd).record('verify', 'F1: refuted — a.rb:1 guards it\nF2: refuted — a.rb:2 guards it');
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
  const plugin = path.resolve(import.meta.dirname, '..');
  const agents = fs.readdirSync(path.join(plugin, 'agents')).filter((file) => file.endsWith('.md'));
  const modelIn = (file: string) => /^model:\s*(\S+)/m.exec(fs.readFileSync(path.join(plugin, 'agents', file), 'utf-8'))?.[1];
  const agent = (cwd: string, subagent_type: string, model?: string): HookEvent => ({
    ...fixture('pre-tool-use-agent-main-session.json'), session_id: SESSION, cwd,
    tool_input: { subagent_type, prompt: 'check', ...(model ? { model } : {}) },
  });

  test("an agent dispatched on a model other than its file's is refused", () => {
    const cwd = owned();
    for (const file of agents.filter((name) => name !== 'fixer.md')) {
      const type = `sdlc:${path.basename(file, '.md')}`;
      expect(reason(decide(agent(cwd, type, 'another-model')))).toMatch(new RegExp(`${type} runs on ${modelIn(file)}`));
      expect(decide(agent(cwd, type, modelIn(file)))).toBeNull();
      expect(decide(agent(cwd, type))).toBeNull();
    }
  });

  test("a fixer's last round runs on its file's model like every other", () => {
    const cwd = owned();
    ledger(cwd).record('check', '- [high] a.rb:3: three');
    for (const id of ['F1', 'F2']) {
      expect(fixRound(cwd)).toBeNull();
      ledger(cwd).record('check', `${id}: fixed`);
    }
    expect(refused(cwd)).toBeNull();
    expect(reason(decide(fixer(cwd, 'another-model')))).toMatch(/sdlc:fixer runs on/);
    expect(decide(fixer(cwd))).toBeNull();
    expect(ledger(cwd).rounds('check')).toBe(3);
  });

  test("an agent's name matches its file whatever its case", () => {
    const cwd = owned();
    expect(reason(decide(agent(cwd, 'SDLC:Checker', 'another-model')))).toMatch(/runs on/);
    decide({ ...fixture('subagent-stop.json'), session_id: SESSION, cwd, agent_transcript_path: undefined,
      agent_type: 'SDLC:Rules', last_assistant_message: '- [medium] a.js:4: builds markup (stimulus.md)' });
    expect(ledger(cwd).open('rules')).toHaveLength(1);
  });

  test("an agent's model is set only in its file", () => {
    expect(agents.filter((file) => !modelIn(file))).toEqual([]);
    const named = ['scripts', 'hooks'].flatMap((dir) => fs.readdirSync(path.join(plugin, dir)).map((file) => path.join(dir, file)))
      .filter((file) => /\b(opus|sonnet|haiku|fable)\b/i.test(fs.readFileSync(path.join(plugin, file), 'utf-8')));
    expect(named).toEqual([]);
  });
});

describe('the ledger file', () => {
  const write = (cwd: string, tool_name: string, input: Record<string, string>, fields: HookEvent = {}): HookEvent =>
    ({ ...fixture('pre-tool-use-bash-main-session.json'), cwd, tool_name, tool_input: input, ...fields });

  test("no session or agent writes a run's ledger through Edit or Write", () => {
    const cwd = owned();
    const file = path.join(ledger(cwd).folder, 'ledger.jsonl');
    expect(reason(decide(write(cwd, 'Edit', { file_path: file, old_string: 'open', new_string: 'fixed' })))).toMatch(/ledger\.mts/);
    expect(reason(decide(write(cwd, 'Write', { file_path: file.toUpperCase(), content: '' }, { session_id: 'someone-else' })))).toMatch(/ledger\.mts/);
    expect(reason(decide(write(cwd, 'NotebookEdit', { notebook_path: '.sdlc/runs/12/ledger.jsonl' }, { agent_type: 'sdlc:fixer' })))).toMatch(/ledger\.mts/);
    expect(decide(write(cwd, 'Write', { file_path: path.join(cwd, 'app', 'ledger.rb'), content: '' }))).toBeNull();
  });

  test('every PreToolUse hook blocks the call when it fails', () => {
    const { hooks } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'hooks', 'hooks.json'), 'utf-8'));
    const entries = hooks.PreToolUse.flatMap((group: any) => group.hooks);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((hook: any) => hook.onFailure !== 'block')).toEqual([]);
    expect(hooks.PreToolUse.map((group: any) => group.matcher).join('|').split('|').sort())
      .toEqual(['Agent', 'Bash', 'Edit', 'NotebookEdit', 'Write']);
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
  afterEach(() => vi.useRealTimers());
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
      { type: 'tool_use', name: 'SubagentHandback', input: { message: '- [high] a.rb:3: three' } },
    ] } })}\n`);
    decide(subagentStop(cwd, { agent_type: 'sdlc:checker', agent_transcript_path: transcript, last_assistant_message: 'Handed back.' }));
    expect(ledger(cwd).open().map((f) => f.id)).toEqual(['F1', 'F2', 'F3']);
  });

  test('a report goes to the ledger the session started last, counting a reopen as a start', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cwd = owned();
    vi.advanceTimersByTime(1000);
    const other = start(cwd, '13');
    decide({ ...fixture('pre-tool-use-bash-main-session.json'), hook_event_name: 'PostToolUse', cwd,
      tool_input: { command: 'node ledger.mts start 13' }, tool_response: { stdout: `Ledger 13 recorded in ${other.folder}\n` } });
    ledger(cwd).append('abandoned', { why: 'asking the user' });
    vi.advanceTimersByTime(1000);
    start(cwd, '12');
    decide(subagentStop(cwd, { agent_type: 'sdlc:rules', last_assistant_message: '- [medium] a.js:4: builds markup (stimulus.md)' }));
    expect(ledger(cwd).open('rules')).toHaveLength(1);
    expect(find(cwd, '13')!.open()).toHaveLength(0);
  });

  test("a checking agent's report is recorded whoever dispatched it", () => {
    const cwd = owned();
    decide(subagentStop(cwd, { session_id: 'a-workflow-run', agent_type: 'sdlc:rules', last_assistant_message: '- [medium] a.js:4: builds markup (stimulus.md)' }));
    expect(ledger(cwd).open('rules').map((f) => f.id)).toEqual(['F3']);
  });

  test("a report from an agent working in a run's worktree goes to that run's ledger", () => {
    const cwd = owned();
    const other = start(cwd, '13');
    const worktree = path.join(ledger(cwd).folder, 'ws', 'api');
    fs.mkdirSync(worktree, { recursive: true });
    decide(subagentStop(worktree, { session_id: 'a-workflow-run', agent_type: 'sdlc:rules', last_assistant_message: '- [medium] a.js:4: builds markup (stimulus.md)' }));
    expect(ledger(cwd).open('rules')).toHaveLength(1);
    expect(find(cwd, other.key)!.open()).toHaveLength(0);
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

  test('a turn held once may end when the session stops again, so it can wait for an agent or a check', () => {
    const cwd = owned();
    expect(decide({ ...stop(cwd), stop_hook_active: true })).toBeNull();
  });

  test('a turn ends without spending its hold while an agent the session started is running', () => {
    const cwd = owned();
    const [running] = fixture('subagent-stop.json').background_tasks;
    expect(decide({ ...stop(cwd), background_tasks: [running] })).toBeNull();
    expect(decide({ ...stop(cwd), background_tasks: [{ id: 'w1', type: 'workflow', status: 'running', name: 'build' }] })).toBeNull();
    expect(reason(decide({ ...stop(cwd), background_tasks: [{ ...running, status: 'completed' }] }))).toMatch(/12: F1 F2 open/);
    expect(reason(decide({ ...stop(cwd), background_tasks: [{ id: 's1', type: 'shell', status: 'running', command: 'npm test' }] }))).toMatch(/12: F1 F2 open/);
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

  test('with only accepted findings left, the turn is held until the body names them', () => {
    const cwd = owned();
    ledger(cwd).accept('F1', 'speculative');
    ledger(cwd).accept('F2', 'speculative');
    expect(reason(decide(stop(cwd)))).toMatch(/12: F1 F2 accepted.*ledger\.mts close 12 <body-file>/);
    expect(ledger(cwd).next()).toMatch(/F1 F2 accepted.*ledger\.mts close 12 <body-file>/);
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
