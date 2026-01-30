## S3 setup guide for Step B image uploads

This document explains how to create and configure an AWS S3 bucket for storing Step B images (front/back of insurance card), secure access via presigned PUT URLs, set a 30-day expiry lifecycle, and configure IAM and CORS to support direct browser uploads.

Goals

- Store images under a per-email prefix: `images/<url-encoded-email>/<timestamp>_<uuid>_<filename>`
- Use presigned PUT URLs so clients upload directly to S3 (server only issues presigns)
- Enforce automatic deletion of objects after 30 days via a lifecycle rule
- Follow least-privilege IAM: only allow PutObject/GetObject/DeleteObject/ListBucket for the bucket

1. Create the S3 bucket

- Console: S3 → Create bucket
  - Name: must be globally unique, e.g. `mycompany-stepb-submissions`.
  - Region: pick your `S3_REGION` (e.g. `us-east-1`).
  - Block public access: keep enabled (do not make objects public).
  - Default encryption: enable server-side encryption with Amazon S3-managed keys (SSE-S3) or KMS if required.

2. Add lifecycle rule (30-day expiry)

- Bucket → Management → Lifecycle rules → Create rule
  - Scope: apply to all objects (or prefix `images/`)
  - Expiration: current version expires after 30 days
  - Save rule

3. Configure CORS for browser PUTs

- Bucket → Permissions → CORS configuration
  - Example (restrict `AllowedOrigin` to your domain or ngrok for testing):

```xml
<CORSConfiguration>
  <CORSRule>
    <!-- Replace AllowedOrigin with the domain where `stepb.html` is hosted. For quick dev use your ngrok URL: -->
    <AllowedOrigin>https://pseudoelectoral-fredricka-dolomitic.ngrok-free.dev</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
```

Notes:

- If you host `stepb.html` at multiple origins (for example production domain + a dev ngrok), add one `<CORSRule>` per origin or repeat `<AllowedOrigin>` entries.
- The origin to include in S3 CORS is the page origin that will perform the `PUT` to the presigned URL (the browser location showing `stepb.html`).
- Clicking the SMS link (the personalized `/stepb.html?token=...` link) opens the page in the browser and is not a cross-origin XHR — CORS only matters for the subsequent direct `PUT` from that page to S3.

Example: developer flow with ngrok

- Set `FORM_BASE_URL` (or `APP_URL`) to your ngrok URL so SMS links point to `https://pseudoelectoral-fredricka-dolomitic.ngrok-free.dev/stepb.html?token=...`.
- Set `CORS_ORIGINS` in your `.env` to the same ngrok URL so the server accepts requests from that origin and S3 CORS allows the browser `PUT` to the presigned URL.

Security recommendations

- For production, restrict `AllowedOrigin` to your production domain only. Do not use `*` for PUT uploads.
- Use short-lived presigned URLs (e.g., 15 minutes) and ensure the client sends `Content-Type` when uploading.

4. IAM user / policy (programmatic access)

- Create an IAM user with programmatic access. Attach a minimal inline policy scoped to the bucket.
- Example policy (replace `your-bucket-name`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::your-bucket-name", "arn:aws:s3:::your-bucket-name/*"]
    }
  ]
}
```

Notes:

- `s3:ListBucket` is optional but useful for debugging. Remove in strict production if not needed.
- For multipart or advanced operations, add `s3:AbortMultipartUpload`.

5. Update your `.env` in the project root

```
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA... (from IAM user)
AWS_SECRET_ACCESS_KEY=... (from IAM user)
```

6. Verify server `src/services/s3.js` behavior

- `generatePresignedUrls(email, files)` builds keys with `images/<safeEmail>/...` and returns `{ key, url, contentType }`.
- When `S3_BUCKET` is set, the `url` will be a signed PUT URL. Client must `PUT` file bytes to that URL with `Content-Type` header.

7. Test presign + upload (curl)

- Request presigns (replace `<TOKEN>` and host):

```bash
curl -X POST 'https://your-host.example.com/api/form/presign?token=<TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"files":[{"name":"front.jpg","type":"image/jpeg"},{"name":"back.jpg","type":"image/jpeg"}]}'
```

- Response example:

```json
{ "success": true, "presigned": [ { "key":"images/jane%40example.com/1640000000000_uuid_front.jpg", "url":"https://s3....amazonaws.com/...?...", "contentType":"image/jpeg" }, ... ] }
```

- Upload the file to the returned URL:

```bash
curl -X PUT '<presigned_url>' \
  -H 'Content-Type: image/jpeg' \
  --data-binary '@front.jpg'
```

- Confirm object appears in S3 Console under the `images/` prefix.

8. Final submit (server-side)

- After client uploads, call `POST /api/form/submit?token=<TOKEN>` with JSON body including `imageObjects` listing keys/urls.
- Server will delete any prior keys (overwrite-by-email), save new `imageObjects` to the `FormSubmission` row and mark `stepBCompleted=true`.

9. Recommendations & security

- Production: prefer presigned PUT uploads. Do NOT send base64 images inside JSON bodies in production — it consumes server memory and bandwidth.
- Use short-lived presigned URLs (e.g., 15 minutes) for security.
- Enable SSE (SSE-S3 or SSE-KMS) if images are PHI/PII.
- Enable S3 Access Logging or S3 Server Access logging to an audit bucket for compliance.
- Rotate IAM credentials regularly; use IAM roles for EC2/ECS/EKS if deploying in AWS.

10. Cost and monitoring

- S3 costs: storage, requests (PUT/GET/DELETE), lifecycle transitions; estimate based on expected daily uploads and retention (30 days).
- Monitor via CloudWatch metrics and set alarms for unusual activity (high PUT rate).

11. Troubleshooting tips

- If client receives CORS errors when PUTting to presigned URL, verify bucket CORS allows your origin and PUT method.
- If presign returns `null` or `mock` entries, ensure `S3_BUCKET` and AWS creds are set and server restarted.
- If uploads succeed but `POST /submit` shows 413, ensure the client used presigned PUT (server should only receive small JSON metadata). If proxy (ngrok) causes issues with large requests, prefer direct S3 uploads.

12. Optional: short redirect links

- For friendlier SMS links, implement a short redirect endpoint `/r/:id` that resolves to `/stepb.html?token=<token>` (store mapping in DB). This keeps tokens out of SMS and shortens URLs.

---

If you'd like, I can:

- Add a `scripts/test-presign-upload.sh` helper that requests presigns, uploads a sample image, and calls `/api/form/submit` to validate the flow; or
- Configure `CORS` with your ngrok host and set `.env` values now and run a full presign+upload test from this environment.

Requested by: project task — Step B image storage setup
