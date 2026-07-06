# research: leetcode unofficial graphql reliability (2026-07-06)

goal: admin form pastes a leetcode url → auto-fill problem number, title,
difficulty. solution code stays manual.

## verdict
**reliable enough as a convenience layer with manual fallback.** live curl tests
(2026-07-06): `POST https://leetcode.com/graphql` answers the `question(titleSlug:)`
query with **no auth, no cookies, no csrf, no user-agent tricks**. the query shape
has been stable since ~2018 (every wrapper/plugin uses it unchanged). vercel
serverless egress ips are not blocked today (verified via a live vercel-hosted
proxy). the risk is a cloudflare policy flip, not schema drift — leetcode.cn's api
was fully challenge-blocked in may 2026 and leetcode.com already challenges html
pages, so the door could close without notice.

## the request (use exactly this, no wrapper library)
```
POST https://leetcode.com/graphql
Content-Type: application/json
{"query":"query q($slug: String!) { question(titleSlug: $slug) { questionFrontendId title titleSlug difficulty isPaidOnly } }","variables":{"slug":"two-sum"}}
```
- use **questionFrontendId** (displayed number) — NOT `questionId` (internal id
  that diverges on newer problems)
- difficulty is exactly `Easy|Medium|Hard`
- unknown slug → http 200 with `{"data":{"question":null}}` (not an error)

## failure modes to gate (all must leave form fields empty & editable)
1. cloudflare block = **403/503 with text/html "just a moment..."** — check
   `res.ok` AND content-type includes `application/json` before `res.json()`
2. 429 — surface "try again later", retry at most once
3. null question for bad slugs — pre-validate url with `/problems/([a-z0-9-]+)/`
   (strips /description/, /solutions/ suffixes); reject leetcode.cn urls
4. timeout — abort at ~8s
5. schema drift — require non-empty strings and difficulty ∈ {Easy,Medium,Hard},
   else treat as lookup failure
6. **the save path must never depend on the lookup**

## caching
cache successes in upstash redis `lc:q:<slug>` with long ttl (30d+) — metadata is
immutable; do not cache failures (or ≤60s). values persist into the content file at
save time anyway.

## tos note
one user-initiated metadata request per personally-solved problem, storing only
number/title/difficulty (facts, not the copyrighted body), is de minimis. do NOT
fetch/republish the problem `content` html.

## early-warning system
watch alfa-leetcode-api and JacobLinCool/LeetCode-Query issue trackers — they break
first if leetcode locks down. wrappers themselves rejected: hosted alfa instance
rate-limits itself into uselessness; leetcode-query npm is maintenance-inactive;
a stranger's vercel proxy is not a dependency.
