// What a skill takes from the user, and where it runs, through the tracker and
// forge ports. Contract: a session runs in one checkout or in a workspace, a
// folder whose sub-folders are checkouts; an argument names a ticket or pull
// request in one of the accepted forms, and anything else is refused with all
// of them; a ticket touches its own repository unless its Repositories section
// names others. Without it, a bare number in a workspace built whichever
// repository came first, and a pull request passed to build was built as a
// ticket. The ports here are in-memory fakes: a forge-native tracker, "Hub",
// and a key-based one, "Jira"; the real adapters have suites of their own.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Forge, Tracker } from '../scripts/ports.mts';
import { check, fromBranch, mode, parse, repositories, resolve, type Ports } from '../scripts/resolver.mts';

let work: string;

function checkout(dir: string, origin: string, agents?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
  if (agents) fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents);
  return dir;
}

interface Remote { kind: 'issue' | 'pr'; state?: 'open' | 'closed'; body?: string; closes?: string[]; children?: string[] }
/** Pull requests by repository, each with the ticket ids it closes or carries. */
type Pulls = Record<string, { number: number; state: 'open' | 'merged'; carries: string[] }[]>;

function fakePorts(remote: Record<string, Remote>, pulls: Pulls): Ports {
  const lookup = async (id: string) => {
    const item = remote[id];
    return item ? { kind: item.kind, state: item.state ?? 'open', body: item.body ?? '' } : null;
  };
  const children = async (id: string) => (remote[id]?.children ?? []).map((child) => ({ id: child, body: remote[child]?.body ?? '' }));
  const hub: Tracker & Forge = {
    name: 'Hub',
    forms: ['https://hub.test/owner/repo/12'],
    parse: (arg) => {
      const url = /^https:\/\/hub\.test\/([^/]+\/[^/]+)\/(\d+)$/.exec(arg);
      if (url) return `${url[1]}#${url[2]}`;
      return /^[\w.-]+\/[\w.-]+#\d+$/.test(arg) ? arg : null;
    },
    inBranch: (branch) => [...branch.matchAll(/(?:^|\/)(?:issue-)?(\d+)(?=[-_/]|$)/g)].map((m) => `#${m[1]}`),
    place: (id) => {
      const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(id);
      return match ? { repo: match[1]!, number: Number(match[2]) } : null;
    },
    project: () => null,
    lookup,
    children,
    repoOf: (origin) => /[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(origin)?.[1] ?? null,
    closes: async ({ repo, number }) => remote[`${repo}#${number}`]?.closes ?? [],
    pullRequests: async (ticket, repo, state) => (pulls[repo] ?? []).filter((pr) => pr.state === state && pr.carries.includes(ticket)).map((pr) => pr.number),
  };
  const keys: Tracker = {
    name: 'Jira',
    forms: ['PROJ-123'],
    parse: (arg) => (/^[A-Z][A-Z0-9]+-\d+$/.test(arg) ? arg : null),
    inBranch: (branch) => [...new Set(branch.match(/(?<![A-Za-z0-9])[A-Z][A-Z0-9]+-\d+(?!\d)/g) ?? [])],
    place: () => null,
    project: (id) => id.split('-')[0]!,
    lookup,
    children,
  };
  return { trackers: [hub, keys], forge: hub };
}

beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-item-')));
  checkout(path.join(work, 'api'), 'git@hub.test:acme/api.git');
  checkout(path.join(work, 'web'), 'https://hub.test/acme/web.git');
  checkout(path.join(work, 'shop'), 'git@hub.test:acme/shop.git', '# Shop\n\nTickets live in the Jira project SHOP.\n');
});

afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

const api = () => path.join(work, 'api');
const ports = fakePorts({
  'acme/api#12': { kind: 'issue' },
  'acme/web#12': { kind: 'pr', closes: ['acme/web#9'] },
  'acme/api#7': { kind: 'issue', state: 'closed' },
  'acme/api#8': { kind: 'issue' },
  'acme/api#20': { kind: 'pr', closes: ['acme/api#12', 'acme/web#3'] },
  'acme/api#30': { kind: 'issue', body: 'Spans two.\n\n### Repositories\n\nacme/api\nacme/web\n\n### Tests\n' },
  'acme/api#5': { kind: 'issue', state: 'closed' },
  'acme/api#50': { kind: 'issue', children: ['acme/api#12', 'acme/api#30'] },
  'SHOP-41': { kind: 'issue' },
}, {
  'acme/api': [
    { number: 40, state: 'open', carries: ['acme/api#12'] },
    { number: 42, state: 'open', carries: ['acme/api#30'] },
    { number: 39, state: 'merged', carries: ['acme/api#5'] },
  ],
  'acme/web': [{ number: 7, state: 'open', carries: ['acme/api#30'] }],
  'acme/shop': [{ number: 9, state: 'open', carries: ['SHOP-41'] }],
});
const at = (cwd: string, extra: object = {}) => ({ cwd, ...ports, ...extra });

describe('where the session runs', () => {
  test('a session folder that is a git checkout runs in checkout mode', () => {
    expect(mode(api())).toBe('checkout');
  });

  test('a folder of checkouts runs in workspace mode', () => {
    expect(mode(work)).toBe('workspace');
  });
});

describe('an argument', () => {
  test("a bare number resolves against the checkout's origin", async () => {
    expect(await resolve('12', at(api()))).toMatchObject({ tracker: 'Hub', id: 'acme/api#12', ref: '#12', kind: 'issue', folder: api() });
    expect(await resolve('#12', at(api()))).toMatchObject({ id: 'acme/api#12' });
  });

  test('a bare number in a workspace names every checkout that has it', async () => {
    await expect(resolve('#12', at(work))).rejects.toThrow(/api#12 \(issue\).*web#12 \(pull request\)/s);
  });

  test("folder#N resolves against that folder's origin", async () => {
    expect(await resolve('web#12', at(work))).toMatchObject({ id: 'acme/web#12', ref: 'web#12', kind: 'pr', folder: path.join(work, 'web') });
  });

  test("owner/repo#N and a tracker's URL resolve anywhere", async () => {
    expect(await resolve('acme/api#8', at(work))).toMatchObject({ id: 'acme/api#8', folder: api() });
    expect(await resolve('https://hub.test/acme/web/12', at(api()))).toMatchObject({ id: 'acme/web#12', kind: 'pr', folder: null });
  });

  test("a Jira key resolves only when a checkout's AGENTS.md names its project", async () => {
    expect(await resolve('SHOP-41', at(work))).toMatchObject({ tracker: 'Jira', id: 'SHOP-41', ref: 'SHOP-41', folder: path.join(work, 'shop'), repositories: ['acme/shop'] });
    await expect(resolve('OPS-3', at(work))).rejects.toThrow(/no AGENTS\.md here names the Jira project OPS/);
  });

  test('a word in an AGENTS.md is not taken for a Jira project unless the line says Jira', async () => {
    fs.writeFileSync(path.join(api(), 'AGENTS.md'), '# Api\n\nThe API serves the web client.\n');
    await expect(resolve('API-3', at(work))).rejects.toThrow(/no AGENTS\.md here names the Jira project API/);
  });

  test('a ticket of a second tracker resolves through the same core', async () => {
    expect(await resolve('SHOP-41', at(work, { for: 'review' }))).toMatchObject({ tracker: 'Jira', prs: ['acme/shop#9'] });
  });

  test('an unparseable argument is refused with every accepted form', () => {
    for (const arg of ['foo', 'api#', '12a', 'https://example.com/12']) {
      expect(() => parse(arg, ports)).toThrow(/<folder>#12[\s\S]*owner\/repo#12[\s\S]*hub\.test[\s\S]*PROJ-123/);
    }
  });

  test('a number with no issue or pull request is refused naming the repository', async () => {
    await expect(resolve('99999', at(api()))).rejects.toThrow('acme/api has no issue or pull request 99999');
  });

  test('a pull request passed to build names the ticket it closes', async () => {
    await expect(resolve('#20', at(api(), { for: 'build' })))
      .rejects.toThrow(/#20 is a pull request: \/sdlc:review #20 reviews it; \/sdlc:build #12 or \/sdlc:build acme\/web#3 builds a ticket it closes/);
  });

  test('an issue passed to review with no pull request names build', async () => {
    await expect(resolve('#8', at(api(), { for: 'review' }))).rejects.toThrow('#8 has no pull request yet: /sdlc:build #8 builds one');
    expect(await resolve('#12', at(api(), { for: 'review' }))).toMatchObject({ kind: 'issue', prs: ['#40'] });
  });

  test("an epic's pull requests are its children's, since none closes the epic", async () => {
    expect(await resolve('#50', at(api(), { for: 'review' }))).toMatchObject({ children: ['#12', '#30'], prs: ['#40', '#42', 'acme/web#7'] });
  });

  test("a multi-repository ticket's pull requests are found in every repository it touches", async () => {
    expect(await resolve('api#30', at(work, { for: 'review' }))).toMatchObject({ prs: ['acme/api#42', 'acme/web#7'] });
  });

  test('a closed ticket has nothing to build, unless a merged pull request closed it, which build closes out', async () => {
    await expect(resolve('#7', at(api(), { for: 'build' }))).rejects.toThrow('#7 is closed: nothing to build');
    expect(await resolve('#5', at(api(), { for: 'build' }))).toMatchObject({ state: 'closed', merged: ['#39'] });
  });

  test('a branch name carrying one ticket yields it, and none or several yields a question', () => {
    expect(fromBranch('feat/91-workspace', ports.trackers)).toBe('#91');
    expect(fromBranch('issue-91', ports.trackers)).toBe('#91');
    expect(fromBranch('SHOP-41-checkout-copy', ports.trackers)).toBe('SHOP-41');
    expect(() => fromBranch('release/v2.0.0', ports.trackers)).toThrow(/names no ticket; say which/);
    expect(() => fromBranch('91-and-SHOP-41', ports.trackers)).toThrow(/#91, SHOP-41; say which/);
  });
});

describe('the repositories a ticket touches', () => {
  test('a ticket with no Repositories section touches only its own repository', async () => {
    expect(repositories('acme/api', 'Done when the list sorts.\n\n### Tests\n')).toEqual(['acme/api']);
    expect(await resolve('#8', at(api()))).toMatchObject({ repositories: ['acme/api'] });
  });

  test('an epic touches every repository its children touch', async () => {
    expect(await resolve('#50', at(api()))).toMatchObject({ repositories: ['acme/api', 'acme/web'] });
  });

  test('a Repositories section lists every repository the ticket touches', async () => {
    expect(await resolve('acme/api#30', at(work))).toMatchObject({ repositories: ['acme/api', 'acme/web'] });
  });

  test('a Repositories entry with no checkout in the workspace names the repository to clone', () => {
    expect(() => check(work, ['acme/api', 'acme/docs'], ports.forge)).toThrow(/acme\/docs.*clone/);
    expect(() => check(work, ['acme/api', 'acme/web'], ports.forge)).not.toThrow();
  });

  test('a session started inside one checkout for a multi-repository ticket names the parent folder', () => {
    expect(() => check(api(), ['acme/api', 'acme/web'], ports.forge)).toThrow(`cd ${work} && claude`);
    expect(() => check(api(), ['acme/api'], ports.forge)).not.toThrow();
  });

  test("a session in a worktree of a checkout names the folder that holds the checkout, not the worktree's", () => {
    execFileSync('git', ['-C', api(), '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'base']);
    const worktree = path.join(api(), '.claude', 'worktrees', 'issue-30');
    execFileSync('git', ['-C', api(), 'worktree', 'add', '-q', worktree]);
    expect(() => check(worktree, ['acme/api', 'acme/web'], ports.forge)).toThrow(`cd ${work} && claude`);
  });

  test('a ticket of another repository is refused in a checkout, naming where to start', () => {
    expect(() => check(api(), ['acme/web'], ports.forge)).toThrow(/acme\/web.*start the session in its checkout/);
  });
});
