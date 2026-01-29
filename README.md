# vc-incident-watch
Live Ventura County incident dashboard

## Admin (SMS subscribers)
- Admin page: `/admin.html`
- Page is protected with Basic Auth. Use username `admin` and password = `ADMIN_TOKEN`.
- API calls also accept Bearer or `?token=` with `ADMIN_TOKEN`.
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

## Test SMS endpoint
Endpoint: `/api/test-sms`

Send a one-off test message to specific numbers:
- `mode: "latest"` uses the newest active call data
- `mode: "custom"` uses a custom message body

Authentication is the same as above (ADMIN_TOKEN).

## Test recipients list
Endpoint: `/api/test-recipients`

The Test SMS tab stores a permanent recipient list in KV until you delete entries.

## iOS Web Push (PWA)
Requirements:
- iOS 16.4+ (push only works when installed)
- In Safari: Share → **Add to Home Screen**
- Open the app from the **Home Screen icon** (not Safari tab)
- Enable the toggle in **Fire/Medical** tab

### VAPID keys
Generate VAPID keys (one-time) using @mmmike/web-push:
```bash
node -e "import('@mmmike/web-push/vapid').then(m => m.generateVapidKeys().then(console.log))"
```

Set env vars:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (e.g. `mailto:you@vcwatch.org`)

Optional control:
- `PUSH_TEST_SECRET` (requires `x-push-secret` header for /api/push/test)
- `PUSH_NOTIFY_SECRET` (requires `x-push-secret` header for /api/push/notify)
- `ENABLE_PUSH_TEST=true` (allow /api/push/test without secret)

### Push endpoints
- `GET /api/push/config`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `POST /api/push/test`
- `POST /api/push/notify`

### Test flow
1. Install to Home Screen → open from icon
2. Toggle **Fire + Traffic Notifications** ON
3. Send a test push:
```bash
curl -X POST https://vcwatch.org/api/push/test \
  -H "Content-Type: application/json" \
  -H "x-push-secret: YOUR_SECRET" \
  -d '{"title":"VC Watch Test","body":"Hello"}'
```
