// What a skill takes from the user, resolved through the tracker and forge
// ports and nothing else: this module knows no provider.
//
// The session runs in one checkout, or in a workspace: a folder whose
// sub-folders are checkouts, one per repository. A ticket touches its own
// repository unless a `### Repositories` section in its description lists every
// repository it touches, its own included. A tracker whose tickets name no
// repository, such as one with project keys, gets its own repository from the
// checkout whose AGENTS.md has a line naming the tracker and the project.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Forge, Tracker } from './ports.mts';

const REPOSITORIES = /^#{2,4}\s+Repositories\s*$([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/m;
const REPO = /^[\w.-]+\/[\w.-]+$/;

export type Mode = 'checkout' | 'workspace';
export type Purpose = 'build' | 'review' | 'any';
export interface Ports { trackers: Tracker[]; forge: Forge }

export interface Item {
  /** The tracker's name. */
  tracker: string;
  /** The tracker's own id for the ticket or pull request. */
  id: string;
  /** The shortest reference that names it from where the session runs. */
  ref: string;
  kind: 'issue' | 'pr';
  state: 'open' | 'closed';
  /** The checkout that holds its repository, or null when none here does. */
  folder: string | null;
  repositories: string[];
  /** For a pull request: the tickets it closes. */
  closes?: string[];
  /** For a ticket resolved for review: its open pull requests, in every repository it touches; for an epic, its children's. */
  prs?: string[];
  /** For a closed ticket resolved for build: the merged pull requests that closed it. */
  merged?: string[];
  /** For an epic: its children. */
  children?: string[];
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
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

const repoOf = (dir: string, forge: Forge) => forge.repoOf(git(dir, ['remote', 'get-url', 'origin']) ?? '');

/** The folder here that holds `repo`: the checkout itself, or a sub-folder of the workspace. */
function folderOf(cwd: string, repo: string, forge: Forge): string | null {
  const top = toplevel(cwd);
  if (top) return repoOf(top, forge) === repo ? top : null;
  const name = checkouts(cwd).find((folder) => repoOf(path.join(cwd, folder), forge) === repo);
  return name ? path.join(cwd, name) : null;
}

export function forms({ trackers, forge }: Ports): string {
  return [
    'Accepted forms:',
    `  12, #12          issue or pull request 12 of this checkout's ${forge.name} origin (in a checkout)`,
    `  <folder>#12      issue or pull request 12 of that sub-folder's origin (in a workspace)`,
    '  owner/repo#12    that repository\'s issue or pull request (anywhere)',
    ...trackers.flatMap((tracker) => tracker.forms).map((line) => `  ${line}`),
  ].join('\n');
}

type Parsed = { tracker: Tracker; id: string } | { number: number; folder?: string };

export function parse(arg: string, ports: Ports): Parsed {
  for (const tracker of ports.trackers) {
    const id = tracker.parse(arg);
    if (id) return { tracker, id };
  }
  const bare = /^#?(\d+)$/.exec(arg);
  if (bare) return { number: Number(bare[1]) };
  const named = /^([^#\s/]+)#(\d+)$/.exec(arg);
  if (named) return { folder: named[1], number: Number(named[2]) };
  throw new Error(`${arg} names no ticket or pull request.\n${forms(ports)}`);
}

/** The repositories a ticket touches: its Repositories section, or its own repository. */
export function repositories(own: string | null, body: string): string[] {
  const section = REPOSITORIES.exec(body)?.[1] ?? '';
  const listed = section.split('\n').map((line) => line.replace(/^\s*[-*]\s*/, '').replace(/`/g, '').trim()).filter((line) => REPO.test(line));
  return listed.length ? [...new Set(listed)] : own ? [own] : [];
}

/** The tracker whose id this is: the one that reads it back as itself. */
function owner(id: string, ports: Ports): Tracker | null {
  return ports.trackers.find((tracker) => tracker.parse(id) === id) ?? null;
}

/** `#n` for an item of the checkout the session runs in, `owner/repo#n` otherwise. */
function placeRef(cwd: string, repo: string, number: number, forge: Forge): string {
  const top = toplevel(cwd);
  return top && repoOf(top, forge) === repo ? `#${number}` : `${repo}#${number}`;
}

/** The shortest reference that names an id from where the session runs. */
function refOf(cwd: string, id: string, ports: Ports, folder: string | null = null): string {
  const place = owner(id, ports)?.place(id);
  if (!place) return id;
  if (!toplevel(cwd) && folder) return `${path.basename(folder)}#${place.number}`;
  return placeRef(cwd, place.repo, place.number, ports.forge);
}

async function identify(arg: string, cwd: string, ports: Ports): Promise<{ tracker: Tracker; id: string }> {
  const parsed = parse(arg, ports);
  if ('id' in parsed) return parsed;
  const { forge } = ports;
  const numbered = (repo: string) => {
    const id = `${repo}#${parsed.number}`;
    const tracker = owner(id, ports);
    if (!tracker) throw new Error(`no tracker here reads ${id}`);
    return { tracker, id };
  };
  const top = toplevel(cwd);
  if (parsed.folder) {
    const dir = path.join(cwd, parsed.folder);
    const repo = !top && fs.existsSync(path.join(dir, '.git')) ? repoOf(dir, forge) : null;
    if (!repo) throw new Error(`${parsed.folder} is not a ${forge.name} checkout in ${cwd}.\n${forms(ports)}`);
    return numbered(repo);
  }
  if (top) {
    const repo = repoOf(top, forge);
    if (!repo) throw new Error(`this checkout's origin is not on ${forge.name}: name the item as owner/repo#${parsed.number} or by its URL`);
    return numbered(repo);
  }
  const found: string[] = [];
  for (const name of checkouts(cwd)) {
    const repo = repoOf(path.join(cwd, name), forge);
    if (!repo) continue;
    const { tracker, id } = numbered(repo);
    const ticket = await tracker.lookup(id);
    if (ticket) found.push(`${name}#${parsed.number} (${ticket.kind === 'pr' ? 'pull request' : 'issue'})`);
  }
  if (!found.length) throw new Error(`no checkout in ${cwd} has an issue or pull request ${parsed.number}`);
  throw new Error(`#${parsed.number} is ambiguous in a workspace; name its folder: ${found.join(', ')}`);
}

/** The repository of a ticket whose id names none: the checkout whose AGENTS.md has a line naming the tracker and the project. */
function projectRepo(cwd: string, tracker: Tracker, project: string, forge: Forge): { repo: string | null; folder: string } {
  const top = toplevel(cwd);
  const folders = top ? [top] : checkouts(cwd).map((name) => path.join(cwd, name));
  const tracks = new RegExp(`\\b${tracker.name}\\b`, 'i');
  const names = new RegExp(`\\b${project}\\b`);
  const folder = folders.find((dir) => {
    const agents = path.join(dir, 'AGENTS.md');
    return fs.existsSync(agents) && fs.readFileSync(agents, 'utf-8').split('\n').some((line) => tracks.test(line) && names.test(line));
  });
  if (!folder) throw new Error(`no AGENTS.md here names the ${tracker.name} project ${project}; start the session where the project's checkout is`);
  return { repo: repoOf(folder, forge), folder };
}

async function pullRequestsFor(cwd: string, forge: Forge, ticket: string, repos: string[], state: 'open' | 'merged'): Promise<string[]> {
  const refs: string[] = [];
  for (const repo of repos) for (const number of await forge.pullRequests(ticket, repo, state)) refs.push(placeRef(cwd, repo, number, forge));
  return refs;
}

export async function resolve(arg: string, options: { cwd: string; for?: Purpose } & Ports): Promise<Item> {
  const { cwd, forge } = options;
  const ports: Ports = { trackers: options.trackers, forge };
  const { tracker, id } = await identify(arg, cwd, ports);
  const place = tracker.place(id);
  const project = place ? null : tracker.project(id);
  const home = place ? { repo: place.repo, folder: folderOf(cwd, place.repo, forge) }
    : project ? projectRepo(cwd, tracker, project, forge) : { repo: null, folder: null };
  const ticket = await tracker.lookup(id);
  if (!ticket) throw new Error(place ? `${place.repo} has no issue or pull request ${place.number}` : `${tracker.name} has no ticket ${id}`);
  const ref = refOf(cwd, id, ports, home.folder);
  const item: Item = {
    tracker: tracker.name, id, ref, kind: ticket.kind, state: ticket.state, folder: home.folder,
    repositories: repositories(home.repo, ticket.body),
  };

  if (item.kind === 'pr') {
    item.closes = (await forge.closes(place!)).map((closed) => refOf(cwd, closed, ports));
    if (options.for === 'build') {
      const tickets = item.closes.map((closed) => `/sdlc:build ${closed}`).join(' or ');
      throw new Error(`${ref} is a pull request: /sdlc:review ${ref} reviews it${tickets ? `; ${tickets} builds a ticket it closes` : ''}`);
    }
    return item;
  }

  const children = (await tracker.children(id)).map((child) => {
    const own = tracker.place(child.id)?.repo ?? home.repo;
    return { id: child.id, repositories: repositories(own, child.body) };
  });
  if (children.length) {
    item.children = children.map((child) => refOf(cwd, child.id, ports));
    item.repositories = [...new Set([...item.repositories, ...children.flatMap((child) => child.repositories)])];
  }
  if (options.for === 'build' && item.state === 'closed') {
    item.merged = await pullRequestsFor(cwd, forge, id, item.repositories, 'merged');
    if (!item.merged.length) throw new Error(`${ref} is closed: nothing to build`);
  }
  if (options.for === 'review') {
    item.prs = [];
    for (const child of children.length ? children : [{ id, repositories: item.repositories }]) {
      item.prs.push(...await pullRequestsFor(cwd, forge, child.id, child.repositories, 'open'));
    }
    if (!item.prs.length) throw new Error(`${ref} has no pull request yet: /sdlc:build ${ref} builds one`);
  }
  return item;
}

/** Whether the session's folder holds every repository a ticket touches; throws with where to start instead. */
export function check(cwd: string, repos: string[], forge: Forge): void {
  const top = toplevel(cwd);
  if (!top) {
    const missing = repos.filter((repo) => !folderOf(cwd, repo, forge));
    if (missing.length) throw new Error(`not in ${cwd}: ${missing.join(', ')}; clone each there, or start the session in the folder that holds them`);
    return;
  }
  const own = repoOf(top, forge);
  if (repos.length === 1 && repos[0] === own) return;
  if (repos.length === 1) throw new Error(`this session runs in ${own ?? top}, and the ticket touches ${repos[0]}: start the session in its checkout`);
  const parent = path.dirname(mainCheckout(top));
  const missing = repos.filter((repo) => !folderOf(parent, repo, forge));
  if (missing.length) throw new Error(`the ticket touches ${repos.join(', ')}: clone ${missing.join(', ')} into ${parent}, then cd ${parent} && claude`);
  throw new Error(`the ticket touches ${repos.join(', ')}: start the session in the folder that holds them: cd ${parent} && claude`);
}

/** The ticket a branch name carries, as an argument any tracker here reads. */
export function fromBranch(branch: string, trackers: Tracker[]): string {
  const found = [...new Set(trackers.flatMap((tracker) => tracker.inBranch(branch)))];
  if (found.length === 1) return found[0]!;
  throw new Error(found.length ? `branch ${branch} names ${found.join(', ')}; say which ticket` : `branch ${branch} names no ticket; say which ticket`);
}
