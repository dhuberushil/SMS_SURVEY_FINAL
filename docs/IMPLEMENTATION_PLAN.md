Implementation Plan — Step A + Step B flow

Purpose

This document is an actionable, developer-focused plan describing how to implement the two-step flow described in `docs/FORM_FLOW.md`. It maps tasks to files, shows rough code outlines, lists tests, deployment notes, and a recommended timeline.

Assumptions

- Project uses Node.js + Express and Mongoose for DB (existing `src` contains `server.js`, `models`, and `services/smsService.js`).
- AWS S3 will be used for image storage.
- SMS service is available via `services/smsService.js`.
- Front-end is in `public/` with `app.js` controlling the existing form behavior.

Phases & Tasks (detailed)

Phase 0 — Setup & prep (1-2 days)

- Add required env vars to `.env` and repository docs: `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `FORM_BASE_URL`, `TOKEN_SECRET`.
- Add AWS SDK v3 dependency (`@aws-sdk/client-s3`) and jsonwebtoken if not present.
- Create branch `feature/stepb-flow`.

Phase 1 — Data model and token management (2-3 days)

1. Add `models/FormSubmission.js` (Mongoose schema).
   - Fields: email, firstName, lastName, dateOfBirth, phone, streetAddress, heightFeet, heightInches, weightLbs, interestedProcedure, priorWeightLossSurgery, wheelchairUsage, hasSecondaryInsurance, insuranceEmployerName, imageObjects, answers, stepBToken, stepBTokenIssuedAt, stepBCompleted, stepBCompletedAt, stepBNudgeCount, stepBLastNudgeAt, createdAt, updatedAt.
2. Add optional `models/FormToken.js` if separated token tracking is preferred. Fields: token, email, issuedAt, nudgeCount, lastNudgeAt, completedAt, resendCount.
3. Add unit tests for schema validation.

Files to create:

- `models/FormSubmission.js`
- optional: `models/FormToken.js`

Phase 2 — Initial submit endpoint + token generation + SMS (2 days)

1. Implement `POST /api/form/initial-submit` in `src/server.js` or `src/routes/form.js`:
   - Validate payload (email required).
   - Create or update `FormSubmission` with Step A fields and generate `stepBToken` (JWT signed with `TOKEN_SECRET`, exp 7d).
   - Set `stepBTokenIssuedAt`, `stepBCompleted=false`, `stepBNudgeCount=0`.
   - Use `smsService.js` to send initial SMS with link: `${FORM_BASE_URL}/form/complete?token=${token}` (shorten if necessary).
   - Return { status: 'ok' }.
2. Front-end: update `public/app.js` to POST to `/api/form/initial-submit`; on success show modal (replace current alert).

Files to edit:

- `src/server.js` or new router `src/routes/forms.js`
- `public/app.js` and `public/index.html` (modal markup)

Phase 3 — Presigned upload endpoint (optional but recommended) (1-2 days)

1. Implement `POST /api/form/presign`:
   - Body: { email, files: [{ name, contentType }] }
   - For each file, generate a key `images/<url-encoded-email>/<ISOts>_<name>`.
   - Use AWS SDK v3 `S3Client` to create presigned PUT URL (or `@aws-sdk/s3-request-presigner`).
   - Return keys and presigned URLs.
2. Client uploads images directly to S3 and then calls `/api/form/submit` with form data + `imageObjects` containing keys and urls.

Files to create/edit:

- `src/services/s3.js` (utility: generateKey, presignUrl)
- `src/routes/forms.js` add `/api/form/presign`

Phase 4 — Step B submit endpoint and overwrite logic (2-3 days)

1. Implement `POST /api/form/submit` to accept final form data:
   - Accept multipart/form-data (server-mediated) OR JSON if presigned flow used.
   - Validate token/email.
   - If presigned flow: validate that the keys belong to `images/<url-encoded-email>/` and that the objects exist (optional verification).
   - If an existing `FormSubmission` exists with `imageObjects` keys, delete those objects from S3 using `DeleteObjectsCommand`.
   - Save new image metadata in `imageObjects` and upsert the `FormSubmission` document (set `stepBCompleted=true`, `stepBCompletedAt=now`).
   - Send post-submission SMS with appointment link using `smsService.js`.
2. Ensure atomic-ish behavior:
   - Upload new images first (presign or server upload). After successful upload, delete old images and update DB. If DB update fails, log and provide retry.

Files to edit:

- `src/routes/forms.js` add `/api/form/submit`
- `src/services/s3.js` add `deleteObjects` helper

Phase 5 — Front-end Step B page and modal (2-4 days)

1. Add Step B page at `public/stepb.html` or a route in SPA.
   - Accept `token` param, call `GET /form/complete?token=XYZ` to prefill if needed.
   - Present all Step B fields as per `docs/FORM_FLOW.md` and `docs/FORM_FLOW.md#Step-B-form-fields`.
   - Implement image capture UI: camera/capture fallback and file input; do client-side validation (size, type).
   - Use presign flow: request presigned URLs, upload images, then submit form data with `imageObjects` keys.
2. Replace existing `alert()` with accessible modal in `public/index.html` and `public/app.js`. Modal should include CTA linking to Step B (with token) and brief instructions.

Phase 6 — Nudge worker & resend endpoint (2 days)

1. Implement `workers/nudgeWorker.js`:
   - Query `FormSubmission` (or `FormToken`) where `stepBCompleted = false` and `stepBNudgeCount < MAX_NUDGES` and next nudge is due.
   - Send SMS via `smsService.js`, increment `stepBNudgeCount`, set `stepBLastNudgeAt`.
2. Implement `POST /api/form/resend-stepb` with rate-limits and optional verification.
3. Deploy worker as a scheduled container or cron job.

Phase 7 — Tests, metrics, and docs (2-3 days)

- Integration tests for full flow.
- Unit tests for token logic, presign, deleteObjects, and overwrite behavior.
- Add metrics instrumentation: `nudge_sent_total`, `nudge_failures_total`, `stepb_completion_rate`.
- Update `docs/FORM_FLOW.md` with implementation notes (done) and add runbook.

Phase 8 — Staging validation & production rollout (1 week)

- Deploy to staging, run QA, validate S3 lifecycle (use short expiry in staging), test overwrite and nudge worker.
- Run privacy/legal review for image retention.
- Phased production rollout with monitoring and rollback plan.

File map (quick)

- `models/FormSubmission.js` (new)
- `models/FormToken.js` (optional)
- `src/routes/forms.js` (new router)
- `src/services/s3.js` (new helper)
- `services/smsService.js` (existing — reuse)
- `workers/nudgeWorker.js` (new)
- `public/stepb.html`, `public/app.js` (UI)
- `public/index.html` (modal update)

Acceptance criteria (done definition)

- Step A submit returns success, sends SMS, and front-end shows modal.
- Step B link opens prefilled form; user can upload two images and submit.
- After Step B submit, DB shows up-to-date fields and `stepBCompleted=true`.
- Old images are removed from S3 after overwrite.
- Nudge worker sends reminder SMS according to schedule, respects rate limits.
- S3 lifecycle rule removes images older than 30 days.

Risks & mitigations (brief)

- SMS deliverability: monitor, use retries & fallbacks.
- Upload failures: use presigned upload validation and retries.
- Race conditions deleting old images: upload new images first, then delete old; batch delete where possible.

Estimated timeline (summary)

- Total: ~6–7 weeks with a 1-backend + 1-frontend + 1 part-time DevOps staffing.

Next immediate steps (what I'll do if you confirm)

1. Implement `models/FormSubmission.js` and unit tests.
2. Implement `POST /api/form/initial-submit` and the front-end modal (so product sees the modal + SMS flow quickly).

If you want I can start coding item (1) now and open a PR with the schema and tests.
