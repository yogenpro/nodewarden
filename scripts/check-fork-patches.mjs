#!/usr/bin/env node
/**
 * Assert that every delta this fork carries over upstream is still present.
 *
 *   npm run check:fork
 *
 * Exit 0 if all patches hold, 1 otherwise. Reads only files in the working
 * tree: no network, no credentials, no build.
 *
 * Why this exists
 * ---------------
 * A fork patch is a line in a file that upstream also edits. Merges resolve
 * those, and a resolution that drops the patch produces no error and no failing
 * build — the setting simply reverts to the upstream default. Nothing complains,
 * because the patch's whole job was to make the default not apply.
 *
 * So the patches are asserted rather than assumed. Each entry here pairs with a
 * section of FORK.md sharing its id; keep the two in step.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Text of a repo-relative file, or null if it is not there. */
const read = (file) => {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
};

/**
 * A top-level TOML key with the given value: present, and above the first
 * [table] header. Position matters — TOML binds a bare key to whatever table
 * precedes it, so a patch that drifts below `[build]` is silently reinterpreted
 * as `build.workers_dev` and wrangler never sees it.
 */
const topLevelToml = (key, value) => ({
  describe: `${key} = ${value} (top level)`,
  check(text) {
    const line = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*${value}[ \\t]*(?:#.*)?$`, 'm');
    const m = line.exec(text);
    if (!m) return `no top-level \`${key} = ${value}\``;
    const firstTable = text.search(/^[ \t]*\[/m);
    if (firstTable !== -1 && m.index > firstTable) {
      const table = /^[ \t]*(\[[^\]]*\])/m.exec(text.slice(firstTable))?.[1] ?? '[table]';
      return `\`${key}\` sits below ${table}, so TOML reads it as that table's key, not a top-level one`;
    }
    return null;
  },
});

const PATCHES = [
  {
    id: 'fork-patch:workers-dev-off',
    summary: 'workers.dev and per-version preview URLs stay off',
    files: ['wrangler.toml', 'wrangler.kv.toml'],
    assertions: [
      topLevelToml('workers_dev', 'false'),
      topLevelToml('preview_urls', 'false'),
    ],
  },
];

let failed = 0;
for (const patch of PATCHES) {
  const problems = [];
  for (const file of patch.files) {
    const text = read(file);
    if (text === null) {
      problems.push(`${file}: missing`);
      continue;
    }
    for (const assertion of patch.assertions) {
      const problem = assertion.check(text);
      if (problem) problems.push(`${file}: ${problem}`);
    }
  }

  if (problems.length === 0) {
    console.log(`ok    ${patch.id} — ${patch.summary}`);
    continue;
  }
  failed++;
  console.error(`FAIL  ${patch.id} — ${patch.summary}`);
  for (const problem of problems) console.error(`        ${problem}`);
}

if (failed) {
  console.error(
    `\n${failed} fork patch(es) missing or misplaced. If a merge dropped one, ` +
    `reapply it from its section in FORK.md rather than re-deriving it. If ` +
    `upstream has genuinely adopted it, remove the patch, its FORK.md section ` +
    `and its entry here in one commit.`
  );
  process.exit(1);
}
console.log(`\n${PATCHES.length} fork patch(es) intact.`);
