# Security Audit: Paywall and VIP Access

Date: 2026-07-11

## 1. Summary

This folder currently contains a Node.js crawler/audit utility, not the production backend source for truyendocviet.shop. Because backend controllers, database models, auth middleware, payment webhooks, and deployment cache/CDN configuration are not present locally, production code cannot be directly patched here.

Implemented locally:

- Centralized chapter access decision service: `services/chapterAccessService.js`
- Express-compatible access middleware example: `middleware/requireChapterAccess.js`
- Unit tests for access rules: `tests/chapter-access.test.js`
- Safe integration check for unauthenticated VIP pages: `tests/paywall.integration.test.js`
- Environment template: `.env.example`
- Crawler hardening: explicit stop when `chapterInfo.IsVip === true` and `MemberCanReadFull === false`

## 2. Relevant Routes Observed

Observed from public HTML/JS bundle:

- Reader page: `/doc-truyen/:storySlug/read/:chapterId.html`
- Chapter list API: `POST /api/v1/chapters/listByBook`
- Frontend bundle references reader data through `window.__INITIAL_DATA__`

Not available in local source:

- Login route implementation
- VIP/subscription route implementation
- Purchase/order/payment route implementation
- Chapter content controller implementation
- Session/JWT validation implementation

## 3. Findings

### Finding 1: Production backend source is not present

Severity: Medium

- Location: `truyendocviet/`
- Cause: The local folder contains crawler tooling, not the website backend.
- Impact: Cannot verify all server-side authorization paths, payment state checks, cache headers, or IDOR protections from source.
- Fix: Run this audit against the actual backend repository or staging deployment source.
- Status: Not fixed here; documented and test scaffold added.

### Finding 2: VIP chapter metadata correctly denies anonymous access in observed response

Severity: Low

- Location observed: `debug/0150-page.html`
- Evidence: Chapter 150 returns `Description: "Vui long dang nhap..."`, `IsVip: true`, `BookIsVip: true`, `MemberCanReadFull: false`.
- Impact: The observed unauthenticated response did not expose the real chapter text through `chapterInfo.Description`.
- Fix: Keep this behavior server-side. Do not move VIP filtering to frontend only.
- Status: Existing behavior appears safe for this checked URL.

### Finding 3: Crawler debug can store full HTML responses

Severity: Medium

- Location: `crawler.js`
- Cause: Debug mode writes `debug/<chapter>-page.html` and `debug/<chapter>-body.txt`.
- Impact: If a valid privileged session is used in future, debug files could store VIP content locally.
- Fix: Do not run crawler with privileged cookies. Keep debug artifacts local and out of commits. Redact content in production audit tools.
- Status: Partially mitigated by stopping on `MemberCanReadFull=false`; remaining risk documented.

## 4. Access Control Rules Implemented Locally

`canReadChapter(userId, chapterId)` returns:

- `FREE_CHAPTER`
- `ACTIVE_VIP`
- `STORY_PURCHASED`
- `CHAPTER_PURCHASED`
- `UNAUTHENTICATED`
- `VIP_EXPIRED`
- `PAYMENT_PENDING`
- `PAYMENT_FAILED`
- `ACCOUNT_BLOCKED`
- `VIP_REQUIRED`
- `CHAPTER_NOT_FOUND`

Denied responses map to:

- `401` for unauthenticated users
- `403` for forbidden/payment/account states
- `404` for missing chapters

## 5. Tests

Run local unit tests:

```powershell
npm.cmd test
```

Run integration paywall check:

```powershell
$env:VIP_CHAPTER_URL='https://truyendocviet.shop/doc-truyen/thai-co-than-ton/read/2134788.html'
npm.cmd run test:paywall
```

Run syntax checks:

```powershell
npm.cmd run check
```

## 6. Production Deployment Guidance

- Enforce paywall on the server before rendering HTML or JSON.
- Never include real VIP content in `window.__INITIAL_DATA__` for unauthorized users.
- Return `401` for no login, `403` for no permission, `404` for missing chapter.
- Use `Cache-Control: private, no-store, max-age=0` for VIP content.
- Use `Vary: Cookie, Authorization` when content depends on auth.
- Derive `userId` only from verified session/token, never from query/body.
- Verify payment webhooks using provider signatures.
- Re-check subscription/purchase state in database on each VIP content request.
- Do not log VIP chapter content, full cookies, full JWTs, passwords, or payment secrets.
