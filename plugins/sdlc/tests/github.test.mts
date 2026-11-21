// The GitHub adapter, both ports, against a fake `gh` that answers the calls it
// makes. Contract: a ticket id is `owner/repo#N`; a missing item is null, not an
// error; a ticket's pull requests are the ones whose body closes or carries it,
// read past gh's default page, never one that only mentions it. Without it, a
// pull request naming a ticket as its `## Sequence` neighbour was taken for
// that ticket's, and the one that closed #1 was the 31st result and never read.
import { describe, expect, test } from 'vitest';
import { github, type Gh } from '../scripts/github.mts';

interface Remote { kind: 'issue' | 'pr'; state?: 'open' | 'closed'; body?: string; closes?: string[]; children?: string[] }
type Pulls = Record<string, { number: number; state: 'open' | 'merged'; body: string }[]>;

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
      const item = remote[`${repo}#${args[2]}`];
      return JSON.stringify({ body: item?.body ?? '', closingIssuesReferences: (item?.closes ?? []).map((ref) => {
        const [owner, name, n] = ref.split(/[/#]/);
        return { number: Number(n), repository: { name, owner: { login: owner } } };
      }) });
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      const search = /^(\S+) in:body$/.exec(args[args.indexOf('--search') + 1]!)![1]!;
      const state = args[args.indexOf('--state') + 1];
      const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 30;
      return JSON.stringify((pulls[repo] ?? []).filter((pr) => pr.state === state && pr.body.includes(search)).slice(0, limit).map(({ number, body }) => ({ number, body })));
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
}

const hub = github(fakeGh({
  'acme/api#12': { kind: 'issue', body: 'Sorts the list.' },
  'acme/api#20': { kind: 'pr', closes: ['acme/api#12', 'acme/web#3'], body: 'Closes #12\nPart of SHOP-41' },
  'acme/api#21': { kind: 'pr', closes: ['acme/api#12'], body: 'Closes #12. Fixes utf-8 decoding of titles.' },
  'acme/api#50': { kind: 'issue', children: ['acme/api#12', 'acme/web#4'] },
  'acme/web#4': { kind: 'issue', body: 'Styles it.' },
}, {
  'acme/api': [
    { number: 40, state: 'open', body: '## Sequence\n\n- Ticket: #12\n\nCloses #12' },
    { number: 41, state: 'open', body: '## Sequence\n\n- Ticket: #11\n- Next: #8, the next ticket\n\nCloses #11' },
    { number: 43, state: 'open', body: 'Closes https://github.com/acme/api/issues/14' },
    ...Array.from({ length: 30 }, (_, i) => ({ number: 100 + i, state: 'merged' as const, body: `Gate: 6${i} tests passed` })),
    { number: 200, state: 'merged', body: 'Closes #6' },
    { number: 44, state: 'open', body: '## Sequence\n\n- Ticket: SHOP-41\n\nCloses SHOP-41' },
    { number: 45, state: 'open', body: 'Follows SHOP-41.' },
  ],
}));

describe('the GitHub tracker', () => {
  test('origins and URLs of GitHub parse, and others do not', () => {
    expect(hub.repoOf('git@github.com:acme/api.git')).toBe('acme/api');
    expect(hub.repoOf('https://github.com/acme/web')).toBe('acme/web');
    expect(hub.repoOf('git@gitlab.example:acme/api.git')).toBeNull();
    expect(hub.parse('https://github.com/acme/web/pull/12/files')).toBe('acme/web#12');
    expect(hub.parse('https://github.com/acme/api/issues/8')).toBe('acme/api#8');
    expect(hub.parse('acme/api#8')).toBe('acme/api#8');
    expect(hub.parse('https://example.com/acme/api/issues/8')).toBeNull();
    expect(hub.parse('SHOP-41')).toBeNull();
  });

  test('a branch name yields the issue number it starts a segment with, never the number of a key', () => {
    for (const branch of ['feat/91-workspace', 'issue-91', 'worktree-issue-91', 'fix-91-thing', 'dsaenz_91_x']) expect(hub.inBranch(branch)).toEqual(['#91']);
    for (const branch of ['SHOP-41-checkout-copy', 'release/v2.0.0', 'main']) expect(hub.inBranch(branch)).toEqual([]);
  });

  test('a missing issue or pull request is null, not an error', async () => {
    expect(await hub.lookup('acme/api#99999')).toBeNull();
    expect(await hub.lookup('acme/api#20')).toMatchObject({ kind: 'pr', state: 'open' });
  });

  test("an epic's children carry their repository and description", async () => {
    expect(await hub.children('acme/api#50')).toEqual([{ id: 'acme/api#12', body: 'Sorts the list.' }, { id: 'acme/web#4', body: 'Styles it.' }]);
  });
});

describe('the GitHub forge', () => {
  test("a pull request's closing references keep their repository", async () => {
    expect(await hub.closes({ repo: 'acme/api', number: 20 })).toEqual(['acme/api#12', 'acme/web#3', 'SHOP-41']);
  });

  test('a lower-case word after a closing verb is not read as a key', async () => {
    expect(await hub.closes({ repo: 'acme/api', number: 21 })).toEqual(['acme/api#12']);
  });

  test("a pull request that only names a ticket as its neighbour is not that ticket's pull request", async () => {
    expect(await hub.pullRequests('acme/api#8', 'acme/api', 'open')).toEqual([]);
    expect(await hub.pullRequests('acme/api#12', 'acme/api', 'open')).toEqual([40]);
  });

  test('a pull request that closes its ticket by URL is its pull request', async () => {
    expect(await hub.pullRequests('acme/api#14', 'acme/api', 'open')).toEqual([43]);
  });

  test("a ticket's closing pull request is found past the first page of pull requests that mention its number", async () => {
    expect(await hub.pullRequests('acme/api#6', 'acme/api', 'merged')).toEqual([200]);
  });

  test("a pull request carrying a Jira key is that ticket's pull request", async () => {
    expect(await hub.pullRequests('SHOP-41', 'acme/api', 'open')).toEqual([44]);
  });
});
