// The GitHub adapter, through the `gh` CLI. GitHub is both ports: its issues
// are a tracker, whose ticket id is `owner/repo#12`, and its pull requests are
// the forge every tracker's tickets are built on.
import { execFileSync } from 'node:child_process';
import type { Forge, Place, Ticket, Tracker } from './ports.mts';

/** git@github.com:o/r.git, ssh://git@github.com/o/r, https://github.com/o/r[.git] */
const ORIGIN = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;
const URL_ITEM = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/;
const ID = /^([\w.-]+\/[\w.-]+)#(\d+)$/;
/** An issue number a branch name starts with, or starts a path segment with: `91-slug`, `feat/91-slug`, `issue-91`. */
const BRANCH_NUMBERS = /(?:^|\/)(?:issue-|gh-)?(\d+)(?=[-_/]|$)/g;
/** Another tracker's key, as a pull request carries it: `PROJ-123`. */
const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const KEYS_CLOSED = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of)\s+([A-Z][A-Z0-9]+-\d+)\b/gi;
const VERBS = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of)';
/** How many pull requests a search reads: `gh` returns 30 by default, and a low ticket number appears in many bodies. */
const SEARCH_LIMIT = 1000;

export type Gh = (args: string[]) => string;

function realGh(args: string[]): string {
  try {
    return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (err as Error).message);
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const place = (id: string): Place | null => {
  const match = ID.exec(id);
  return match ? { repo: match[1]!, number: Number(match[2]) } : null;
};

export function github(gh: Gh = realGh): Tracker & Forge {
  const json = <T,>(args: string[]) => JSON.parse(gh(args)) as T;
  return {
    name: 'GitHub',
    forms: ['https://github.com/owner/repo/issues/12, or /pull/12'],

    parse(arg) {
      const url = URL_ITEM.exec(arg);
      if (url) return `${url[1]}/${url[2]}#${url[3]}`;
      return ID.test(arg) ? arg : null;
    },

    inBranch(branch) {
      return [...new Set([...branch.matchAll(BRANCH_NUMBERS)].map((m) => `#${m[1]}`))];
    },

    place,

    project: () => null,

    async lookup(id) {
      const { repo, number } = place(id)!;
      try {
        const item = json<{ state: Ticket['state']; body?: string | null; pull_request?: unknown }>(['api', `repos/${repo}/issues/${number}`]);
        return { kind: item.pull_request ? 'pr' : 'issue', state: item.state, body: item.body ?? '' };
      } catch (err) {
        if (/HTTP 404|Not Found/.test((err as Error).message)) return null;
        throw err;
      }
    },

    async children(id) {
      const { repo, number } = place(id)!;
      const children = json<{ number: number; body?: string | null; repository_url: string }[]>(['api', `repos/${repo}/issues/${number}/sub_issues`]);
      return children.map((child) => ({ id: `${child.repository_url.replace(/^.*\/repos\//, '')}#${child.number}`, body: child.body ?? '' }));
    },

    repoOf(origin) {
      const match = ORIGIN.exec(origin);
      return match ? `${match[1]}/${match[2]}` : null;
    },

    async closes({ repo, number }) {
      const pr = json<{ body?: string; closingIssuesReferences: { number: number; repository: { name: string; owner: { login: string } } }[] }>(
        ['pr', 'view', String(number), '-R', repo, '--json', 'closingIssuesReferences,body']);
      const issues = pr.closingIssuesReferences.map((ref) => `${ref.repository.owner.login}/${ref.repository.name}#${ref.number}`);
      const keys = [...(pr.body ?? '').matchAll(KEYS_CLOSED)].map((m) => m[1]!.toUpperCase());
      return [...new Set([...issues, ...keys])];
    },

    // The search matches any mention, a `## Sequence` neighbour included, so each body is read for a line that closes
    // or carries the ticket: by reference or URL for a GitHub issue, by key for another tracker's ticket.
    async pullRequests(ticket, repo, state) {
      const issue = place(ticket);
      let search: string;
      let reference: string;
      if (issue) {
        const named = `(?:https://github\\.com/${escape(issue.repo)}/issues/|${escape(issue.repo)}#)${issue.number}`;
        search = String(issue.number);
        reference = repo === issue.repo ? `(?:${named}|#${issue.number})(?!\\d)` : `${named}(?!\\d)`;
      } else if (KEY.test(ticket)) {
        search = ticket;
        reference = `${escape(ticket)}\\b`;
      } else {
        return [];
      }
      const carries = new RegExp(`\\b${VERBS}\\s+${reference}`, 'i');
      const prs = json<{ number: number; body: string }[]>(['pr', 'list', '-R', repo, '--state', state, '--search', `${search} in:body`,
        '--limit', String(SEARCH_LIMIT), '--json', 'number,body']);
      return prs.filter((pr) => carries.test(pr.body)).map((pr) => pr.number);
    },
  };
}
