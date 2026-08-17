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
