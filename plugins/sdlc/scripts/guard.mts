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
// - SubagentStop: a checking agent's report is recorded in the ledger, so a
//   session that forgets `ledger.mts node` loses no finding and no answer.
// - PreCompact and SessionStart after a compaction or a resume: each open
//   ledger's next step is carried into the new context.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ledger, MAX_FIX_ROUNDS, forSession } from './ledger.mts';

/** The ledger node each checking agent's report is recorded under. */
const NODE_OF: Record<string, string> = { checker: 'check', rules: 'rules', security: 'security', walker: 'walk', verifier: 'verify' };

const STARTED = /^Ledger (\S+) recorded in (.+)$/m;
const OPUS = /opus/i;
const OPUS_AGENTS = ['checker', 'verifier'];
const PUSH = /\bgit(?:\s+-[Cc]\s+\S+)*\s+push\b/;
const MERGE = /\bgh\s+pr\s+merge\b|\/pulls\/\d+\/merge\b|\/merge_requests\/\d+\/merge\b/;

export type HookEvent = Record<string, any>;
/** A JSON decision, plain text (PreCompact's instructions), or nothing. */
export type Decision = Record<string, unknown> | string | null;

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

/** The agent's report: its SubagentHandback message when it handed back that way, else its last message. */
function report(event: HookEvent): string {
  const transcript: string | undefined = event.agent_transcript_path;
  if (transcript && fs.existsSync(transcript)) {
    const handback = fs.readFileSync(transcript, 'utf-8').split('\n').filter((line) => line.includes('SubagentHandback'))
      .flatMap((line) => {
        try {
          const content = JSON.parse(line).message?.content;
          return Array.isArray(content) ? content : [];
        } catch {
          return [];
        }
      })
      .findLast((c) => c?.type === 'tool_use' && c.name === 'SubagentHandback');
    if (typeof handback?.input?.message === 'string') return handback.input.message;
  }
  return event.last_assistant_message ?? '';
}

const lastStart = (ledger: Ledger): string => ledger.of('start').at(-1)!.at;

/** The ledger the session started last, a reopen counting as a start. */
const latest = (ledgers: Ledger[]): Ledger =>
  ledgers.reduce((a, b) => (lastStart(a) >= lastStart(b) ? a : b));

function subagentStop(event: HookEvent, ledgers: Ledger[]): Decision {
  const node = NODE_OF[role(event.agent_type) ?? ''];
  if (node) latest(ledgers).record(node, report(event));
  return null;
}

const nextSteps = (ledgers: Ledger[]): string =>
  ledgers.map((l) => `Findings ledger ${l.key} (\`ledger.mts next ${l.key}\`):\n${l.next()}`).join('\n');

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
  if (event.hook_event_name === 'SubagentStop') return subagentStop(event, ledgers);
  if (event.hook_event_name === 'PreCompact') {
    return `Keep in the summary, word for word, that a findings ledger is open and what is due next:\n${nextSteps(ledgers)}`;
  }
  if (event.hook_event_name === 'SessionStart') {
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${nextSteps(ledgers)}\nFix rounds open with \`ledger.mts round\`; what is left goes under Still open.` } };
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const decision = decide(JSON.parse(fs.readFileSync(0, 'utf-8')));
  if (typeof decision === 'string') process.stdout.write(`${decision}\n`);
  else if (decision) process.stdout.write(`${JSON.stringify(decision)}\n`);
}
