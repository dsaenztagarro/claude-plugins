#!/usr/bin/env node

// The hook behind the ledger's rules. Reads one hook event on stdin and prints
// a decision, or nothing to let the call through. Every rule holds only the
// session that started the ledger, so another session in the same folder is
// never held by it.
//
// - PostToolUse on Bash: the session whose `ledger.mts start` printed its line
//   owns that ledger.
// - PreToolUse on Agent: a fixer names its node on the first line
//   (`Node: <name>`) and gets at most three rounds per node, none after a round
//   that fixed nothing, the third on opus; the checker and the verifier run on
//   opus.
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
  const node = /^\s*Node:\s*(\S+)/.exec(event.tool_input?.prompt ?? '')?.[1];
  const ledger = ledgers.find((l) => node !== undefined && l.open(node).length);
  if (!node || !ledger) {
    const open = ledgers.flatMap((l) => [...new Set(l.open().map((f) => f.node))]);
    return deny('Name the node whose findings this round fixes on the prompt\'s first line, `Node: <name>`, '
      + `one with open findings in the ledger${open.length ? ` (${open.join(', ')})` : ': none is open, so there is nothing to fix'}.`);
  }
  const rounds = ledger.rounds(node);
  if (rounds >= MAX_FIX_ROUNDS) {
    ledger.append('fix-refused', { node, why: 'limit' });
    return deny(`${node} has had its ${MAX_FIX_ROUNDS} fix rounds. List its open findings under Still open `
      + `(\`ledger.mts still-open ${ledger.key}\`) and carry on.`);
  }
  if (!ledger.progressSinceLastRound(node)) {
    ledger.append('fix-refused', { node, why: 'no progress' });
    return deny(`${node}'s last fix round fixed none of its findings, so another would repeat it. Make sure the recheck `
      + `answered each open id (\`F<n>: fixed|open\`) and was recorded; if it was, list them under Still open and carry on.`);
  }
  if (rounds === MAX_FIX_ROUNDS - 1 && !OPUS.test(model ?? '')) {
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
