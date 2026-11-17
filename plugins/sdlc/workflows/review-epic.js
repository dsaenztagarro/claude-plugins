export const meta = {
  name: 'review-epic',
  description: 'Review an implemented ticket or epic across one or more repositories against its tracker requirements and design sources: coverage per requirement, verified gaps, test suites, optional e2e feasibility, published as a review on each pull request and one comment on the ticket',
  whenToUse: 'After a ticket or epic is built, before calling it done. Read-only on the code. Args: {ticket, repos:[{name, path, base, pr?}], scratch, tracker, sources?:[{kind:"figma"|"doc"|"url", ref, note?}], context?, e2e?:{path, note?}, runSuites?, publish?}. pr is the URL of the repository\'s pull request; without one, its findings go on the ticket. publish:false posts nothing, skips the Verify phase, and leaves the gaps in <scratch>/gaps.json, for the caller to reproduce in the product before posting. tracker names the tracker and its site, e.g. "github owner/repo" or "jira <site>".',
  phases: [
    { title: 'Requirements', detail: 'one reader per source, merged into one numbered catalogue' },
    { title: 'Trace', detail: 'per area: implementation and tests in every repository' },
    { title: 'Verify', detail: 'only when publishing: per area with gaps, one fresh agent tries to refute each of them' },
    { title: 'Suites', detail: "each repository's own gate, as its AGENTS.md names it" },
    { title: 'E2E', detail: 'feasibility of end-to-end specs in the named e2e repository' },
    { title: 'Report', detail: 'one report file, published to each pull request and the ticket unless publish is false, digest back' },
  ],
}

const DEFAULTS = {
  sources: [],
  context: '',
  e2e: null,
  // The author's gate run and CI usually already cover the head commit; re-running it is the slowest phase.
  runSuites: false,
  publish: true,
}
const REQUIRED = ['ticket', 'repos', 'scratch', 'tracker']
const given = args ?? {}
const known = new Set([...Object.keys(DEFAULTS), ...REQUIRED])
const unknown = Object.keys(given).filter(k => !known.has(k))
if (unknown.length) throw new Error(`review-epic: unknown args ${unknown.join(', ')}; known: ${[...known].join(', ')}`)
const A = { ...DEFAULTS, ...given }
const missing = REQUIRED.filter(k => A[k] == null || A[k] === '' || (Array.isArray(A[k]) && !A[k].length))
if (missing.length) throw new Error(`review-epic: needs args ${missing.join(', ')}`)
const badRepo = A.repos.find(r => !r.name || !r.path || !r.base)
if (badRepo) throw new Error(`review-epic: every repo needs name, path and base, got ${JSON.stringify(badRepo)}`)

const S = A.scratch
const T = A.ticket
const REPOS = A.repos.map(r => `- ${r.name}: ${r.path} (change = \`git -C ${r.path} diff ${r.base}...HEAD\`; its AGENTS.md/CLAUDE.md are its rules)`).join('\n')
const PATHS = A.repos.map(r => r.path).concat(A.e2e ? [A.e2e.path] : [])
const READONLY = `READ-ONLY review: never edit, commit, stash, checkout or push in ${PATHS.join(', ')} (build output and installed dependencies are fine). Write only under ${S}.`
const CONTEXT = A.context ? `\nProject context from the orchestrator:\n${A.context}` : ''

const REQ_SCHEMA = {
  type: 'object',
  properties: {
    areas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, reqIds: { type: 'array', items: { type: 'string' } } },
        required: ['name', 'reqIds'],
      },
    },
    count: { type: 'number' },
  },
  required: ['areas', 'count'],
}
const GAP_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reqId: { type: 'string' },
          kind: { type: 'string', enum: ['not-implemented', 'wrong-behaviour', 'bug', 'untested', 'cross-repo', 'spec-conflict'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          repo: { type: 'string' },
          claim: { type: 'string' },
          evidence: { type: 'string' },
          missingTest: { type: 'string' },
        },
        required: ['reqId', 'kind', 'severity', 'repo', 'claim', 'evidence'],
      },
    },
    covered: { type: 'number' },
  },
  required: ['gaps', 'covered'],
}
const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'number' }, refuted: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['i', 'refuted', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

const SOURCE_HOW = {
  figma: s => `Figma design ${s.ref}. Use the Figma MCP tools only (load them via ToolSearch): get_metadata on the page for frame ids and sticky-note text, then get_screenshot per frame. Walk every frame: screens, states, copy, buttons, popovers, empty/error states, and every designer note frame verbatim. If the MCP refuses a call (seat limit), fall back to the design plugin's figma skill (/design:figma), its \`render\` and \`crop\` only, never its \`texts\`: /v1/files/:key/nodes locks the account out for days on a 429. Report which frames were read that way, and which were not read at all.`,
  doc: s => `Document(s) on disk at ${s.ref}. Read them in full, attachments included.`,
  url: s => `The page at ${s.ref}.`,
}

phase('Requirements')
const readers = [
  { key: 'tracker', how: `${T} in the tracker (${A.tracker}; load its MCP tools via ToolSearch, or gh for GitHub). Read the full description, every comment, child and linked issues, and attachments.` },
  ...A.sources.map((s, i) => {
    if (!SOURCE_HOW[s.kind]) throw new Error(`review-epic: source kind must be figma, doc or url, got ${s.kind}`)
    return { key: `${s.kind}-${i + 1}`, how: SOURCE_HOW[s.kind](s) + (s.note ? `\nNote: ${s.note}` : '') }
  }),
]
// Areas scale with the change: each tracer re-reads its part of the diff, so a fixed 5-8 multiplied the cost of a small one.
const AREAS = `Size the areas to the change: count changed lines with \`git -C <path> diff --shortstat <base>...HEAD\` per repository (${A.repos.map(r => `${r.path} against ${r.base}`).join('; ')}), and make one area per ~500 changed lines in total, at least 1 and at most 6, each a coherent functional slice.`
const CATALOGUE = `Write ${S}/requirements.md: one entry per testable rule, id REQ-01.., each with the rule, its source(s), which repositories it concerns (${A.repos.map(r => r.name).join(', ')}), and a flag where sources conflict or the rule is an open scope question. Keep conflicting and open ones, flagged.
${AREAS} Return the areas with the total count.`

let catalogue
if (readers.length === 1) {
  // The ticket alone: its done-when and Tests section already are the catalogue, so one agent reads and numbers them.
  catalogue = await agent(`Build the requirement catalogue of ${T} from the tracker.
Source: ${readers[0].how}${CONTEXT}
Take the ticket's done-when lines and its Tests section as the rules, word for word where they are already testable; add only rules the description states that neither covers.
${CATALOGUE}
${READONLY}`, { label: 'req:catalogue', phase: 'Requirements', schema: REQ_SCHEMA })
} else {
  const sourceLines = await parallel(readers.map(r => () => agent(`Extract the requirements of ${T} from one source.
Source: ${r.how}${CONTEXT}
Write ${S}/req-${r.key}.md: every acceptance criterion, behavioural rule and UI rule as a bullet, each tagged with where in the source it came from, noting anything ambiguous or self-contradictory. From the tracker, the ticket's done-when lines and Tests section come first, word for word.
${READONLY}
Final message: ONE line — bullet count and the file path.`, { label: `req:${r.key}`, phase: 'Requirements' })))
  log(`sources: ${sourceLines.map(l => (l || 'FAILED').toString().slice(0, 100)).join(' | ')}`)
  catalogue = await agent(`Merge ${readers.map(r => `${S}/req-${r.key}.md`).join(', ')} into one numbered requirement catalogue for ${T}.${CONTEXT}
${CATALOGUE}`, { label: 'req:catalogue', phase: 'Requirements', schema: REQ_SCHEMA })
}
log(`catalogue: ${catalogue.count} requirements in ${catalogue.areas.length} areas`)

const traced = pipeline(
  catalogue.areas,
  area => agent(`Review area "${area.name}" of ${T}: requirements ${area.reqIds.join(', ')} in ${S}/requirements.md.
Repositories:
${REPOS}${CONTEXT}
For each requirement: (1) find the implementing code in every repository it concerns and judge whether it really works end to end — request/response shapes agree across repositories, called endpoints exist, error and empty states, concurrency, tenancy, authorisation; (2) find the tests proving it in each repository and judge whether they state the rule rather than just exercise code, against that repository's own testing rules. Check the couplings no single repository shows (generated clients, shared constants, published packages, API specs).
Report only gaps, each with file:line evidence and, where a test is missing, the test name that would state the rule. Severity is what a user would meet: high = wrong result or data on a normal path, medium = wrong on a plausible path or a core rule untested, low = an edge case, a cosmetic slip or a missing test for a minor rule. Count the requirements fully covered.
${READONLY}`, { label: `trace:${area.name}`, phase: 'Trace', schema: GAP_SCHEMA }),
  // One refuter per area, not per gap: the gaps of one area share their code and requirements, so a fresh agent
  // reads that context once. It is still independent of the tracer that made the claims.
  // Only medium and high gaps get a refuter: a fresh agent costs more than a low finding is worth, and a low one is posted marked unverified.
  // Without publishing, the caller walks every gap in the product, which refutes what a refuter would: Verify only pays when the run posts.
  (res, area) => {
    const all = res?.gaps || []
    if (!A.publish) return { area: area.name, covered: res?.covered ?? 0, gaps: all.map(g => ({ ...g, area: area.name, verdict: { refuted: false, reason: 'not verified: the caller walks it' } })) }
    const lowOnes = all.filter(g => g.severity === 'low').map(g => ({ ...g, area: area.name, verdict: { refuted: false, reason: 'low, not verified' } }))
    const gaps = all.filter(g => g.severity !== 'low')
    if (!gaps.length) return { area: area.name, covered: res?.covered ?? 0, gaps: lowOnes }
    return agent(`Try to REFUTE each of these review findings on ${T}, area "${area.name}". Repositories:
${REPOS}
Requirements: ${S}/requirements.md
${gaps.map((g, i) => `[${i}] ${g.reqId} ${g.severity} ${g.kind} ${g.repo}: ${g.claim}\n    Evidence given: ${g.evidence}`).join('\n')}
Judge each finding on its own; one being real says nothing about the next. Look for code or tests elsewhere that make it false — other files, modules, the other repositories, the base branch. refuted=true if the behaviour or test exists, or the requirement does not say what the finding assumes. If it holds, refuted=false with the exact file:line. One verdict per index.
${READONLY}`, { label: `verify:${area.name}`, phase: 'Verify', schema: VERDICTS, effort: 'high' })
      .then(v => {
        const by = new Map((v?.verdicts ?? []).map(x => [x.i, x]))
        // A gap the refuter skipped stays a gap: an unverified finding is reported, not dropped.
        return { area: area.name, covered: res?.covered ?? 0, gaps: [...gaps.map((g, i) => ({ ...g, area: area.name, verdict: by.get(i) ?? { refuted: false, reason: 'not verified' } })), ...lowOnes] }
      })
  },
)

const suites = A.runSuites
  ? parallel(A.repos.map(r => () => agent(`Report the test gate of ${r.name} at ${r.path}. If the project's CI already ran the full gate on exactly \`git -C ${r.path} rev-parse HEAD\`, the worktree is clean, and it passed (the forge's checks for that commit: gh pr checks or gh run list on GitHub), cite that run instead of re-running; a failed, pending, partial or missing CI result means you run it. Its AGENTS.md / CLAUDE.md / README name the gate and its prerequisites; follow them, and work around a broken environment only without modifying tracked files. If a prerequisite cannot be met, say exactly which.${CONTEXT}
Write ${S}/suite-${r.name}.md: commands, results, failing tests with key error lines, and the test files the change added or modified (\`git -C ${r.path} diff --stat ${r.base}...HEAD\`).
${READONLY}
Final message: ONE line — PASS/FAIL per check, file path.`, { label: `suite:${r.name}`, phase: 'Suites' })))
  : Promise.resolve([])

const e2e = A.e2e
  ? agent(`Analyse whether end-to-end specs for ${T} can be written in ${A.e2e.path} — analysis only, write NO files there.${A.e2e.note ? `\nNote: ${A.e2e.note}` : ''}${CONTEXT}
Read that repository: README, config, support layer, scripts, pipeline. Determine which environment it targets, how it authenticates, and whether it runs today.
Using ${S}/requirements.md and the repositories:
${REPOS}
list the user flows worth an e2e spec, and for each what blocks it: non-deterministic or paid external calls and whether they can be stubbed in that environment, seed data, committable fixtures, selectors in the UI, whether the change is deployed anywhere.
Write ${S}/e2e-feasibility.md: verdict (feasible now / feasible after X / not worthwhile), prerequisites in order, proposed spec files with test names stating the rule, and the minimal first spec.
Final message: ONE line — verdict and file path.`, { label: 'e2e:feasibility', phase: 'E2E' })
  : Promise.resolve(null)

const [areas, suiteLines, e2eLine] = await Promise.all([traced, suites, e2e])
const done = areas.filter(Boolean)
// The id labels a finding everywhere it travels: the report, the PR thread or QA note, the fix commit.
const confirmed = done.flatMap(a => a.gaps.filter(g => !g.verdict.refuted)).map((g, i) => ({ id: `F${i + 1}`, ...g }))
const refuted = done.flatMap(a => a.gaps.filter(g => g.verdict.refuted))
log(`gaps: ${confirmed.length} confirmed, ${refuted.length} refuted`)

phase('Report')
const PUBLISH = `Then publish it: the file dies with the session, and a fresh session acts only on what is posted.
- Pull requests: ${A.repos.filter(r => r.pr).map(r => `${r.name} ${r.pr}`).join(', ') || 'none'}. On each, post ONE review (comment, not approve or request changes) holding an inline comment on the line of each gap in that repository whose line is in the diff: "<id> — <claim>", the evidence, and the test that should exist. Its body is one line: the verdict and the counts. GitHub: \`gh api repos/<owner>/<repo>/pulls/<n>/reviews\` with a comments array; another forge: one inline comment per gap through its API.
- ${T}: ONE comment, starting "QA:" when it lists anything to act on: the verdict, the counts, the suite results, a link to each PR review, then every gap not posted inline (no pull request, a line outside the diff, a requirement not built) under its id, and the open scope questions. Post it with the tracker's tools (${A.tracker}).
No finding is posted twice.`
const HOLD = `Post nothing: the caller reproduces each gap in the running product first, and posts only what it reproduces.\nAlso write ${S}/gaps.json: the verified gaps (the JSON above), each with its id.`
const report = await agent(`Write the review report for ${T} to ${S}/review.md.
Inputs: ${S}/requirements.md${A.runSuites ? `, ${A.repos.map(r => `${S}/suite-${r.name}.md`).join(', ')}` : ''}${A.e2e ? `, ${S}/e2e-feasibility.md` : ''}, and these verified gaps (JSON): ${JSON.stringify(confirmed)}
Per-area coverage: ${JSON.stringify(done.map(a => ({ area: a.area, covered: a.covered, gaps: a.gaps.filter(g => !g.verdict.refuted).length })))}
Sections: 1) verdict — will it work, does it cover the requirements; 2) coverage matrix REQ-id × (implementation, test) per repository, ✓/✗/n.a.; 3) confirmed gaps by severity, each under its id, with file:line and the test that should exist; 4) open scope questions for the reporter; 5) suite results; 6) e2e feasibility, if run. Semantic line breaks, no hard wrap.
${A.publish ? PUBLISH : HOLD}
Final message: at most 8 lines — verdict, counts (requirements / covered / gaps by severity), suites PASS/FAIL, e2e verdict, the URLs posted.`, { label: 'report', phase: 'Report' })

return { report, suites: suiteLines, e2e: e2eLine, confirmed: confirmed.length, refuted: refuted.length }
