# VELORA continuation checkpoint

Campaign: maximum 30 new recipients TOTAL across Russia. Two recipients already confirmed delivered; read individual JSON journals before any outbound action. Protected: АМАТЭ, Студия17, LE Di Clinic; no site or message changes. BonBuket and 10 Баллов: WAITING_REPLY, do not resend.

Read operations/batch-2026-09-09.json and workflow run 34279573373 for the next three prepared sites. These are prospects, not sales. Sites already exist on clients.site; do not claim absence of website or booking. Delivery, response, interest, payment are separate states. Unknown means unknown, never zero or success.

Before sending: verify exact recipient, live site, real first-screen screenshot, and protected admin. Reserve record using current GitHub blob SHA, then send once, immediately persist execution/delivery IDs. If outcome unknown: investigate delivery, never resend. Never run an outbound loop concurrently with another executor. Single photo, short personal text, real site URL, no initial price. Important aggregate notifications only; no per-client reporting. READY_TO_PAY goes to Елизавета.

## Improvements, evidence and rollback

- Lost continuation state: live repo had only two sent-client journals, no next-batch checkpoint. Approach: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents (2025-11-26), read 2026-09-08. Implemented next-batch JSON and this handoff; do not mark done without actual QA/delivery evidence. These are operational practices, not a guarantee of autonomous uptime.
- Repeated material generation: demo materials called captureDistinctScreenshots despite one-photo outreach rule. New-three-only branch now makes one screenshot; other slugs retain previous behavior. Actual endpoint result still needs verification. Rollback only scoped branch if necessary.
- During the screenshot edit a broad string replacement initially touched the general materials route; detected by inspecting surrounding code and immediately corrected in commit c884c0ef747d36126402bb74f3ed8d1c78b2d82d. Verified general capture/video path restored and new branch lies inside /demo/:slug/materials.json. Do not use unchecked global replacement in shared source.
- Admin page and brief reads are tested by workflow; admin SAVE has not been tested. Never describe it as fully tested. Existing form may omit advanced brief fields; investigate only for uncontacted clients with scoped changes and preservation checks.

## Quotas

New-spend budget zero. Remaining Make/GitHub/Railway quotas unknown. Last two delivered recipients used 6 Make credits each including delivery checks; not a universal cost guarantee. Do not bypass limits, enable paid overage, or promise uninterrupted work. Save retry_after on actual quota refusal.

## Priority

Finish new batch QA, verify contacts, prepare one screenshot each. Preserve local contact time in records. Choose additional city+niche prospects by observed business need; no gender assumptions, no unsupported best-city claim. Count delivered recipients separately from messages. Responses and payments currently not freshly checked.
