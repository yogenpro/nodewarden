# CLAUDE.md

A **fork** of [`shuaiplus/nodewarden`](https://github.com/shuaiplus/nodewarden) —
a Bitwarden-compatible server running on Cloudflare Workers — deployed to a live
Cloudflare account where it holds a real password vault. Two facts follow from
that and shape everything below: upstream writes almost all of this code, and a
mistake here loses or exposes credentials rather than causing an outage.

**This repository is public.** Never commit a hostname, account ID, namespace ID,
database ID or bucket name that is not already public, and never paste live
`wrangler`/API output into a tracked file or a commit message without stripping
those first. Reasoning about the deployment belongs here; addresses of it do not.
The sibling infrastructure repo is private for the same reason and does not get
to relax this one.

## Two invariants

**`npm run check:fork` passes.** Every change this fork carries over upstream is
recorded in [FORK.md](FORK.md) and asserted by
`scripts/check-fork-patches.mjs`. A patch dropped by a merge fails nothing on its
own — the setting silently reverts to upstream's default — so it is asserted
rather than assumed. If the check fails, that is the bug.

**The delta over upstream stays as small as it can be.** Every line this fork
changes is a line that can conflict on the next merge, and every conflict is a
chance to lose a patch. Do not reformat, rename, refactor or "clean up"
upstream's files. Fix what must be fixed, record it, and leave the rest alone —
even when it is obviously improvable.

## Before anything

```sh
npm ci                  # package-lock.json is the lockfile; there is no pnpm-lock.yaml
npm run check:fork      # must pass before and after any change
```

## Merging upstream

This is a supply chain into a password vault. Review before merging, not after —
once it is in the working tree the diff is harder to see and the temptation is to
deploy.

```sh
git fetch upstream
git log --oneline main..upstream/main            # 1. what is coming
git diff main..upstream/main -- package.json package-lock.json
git diff main..upstream/main -- src/handlers/identity.ts src/handlers/accounts.ts \
    src/handlers/backup.ts src/services/ src/utils/                # 2. read these
git merge upstream/main                          # 3. only after 2
npm run check:fork                               # 4. patches survived?
```

**Step 2 is the point of the exercise.** Read every change touching
authentication, crypto, the backup endpoints, admin routes, or dependency
versions. A dependency bump in an application like this is a security change, not
housekeeping. Report what you found before merging; do not summarise a diff you
did not read.

**Step 4 is not optional.** If it fails, reapply the patch from its FORK.md
section rather than re-deriving it — the section records reasoning the diff does
not. If upstream has genuinely adopted a patch, delete all three of its places
(FORK.md section, the in-file comment, the assertion) in one commit and say so.

Then run the checks upstream ships but does not wire up — see below — and only
then deploy.

## The security scripts upstream leaves unwired

`scripts/security-audit-*.mjs` are regression tests for three specific
vulnerability classes: API-key semantics, backup archives leaking runtime auth
state, and SSRF in the backup endpoint URL. They are referenced by **no** CI
workflow and **no** npm script, so nothing runs them on their own.

Run all three after every upstream merge, before deploying:

```sh
npx tsx scripts/security-audit-api-key-semantics.mjs
npx tsx scripts/security-audit-backup-auth-state.mjs
npx tsx scripts/security-audit-backup-endpoint.mjs
```

They import `.ts` directly, hence `tsx` rather than bare `node`. Also run the
`test:*` scripts in `package.json` relevant to what the merge touched.

Note what CI does and does not cover: the `pnpm audit` job in
`.github/workflows/security-extra.yml` skips silently, because it looks for a
`pnpm-lock.yaml` this repo does not have. Dependency auditing is therefore
`npm audit` run locally, not something CI is doing for you.

## What this repo owns, and what it does not

A sibling private repo manages this worker's Cloudflare resources with Terraform:
its custom domain, its D1 database and its R2 bucket. The split is not arbitrary,
and getting it wrong breaks a clean-plan invariant over there:

> **Whatever `wrangler deploy` writes belongs to wrangler — including its
> defaults. Terraform owns only what wrangler never touches.**

So this repo owns the code, the bindings, `compatibility_date`, the cron trigger,
the Durable Object migrations, and the `workers_dev` / `preview_urls` settings.
Terraform owns the custom domain and the storage containers those bindings point
at by name.

**Never add `routes` or a `custom_domain` entry to a wrangler config.** The
hostname is Terraform's. Declaring it here too creates two writers of one field:
whichever ran last wins, and the other's next plan is dirty.

**The Cloudflare dashboard is a read-only view of this worker.** Every setting it
shows is owned by a file — this repo's wrangler config, or the Terraform root.
Changing something there does not fail; it just makes the live worker stop
matching the code that is supposed to describe it, silently and with no diff
anywhere. This has already happened once: `workers_dev` and `preview_urls` were
both on in production while nothing in any repo said so, and it took an audit-log
query to reconstruct why. Deploy with `npm run deploy`; if a setting needs
changing, change the file and deploy. Use the dashboard to look, and to read the
audit log when the live state and the files disagree.

## Things that will bite you

**`npm run deploy:kv` deploys over the same worker.** `wrangler.kv.toml` sets the
same `name` as `wrangler.toml` and differs only in swapping the R2 attachments
bucket for a KV namespace. Running it against this deployment does not create a
second worker — it redeploys this one onto a different attachments backend, and
every attachment already in R2 stops resolving. `npm run deploy` is the deploy
command here. Do not reach for the `:kv` variant to "try something".

**`scripts/ensure-kv.cjs` rewrites a tracked file.** It writes the resolved
namespace id back into `wrangler.kv.toml`, so a `deploy:kv` run leaves an
uncommitted modification. If that file is dirty and you did not edit it, this is
why — and the id it wrote is account state that should not be committed to a
public repo.

**`workers_dev` and `preview_urls` are top-level TOML keys.** A merge that moves
them below `[build]` rebinds them to that table, wrangler stops seeing them, and
both doors reopen on the next deploy with no error anywhere. `check:fork` asserts
their position for this reason, not just their presence.

**`[[migrations]]` tags are append-only history.** They record Durable Object
class migrations already applied to the live worker. Renaming, reordering or
removing a tag breaks the next deploy. Add new tags at the end; never edit
existing ones.

**Secrets are set out of band and never appear in a config file.** `JWT_SECRET`
is a wrangler secret (`wrangler secret put JWT_SECRET`). The API returns its name
but never its value. Do not add it to a `.toml`, a `.dev.vars` that gets
committed, or CI.

**Config changes do nothing until the next deploy.** Editing `wrangler.toml`
changes the intent, not the live worker. After a change to `workers_dev`,
`preview_urls`, crons or bindings, it is `npm run deploy` that applies it — and
until then the live setting is whatever the last deploy left.

## Further reading

- [FORK.md](FORK.md) — every delta over upstream, with reasoning and the merge
  procedure
- [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) — upstream's own
