import { sendPushNotification } from "./web-push.js";
import {
  json,
  listSubscriptions,
  shouldNotifyForCategory,
  isSupportedCategory,
  normalizeCategory,
  isEventAlreadySent,
  markEventSent,
  removeSubscriptionByEndpoint,
  requireSecret,
} from "./_shared.js";

export async function onRequestPost({ env, request }) {
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  if (!isNotifyAllowed(request, env)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const vapid = getVapidConfig(env);
  if (!vapid) return json({ ok: false, error: "Missing VAPID env vars." }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

  const event = body.event || body;
  if (!event?.id) return json({ ok: false, error: "Missing event id." }, 400);

  const category = normalizeCategory(event.category);
  if (!isSupportedCategory(category)) {
    return json({ ok: false, error: "Unsupported category." }, 400);
  }

  if (await isEventAlreadySent(kv, event.id)) {
    return json({ ok: true, skipped: true, reason: "Already sent." });
  }

  const payload = {
    title: event.title || "VC Watch Alert",
    body: event.body || "",
    icon: event.icon || "/icons/icon-192.png",
    badge: event.badge || "/icons/icon-192.png",
    tag: event.id,
    data: { url: event.url || "/" },
  };

  const subs = await listSubscriptions(kv);
  const targets = subs.filter((sub) => shouldNotifyForCategory(category, sub.prefs || {}));

  const result = await sendToSubscriptions(targets, payload, vapid, kv);
  await markEventSent(kv, event.id, 60 * 60 * 24);

  return json({ ok: true, category, ...result });
}

function isNotifyAllowed(request, env) {
  if (env.PUSH_NOTIFY_SECRET) return requireSecret(request, env, "PUSH_NOTIFY_SECRET");
  if (env.PUSH_TEST_SECRET) return requireSecret(request, env, "PUSH_TEST_SECRET");
  return String(env.ENABLE_PUSH_TEST || "").toLowerCase() === "true";
}

function getVapidConfig(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

async function sendToSubscriptions(subs, payload, vapid, kv) {
  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const sub of subs) {
    try {
      const ok = await sendPushNotification(sub.subscription, payload, vapid);
      if (ok) sent += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      if (shouldRemoveSubscription(err)) {
        await removeSubscriptionByEndpoint(kv, sub.endpoint);
        removed += 1;
      }
    }
  }

  return { sent, failed, removed, total: subs.length };
}

function shouldRemoveSubscription(err) {
  const msg = String(err?.message || err);
  return msg.includes("410") || msg.includes("404");
}
