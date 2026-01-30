Executive Summary — Two-Step Form Flow (Step A + Step B)

Purpose

This document provides a clear, non-technical summary of the planned product change: replacing the current single-question flow with a two-step submission process. It is written for executives and team leads to explain what will change, why it helps the business, the expected customer experience, operational impacts, risks, timeline, and what success looks like.

Overview

Problem: The current “questions” flow no longer serves the product’s needs. It collects limited information and leaves important data (including two required images) to be collected elsewhere. The present experience relies on browser alerts and produces incomplete submissions.

Solution: Replace the existing flow with a two-step process:

- Step A: user completes the current on-site initial form. On submit the app shows a polished UI modal confirming receipt and an SMS with a secure link (Step B).
- Step B: the secure link opens a second, mobile-friendly form where the user completes detailed fields and uploads two images (front/back of insurance card). The Step B data becomes the canonical submission stored in the system.

Why this helps (benefits)

- Better completion rate: moving image collection to a dedicated, mobile-first page with an SMS prompt increases the chance users will complete the required steps (they can do it on their phone, camera ready).
- Improved data quality: Step B collects structured fields (DOB, address, height/weight, insurance details, images) and validates them before persisting.
- Operational efficiency: completed, validated submissions reduce manual follow-up and accelerate downstream scheduling and intake processes.
- Cost controls: images are stored temporarily (30 days) to comply with storage budget and privacy expectations; only critical metadata is retained permanently.
- Auditability and compliance: tokenized links, explicit consent flows, and audit logs provide a clear trail for support and compliance.

User experience (what the user sees)

1. Complete initial form on the website.
2. An attractive modal confirms receipt and advises the user to check SMS for the Step B link.
3. The user receives an SMS with a short secure link; tapping it opens the Step B page optimized for mobile.
4. On Step B the user reviews prefills, completes required fields, takes two photos (front/back of card), and submits.
5. The user receives a final SMS confirming receipt and an appointment booking link.

Key business rules (non-technical)

- Each Step B submission is associated with the user’s email address (serves as the unique identifier).
- If a user submits Step B multiple times, the system retains only the latest submission and removes previous images to avoid confusion and extra storage costs.
- Images are stored in secure cloud storage and automatically deleted after 30 days; non-image form data is kept indefinitely for audit and service continuity.
- If a user does not complete Step B, the system sends configurable reminder messages (nudges) up to a limit; manual resends are allowed under rate limits to prevent abuse.

Operational impact and requirements

- Infrastructure: requires cloud object storage, a moderate lifecycle rule (30-day expiry), and secure credentials for uploads. The current SMS provider and existing `smsService` will be reused.
- Support: support teams will have a small new workflow to check Step B status and resend links when permitted.
- Security & privacy: use tokenized, time-limited links for Step B; validate email matches the token to avoid data leaks. Images are restricted to common image formats and size limits.

Risks and mitigation

- Lower-than-expected completion: mitigate by keeping Step B short, using clear CTA in SMS, and sending up to three timed nudges.
- SMS costs: mitigate with rate limits and monitoring; use URL shorteners and concise text to reduce length where provider charges per segment.
- Data loss on overwrite: implement predictable overwrite behavior (new replaces old) and maintain audit logs for rollback if needed.
- Privacy concerns: store images briefly (30 days), use secure access control, and document retention policy for legal review.

Metrics and success criteria

- Completion rate: percent of users who open Step B link and finish submission within 7 days (target: >= 65% initial; iterative improvement expected).
- Time-to-complete: median time between Step A submit and Step B completion (target: under 48 hours).
- Data quality: percent of submissions passing server-side validation on first submit (target: >= 90%).
- Cost metrics: S3 storage usage and SMS spend monitored monthly; images should not exceed budget due to 30-day lifecycle and explicit deletion on overwrite.

Estimated effort and timeline

- Phase 1 (2 weeks): Design and implement DB model, token generation, SMS integration for Step A, and modal UI on the existing site. Include QA.
- Phase 2 (2–3 weeks): Build Step B form (mobile-first), image upload flow (presigned upload or secure server proxy), and implement upsert/overwrite behavior.
- Phase 3 (1 week): Implement nudge worker, resend API, rate-limiting, and logging/monitoring.
- Buffer & rollout (1 week): Staging validation, legal/privacy review, and phased rollout.

Total estimated delivery: 6–7 weeks from start to production, assuming a small team (1 backend, 1 frontend, 1 DevOps part-time).

Next steps / decision points for leadership

- Approve the approach to store images for 30 days and retain non-image data indefinitely.
- Confirm SMS budget and acceptable nudge frequency (recommended: 3 nudges maximum per user).
- Decide whether to require single-use tokens (stronger security) or accept time-limited reuse (simpler UX).
- Approve resources: one backend engineer, one frontend engineer, and DevOps support to configure S3 lifecycle and scheduling.

Contacts

- Product owner: [specify name]
- Technical lead: [specify name]
- Operations/DevOps: [specify name]

Prepared by: Product / Engineering
Date: 2026-01-23

Notes

This summary omits implementation details and code-level choices; a separate technical specification (`docs/FORM_FLOW.md`) describes the exact API contracts, DB fields, S3 layout, worker behavior, and testing guidance for engineering teams.
