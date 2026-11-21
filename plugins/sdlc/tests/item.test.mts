// What a skill takes from the user, and where it runs. Contract: a session
// runs in one checkout or in a workspace, a folder whose sub-folders are
// checkouts; an argument names a GitHub issue or pull request, or a Jira
// issue, in one of the accepted forms, and anything else is refused with all
// of them; a ticket touches its own repository unless its Repositories section
// names others. Without it, a bare number in a workspace built whichever
// repository came first, and a pull request passed to build was built as a
// ticket.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { check, fromBranch, mode, parse, repositories, resolve, type Gh } from '../scripts/item.mts';

let work: string;

function checkout(dir: string, origin: string, agents?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
  if (agents) fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents);
  return dir;
}

interface Remote { kind: 'issue' | 'pr'; state?: 'open' | 'closed'; body?: string; closes?: string[]; children?: string[] }

/** Pull requests by repository, each with its state and body, as `gh pr list` searches them. */
type Pulls = Record<string, { number: number; state: 'open' | 'merged'; body: string }[]>;

/** A fake `gh` answering the three calls the resolver makes, from a table keyed `owner/repo#n`. */
function fakeGh(remote: Record<string, Remote>, pulls: Pulls = {}): Gh {
  return (args) => {
    const children = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/sub_issues$/.exec(args[1] ?? '');
    if (args[0] === 'api' && children) {
      return JSON.stringify((remote[`${children[1]}#${children[2]}`]?.children ?? []).map((ref) => {
        const [owner, name, n] = ref.split(/[/#]/);
        return { number: Number(n), body: remote[ref]?.body ?? '', repository_url: `https://api.github.com/repos/${owner}/${name}` };
      }));
    }
    const issue = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(args[1] ?? '');
    if (args[0] === 'api' && issue) {
      const item = remote[`${issue[1]}#${issue[2]}`];
      if (!item) throw new Error('gh: Not Found (HTTP 404)');
      return JSON.stringify({ number: Number(issue[2]), state: item.state ?? 'open', body: item.body ?? '', ...(item.kind === 'pr' ? { pull_request: {} } : {}) });
    }
    const repo = args[args.indexOf('-R') + 1]!;
    if (args[0] === 'pr' && args[1] === 'view') {
      const closes = remote[`${repo}#${args[2]}`]?.closes ?? [];
      return JSON.stringify({ closingIssuesReferences: closes.map((ref) => {
        const [, owner, name, n] = /^(?:([^/]+)\/([^#]+))?#(\d+)$/.exec(ref)!;
        const [o, r] = repo.split('/');
        return { number: Number(n), repository: { name: name ?? r, owner: { login: owner ?? o } } };
      }) });
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      const n = /^(\d+) in:body$/.exec(args[args.indexOf('--search') + 1]!)![1]!;
      const state = args[args.indexOf('--state') + 1];
      return JSON.stringify((pulls[repo] ?? []).filter((pr) => pr.state === state && pr.body.includes(n)).map(({ number, body }) => ({ number, body })));
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
}

beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-item-')));
  checkout(path.join(work, 'api'), 'git@github.com:acme/api.git');
  checkout(path.join(work, 'web'), 'https://github.com/acme/web.git');
  checkout(path.join(work, 'shop'), 'git@github.com:acme/shop.git', '# Shop\n\nTickets live in the Jira project SHOP.\n');
});

afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

const api = () => path.join(work, 'api');
const gh = fakeGh({
  'acme/api#12': { kind: 'issue' },
  'acme/web#12': { kind: 'pr', closes: ['#9'] },
  'acme/api#7': { kind: 'issue', state: 'closed' },
  'acme/api#8': { kind: 'issue' },
  'acme/api#20': { kind: 'pr', closes: ['#12', 'acme/web#3'] },
  'acme/api#30': { kind: 'issue', body: 'Spans two.\n\n### Repositories\n\nacme/api\nacme/web\n\n### Tests\n' },
  'acme/api#5': { kind: 'issue', state: 'closed' },
  'acme/api#50': { kind: 'issue', children: ['acme/api#12', 'acme/api#30'] },
  'acme/api#14': { kind: 'issue' },
}, {
  'acme/api': [
    { number: 40, state: 'open', body: '## Sequence\n\n- Ticket: #12\n\nCloses #12' },
    { number: 41, state: 'open', body: '## Sequence\n\n- Ticket: #11\n- Next: #8, the next ticket\n\nCloses #11' },
    { number: 42, state: 'open', body: 'Part of #30' },
    { number: 39, state: 'merged', body: 'Closes #5' },
    { number: 43, state: 'open', body: 'Closes https://github.com/acme/api/issues/14' },
  ],
  'acme/web': [{ number: 7, state: 'open', body: 'Closes acme/api#30' }],
});

describe('where the session runs', () => {
  test('a session folder that is a git checkout runs in checkout mode', () => {
    expect(mode(api())).toBe('checkout');
  });

  test('a folder of checkouts runs in workspace mode', () => {
    expect(mode(work)).toBe('workspace');
  });
});

describe('an argument', () => {
  test("a bare number resolves against the checkout's origin", () => {
    expect(resolve('12', { cwd: api(), gh })).toMatchObject({ tracker: 'github', repo: 'acme/api', number: 12, kind: 'issue', folder: api() });
    expect(resolve('#12', { cwd: api(), gh })).toMatchObject({ repo: 'acme/api', number: 12 });
  });

  test('a bare number in a workspace names every checkout that has it', () => {
    expect(() => resolve('#12', { cwd: work, gh })).toThrow(/api#12 \(issue\).*web#12 \(pull request\)/s);
  });

  test("folder#N resolves against that folder's origin", () => {
    expect(resolve('web#12', { cwd: work, gh })).toMatchObject({ repo: 'acme/web', number: 12, kind: 'pr', folder: path.join(work, 'web') });
  });

  test('owner/repo#N and a GitHub URL resolve anywhere', () => {
    expect(resolve('acme/api#8', { cwd: work, gh })).toMatchObject({ repo: 'acme/api', number: 8, folder: api() });
    expect(resolve('https://github.com/acme/web/pull/12/files', { cwd: api(), gh })).toMatchObject({ repo: 'acme/web', number: 12, kind: 'pr', folder: null });
    expect(parse('https://github.com/acme/api/issues/8')).toEqual({ repo: 'acme/api', number: 8 });
  });

  test("a Jira key resolves only when a checkout's AGENTS.md names its project", () => {
    expect(resolve('SHOP-41', { cwd: work, gh })).toEqual({ tracker: 'jira', key: 'SHOP-41', folder: path.join(work, 'shop'), repositories: ['acme/shop'] });
    expect(resolve('https://acme.atlassian.net/browse/SHOP-41', { cwd: work, gh })).toMatchObject({ key: 'SHOP-41' });
    expect(() => resolve('OPS-3', { cwd: work, gh })).toThrow(/no AGENTS\.md here names the Jira project OPS/);
    expect(resolve('SHOP-41', { cwd: work, gh })).toMatchObject({ repositories: ['acme/shop'] });
  });

  test('a word in an AGENTS.md is not taken for a Jira project unless the line says Jira', () => {
    fs.writeFileSync(path.join(api(), 'AGENTS.md'), '# Api\n\nThe API serves the web client.\n');
    expect(() => resolve('API-3', { cwd: work, gh })).toThrow(/no AGENTS\.md here names the Jira project API/);
  });

  test('an unparseable argument is refused with every accepted form', () => {
    for (const arg of ['foo', 'api#', '12a', 'https://example.com/12']) {
      expect(() => parse(arg)).toThrow(/<folder>#12[\s\S]*owner\/repo#12[\s\S]*PROJ-123/);
    }
  });

  test('a number with no issue or pull request is refused naming the repository', () => {
    expect(() => resolve('99999', { cwd: api(), gh })).toThrow('acme/api has no issue or pull request 99999');
  });

  test('a pull request passed to build names the ticket it closes', () => {
    expect(() => resolve('#20', { cwd: api(), gh, for: 'build' }))
      .toThrow(/#20 is a pull request: \/sdlc:review #20 reviews it; \/sdlc:build #12 or \/sdlc:build acme\/web#3 builds a ticket it closes/);
  });

  test('an issue passed to review with no pull request names build', () => {
    expect(() => resolve('#8', { cwd: api(), gh, for: 'review' })).toThrow('#8 has no pull request yet: /sdlc:build #8 builds one');
    expect(resolve('#12', { cwd: api(), gh, for: 'review' })).toMatchObject({ kind: 'issue', prs: ['#40'] });
  });

  test("a pull request that only names a ticket as its neighbour is not that ticket's pull request", () => {
    expect(() => resolve('#8', { cwd: api(), gh, for: 'review' })).toThrow('#8 has no pull request yet');
  });

  test('a pull request that closes its ticket by URL is its pull request', () => {
    expect(resolve('#14', { cwd: api(), gh, for: 'review' })).toMatchObject({ prs: ['#43'] });
  });

  test("an epic's pull requests are its children's, since none closes the epic", () => {
    expect(resolve('#50', { cwd: api(), gh, for: 'review' })).toMatchObject({ children: ['#12', '#30'], prs: ['#40', '#42', 'acme/web#7'] });
  });

  test("a multi-repository ticket's pull requests are found in every repository it touches", () => {
    expect(resolve('api#30', { cwd: work, gh, for: 'review' })).toMatchObject({ prs: ['acme/api#42', 'acme/web#7'] });
  });

  test('a closed ticket has nothing to build, unless a merged pull request closed it, which build closes out', () => {
    expect(() => resolve('#7', { cwd: api(), gh, for: 'build' })).toThrow('#7 is closed: nothing to build');
    expect(resolve('#5', { cwd: api(), gh, for: 'build' })).toMatchObject({ state: 'closed', merged: ['#39'] });
  });

  test("a branch name carrying one ticket yields it, and none or several yields a question", () => {
    expect(fromBranch('feat/91-workspace')).toBe('#91');
    expect(fromBranch('issue-91')).toBe('#91');
    expect(fromBranch('SHOP-41-checkout-copy')).toBe('SHOP-41');
    expect(() => fromBranch('release/v2.0.0')).toThrow(/names no ticket; say which/);
    expect(() => fromBranch('feat/91-and-93')).toThrow(/#91, #93; say which/);
  });
});

describe('the repositories a ticket touches', () => {
  test('a ticket with no Repositories section touches only its own repository', () => {
    expect(repositories('acme/api', 'Done when the list sorts.\n\n### Tests\n')).toEqual(['acme/api']);
    expect(resolve('#8', { cwd: api(), gh })).toMatchObject({ repositories: ['acme/api'] });
  });

  test("an epic touches every repository its children touch", () => {
    expect(resolve('#50', { cwd: api(), gh })).toMatchObject({ repositories: ['acme/api', 'acme/web'] });
  });

  test('a Repositories section lists every repository the ticket touches', () => {
    expect(resolve('acme/api#30', { cwd: work, gh })).toMatchObject({ repositories: ['acme/api', 'acme/web'] });
  });

  test('a Repositories entry with no checkout in the workspace names the repository to clone', () => {
    expect(() => check(work, ['acme/api', 'acme/docs'])).toThrow(/acme\/docs.*clone/);
    expect(() => check(work, ['acme/api', 'acme/web'])).not.toThrow();
  });

  test('a session started inside one checkout for a multi-repository ticket names the parent folder', () => {
    expect(() => check(api(), ['acme/api', 'acme/web'])).toThrow(`cd ${work} && claude`);
    expect(() => check(api(), ['acme/api'])).not.toThrow();
  });

  test("a session in a worktree of a checkout names the folder that holds the checkout, not the worktree's", () => {
    execFileSync('git', ['-C', api(), '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'base']);
    const worktree = path.join(api(), '.claude', 'worktrees', 'issue-30');
    execFileSync('git', ['-C', api(), 'worktree', 'add', '-q', worktree]);
    expect(() => check(worktree, ['acme/api', 'acme/web'])).toThrow(`cd ${work} && claude`);
  });

  test("a ticket of another repository is refused in a checkout, naming where to start", () => {
    expect(() => check(api(), ['acme/web'])).toThrow(/acme\/web.*start the session in its checkout/);
  });
});
