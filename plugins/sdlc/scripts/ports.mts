// The two ports item.mts resolves through; it calls nothing else that knows a
// provider. A Tracker holds tickets, a Forge holds code and pull requests:
// GitHub is both, and Jira is a tracker whose pull requests live on a forge.
// Another provider joins as another adapter, and item.mts does not change.

/** A ticket as a tracker holds it. On a forge's own tracker a pull request is one too. */
export interface Ticket { kind: 'issue' | 'pr'; state: 'open' | 'closed'; body: string }

/** A ticket's place on a forge, when its id says it: GitHub's `owner/repo#12`. */
export interface Place { repo: string; number: number }

export interface Tracker {
  /** Its name in messages, and the word an `AGENTS.md` line uses to name one of its projects. */
  name: string;
  /** The lines it adds to the accepted forms. */
  forms: string[];
  /** The ticket id an argument names in this tracker's own forms, or null. A ticket id is the tracker's own text. */
  parse(arg: string): string | null;
  /** The ids a branch name carries. */
  inBranch(branch: string): string[];
  /** Where a ticket sits on a forge, when its id says it; null for a tracker without repositories. */
  place(id: string): Place | null;
  /** The project a ticket belongs to, for a tracker whose tickets name no repository; null otherwise. */
  project(id: string): string | null;
  lookup(id: string): Promise<Ticket | null>;
  /** An epic's children, each with its description; a ticket has none. */
  children(id: string): Promise<{ id: string; body: string }[]>;
}

export interface Forge {
  name: string;
  /** The `owner/repo` an origin URL points at on this forge, or null. */
  repoOf(origin: string): string | null;
  /** The ticket ids a pull request closes or carries, of any tracker. */
  closes(pr: Place): Promise<string[]>;
  /** The pull requests in `repo` that close or carry the ticket, never one that only mentions it. */
  pullRequests(ticket: string, repo: string, state: 'open' | 'merged'): Promise<number[]>;
}
