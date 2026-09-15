# Pebble → Cursor Webhook Bridge

Pebble Index 01 の `multipart/form-data` webhook を、Cursor Automations が受け取れる JSON に変換する小さな Cloudflare Worker です。音声ファイルは転送しません。

A tiny Cloudflare Worker that converts Pebble Index 01 `multipart/form-data` webhooks into JSON accepted by Cursor Automations. Audio is discarded and never forwarded.

## Why

Pebble posts `multipart/form-data`. Cursor Automations webhooks expect `Content-Type: application/json`. Calling Cursor directly from Pebble returns **HTTP 415**.

```text
Pebble Index 01 → (multipart) → this Worker → (JSON) → Cursor Automations webhook → your agent
```

## Setup

Requires Node.js 22+.

```bash
npm install
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put CURSOR_WEBHOOK_URL
npx wrangler secret put CURSOR_WEBHOOK_AUTH
npm run deploy
```

Secrets:

- `INGEST_TOKEN` — shared secret Pebble sends (prefer a **short** token; the Pebble app header field can truncate long values)
- `CURSOR_WEBHOOK_URL` — Cursor Automations webhook URL
- `CURSOR_WEBHOOK_AUTH` — **Bearer value only** (`Bearer …`), not the full `Authorization: Bearer …` header line

Pebble app:

- Webhook URL: your `https://<name>.<subdomain>.workers.dev`
- Header `Authorization`: `Bearer <same as INGEST_TOKEN>`
- Send: Transcription

## Pitfalls

1. Direct Pebble → Cursor = 415 (wrong content type).
2. If `CURSOR_WEBHOOK_AUTH` includes the `Authorization:` prefix, Cursor returns 401 malformed header.
3. Register a workers.dev subdomain once per Cloudflare account before first deploy.
4. Very long Bearer tokens may be truncated in the Pebble UI — keep `INGEST_TOKEN` short.

## License

MIT
