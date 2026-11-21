// The Jira adapter of the tracker port, against a fake fetch answering recorded
// REST v3 responses. Contract: a ticket id is the issue key; the site and the
// credentials are required settings, refused by name when unset; a done status
// category is closed; a description's sections survive the flattening of
// Jira's document format, so a Repositories section is read as on GitHub.
import { describe, expect, test } from 'vitest';
import { docText, jira, type JiraSettings } from '../scripts/jira.mts';

const SITE: JiraSettings = { baseUrl: 'https://acme.atlassian.net', email: 'dev@example.com', token: 'not-a-real-token' };

const doc = (...content: object[]) => ({ type: 'doc', version: 1, content });
const heading = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const paragraph = (...lines: string[]) => ({
  type: 'paragraph',
  content: lines.flatMap((text, i) => (i ? [{ type: 'hardBreak' }, { type: 'text', text }] : [{ type: 'text', text }])),
});
const bullets = (...items: string[]) => ({ type: 'bulletList', content: items.map((text) => ({ type: 'listItem', content: [paragraph(text)] })) });

const ISSUES: Record<string, object> = {
  'SHOP-41': { key: 'SHOP-41', fields: { status: { statusCategory: { key: 'indeterminate' } }, description: doc(paragraph('Spans two.'), heading(3, 'Repositories'), bullets('acme/shop', 'acme/web'), heading(3, 'Tests')) } },
  'SHOP-7': { key: 'SHOP-7', fields: { status: { statusCategory: { key: 'done' } }, description: null } },
};

/** A fake fetch answering the issue and JQL search calls the adapter makes, and recording each URL. */
function fakeFetch(seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seen.push(url.pathname + url.search);
    const issue = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname);
    if (issue) {
      const found = ISSUES[decodeURIComponent(issue[1]!)];
      return new Response(JSON.stringify(found ?? { errorMessages: ['Issue does not exist'] }), { status: found ? 200 : 404 });
    }
    if (url.pathname === '/rest/api/3/search/jql') {
      const parent = /^parent = (\S+)$/.exec(url.searchParams.get('jql') ?? '')?.[1];
      const page = url.searchParams.get('nextPageToken');
      if (parent === 'SHOP-1' && !page) return new Response(JSON.stringify({ issues: [ISSUES['SHOP-41']], nextPageToken: 'p2', isLast: false }));
      if (parent === 'SHOP-1' && page === 'p2') return new Response(JSON.stringify({ issues: [ISSUES['SHOP-7']], isLast: true }));
      return new Response(JSON.stringify({ issues: [], isLast: true }));
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('the Jira tracker', () => {
  test('a Jira key or browse URL on the site parses, and other text does not', () => {
    const tickets = jira(SITE, fakeFetch());
    expect(tickets.parse('SHOP-41')).toBe('SHOP-41');
    expect(tickets.parse('https://acme.atlassian.net/browse/SHOP-41')).toBe('SHOP-41');
    expect(tickets.parse('https://other.atlassian.net/browse/SHOP-41')).toBeNull();
    expect(tickets.parse('acme/api#12')).toBeNull();
    expect(tickets.parse('shop-41')).toBeNull();
    expect(tickets.project('SHOP-41')).toBe('SHOP');
    expect(tickets.place('SHOP-41')).toBeNull();
  });

  test('a missing issue is null, not an error', async () => {
    expect(await jira(SITE, fakeFetch()).lookup('SHOP-999')).toBeNull();
  });

  test('an issue in a done status category is closed', async () => {
    const tickets = jira(SITE, fakeFetch());
    expect(await tickets.lookup('SHOP-7')).toEqual({ kind: 'issue', state: 'closed', body: '' });
    expect(await tickets.lookup('SHOP-41')).toMatchObject({ state: 'open' });
  });

  test("a description's Repositories section survives the flattening of Jira's document format", async () => {
    const { body } = (await jira(SITE, fakeFetch()).lookup('SHOP-41'))!;
    expect(body).toMatch(/^### Repositories\n\n- acme\/shop\n- acme\/web\n/m);
    expect(docText(doc(paragraph('acme/api', 'acme/web')) as Parameters<typeof docText>[0])).toBe('acme/api\nacme/web\n\n');
  });

  test("an epic's children are its parent-linked issues", async () => {
    const seen: string[] = [];
    const children = await jira(SITE, fakeFetch(seen)).children('SHOP-1');
    expect(children.map((child) => child.id)).toEqual(['SHOP-41', 'SHOP-7']);
    expect(seen.filter((url) => url.startsWith('/rest/api/3/search/jql'))).toHaveLength(2);
  });

  test('a Jira argument with a setting unset is refused naming the variable', async () => {
    await expect(jira({ ...SITE, baseUrl: undefined }, fakeFetch()).lookup('SHOP-41')).rejects.toThrow(/JIRA_BASE_URL is not set/);
    await expect(jira({ ...SITE, token: '' }, fakeFetch()).lookup('SHOP-41')).rejects.toThrow(/JIRA_API_TOKEN is not set/);
    expect(jira({}, fakeFetch()).parse('SHOP-41')).toBe('SHOP-41');
  });
});
