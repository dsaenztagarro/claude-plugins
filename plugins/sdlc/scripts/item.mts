#!/usr/bin/env node

// What a skill takes from the user, checked before anything starts.
//
//   node item.mts mode
//   node item.mts parse <arg>
//   node item.mts resolve [--for build|review] <arg>
//   node item.mts check <owner/repo>...
//   node item.mts from-branch <branch>
//
// The session runs in one checkout, or in a workspace: a folder whose
// sub-folders are checkouts, one per repository. Every command runs from the
// session's folder. Prints the result, or the reason on stderr and exit 2.
//
// A ticket touches its own repository unless a `### Repositories` section in
// its description lists every repository it touches, its own included.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** git@github.com:o/r.git, ssh://git@github.com/o/r, https://github.com/o/r[.git] */
const ORIGIN = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;
const URL_ITEM = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/;
const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
/** A Jira key inside a branch name, where `_` beside it is a separator, though `\b` counts it as part of a word. */
const JIRA_KEYS = /(?<![A-Za-z0-9])[A-Z][A-Z0-9]+-\d+(?!\d)/g;
/** An issue number a branch name starts a segment with: `91-slug`, `feat/91-slug`, `issue-91`. */
const BRANCH_NUMBERS = /(?:^|[/_-])(?:issue-|gh-)?(\d+)(?=[-_/]|$)/g;
const REPOSITORIES = /^#{2,4}\s+Repositories\s*$([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/m;
const REPO = /^[\w.-]+\/[\w.-]+$/;
/** How many pull requests a search reads: `gh` returns 30 by default, and a low ticket number appears in many bodies. */
const SEARCH_LIMIT = 1000;

export const FORMS = `Accepted forms:
  12, #12          issue or pull request 12 of this checkout's GitHub origin (in a checkout)
  <folder>#12      issue or pull request 12 of that sub-folder's origin (in a workspace)
  owner/repo#12    that repository's issue or pull request (anywhere)
  https://github.com/owner/repo/issues/12, or /pull/12
  PROJ-123, or its Jira browse URL (when an AGENTS.md here names the project PROJ)`;

export type Gh = (args: string[]) => string;
export type Mode = 'checkout' | 'workspace';
export type Parsed = { number: number; repo?: string; folder?: string } | { jira: string };
export type Purpose = 'build' | 'review' | 'any';

export interface GitHubItem {
  tracker: 'github';
  repo: string;
  number: number;
  kind: 'issue' | 'pr';
  state: 'open' | 'closed';
  /** The checkout that holds the repository, or null when none here does. */
  folder: string | null;
  repositories: string[];
  /** For a pull request: the tickets it closes, as references. */
  closes?: string[];
  /** For an issue resolved for review: its open pull requests, in every repository it touches. */
  prs?: string[];
  /** For a closed issue resolved for build: the merged pull requests that closed it. */
  merged?: string[];
  /** For an epic: its sub-issues. */
  children?: string[];
}
export interface JiraItem { tracker: 'jira'; key: string; folder: string; repositories: string[] }
export type Item = GitHubItem | JiraItem;

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** `owner/repo` of a checkout's origin on GitHub, or null. */
export function repoOf(dir: string): string | null {
  const match = ORIGIN.exec(git(dir, ['remote', 'get-url', 'origin']) ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
}

const toplevel = (dir: string) => git(dir, ['rev-parse', '--show-toplevel']);

/** The checkout a worktree belongs to, which is where the user keeps their repositories; a checkout is its own. */
function mainCheckout(top: string): string {
  const common = git(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return common && path.basename(common) === '.git' ? path.dirname(common) : top;
}

export function mode(cwd: string): Mode {
  return toplevel(cwd) ? 'checkout' : 'workspace';
}

/** The workspace's checkouts, by folder name. */
function checkouts(workspace: string): string[] {
  return fs.readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(workspace, entry.name, '.git')))
    .map((entry) => entry.name)
    .sort();
}

/** The folder here that holds `repo`: the checkout itself, or a sub-folder of the workspace. */
function folderOf(cwd: string, repo: string): string | null {
  const top = toplevel(cwd);
  if (top) return repoOf(top) === repo ? top : null;
  const name = checkouts(cwd).find((folder) => repoOf(path.join(cwd, folder)) === repo);
  return name ? path.join(cwd, name) : null;
}

export function parse(arg: string): Parsed {
  const url = URL_ITEM.exec(arg);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) };
  const key = /\/browse\/([^/?#]+)/.exec(arg)?.[1] ?? arg;
  if (JIRA_KEY.test(key)) return { jira: key };
  const bare = /^#?(\d+)$/.exec(arg);
  if (bare) return { number: Number(bare[1]) };
  const named = /^([^#\s]+)#(\d+)$/.exec(arg);
  if (named) return REPO.test(named[1]!) ? { repo: named[1], number: Number(named[2]) } : { folder: named[1], number: Number(named[2]) };
  throw new Error(`${arg} names no ticket or pull request.\n${FORMS}`);
}

/** The repositories a ticket touches: its Repositories section, or its own repository. */
export function repositories(own: string, body: string): string[] {
  const section = REPOSITORIES.exec(body)?.[1] ?? '';
  const listed = section.split('\n').map((line) => line.replace(/^\s*[-*]\s*/, '').replace(/`/g, '').trim()).filter((line) => REPO.test(line));
  return listed.length ? [...new Set(listed)] : [own];
}

interface Remote { number: number; state: 'open' | 'closed'; body?: string | null; pull_request?: unknown }

function lookup(gh: Gh, repo: string, number: number): Remote | null {
  try {
    return JSON.parse(gh(['api', `repos/${repo}/issues/${number}`])) as Remote;
  } catch (err) {
    if (/HTTP 404|Not Found/.test((err as Error).message)) return null;
    throw err;
  }
}

/** The shortest reference that names the item from where the session runs. */
function refOf(cwd: string, repo: string, number: number, folder: string | null): string {
  if (toplevel(cwd)) return folder === toplevel(cwd) ? `#${number}` : `${repo}#${number}`;
  return folder ? `${path.basename(folder)}#${number}` : `${repo}#${number}`;
}

function locate(cwd: string, parsed: { number: number; repo?: string; folder?: string }, gh: Gh): { repo: string; folder: string | null } {
  if (parsed.repo) return { repo: parsed.repo, folder: folderOf(cwd, parsed.repo) };
  const top = toplevel(cwd);
  if (parsed.folder) {
    const dir = path.join(cwd, parsed.folder);
    const repo = !top && fs.existsSync(path.join(dir, '.git')) ? repoOf(dir) : null;
    if (!repo) throw new Error(`${parsed.folder} is not a GitHub checkout in ${cwd}.\n${FORMS}`);
    return { repo, folder: dir };
  }
  if (top) {
    const repo = repoOf(top);
    if (!repo) throw new Error(`this checkout's origin is not on GitHub: name the item as owner/repo#${parsed.number} or by its URL`);
    return { repo, folder: top };
  }
  const found = checkouts(cwd).flatMap((name) => {
    const repo = repoOf(path.join(cwd, name));
    const item = repo ? lookup(gh, repo, parsed.number) : null;
    return item ? [`${name}#${parsed.number} (${item.pull_request ? 'pull request' : 'issue'})`] : [];
  });
  if (!found.length) throw new Error(`no checkout in ${cwd} has an issue or pull request ${parsed.number}`);
  throw new Error(`#${parsed.number} is ambiguous in a workspace; name its folder: ${found.join(', ')}`);
}

function closingRefs(gh: Gh, repo: string, number: number): string[] {
  const { closingIssuesReferences } = JSON.parse(gh(['pr', 'view', String(number), '-R', repo, '--json', 'closingIssuesReferences'])) as
    { closingIssuesReferences: { number: number; repository: { name: string; owner: { login: string } } }[] };
  return closingIssuesReferences.map((ref) => {
    const other = `${ref.repository.owner.login}/${ref.repository.name}`;
    return other === repo ? `#${ref.number}` : `${other}#${ref.number}`;
  });
}

/**
 * The pull requests, in any of `repos`, that close or carry part of the ticket. A body that only names it, as a
 * `## Sequence` neighbour does, is not one: the search matches any mention, so the body is read for a closing line.
 */
function pullRequestsFor(cwd: string, gh: Gh, item: { repo: string; number: number; repositories: string[] }, state: 'open' | 'merged'): string[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return item.repositories.flatMap((repo) => {
    const named = `(?:https://github\\.com/${escape(item.repo)}/issues/|${escape(item.repo)}#)${item.number}`;
    const ticket = repo === item.repo ? `(?:${named}|#${item.number})` : named;
    const carries = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of)\\s+${ticket}(?!\\d)`, 'i');
    const prs = JSON.parse(gh(['pr', 'list', '-R', repo, '--state', state, '--search', `${item.number} in:body`, '--limit', String(SEARCH_LIMIT), '--json', 'number,body'])) as { number: number; body: string }[];
    return prs.filter((pr) => carries.test(pr.body)).map((pr) => prRef(cwd, repo, pr.number));
  });
}

interface Child { repo: string; number: number; repositories: string[] }

/** An epic's children, from GitHub's sub-issues; a ticket has none. */
function subIssues(gh: Gh, repo: string, number: number): Child[] {
  const children = JSON.parse(gh(['api', `repos/${repo}/issues/${number}/sub_issues`])) as { number: number; body?: string | null; repository_url: string }[];
  return children.map((child) => {
    const own = child.repository_url.replace(/^.*\/repos\//, '');
    return { repo: own, number: child.number, repositories: repositories(own, child.body ?? '') };
  });
}

/** `#n` for a pull request of the checkout the session runs in, `owner/repo#n` otherwise. */
function prRef(cwd: string, repo: string, number: number): string {
  const top = toplevel(cwd);
  return top && repoOf(top) === repo ? `#${number}` : `${repo}#${number}`;
}

function jira(cwd: string, key: string): JiraItem {
  const project = key.split('-')[0]!;
  const top = toplevel(cwd);
  const folders = top ? [top] : checkouts(cwd).map((name) => path.join(cwd, name));
  const names = new RegExp(`\\b${project}\\b`);
  const folder = folders.find((dir) => {
    const agents = path.join(dir, 'AGENTS.md');
    return fs.existsSync(agents) && fs.readFileSync(agents, 'utf-8').split('\n').some((line) => /jira/i.test(line) && names.test(line));
  });
  if (!folder) throw new Error(`no AGENTS.md here names the Jira project ${project}; start the session where the project's checkout is`);
  const repo = repoOf(folder);
  return { tracker: 'jira', key, folder, repositories: repo ? [repo] : [] };
}

export function resolve(arg: string, options: { cwd: string; gh: Gh; for?: Purpose }): Item {
  const { cwd, gh } = options;
  const parsed = parse(arg);
  if ('jira' in parsed) return jira(cwd, parsed.jira);
  const { repo, folder } = locate(cwd, parsed, gh);
  const remote = lookup(gh, repo, parsed.number);
  if (!remote) throw new Error(`${repo} has no issue or pull request ${parsed.number}`);
  const ref = refOf(cwd, repo, parsed.number, folder);
  const item: GitHubItem = {
    tracker: 'github', repo, number: parsed.number, kind: remote.pull_request ? 'pr' : 'issue', state: remote.state, folder,
    repositories: repositories(repo, remote.body ?? ''),
  };
  if (item.kind === 'pr') {
    item.closes = closingRefs(gh, repo, item.number);
    if (options.for === 'build') {
      const tickets = item.closes.map((closed) => `/sdlc:build ${closed}`).join(' or ');
      throw new Error(`${ref} is a pull request: /sdlc:review ${ref} reviews it${tickets ? `; ${tickets} builds a ticket it closes` : ''}`);
    }
    return item;
  }
  const children = subIssues(gh, repo, item.number);
  if (children.length) {
    item.children = children.map((child) => prRef(cwd, child.repo, child.number));
    item.repositories = [...new Set([...item.repositories, ...children.flatMap((child) => child.repositories)])];
  }
  if (options.for === 'build' && item.state === 'closed') {
    item.merged = pullRequestsFor(cwd, gh, item, 'merged');
    if (!item.merged.length) throw new Error(`${ref} is closed: nothing to build`);
  }
  if (options.for === 'review') {
    item.prs = children.length
      ? children.flatMap((child) => pullRequestsFor(cwd, gh, child, 'open'))
      : pullRequestsFor(cwd, gh, item, 'open');
    if (!item.prs.length) throw new Error(`${ref} has no pull request yet: /sdlc:build ${ref} builds one`);
  }
  return item;
}

/** Whether the session's folder holds every repository a ticket touches; throws with where to start instead. */
export function check(cwd: string, repos: string[]): void {
  const top = toplevel(cwd);
  if (!top) {
    const missing = repos.filter((repo) => !folderOf(cwd, repo));
    if (missing.length) throw new Error(`not in ${cwd}: ${missing.join(', ')}; clone each there, or start the session in the folder that holds them`);
    return;
  }
  const own = repoOf(top);
  if (repos.length === 1 && repos[0] === own) return;
  if (repos.length === 1) throw new Error(`this session runs in ${own ?? top}, and the ticket touches ${repos[0]}: start the session in its checkout`);
  const parent = path.dirname(mainCheckout(top));
  const missing = repos.filter((repo) => !folderOf(parent, repo));
  if (missing.length) throw new Error(`the ticket touches ${repos.join(', ')}: clone ${missing.join(', ')} into ${parent}, then cd ${parent} && claude`);
  throw new Error(`the ticket touches ${repos.join(', ')}: start the session in the folder that holds them: cd ${parent} && claude`);
}

/** The ticket a branch name carries: `#N` or a Jira key. */
export function fromBranch(branch: string): string {
  const keys = [...new Set(branch.match(JIRA_KEYS) ?? [])];
  const numbers = keys.length ? [] : [...new Set([...branch.matchAll(BRANCH_NUMBERS)].map((m) => `#${m[1]}`))];
  const found = [...keys, ...numbers];
  if (found.length === 1) return found[0]!;
  throw new Error(found.length ? `branch ${branch} names ${found.join(', ')}; say which ticket` : `branch ${branch} names no ticket; say which ticket`);
}

function realGh(args: string[]): string {
  try {
    return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (err as Error).message);
  }
}

const USAGE = 'usage: item.mts mode | parse <arg> | resolve [--for build|review] <arg> | check <owner/repo>... | from-branch <branch>\n';

export function main(argv: string[], cwd = process.cwd(), gh: Gh = realGh): number {
  const [command, ...args] = argv;
  const out = (value: unknown) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  if (command === 'mode') out(mode(cwd));
  else if (command === 'parse' && args[0]) out(parse(args[0]));
  else if (command === 'resolve') {
    const purpose = args[0] === '--for' ? args.splice(0, 2)[1] : 'any';
    if (!args[0] || !['build', 'review', 'any'].includes(purpose!)) {
      process.stderr.write(`${USAGE}${FORMS}\n`);
      return 2;
    }
    out(resolve(args[0], { cwd, gh, for: purpose as Purpose }));
  } else if (command === 'check' && args.length) check(cwd, args);
  else if (command === 'from-branch' && args[0]) out(fromBranch(args[0]));
  else {
    process.stderr.write(USAGE);
    return 2;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`item.mts: ${(err as Error).message}\n`);
    process.exit(2);
  }
}
