#!/usr/bin/env node

// The hook behind the ledger's rules. Reads one hook event on stdin and prints
// a decision, or nothing to let the call through. Two rules hold whoever
// asks; every other holds only the session that started the ledger, so
// another session in the same folder is never held by it.
//
// Whoever asks:
// - PreToolUse on Edit, Write and NotebookEdit: nothing writes a run's
//   `ledger.jsonl` but `ledger.mts`.
// - SubagentStop: a checking agent's report is recorded in the ledger, so a
//   session that forgets `ledger.mts node` loses no finding and no answer,
//   and an agent a workflow dispatched is recorded like any other.
//
// The session that started the ledger:
// - PostToolUse on Bash: the session whose `ledger.mts start` printed its line
//   owns that ledger.
// - PreToolUse on Agent: a plugin agent runs on the model its file sets, and a
//   fixer takes only a round `ledger.mts round` opened, which it refuses past
//   three per node or after a round that fixed nothing.
// - PreToolUse on Bash: none of the plugin's agents pushes or merges.
// - Stop: a turn ending while a ledger is open is held once, with what is due,
//   and ends when the session stops again: holding every stop would block each
//   wait for a check until the session abandoned the ledger. A turn that ends
//   while an agent or a workflow is still running is a wait, and is not held.
//   Closing the ledger needs every open finding named under Still open.
// - PreCompact and SessionStart after a compaction or a resume: each open
//   ledger's next step is carried into the new context.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger, activeLedgers, forSession } from './ledger.mts';

/** The ledger node each checking agent's report is recorded under. */
const NODE_OF: Record<string, string> = { checker: 'check', rules: 'rules', security: 'security', walker: 'walk', verifier: 'verify' };

const AGENTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents');
const STARTED = /^Ledger (\S+) recorded in (.+)$/m;
const LEDGER_FILE = /\/\.sdlc\/runs\/[^/]+\/ledger\.jsonl$/;
const PUSH = /\bgit(?:\s+-[Cc]\s+\S+)*\s+push\b/;
const MERGE = /\bgh\s+pr\s+merge\b|\/pulls\/\d+\/merge\b|\/merge_requests\/\d+\/merge\b/;

export type HookEvent = Record<string, any>;
/** A JSON decision, plain text (PreCompact's instructions), or nothing. */
export type Decision = Record<string, unknown> | string | null;

const deny = (reason: string): Decision => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

const block = (reason: string): Decision => ({ decision: 'block', reason });

/** The plugin agent's name in lower case, whatever case it was dispatched in; null for any other agent. */
const role = (agentType: string | undefined): string | null => {
  const name = agentType?.toLowerCase();
  return name?.startsWith('sdlc:') ? name.slice('sdlc:'.length) : null;
};

/** The model the agent's file sets, or null when it sets none or inherits the session's. */
function modelOf(agent: string): string | null {
  const file = fs.readdirSync(AGENTS).find((name) => name.toLowerCase() === `${agent}.md`);
  if (!file) return null;
  const frontmatter = fs.readFileSync(path.join(AGENTS, file), 'utf-8').split(/^---\s*$/m)[1] ?? '';
  const model = /^model:\s*["']?([\w.-]+)/m.exec(frontmatter)?.[1]?.toLowerCase();
  return model && model !== 'inherit' ? model : null;
}

/** An alias names the same model as the full id that contains it. */
const sameModel = (a: string, b: string) => a.includes(b) || b.includes(a);

function dispatch(event: HookEvent, ledgers: Ledger[]): Decision {
  const agent = role(event.tool_input?.subagent_type);
  if (!agent) return null;
  const model: string | undefined = event.tool_input?.model;
  const own = modelOf(agent);
  if (own && model !== undefined && !sameModel(model.toLowerCase(), own)) {
    return deny(`sdlc:${agent} runs on ${own}, the model its file sets: dispatch it without \`model\`.`);
  }
  if (agent !== 'fixer') return null;
  const ledger = ledgers.find((l) => l.pending());
  if (!ledger) {
    return deny('A fixer takes a round the ledger opened: run `ledger.mts round <key> <node>` and hand its output to the fixer. '
      + 'It refuses a round past the limit, after one that fixed nothing, and after one in which no file changed.');
  }
  ledger.take(model ?? null);
  return null;
}

function ledgerWrite(event: HookEvent): Decision {
  const target: unknown = event.tool_input?.file_path ?? event.tool_input?.notebook_path;
  if (typeof target !== 'string') return null;
  const resolved = path.resolve(event.cwd ?? '.', target).split(path.sep).join('/').toLowerCase();
  return LEDGER_FILE.test(resolved)
    ? deny('Only `ledger.mts` writes a run\'s ledger: record a report with `ledger.mts node <key> <node> <file>`, and leave a finding unfixed with `ledger.mts accept`.')
    : null;
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
      : `- ${l.key}: ${l.next()}`;
  });
  return block(`A findings ledger is still open:\n${lines.join('\n')}\n`
    + 'If you are waiting for a check, end the turn again and keep the ledger open. '
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

/** The ledger a finished agent's report belongs to: the run it worked in, else the session's latest, else the latest open here. */
function ledgerOf(event: HookEvent): Ledger | null {
  const active = activeLedgers(event.cwd ?? '.');
  if (!active.length) return null;
  const cwd = path.resolve(event.cwd ?? '.');
  const inside = active.filter((l) => `${cwd}${path.sep}`.startsWith(`${l.folder}${path.sep}`));
  const owned = active.filter((l) => l.owner() === event.session_id);
  return latest(inside.length ? inside : owned.length ? owned : active);
}

function subagentStop(event: HookEvent): Decision {
  const node = NODE_OF[role(event.agent_type) ?? ''];
  if (node) ledgerOf(event)?.record(node, report(event));
  return null;
}

/** Whether the session is waiting for an agent or a workflow it started. */
const waiting = (event: HookEvent): boolean =>
  (event.background_tasks ?? []).some((task: any) => (task.type === 'subagent' || task.type === 'workflow') && task.status === 'running');

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
  if (event.hook_event_name === 'PreToolUse' && ['Edit', 'Write', 'NotebookEdit'].includes(event.tool_name)) return ledgerWrite(event);
  if (event.hook_event_name === 'SubagentStop') return subagentStop(event);
  const ledgers = forSession(event.cwd ?? '.', event.session_id);
  if (!ledgers.length) return null;
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent') return dispatch(event, ledgers);
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Bash') return bash(event);
  if (event.hook_event_name === 'Stop') return event.stop_hook_active || waiting(event) ? null : stop(ledgers);
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
