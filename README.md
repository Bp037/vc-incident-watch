# vc-incident-watch
Live Ventura County incident dashboard

## Admin (SMS subscribers)
- Admin page: `/admin.html`
- Uses `ADMIN_TOKEN` (bearer token) to manage subscriber list.
- Store phone numbers in E.164 format (example: `+18055551234`).

### Required bindings / env vars
Create a KV namespace and bind it to Pages Functions as:
- `VCWATCH_KV` (stores subscribers + last fire snapshot)

Set these environment variables:
- `ADMIN_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` (a Twilio phone number in E.164 format)

## Fire notification endpoint
Endpoint: `/api/fire-notify`

Call it on a schedule (cron, uptime monitor, etc). The endpoint:
- pulls the VCFD incident feed
- detects new active calls since the last run
- sends SMS alerts to all subscribers

The first run only stores a snapshot to avoid spamming. Use either:
- `Authorization: Bearer <ADMIN_TOKEN>`
- or `?token=<ADMIN_TOKEN>`
