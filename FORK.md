# Fork deltas

`yogenpro/nodewarden`, forked from [`shuaiplus/nodewarden`](https://github.com/shuaiplus/nodewarden).

Everything this fork changes on top of upstream is listed here, one section per
patch. The point is merge safety: a patch that exists only as a line in a file
upstream also edits is one conflict resolution away from being dropped, and
dropping it makes the tree *quieter*, not noisier — nothing fails, the setting
just reverts to the upstream default. That is the shape of fault worth writing
down and testing for.

Every patch carries an id. The id appears in three places: the section heading
here, a comment at the patched line, and an assertion in
`scripts/check-fork-patches.mjs`. Run it any time:

```sh
npm run check:fork
```

## Merging upstream

```sh
git fetch upstream
git log --oneline main..upstream/main      # what is coming
git merge upstream/main
npm run check:fork                         # every patch still present?
```

If `check:fork` fails after a merge, the merge dropped a patch — reapply it from
the section below rather than re-deriving it. If a patch has become genuinely
obsolete (upstream adopted it), delete all three of its places in one commit and
say so in the message.

Take the security read seriously before merging, not after: this application
holds a password vault, and a fork is a supply chain. `git log --oneline
main..upstream/main` first, then review the diff of anything touching auth,
crypto, backup, or dependencies before it reaches a deploy.

---

## fork-patch:workers-dev-off

**Files:** `wrangler.toml`, `wrangler.kv.toml`
**Added:** 2026-08-17

```toml
workers_dev = false
preview_urls = false
```

**Why.** This deployment is reached at a single Workers custom domain, attached
*outside* wrangler. Because that domain is not in the wrangler config, the config
declares no routes at all — and wrangler defaults `workers_dev` to true in
exactly that case. Checked against the live account before this patch: the
worker's `workers.dev` hostname served the application just as the custom domain
did, and `preview_urls` was on as well, giving every uploaded version its own
hostname so superseded builds stayed reachable.

Neither door is a break by itself — a Bitwarden-compatible server is built to
face the internet, with client-side encryption and its own auth. The reason to
close them is that they are *unmanaged* surface: not in this config, not in the
infrastructure repo, not anywhere a review would look. Any control placed in
front of the custom domain — a Cloudflare Access policy, a WAF rule, a rate
limit — binds to that hostname and not to `workers.dev`, so a second open door
quietly makes every such control partial.

**Why it lives here and not in Terraform.** The sibling `infra` repository
manages this worker's custom domain, D1 database and R2 bucket. It deliberately
does *not* manage this setting. `wrangler deploy` writes the workers.dev route
on every deploy, from this file — so a Terraform resource declaring it would be
reverted by the next deploy, and the plan would go dirty. The rule that split
them: whatever wrangler *writes* belongs to wrangler, including its defaults;
Terraform owns only what wrangler never touches.

**Watch for.** These are top-level TOML keys, so they must stay above the first
`[table]` header. A merge that moves them below `[build]` silently reparses them
as members of that table, and wrangler stops seeing them. `check:fork` asserts
the position, not just the presence.

---

## fork-patch:nanoid-advisory-floor

**Files:** `package.json`
**Added:** 2026-08-17

```json
"overrides": {
  "nanoid": "^3.3.18",
```

Upstream pins `"nanoid": "3.3.17"` exactly. This fork raises the floor to the
version that carries the advisory fix, and keeps the bound.

**Why.** [GHSA-2v37-7h3g-55p8][ghsa] — a custom nanoid generator loops forever
when called with size zero (CWE-835) — is fixed in **3.3.18**. Upstream's
dependency commit bumped nanoid to 3.3.17 and pinned it exactly, so the pin
itself is what holds the tree on a vulnerable version: `postcss` asks for
`^3.3.16` and would resolve the fix on its own, but an exact `overrides` entry
outranks that. `npm audit` reports it as 2 high findings, nanoid and postcss
downstream of it.

Be clear about the size of this: nanoid here is a **dev-only** transitive of
postcss, reached through tailwind and vite at build time. It is not in the worker
bundle and never touches the vault. The CVSS vector is availability-only
(`C:N/I:N/A:H`), the call in `postcss/lib/input.js` passes a constant size, and
the realistic worst case is a hung local build. The reason to patch it anyway is
signal, not exposure: local `npm audit` is the *only* dependency audit this repo
gets, because the `pnpm audit` job in `.github/workflows/security-extra.yml`
skips silently on a `pnpm-lock.yaml` that does not exist. A permanently dirty
audit is a broken instrument, and this one is cheap to fix.

**Why `^3.3.18` and not `>=3.3.18`.** The unbounded floor was tried first and is
wrong. npm resolved it to **nanoid 6.0.1** — three majors up — because nothing
capped it. nanoid is ESM-only from 4.x, `"type": "module"`, while postcss reaches
it through `require('nanoid/non-secure')`. That combination happened to survive
here only because Node 24 can `require()` a synchronous ESM graph; on Node 22.11
or earlier the same tree throws `ERR_REQUIRE_ESM`, and postcss never declared 4.x
support at all. `npm audit` reported "0 vulnerabilities" for that tree, which is
how a bad fix looks when you read the summary and not the lockfile diff. The
caret keeps the fix inside the 3.x line postcss actually supports.

**Why a range and not another exact pin.** A caret absorbs the next 3.x patch,
including the next advisory, without a second fork edit. `check:fork` therefore
accepts an exact pin *at or above* 3.3.18 as well: upstream writes exact pins,
and one that clears the advisory is not the fault worth failing on.

**Why the odd JSON key.** `package.json` is JSON and JSON has no comments, so the
patch's in-file marker is a top-level `"//fork-patch:nanoid-advisory-floor"`
string — npm's own convention for annotating a manifest, and ignored by npm. It
sits above `overrides` rather than inside it, because every key *inside*
`overrides` is read as a package name. `check:fork` asserts the marker too, so
the explanation cannot quietly go missing while the patch stays.

**Watch for.** Upstream is actively editing this exact line — it changed in the
merge that created this patch — so expect a conflict here on the next merge, and
resolve it by keeping the higher floor. If upstream moves to 3.3.18 or later
within 3.x by any spelling, this patch is obsolete: delete its three places
(this section, the marker key, the `check:fork` entry) in one commit. Worth
reporting upstream, since their pin ships the same finding to every consumer.

[ghsa]: https://github.com/advisories/GHSA-2v37-7h3g-55p8
