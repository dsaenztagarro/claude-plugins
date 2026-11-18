#!/usr/bin/env node

// The hook behind the ledger's rules. Reads one hook event on stdin and prints
// a decision, or nothing to let the call through. Every rule holds only the
// session that started the ledger, so another session in the same folder is
// never held by it.
//
// - PostToolUse on Bash: the session whose `ledger.mts start` printed its line
//   owns that ledger.
// - PreToolUse on Agent: a fixer takes only a round `ledger.mts round` opened,
//   which it refuses past three per node or after a round that fixed nothing;
//   the third round, the checker and the verifier run on opus.
// - PreToolUse on Bash: none of the plugin's agents pushes or merges.
// - Stop: the turn does not end while a ledger is open; closing it needs every
//   open finding named under Still open.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ledger, MAX_FIX_ROUNDS, forSession } from './ledger.mts';

const STARTED = /^Ledger (\S+) recorded in (.+)$/m;
const OPUS = /opus/i;
const OPUS_AGENTS = ['checker', 'verifier'];
const PUSH = /\bgit(?:\s+-[Cc]\s+\S+)*\s+push\b/;
const MERGE = /\bgh\s+pr\s+merge\b|\/pulls\/\d+\/merge\b|\/merge_requests\/\d+\/merge\b/;

export type HookEvent = Record<string, any>;
export type Decision = Record<string, unknown> | null;

const deny = (reason: string): Decision => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

const block = (reason: string): Decision => ({ decision: 'block', reason });

const role = (agentType: string | undefined): string | null =>
  agentType?.startsWith('sdlc:') ? agentType.slice('sdlc:'.length) : null;

function dispatch(event: HookEvent, ledgers: Ledger[]): Decision {
  const agent = role(event.tool_input?.subagent_type);
  const model: string | undefined = event.tool_input?.model;
  if (agent && OPUS_AGENTS.includes(agent) && model !== undefined && !OPUS.test(model)) {
    return deny(`sdlc:${agent} runs on opus, a different model from the agents whose work it checks: dispatch it without \`model\`, or with \`model: opus\`.`);
  }
  if (agent !== 'fixer') return null;
  const ledger = ledgers.find((l) => l.pending());
  if (!ledger) {
    return deny('A fixer takes a round the ledger opened: run `ledger.mts round <key> <node>` and hand its output to the fixer. '
      + 'It refuses a round past the limit or after one that fixed nothing.');
  }
  const { node, round } = ledger.pending()!;
  if (round === MAX_FIX_ROUNDS && !OPUS.test(model ?? '')) {
    return deny(`This is ${node}'s last fix round, and two rounds on the same model did not finish it: dispatch it with \`model: opus\`.`);
  }
  ledger.append('fix-round', { node, model: model ?? null });
  return null;
}

function bash(event: HookEvent): Decision {
  if (!role(event.agent_type)) return null;
  const command: string = event.tool_input?.command ?? '';
  if (PUSH.test(command)) return deny('Only the session that conducts the build pushes. Leave the commit in the worktree.');
  if (MERGE.test(command)) return deny('Nothing in the pipeline merges a pull request: a person does.');
  return null;
}

function stop(ledgers: Ledger[]): Decision {
  const lines = ledgers.map((l) => {
    const open = l.open().map((f) => f.id);
    return open.length
      ? `- ${l.key}: ${open.join(' ')} open. Fix them, or list them under Still open in the pull request body from \`ledger.mts still-open ${l.key}\`, then \`ledger.mts close ${l.key} <body-file>\`.`
      : `- ${l.key}: nothing is open; close it with \`ledger.mts close ${l.key}\`.`;
  });
  return block(`A findings ledger is still open:\n${lines.join('\n')}\n`
    + 'If the user asked to stop, or the run is blocked on something only they can clear, `ledger.mts abandon <key> "<why>"`.');
}

function claim(event: HookEvent): void {
  const m = STARTED.exec(event.tool_response?.stdout ?? '');
  if (m && fs.existsSync(m[2]!)) new Ledger(m[2]!).claim(event.session_id);
}

export function decide(event: HookEvent): Decision {
  if (event.hook_event_name === 'PostToolUse' && event.tool_name === 'Bash') {
    claim(event);
    return null;
  }
  const ledgers = forSession(event.cwd ?? '.', event.session_id);
  if (!ledgers.length) return null;
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent') return dispatch(event, ledgers);
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Bash') return bash(event);
  if (event.hook_event_name === 'Stop') return stop(ledgers);
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const decision = decide(JSON.parse(fs.readFileSync(0, 'utf-8')));
  if (decision) process.stdout.write(`${JSON.stringify(decision)}\n`);
}
