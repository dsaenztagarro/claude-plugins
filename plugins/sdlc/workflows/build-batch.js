export const meta = {
  name: 'build-batch',
  description: 'Build one batch of tracker tickets (one or more epics) in dependency waves, each ticket in its own worktree, and open one PR',
  whenToUse: 'One phase of a roadmap in any repository that keeps an AGENTS.md and an issue tracker. Relaunching with the same args continues a paused batch from its pushed branches, on any machine. Args: {repo, root, base, branch, name, epics, scope?, prelude?, preludeTracker?, maxWidth?, scratch?}. Once the PR merges, close its tickets with /sdlc:close in the session.',
  phases: [
    { title: 'Prelude', detail: 'pending fixes before the batch' },
    { title: 'Plan', detail: 'order the batch with dependencies and touched paths, settle the names tickets of one wave share, publish the plan, amend contradicted tickets; a relaunch reuses the stored plan' },
    { title: 'Build', detail: 'per ticket in its own worktree: build, then check (review + done-when lines) and fix, focused checks only' },
    { title: 'Integrate', detail: 'per wave: rebase every ticket onto the batch branch, one full gate, bisect only on red', model: 'sonnet' },
    { title: 'Cohere', detail: 'one reviewer reads the whole batch for conflicting choices parallel writers made' },
    { title: 'PR', detail: 'rebase only if the base moved, gate only on a cache miss, push, open PR (orchestrator merges)', model: 'sonnet' },
  ],
}

const DEFAULTS = {
  scratch: null,      // /tmp/build-batch/<branch>
  maxWidth: 4,
  scope: '',
  prelude: '',
  preludeTracker: '',
}
const REQUIRED = ['repo', 'root', 'base', 'branch', 'name', 'epics']
const given = args ?? {}
const known = new Set([...Object.keys(DEFAULTS), ...REQUIRED])
const unknown = Object.keys(given).filter(k => !known.has(k))
if (unknown.length) throw new Error(`build-batch: unknown args ${unknown.join(', ')}; known: ${[...known].join(', ')}`)
const A = { ...DEFAULTS, ...given }
const missing = REQUIRED.filter(k => A[k] == null || A[k] === '')
if (missing.length) throw new Error(`build-batch: needs args ${missing.join(', ')}`)

const ROOT = A.root
const BASE = A.base
const WT = `${ROOT}/.claude/worktrees/${A.branch}`
const S = A.scratch ?? `/tmp/build-batch/${A.branch}`
const MAX_WIDTH = A.maxWidth
// Steps that follow a procedure — gate, stack, open the PR — rather than design or judge code.
// Planning, building, checking and the cohere pass keep the session's model.
const ROUTINE = { model: 'sonnet', effort: 'medium' }
// A check round that still finds defects after one fix rarely converges on a second; what is left goes to the PR as open.
const CHECK_ROUNDS = 2

// The full gate runs once per wave on the integrated batch branch, never per agent: a ticket's own checks are focused,
// and a tree that already passed is never gated again. That is where most of a naive pipeline's time and tokens went.
const GATE = `Checks come in two tiers.
- Focused: the formatter, linter and type check on the files you changed, and the tests that cover them — the test files the change touches plus the runner's related-tests selector where it has one (e.g. \`jest --findRelatedTests\`, \`rspec <spec files>\`, \`pytest <paths>\`, \`go test ./<pkg>/...\`). Run these before every commit.
- Full: the whole gate the project's AGENTS.md names. Run it only where your instructions say so, and only on a clean worktree, through the cache: \`t=$(git rev-parse HEAD^{tree})\`; if \`${S}/gate-pass/$t\` exists the gate already passed on this exact tree, so do not rerun it; after a full pass, \`mkdir -p ${S}/gate-pass && touch ${S}/gate-pass/$t\`. Never cache a failure. A test that fails once and passes on a rerun of that test alone is flaky: name it in your report, do not rerun the whole gate for it.
Never --no-verify: a hook the repository installs runs as it is.`

// Conventions, the gate and live targets come from the project's AGENTS.md / CLAUDE.md, which every agent already has.
const ctx = (wt, branch) => `Repository ${A.repo}. Main checkout ${ROOT} stays on ${BASE}: never edit or commit there, except \`git pull --ff-only\` when told. You work in the worktree ${wt} on branch ${branch}; cd there for every command and never touch another worktree.
The project's AGENTS.md and CLAUDE.md are your rules — conventions, the gate and how to run it, live verification targets, and what is off-limits. A live check those rules forbid you to run goes to the user as exact commands with the expected output, never reported as passed.
${GATE}
Lines that depend on an unbuilt ticket outside this batch are BLOCKED (name the ticket), never faked.
A paused run may have left your branch on origin, possibly from another machine. Creating a worktree: if the branch exists locally or as origin/<branch> after \`git fetch origin\`, add the worktree on it (\`git worktree add <path> <branch>\`) and continue from its commits; cut a new branch only when neither exists. Fold any "WIP:" commit you find into the ticket's real commit.
Commits follow the repository's own style (git log shows it). No AI attribution of any kind.`
const CTX = ctx(WT, A.branch)

const QA = `QA notes: a reviewer posts findings as comments on the ticket, each starting "QA:"; the user has approved them as their own. Before building, reviewing or committing, read the ticket's comments. Apply each QA note, or state a technical reason for rejecting it; an unapplied note with no reason is a review defect. Never message the reviewer or wait on it.`


if (A.prelude) {
  phase('Prelude')
  await agent(`${CTX}

Prelude, before the batch, on ${A.branch}. First create the worktree if it does not exist: \`git -C ${ROOT} pull --ff-only && git -C ${ROOT} worktree add ${WT} -b ${A.branch} ${BASE}\`. Each fix is its own commit, with focused checks; the first wave's integration runs the full gate over them.
${A.prelude}
Final message: one line per commit, \`<sha> <subject>\`.`, { label: 'prelude:code', phase: 'Prelude' })
  if (A.preludeTracker) {
    await agent(`${CTX}

Tracker prelude, no repository changes: ${A.preludeTracker}
Read each issue body immediately before editing it, change only what is described, and re-read afterwards to confirm nothing else changed. Temp files under ${S}/, deleted after.
Final message: one line per issue changed.`, { label: 'prelude:tracker', phase: 'Prelude', ...ROUTINE, effort: 'low' })
  }
}

phase('Plan')
const PLAN = {
  type: 'object',
  properties: {
    tickets: { type: 'array', items: { type: 'object', properties: {
      n: { type: 'number' }, title: { type: 'string' }, epic: { type: 'number' },
      build: { type: 'boolean' }, why: { type: 'string' },
      deps: { type: 'array', items: { type: 'number' } },
      touches: { type: 'array', items: { type: 'string' } },
    }, required: ['n', 'title', 'epic', 'build', 'why', 'deps', 'touches'] } },
    notes: { type: 'string' },
  },
  required: ['tickets', 'notes'],
}
const plan = await agent(`${CTX}

Plan this batch: ${A.name}. Epics: ${A.epics.map(e => '#' + e).join(', ')}. ${A.scope}
1. Ensure the worktree: \`git -C ${ROOT} pull --ff-only\`; if ${WT} does not exist, create it on ${A.branch} by the worktree rule above, cutting it from ${BASE} only when the branch exists nowhere. Ticket branches \`${A.branch}-t<N>\` found locally or on origin are a paused run's work: a ticket whose branch holds commits is still built (its builder continues from them), and a ticket already integrated on ${A.branch} is build=false.
2. Resume check: look on epic #${A.epics[0]} for a comment starting "BATCH-PLAN ${A.branch}:". If it exists, this run continues a paused batch and that plan stands: take its tickets, deps, touches and notes as they are, and do not research, amend tickets or republish the plan. Only re-derive build from git — a ticket integrated on ${A.branch} is build=false, why "integrated by an earlier run" — and plan by steps 3 to 5 any open child of the epics that the comment does not list. Then update the comment (step 6) only if a ticket was added, and return.
3. Read every open child of each epic (sub-issues on GitHub, child issues on Jira) and the epic itself, and the code on the branch — \`git log ${BASE}..HEAD\` shows tickets already committed there. Research the external tools a ticket depends on from their real --help and versioned vendor docs.
4. Order the batch by dependency: nothing advances while a lower verification level is open. For each ticket give deps — the tickets IN THIS BATCH whose code it needs before it can start (a trait it implements, a type it uses, a module it extends) — and touches: the files and directories it will create or edit, as repo-relative paths, a directory where you cannot name the files. Tickets whose touches overlap are never built at the same time, so be concrete. build=false for a ticket out of scope, wholly blocked, or already done on the branch, with why.
5. Amend each ticket the research contradicts (only the wrong lines, with the source). Publish the batch plan into each epic by the /sdlc:plan skill's procedure (invoke it): the marked implementation-plan section of the description, replaced in place.
6. Post, or edit in place, ONE comment on epic #${A.epics[0]} starting "BATCH-PLAN ${A.branch}:" holding the result below as a fenced JSON block, so a relaunch on any machine resumes from it.
Return the ordered tickets with deps, touches and each ticket's epic, and notes for the builders: decisions taken, where things live, and every name two tickets could both introduce or one must use from another — public types and traits, modules, message keys and user-facing spellings, CLI flags, config fields, exit codes, shared helpers — each with its one owner and one spelling, preferring what already exists. Tickets with disjoint touches build at the same time and cannot see each other's code, so the notes are the only place such a name is settled.`, { label: `plan:${A.branch}`, phase: 'Plan', schema: PLAN })

const order = (plan?.tickets ?? []).filter(t => t.build)
const inBatch = new Set(order.map(t => t.n))

// Parallel writers on the same files pay in rebase conflicts, shared names and a cohere pass, and buy little wall-clock,
// so two tickets share a wave only when their declared paths are disjoint.
const norm = p => p.replace(/^\.?\/+/, '').replace(/\/+$/, '')
// A ticket whose paths the planner could not name overlaps everything.
const overlaps = (a, b) => !a.touches?.length || !b.touches?.length || a.touches.some(x => (b.touches ?? []).some(y => {
  const [p, q] = [norm(x), norm(y)]
  return p === q || p.startsWith(q + '/') || q.startsWith(p + '/') || !p || !q
}))

// Each wave holds tickets whose in-batch deps are already integrated, in plan order, at most MAX_WIDTH, pairwise disjoint.
const waves = []
const placed = new Set()
let pending = order.slice()
while (pending.length) {
  let ready = pending.filter(t => (t.deps ?? []).filter(d => inBatch.has(d)).every(d => placed.has(d)))
  if (!ready.length) {
    log(`dependency cycle among ${pending.map(t => '#' + t.n).join(' ')}: building them one at a time in plan order`)
    ready = pending.slice(0, 1)
  }
  const level = []
  for (const t of ready) {
    const slot = level.find(w => w.length < MAX_WIDTH && !w.some(o => overlaps(o, t)))
    slot ? slot.push(t) : level.push([t])
  }
  waves.push(...level)
  ready.forEach(t => placed.add(t.n))
  pending = pending.filter(t => !placed.has(t.n))
}
log(`${order.length} tickets in ${waves.length} waves: ${waves.map(w => w.map(t => '#' + t.n).join(',')).join(' | ')}`)

const CHECK = { type: 'object', properties: {
  problems: { type: 'array', items: { type: 'string' } },
  lines: { type: 'array', items: { type: 'object', properties: {
    line: { type: 'string' }, status: { type: 'string', enum: ['done', 'blocked', 'missing'] }, evidence: { type: 'string' } }, required: ['line', 'status', 'evidence'] } },
}, required: ['problems', 'lines'] }
const REVIEW = { type: 'object', properties: { ok: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'problems'] }
const INTEGRATED = { type: 'object', properties: {
  integrated: { type: 'array', items: { type: 'number' } },
  failed: { type: 'array', items: { type: 'object', properties: { n: { type: 'number' }, reason: { type: 'string' } }, required: ['n', 'reason'] } },
  gate: { type: 'string', enum: ['pass', 'cached', 'fail'] },
}, required: ['integrated', 'failed', 'gate'] }

const BUILT = { type: 'object', properties: {
  summary: { type: 'string' }, checks: { type: 'string' },
  decisionLog: { type: 'array', items: { type: 'object', properties: { issue: { type: 'number' }, text: { type: 'string' } }, required: ['issue', 'text'] } },
  blocked: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'checks', 'decisionLog', 'blocked'] }

const ticketBranch = t => `${A.branch}-t${t.n}`
const ticketWt = t => `${WT}-t${t.n}`

const buildTicket = async t => {
  const TB = ticketBranch(t), TWT = ticketWt(t), TCTX = ctx(TWT, TB)
  const b = await agent(`${TCTX}

Batch plan notes, which settle every name shared between tickets:
${plan.notes}
${QA}
Build ticket #${t.n} (${t.title}). First create your worktree if it does not exist, by the worktree rule above; a new branch is \`git -C ${WT} worktree add ${TWT} -b ${TB} ${A.branch}\` — cut from the batch branch, which already holds every ticket this one depends on. Other tickets may be building at the same time in their own worktrees: stay inside yours and inside this ticket's scope, and introduce a name another ticket could also introduce only as the plan notes spell it.
Read the ticket and its comments, and \`git log ${BASE}..HEAD\`. Write the tests first, named after the ticket's rules; see them fail; implement; mutation-check the ones that matter; amend the decision record that owns the theme if a decision was made, and list its decision-log line in your report rather than posting it. Run the focused checks, commit on ${TB}. Do not run the full gate: integration runs it once for the wave.
Report briefly — the checker reads your commits from git: summary in at most three sentences, focused checks as one line with their result, decision-log lines to post, and blocked lines with their tickets.`, { label: `build:#${t.n}`, phase: 'Build', schema: BUILT })
  // One independent checker both reviews the code and proves the done-when lines, so whatever a fix adds is checked again.
  let rep = b ? `Builder report: ${b.summary}\nFocused checks: ${b.checks}${b.blocked.length ? `\nBlocked: ${b.blocked.join('; ')}` : ''}` : 'The builder returned no report: read its commits.'
  let v = null
  for (let r = 0; r < CHECK_ROUNDS; r++) {
    v = await agent(`${TCTX}

${QA}
Check ticket #${t.n} on this branch; do not edit. ${r ? 'This is a re-check after a fix: confirm each earlier finding is resolved, read the fix commits closely, and re-prove every done-when line.' : ''}
1. Adversarially review its commits (\`git log -p ${A.branch}..HEAD\`): the project's conventions; tests state rules and go red when the code they cover breaks — mutation-check the most important one on the changed lines only, then restore and confirm \`git status\` is clean; nothing faked that should be real; a person can exercise the behaviour.
2. For every done-when line and verification step of the ticket: done = a named passing test or real command output you ran; blocked = names an unbuilt ticket outside this batch, with nothing faked; missing = buildable but not built or not proven.
Run the focused checks and the ticket's own verification procedure where the rules let you; the full gate runs at integration, not here. problems lists real defects only, each with file:line and the fix.

${rep}`, { label: `check:#${t.n}.${r + 1}`, phase: 'Build', schema: CHECK, effort: 'high' })
    const gaps = (v?.lines ?? []).filter(l => l.status === 'missing')
    if (!v || (!v.problems.length && !gaps.length) || r === CHECK_ROUNDS - 1) break
    const fixed = await agent(`${TCTX}

${QA}
Ticket #${t.n}: fix these check findings and build or prove these missing lines (tests first). If a line is truly blocked, name the ticket. Run the focused checks, commit.
${v.problems.map(p => '- ' + p).join('\n')}
${gaps.map(l => '- missing: ' + l.line + ' — ' + l.evidence).join('\n')}
Final message: one line per commit, \`<sha> <subject>\`.`, { label: `fix:#${t.n}.${r + 1}`, phase: 'Build' })
    rep = `Earlier findings:\n${[...v.problems, ...gaps.map(l => 'missing: ' + l.line)].map(p => '- ' + p).join('\n')}\n\nFixer report:\n${fixed}`
  }
  if (v?.problems.length) log(`#${t.n}: ${v.problems.length} check problems left open after ${CHECK_ROUNDS} rounds`)
  return { n: t.n, title: t.title, epic: t.epic, verdict: v, decisionLog: b?.decisionLog ?? [] }
}

const built = []
const failed = []
const skipped = []
let parallelWaves = 0

for (const [w, wave] of waves.entries()) {
  if (wave.length > 1) parallelWaves++
  phase('Build')
  const results = (await pipeline(wave, buildTicket)).filter(Boolean)
  phase('Integrate')
  // A merge queue, not a per-ticket gate: stack the wave, gate the stack once, and pay for bisection only when it is red.
  const integ = await agent(`${CTX}

Integrate wave ${w + 1} of "${A.name}" into ${A.branch}, in this order: ${results.map(r => '#' + r.n).join(', ')}.
1. Stack. For each ticket N, whose branch ${A.branch}-tN is checked out in ${WT}-tN: note \`git -C ${WT} rev-parse HEAD\` as N's base; in ${WT}-tN \`git rebase ${A.branch}\`, resolving conflicts so both tickets' rules survive (never drop a test to make a rebase pass) and running the focused checks on the files a conflict touched; then in ${WT} \`git merge --ff-only ${A.branch}-tN\`. A ticket you cannot rebase without changing its rule goes in failed with the reason; continue with the next.
2. Gate the stack once: the full gate in ${WT}, through the cache.
3. Only if it is red: rerun just the failing tests at each ticket's tip, in order, to find the first ticket that turns them red. Drop it: \`git -C ${WT} reset --hard <its base>\`, then re-stack each later ticket M with \`git rebase --onto ${A.branch} <M's base from step 1> ${A.branch}-tM\` in its worktree and \`git merge --ff-only\` in ${WT}, recording M's new base — never a plain rebase, which would replay the dropped ticket's commits along with M's. Put the dropped ticket in failed with the failing tests, and gate again. A failure already present at the wave's starting commit belongs to no ticket: add a failed entry with n=0 and the failing tests, report every stacked ticket as integrated, and go to step 4 with gate=fail.
4. Remove the worktree and branch of every integrated ticket (\`git -C ${WT} worktree remove ${WT}-tN && git -C ${WT} branch -D ${A.branch}-tN\`); leave failed ones in place.
gate: pass, cached, or fail if the stack never went green.`, { label: `integrate:wave${w + 1}`, phase: 'Integrate', schema: INTEGRATED, ...ROUTINE })
  const ok = new Set(integ?.integrated ?? [])
  for (const r of results) (ok.has(r.n) ? built : failed).push(r)
  for (const f of integ?.failed ?? []) log(`#${f.n} not integrated: ${f.reason}`)
  log(`wave ${w + 1}: ${results.filter(r => ok.has(r.n)).map(r => '#' + r.n).join(' ') || 'nothing'} integrated, gate ${integ?.gate ?? 'unknown'}`)
  if (integ?.gate === 'fail') {
    skipped.push(...waves.slice(w + 1).flat())
    log(`wave ${w + 1}: batch branch is red; not building ${skipped.map(t => '#' + t.n).join(' ') || 'nothing more'} on it`)
    break
  }
}

// Parallel writers make conflicting implicit choices (naming, error spelling, edge cases) that no per-ticket check can see.
// A batch built one ticket at a time has no such writers, and every ticket was checked against the code before it.
if (parallelWaves && built.length > 1) {
  phase('Cohere')
  const rv = await agent(`${CTX}

Read the whole batch as one change: \`git log -p ${BASE}..HEAD\` on ${A.branch} (tickets ${built.map(x => '#' + x.n).join(', ')}, some built in parallel and integrated one at a time). Do not edit. Look only for what no single-ticket review could see: two tickets solving the same problem two ways, a shared type or message spelled differently, a duplicated helper, a convention one ticket follows and another breaks, a test one ticket's change silently weakened, and any shared name built differently from the batch plan notes:
${plan.notes}
 ok=false only for such defects, each with file:line and the fix.`, { label: 'cohere', phase: 'Cohere', schema: REVIEW, effort: 'high' })
  if (rv && !rv.ok && rv.problems.length) {
    log(`cohere: ${rv.problems.length} cross-ticket problems`)
    await agent(`${CTX}

Fix these cross-ticket problems on ${A.branch}, focused checks per commit, then the full gate through the cache:
- ${rv.problems.join('\n- ')}
Final message: one line per commit, and the gate result.`, { label: 'cohere-fix', phase: 'Cohere' })
  }
}

phase('PR')
// A resumed run can find every ticket already integrated by an earlier run, and the branch still needs its PR.
const carried = (plan?.tickets ?? []).filter(t => !t.build && !built.some(b => b.n === t.n) && !failed.some(f => f.n === t.n))
const red = skipped.length || failed.length
const pr = built.length || carried.length ? await agent(`${CTX}

Every integrated ticket of "${A.name}" is committed on ${A.branch}. If \`git rev-list --count origin/${BASE}..${A.branch}\` is 0, or an open PR from ${A.branch} already exists, do nothing else and reply with that PR or "none — nothing integrated". Otherwise \`git fetch origin\`; if origin/${BASE} is not an ancestor of HEAD (\`git merge-base --is-ancestor origin/${BASE} HEAD\`), \`git rebase origin/${BASE}\` and resolve conflicts faithfully. Run the full gate through the cache — on an unchanged tree that is a lookup, not a run; if red, fix and commit. Push with \`git push -u origin ${A.branch}\` (\`--force-with-lease\` only if the rebase rewrote pushed commits), and open a PR to ${BASE}.
Title: the batch's outcome as a rule. Body: what the project did before and why that was wrong, what it does now per ticket, what is not in this change (blocked lines with their tickets, and any check problem left open), and the verification; final state only, no AI attribution. Reference tickets as "Part of #N", never "Closes". Do NOT merge: the orchestrator merges.
Final message: ONE line, the PR number and URL.

Tickets: ${built.map(x => '#' + x.n + ' ' + x.title).join('; ')}${built.some(x => x.verdict?.problems.length) ? `
Check problems left open: ${built.filter(x => x.verdict?.problems.length).map(x => '#' + x.n + ': ' + x.verdict.problems.join(' / ')).join('; ')}` : ''}${built.some(x => x.decisionLog.length) ? `
Decision-log lines, listed under a "Decision log" heading in the body for /sdlc:close to post — do not post them: ${built.flatMap(x => x.decisionLog.map(d => '#' + x.n + ' → #' + d.issue + ': ' + d.text)).join('; ')}` : ''}${red ? `
Not in this change: ${[...failed.map(x => '#' + x.n + ' (failed integration)'), ...skipped.map(x => '#' + x.n + ' (not built: the batch branch went red)')].join('; ')}. If the full gate is red on ${A.branch}, open the PR as a draft and say why in the body.` : ''}${carried.length ? `
Tickets built by an earlier run; describe only those whose commits are on the branch: ${carried.map(x => '#' + x.n + ' ' + x.title + ' (' + x.why + ')').join('; ')}` : ''}`, { label: 'pr', phase: 'PR', ...ROUTINE }) : 'none — nothing integrated'

const tally = x => ['done', 'blocked', 'missing'].map(k => k + '=' + (x.verdict?.lines ?? []).filter(l => l.status === k).length).join(' ') + (x.verdict?.problems.length ? ` open-problems=${x.verdict.problems.length}` : '')
return [
  `PR: ${String(pr).slice(0, 200)}`,
  ...built.map(x => `#${x.n}: ${tally(x)}`),
  ...failed.map(x => `#${x.n}: NOT INTEGRATED — branch ${ticketBranch(x)} left in ${ticketWt(x)}`),
  ...skipped.map(x => `#${x.n}: NOT BUILT — the batch branch went red before its wave`),
].join('\n')
