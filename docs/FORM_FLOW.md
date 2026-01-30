Feature: New post-form flow — polished shareable specification

Audience

This document is intended for product managers, backend and frontend engineers, and DevOps engineers responsible for implementing the new form flow and its operational components.

TL;DR

- Replace the current question flow with a two-step flow: Step A (existing form) and Step B (link-driven form with two image uploads).
- After Step A submit: show an accessible modal and send an SMS with a tokenized Step B link.
- Step B submissions are upserted by `email`; images are stored under `images/<url-encoded-email>/...` in S3 and expire after 30 days.
- If Step B is not completed, send configurable nudges; allow controlled resends.

Table of contents

1. High-level flow
2. Data model
3. S3 layout & lifecycle
4. Token, security & validation
5. API contracts
6. Incomplete-StepB logic (nudges & resends)
7. Worker design
8. Testing & monitoring
9. Quick implementation checklist

10. High-level flow

11. User completes Step A; front-end POSTs to `/api/form/initial-submit`.
12. Server creates/records the initial payload, issues a short token for Step B, sends an SMS with the Step B link, and responds success.
13. Front-end shows an accessible modal confirming submission and offering a CTA to open Step B.
14. User completes Step B (includes up to two images). Server validates token/email, accepts image uploads, deletes previous images for that email (if any), upserts DB record, and sends a post-submission SMS with an appointment link.

15. Data model

- Table/collection: `form_submissions` (or split `form_tokens` if preferred).
- Required fields:
  - `email` (unique)
  - personal fields (`firstName`, `lastName`, `phone`, ...)
  - `answers` (JSON)
  - `imageObjects`: [{ key, url, uploadedAt, size, contentType }]
  - `stepBToken`, `stepBTokenIssuedAt`, `stepBCompleted`, `stepBCompletedAt`, `stepBNudgeCount`, `stepBLastNudgeAt`

Design note: consider a separate `form_tokens` collection to track tokens and nudges if writes to tokens must be frequent.

2.1 Step B form fields (exact - developer reference)

The following is a precise list of fields the Step B (secondary) form collects (derived from the provided screenshots). Each field below should be stored on the `form_submissions` record or in a closely related document. Use the provided `name` as the DB property, the `type`, and `validation` guidance.

- `dateOfBirth`
  - type: Date (ISO string)
  - required: yes
  - validation: format MM/DD/YYYY; must be a plausible DOB (age > 13 and < 120)

- `email`
  - type: String
  - required: yes
  - validation: standard email regex; must match token email when token present

- `streetAddress`
  - type: String
  - required: yes

- `heightFeet`
  - type: Integer
  - required: conditional (if height provided)
  - validation: 0-8

- `heightInches`
  - type: Integer
  - required: conditional
  - validation: 0-11

- `weightLbs`
  - type: Number
  - required: yes
  - validation: reasonable bounds (e.g., 30-1000)

- `interestedProcedure`
  - type: String
  - required: no (optional free text)

- `priorWeightLossSurgery`
  - type: Boolean
  - required: yes (explicit radio yes/no shown)

- `wheelchairUsage`
  - type: Boolean
  - required: yes (yes/no)

- `hasSecondaryInsurance`
  - type: Boolean
  - required: yes

- `insuranceEmployerName`
  - type: String
  - required: conditional (if `hasSecondaryInsurance` true and employer asked)

- `insuranceFrontImage` (photo)
  - type: S3 object metadata (key, url, uploadedAt, size, contentType)
  - required: conditional (if insurance requested)
  - validation: content-type image/jpeg|image/png; max 5 MB

- `insuranceBackImage` (photo)
  - type: S3 object metadata
  - required: conditional
  - validation: content-type image/jpeg|image/png; max 5 MB

- Additional boolean/yes-no questions
  - There are a number of radio/boolean questions visible on the screenshots (for example secondary insurance, prior surgery, mobility). Implement storage as typed boolean fields with clear `questionKey` names. Examples:
    - `hasSecondaryInsurance`, `priorWeightLossSurgery`, `wheelchairUsage`

- `additionalNotes` or `answers` (catch-all)
  - type: JSON/Object
  - required: no
  - purpose: store any other form fields not enumerated above; keep raw question keys and values for future mapping.

Storage and UI notes

- Prefill: when the Step B token is used, prefill `email` and any values already known from Step A.
- UX: show thumbnails for `insuranceFrontImage` and `insuranceBackImage` when editing an existing submission.
- Upload approach: prefer presigned upload flow (server returns presigned URLs). Client uploads images directly to S3 under keys `images/<url-encoded-email>/<timestamp>_<orig>` and then submits the keys to `POST /api/form/submit` as `imageObjects`.

DB mapping example (document shape)

{
email: "user@example.com",
dateOfBirth: "1980-01-01T00:00:00.000Z",
firstName: "Jane",
lastName: "Doe",
streetAddress: "123 Main St",
heightFeet: 5,
heightInches: 3,
weightLbs: 153,
interestedProcedure: "Lap-Band",
priorWeightLossSurgery: false,
wheelchairUsage: false,
hasSecondaryInsurance: true,
insuranceEmployerName: "Acme Corp",
imageObjects: [ { key: "images/user%40example.com/2026-01-23_front.jpg", url: "https://...", uploadedAt: Date, size: 234123, contentType: "image/jpeg" }, ... ],
answers: { "question_slug": "value", ... }
}

3. S3 layout & lifecycle

- Key pattern: `images/<url-encoded-email>/<ISOtimestamp>_<filename>`.
- Lifecycle rule: expire objects under `images/` after 30 days.
- On overwrite: server should explicitly delete previous keys referenced in the DB.

4. Token, security & validation

- Token: sign JWT/HMAC with `TOKEN_SECRET`. Payload: `{ email, exp }`.
- Validate tokens server-side; tokens expire (e.g., 7 days).
- File validation: only `image/jpeg` and `image/png`, max 5 MB each.

5. API contracts (concise)

- POST /api/form/initial-submit
  - Body: { email, firstName, lastName, phone, ... }
  - Response: { status: "ok" }

- GET /form/complete?token=XYZ
  - Serve Step B UI or return prefill data.

- POST /api/form/presign
  - Body: { email, files: [{ name, contentType }] }
  - Response: presigned upload URLs

- POST /api/form/submit
  - Accepts multipart/form-data (server-flow) or JSON with `imageObjects` (presign-flow).
  - Server duties: validate token -> accept images -> upload images -> delete old images -> upsert DB -> send post-submit SMS.

6. Incomplete-StepB logic (nudges & resends)

- Fields: `stepBTokenIssuedAt`, `stepBCompleted`, `stepBNudgeCount`, `stepBLastNudgeAt`.
- Nudges: send reminders at configurable intervals (example: 24h, 72h, 7d) up to `MAX_NUDGES=3`.
- Resend endpoint: `POST /api/form/resend-stepb` (rate-limited: e.g., 2 resends / 24h).

7. Worker design

- `workers/nudgeWorker.js` runs hourly and:
  - Queries uncompleted tokens where next nudge is due.
  - Sends SMS via `smsService.js`.
  - Atomically increments `stepBNudgeCount` and updates `stepBLastNudgeAt`.

8. Testing & monitoring

- Tests: E2E flow, overwrite, nudge schedule, token expiry, rate limiting.
- Metrics: `nudge_sent_total`, `nudge_failures_total`, `stepb_completion_rate`.

9. Quick implementation checklist (developer-friendly)

1. Add/adjust DB schema for `form_submissions` and token fields.
1. Implement `POST /api/form/initial-submit` — generate token and send SMS.
1. Implement front-end modal replacing `alert()` and wire CTA to `FORM_BASE_URL` + token.
1. Implement Step B UI and image upload flow (presign preferred).
1. Implement `POST /api/form/submit` with overwrite + S3 delete semantics.
1. Implement `workers/nudgeWorker.js` and `POST /api/form/resend-stepb`.
1. Configure S3 lifecycle for `images/` prefix (30 days) and test in staging.

Contacts and ownership

- Suggested owners: backend engineer (token generation, DB, S3), frontend engineer (modal, Step B UI), DevOps (S3 lifecycle, IAM, worker scheduling).

If the author should proceed, they will implement the backend endpoints and worker next. Indicate whether to prioritize backend or frontend.

Incomplete Step B: reminders, resends, and status tracking

Overview

This section defines the required behavior when a user completes Step A (initial form) and the Step B link is sent via SMS, but the user does not complete the Step B form. The goal is to: 1) track incomplete flows reliably, 2) nudge users with configurable reminder SMS, 3) allow safe resend of the Step B link, and 4) avoid abusing SMS or generating duplicate records.

Database additions

- Add fields to `form_submissions` or a related `form_tokens` collection to track Step B state:
  - `stepBToken` (String) — the signed token issued for Step B (or a key referencing a server-stored token entry).
  - `stepBTokenIssuedAt` (Date)
  - `stepBCompleted` (Boolean) — true when Step B completed
  - `stepBCompletedAt` (Date)
  - `stepBNudgeCount` (Number) — how many reminder messages have been sent
  - `stepBLastNudgeAt` (Date)

Recommended schema design options

- Option A — extend `form_submissions`: add the fields above to the existing record created on Step A submit.
- Option B — separate `form_tokens` table: store one row per Step A submission with fields { token, email, issuedAt, nudgeCount, lastNudgeAt, completedAt }. This avoids locking the main submission record during nudge updates.

Business rules

- Initial token issuance: when Step A is submitted, the server issues a Step B token and sets `stepBTokenIssuedAt = now`, `stepBCompleted = false`, `stepBNudgeCount = 0`.
- Reminder schedule (configurable): send nudge messages at configurable intervals, for example: 24 hours, 72 hours, and 7 days after token issuance. Stop after N nudges (configurable, e.g., N = 3).
- Expiry: tokens may expire after a configurable period (e.g., 7 or 14 days). After expiry, the Step B link should no longer let the user submit; instead they must trigger a fresh Step A or a resend flow.
- Overwrite safety: if a user completes Step B after receiving a nudge, worker must detect `stepBCompleted = true` and not send further nudges.

Worker behavior

- `workers/nudgeWorker.js` responsibilities:
  - Run on a schedule (e.g., every hour) to find tokens where `stepBCompleted = false` and `now - stepBTokenIssuedAt` matches the next nudge interval and `stepBNudgeCount < MAX_NUDGES`.
  - Send a reminder SMS via `smsService.js` using a templated message that includes the Step B link (tokenized).
  - Increment `stepBNudgeCount` and set `stepBLastNudgeAt`.
  - Record metrics/logging: nudge sent, token, email, worker run id, errors.

- Failure handling:
  - If SMS sending fails, retry with exponential backoff limited attempts.
  - If DB update fails after sending SMS, log and retry; ensure retries are idempotent using `stepBNudgeCount` increments guarded by atomic DB update operations.

API endpoints for resends and status

- POST /api/form/resend-stepb
  - Purpose: explicit user-triggered resend of the Step B link (rate-limited).
  - Body: { email } or { token }
  - Behavior: verify identity (rate-limit by IP/email, limit to M resends per 24h), reissue token or reuse existing unexpired token, send SMS, increment `stepBNudgeCount` or track `resendCount` separately.
  - Response: { status: "ok" }

- GET /api/form/status?email=...
  - Purpose: return minimal status (e.g., { stepBCompleted: true|false, lastNudgeAt, nudgeCount }).
  - Use this to drive UI or support staff tools.

SMS templates for nudges

- Nudge template examples:
  - Nudge 1 (24h): "Reminder: please complete your additional form here: {FORM_LINK}"
  - Nudge 2 (72h): "Second reminder: we still need a couple of photos — finish here: {FORM_LINK}"
  - Final (7d): "Final reminder: please complete your form within 24 hours or contact support: {SUPPORT_LINK}"

Rate limiting and anti-abuse

- Enforce rate limits on both automatic nudges and manual `resend-stepb` calls to avoid SMS spam and possible costs. Typical limits:
  - Auto-nudges: max `MAX_NUDGES = 3` per token.
  - Manual resends: max 2 resends per 24 hours per email.

Metrics and monitoring

- Track metrics:
  - `nudge_sent_total` (count)
  - `nudge_failures_total` (count)
  - `stepb_completion_rate` (percent within 7 days)
  - `resend_requests_total` and `resend_rate_limited_total`

Edge cases and operational notes

- If a user requests a resend after token expiry, issue a new token and record `tokenReissuedAt` for auditing.
- If Step A is re-submitted (user submitted initial form again), refresh the token and reset nudge counters (or treat as separate flows per product decision).
- Keep audit logs of all SMS sends and token reissues for compliance.

Implementation example: nudge worker pseudocode

// run hourly
const pending = db.find({ stepBCompleted: false, tokenIssuedAt: { $lte: now - 24h } });
for (const rec of pending) {
if (shouldNudge(rec)) {
const link = makeLink(rec.stepBToken);
await smsService.send(rec.phone, template(link));
db.update(rec.\_id, { $inc: { stepBNudgeCount: 1 }, $set: { stepBLastNudgeAt: now } });
}
}

Update to testing checklist

- Add tests validating nudge scheduling, idempotent nudge sends, resend endpoint limits, and token expiry behavior.

Deployment notes

- Worker scheduling: run via cron (Linux) or a scheduled container (e.g., Docker + cron / ECS scheduled task / Azure WebJob) at an interval that makes sense (hourly suggested).
- Ensure `workers/nudgeWorker.js` uses the same database connection configuration and `smsService.js` credentials as the main app.

Summary

Adding this logic ensures users who receive a Step B link but do not complete the secondary form are nudged in a controlled, auditable, and rate-limited manner. It also provides staff-usable endpoints to resend links and check status.
Feature: New post-form flow, modal UI, SMS link-driven form, image S3 storage, 30-day image deletion

**Summary**

Replace the existing question flow with a two-step user experience:

- Step A: user fills initial form (existing). After submit, show a polished modal (not alert) confirming receipt and provide a link to Step B.
- Step B: the link opens a second form (hosted URL) that contains all captured details plus two image inputs (file uploads).

Key requirements

- Show a UI modal (popup) after the initial form submit (see attached sample image for style inspiration).
- Send an SMS to the user containing a thank-you message and the Step B link.
- The Step B form saves its data to the database permanently (except images are retained for 30 days only).
- Images are stored in S3 under a folder named exactly as the submitting user's email address (email is unique).
- Images under that email folder must be deleted after 30 days; all other DB data is permanent.
- If the same person (same email) fills the Step B form again, the previous submission should be overwritten (data and images updated accordingly).
- After Step B submission, send a second SMS that thanks the user and includes an appointment link.

Design details

1. Identification and uniqueness

- Use the user email as the unique identifier for submissions. All Step B submissions are upserted keyed by email.
- On Step B submit: find existing `FormSubmission` by `email`. If found, delete previous images from S3 and replace data & new images. If not found, create new.

2. Database model (example using Mongoose)

- Collection: `form_submissions`
- Fields:
  - `email` (String, required, unique, indexed)
  - `firstName`, `lastName`, etc. (other form fields)
  - `imageKeys` (Array of objects): [{ key: String, url: String, uploadedAt: Date }]
  - `createdAt` (Date)
  - `updatedAt` (Date)
  - `source` (String) - optional, e.g., "sms-link"

Retention:

- Keep DB documents forever (no deletion). Only images in S3 are subject to lifecycle deletion after 30 days.

3. S3 layout and lifecycle

- Bucket: `YOUR_BUCKET_NAME` (configurable via env var `S3_BUCKET`)
- Object key pattern: `email/<filename>` — e.g., `user%40example.com/photo1.jpg` (URL-encode email if needed).
- Alternatively include timestamp to avoid collisions: `email/2026-01-23T12-00-00_photo1.jpg`.

Lifecycle (recommended):

- Configure an S3 lifecycle rule scoped to prefix `email/` to expire objects 30 days after creation. Because the prefix changes per email, create a lifecycle rule using a tag or globally apply a rule to a bucket that matches all objects under `*/` with a 30-day expiration for objects in `images/` prefix or similar. If you can't set many per-email rules, use a consistent folder such as `images/<email>/...` and set a rule for `images/` prefix.
- Example lifecycle: Expiration action: `Expiration: 30 days` for prefix `images/`.

IAM

- Create a minimal IAM policy allowing PutObject, GetObject, DeleteObject for the specific bucket. If using folder-per-email, scope via condition on `s3:prefix` when possible.

4. Overwrite behavior (double submissions)

- On new submission with existing email:
  1. Begin transaction / atomic operation if DB supports transactions.
  2. Delete old image objects listed in `imageKeys` from S3.
  3. Upload new images to S3 (or accept presigned uploads from client), record new keys in DB.
  4. Update DB document with new fields and `imageKeys`.
- This ensures only the latest images remain in S3 and DB always reflects the latest submission.

5. UI: Modal / popup after initial form

- Replace `alert()` with a styled modal. Requirements:
  - Title: thank-you bubble similar to the attached image.
  - Body: short confirmation text and a prominent CTA link/button that opens Step B in a new tab (or same tab depending on UX choice).
  - Also show short instructions to check SMS for link and next steps.
- Accessibility: modal should be focus-trapped and keyboard-accessible.
- Example implementation: Bootstrap modal or custom accessible dialog element.

6. Step B form (hosted page)

- URL pattern: `https://your-domain.com/extra-form?token=XYZ` or `https://your-domain.com/form?email=user%40example.com&id=...`.
- Security: prefer generating a short one-time token tied to the email to avoid exposing email in query. Token should expire after e.g., 7 days.
- Fields: include all previously collected fields (prefill where available), plus two file inputs for images. Show thumbnails of uploaded images if editing.
- Upload approach options:
  - Server-mediated upload (client posts multipart/form-data to your server, server uploads to S3 via AWS SDK). Simpler to implement but increases server bandwidth.
  - Presigned PUT/S3 upload: server generates presigned URLs and client uploads directly to S3; then client posts the returned S3 keys to server to finalize DB.

7. SMS message flows and templates

- Initial SMS (sent immediately after Step A submit):
  - Template: "Thank you — we've received your info. Please complete the next step: [FORM_LINK]"
  - Use a short URL (your domain or a redirect) so the SMS looks clean.

- Post-Step B SMS (after Step B submit):
  - Template: "Thanks — we received your additional info. Book your appointment here: [APPT_LINK]"

- If user re-submits Step B (overwrites), send the post-Step B SMS again if desired (or only on first-time submission). Clarify desired behavior in product requirements.

8. Endpoints (express-style)

- POST /api/form/initial-submit
  - Called by the existing form front-end. Server: save or log initial info, send SMS with Step B link, respond with success so front-end shows modal.

- GET /form/complete?token=XYZ
  - Serves the Step B form page; token identifies the email and pre-fills fields.

- POST /api/form/submit
  - Accepts Step B form fields + image keys or multipart images. Server performs upsert by email and handles image upload lifecycle.

- POST /api/form/presign (optional)
  - Returns presigned S3 URLs for direct client upload.

Implementation examples (Node / Express / Mongoose)

- Mongoose schema sketch:

  const FormSubmissionSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  firstName: String,
  lastName: String,
  otherFields: Object,
  imageKeys: [{ key: String, url: String, uploadedAt: Date }],
  }, { timestamps: true });

- Upload flow (server-mediated):
  1. Receive `multipart/form-data` with fields + files.
  2. If existing submission: delete previous S3 objects listed in `imageKeys`.
  3. Upload files to S3: key = `images/<email>/<timestamp>_<originalName>`.
  4. Save keys and urls in `imageKeys` and upsert document.
  5. Send SMS via existing `smsService.js` with appointment link.

- Using presigned uploads:
  1. Client requests presigned URLs for each file with `POST /api/form/presign { email, fileName, contentType }`.
  2. Server responds with presigned put URL(s) and future keys.
  3. Client uploads directly to S3.
  4. Client calls `POST /api/form/submit` with form data plus `imageKeys` (the server validates ownership and timestamps), server upserts document.

Code snippet: deleting previous images (AWS SDK v3, JS)

const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ region: process.env.S3_REGION });

async function deleteOldImages(bucket, keys) {
if (!keys || keys.length === 0) return;
const objects = keys.map(k=>({ Key: k }));
await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
}

S3 lifecycle vs explicit deletion

- Prefer lifecycle rules to automatically remove old photos after 30 days — it's reliable and inexpensive. Configure lifecycle at the bucket level for prefix `images/`.
- Still delete old objects explicitly on overwrite so storage does not temporarily double (recommended). Lifecycle is a safety net.

Security and validation

- Validate email format and ensure token-based access to Step B if you don't want to expose email in URL.
- Limit file types (jpg/png), max file size (e.g., 5MB each), and number of files (2).
- Rate-limit endpoints to prevent abuse of SMS or S3.
- Make SMS links short and single-use if desired.

Testing checklist

- End-to-end: initial form -> modal -> SMS with link -> Step B form -> upload images -> DB stores data -> images in S3 -> post-step SMS sent.
- Overwrite test: submit Step B twice for same email — verify DB updated and old S3 objects removed.
- Lifecycle test: (if possible) verify lifecycle rule by simulating object creation date or using short lifecycle during test.

Deployment & environment variables

- `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `SMS_SERVICE_*` (whatever `smsService.js` requires)
- `FORM_BASE_URL` (domain used in SMS links)
- `TOKEN_SECRET` (if you implement token-based Step B links)

Next steps / Implementation plan

- Implement backend `FormSubmission` model and write upload handlers.
- Integrate S3 presigned or server-upload approach and test file upload from the Step B page.
- Replace front-end `alert()` with a modal and wire the CTA to generate tokens and send SMS.
- Hook up `smsService.js` to send the two SMS messages (initial and post-completion).
- Configure S3 lifecycle rule and test overwrite/delete flows.

Appendix: SMS templates

- Initial SMS: "Thanks — we got your details. Please finish here: [LINK]"
- Step B success SMS: "Thanks — we've received your extra info. Book appointment: [APPT_LINK]"

If you want, I can now:

- Implement the DB model and the `POST /api/form/submit` endpoint (server-side).
- Replace the front-end alert with a modal and wire the CTA to generate tokens and send SMS.
- Add S3 lifecycle configuration example (CloudFormation/Terraform) and sample IAM policy.
