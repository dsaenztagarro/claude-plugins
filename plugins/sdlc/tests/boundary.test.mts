// The public boundary: the plugins install on a stranger's machine, so what
// they hand the model names no one's home folder, no forge but GitHub, and no
// owner but as the marketplace a plugin is installed from. A guard on the
// shipped text, not a behaviour; the hook-event fixtures ship with the plugin,
// so they are checked too.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const plugins = path.resolve(import.meta.dirname, '..', '..');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dev') return [];
    return entry.isDirectory() ? files(full) : [full];
  });
}

const shipped = () => [...files(plugins)].filter((file) =>
  /\/(skills|agents|scripts|hooks)\//.test(file) || /\/tests\/fixtures\//.test(file));

const FORBIDDEN: [RegExp, string][] = [
  [/\/(?:Users|home)\/(?!dev\/)[\w.-]+/, 'a home folder'],
  [/bitbucket|gitlab/i, 'a forge other than GitHub'],
  [/dsaenztagarro(?!\/claude-plugins\b)(?<!@dsaenztagarro)/, 'an owner'],
];

test('no file the plugins ship names a home path, another forge or a hard-coded owner', () => {
  const found = shipped().flatMap((file) => {
    const text = fs.readFileSync(file, 'utf-8');
    return FORBIDDEN.filter(([pattern]) => pattern.test(text)).map(([, what]) => `${path.relative(plugins, file)}: ${what}`);
  });
  expect(found).toEqual([]);
});
