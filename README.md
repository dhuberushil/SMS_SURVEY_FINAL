# SMS Survey Engine

Lightweight SMS survey backend using Express, Sequelize (Postgres), and Twilio.

Quick start — development

# SMS Survey Engine

Lightweight SMS survey backend using Express, Sequelize (Postgres), and Twilio.

Quick start — development

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:

```bash
npm install
```

3. Run locally:

```bash
npm start
```

Expose to Twilio during development with ngrok and set your Twilio webhook to `POST https://<your-ngrok>/sms`.

Production checklist

- Never commit `.env` (use a secrets manager or CI environment variables).
- Use `PM2`, `systemd`, or Docker to run in production. `ecosystem.config.js` is included for PM2.
- Ensure S3 bucket CORS allows your frontend origin(s) when using presigned uploads (see docs/S3_SETUP.md or the notes below).

Quick commands

- Start (production): `npm run start:prod`
- Docker build: `npm run docker:build`
- Docker compose (prod): `npm run docker:up`
- Health check: `curl http://127.0.0.1:3000/health`

Environment variables

Create `.env` locally (do not commit). See `.env.example` for required keys.

Key production hardening hints

- Rotate API keys and secrets (Twilio, AWS) and store in a secrets manager (AWS Secrets Manager, HashiCorp Vault, or your CI provider).
- Serve the frontend over HTTPS and add exact frontend origins to the S3 CORS configuration for presigned uploads.
- Enable Twilio request validation for incoming webhooks if exposing public endpoints.
- Add monitoring/alerts (PM2 + log aggregation, or use a hosted APM).

Further help

I can:

- Add a `DRY_RUN` toggle to the nudge worker so SMS are logged instead of sent.
- Add database migrations and example `docker-compose` stack with an nginx reverse proxy and Let’s Encrypt.

See `docs/` for deployment guides and extra details.

```

```
