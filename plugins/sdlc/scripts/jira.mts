// The Jira adapter of the tracker port, over Jira Cloud's REST API v3 with
// Node's own fetch, so nothing is installed. Its ticket id is the issue key.
// The site and the credentials are required settings with no default:
// JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.
import type { Ticket, Tracker } from './ports.mts';

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
/** A key inside a branch name, where `_` beside it is a separator, though `\b` counts it as part of a word. */
const KEYS = /(?<![A-Za-z0-9])[A-Z][A-Z0-9]+-\d+(?!\d)/g;
const BROWSE = /^https?:\/\/[^/]+\/browse\/([A-Z][A-Z0-9]+-\d+)(?:[/?#].*)?$/;
const SETTINGS = { baseUrl: 'JIRA_BASE_URL', email: 'JIRA_EMAIL', token: 'JIRA_API_TOKEN' } as const;

export interface JiraSettings { baseUrl?: string; email?: string; token?: string }

export const fromEnv = (env: NodeJS.ProcessEnv = process.env): JiraSettings =>
  ({ baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN });

/** A node of the Atlassian Document Format a description is written in. */
interface Doc { type: string; text?: string; attrs?: { level?: number }; content?: Doc[] }

/** A description as plain text, with headings as `#` lines and list items as `- ` lines, enough for its sections. */
export function docText(node: Doc | null | undefined): string {
  if (!node) return '';
  const inner = (n: Doc) => (n.content ?? []).map(docText).join('');
  switch (node.type) {
    case 'text': return node.text ?? '';
    case 'hardBreak': return '\n';
    case 'heading': return `${'#'.repeat(node.attrs?.level ?? 1)} ${inner(node)}\n\n`;
    case 'paragraph':
    case 'codeBlock': return `${inner(node)}\n\n`;
    case 'listItem': return `- ${inner(node).trim()}\n`;
    case 'bulletList':
    case 'orderedList': return `${inner(node)}\n`;
    default: return inner(node);
  }
}

interface Issue { key: string; fields: { status?: { statusCategory?: { key?: string } }; description?: Doc | null } }

export function jira(settings: JiraSettings, http: typeof fetch = fetch): Tracker {
  function ready(): Required<JiraSettings> {
    for (const [field, variable] of Object.entries(SETTINGS)) {
      if (!settings[field as keyof JiraSettings]) throw new Error(`${variable} is not set: a Jira ticket needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN`);
    }
    return settings as Required<JiraSettings>;
  }

  async function get<T>(path: string): Promise<T | null> {
    const { baseUrl, email, token } = ready();
    const response = await http(new URL(path, baseUrl), {
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Jira answered ${response.status} for ${path}`);
    return (await response.json()) as T;
  }

  return {
    name: 'Jira',
    forms: ['PROJ-123, or its Jira browse URL (with JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN set, and an AGENTS.md line naming the Jira project PROJ)'],

    parse(arg) {
      const browse = BROWSE.exec(arg);
      if (browse) {
        const site = settings.baseUrl ? new URL(settings.baseUrl).host : null;
        return site === null || new URL(arg).host === site ? browse[1]! : null;
      }
      return KEY.test(arg) ? arg : null;
    },

    inBranch(branch) {
      return [...new Set(branch.match(KEYS) ?? [])];
    },

    place: () => null,

    project: (id) => id.split('-')[0]!,

    async lookup(id) {
      const issue = await get<Issue>(`/rest/api/3/issue/${encodeURIComponent(id)}?fields=status,description`);
      if (!issue) return null;
      const state: Ticket['state'] = issue.fields.status?.statusCategory?.key === 'done' ? 'closed' : 'open';
      return { kind: 'issue', state, body: docText(issue.fields.description) };
    },

    async children(id) {
      const children: { id: string; body: string }[] = [];
      let page: string | undefined;
      do {
        const query = new URLSearchParams({ jql: `parent = ${id}`, fields: 'description', maxResults: '100', ...(page ? { nextPageToken: page } : {}) });
        const result = await get<{ issues: Issue[]; nextPageToken?: string }>(`/rest/api/3/search/jql?${query}`);
        for (const issue of result?.issues ?? []) children.push({ id: issue.key, body: docText(issue.fields.description) });
        page = result?.nextPageToken;
      } while (page);
      return children;
    },
  };
}
