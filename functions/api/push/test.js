import { sendPushNotification } from "./web-push.js";
import {
  json,
  listSubscriptions,
  normalizeCategory,
  shouldNotifyForCategory,
  removeSubscriptionByEndpoint,
  requireSecret,
} from "./_shared.js";

export async function onRequestPost({ env, request }) {
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  const allowed = isTestAllowed(request, env);
  if (!allowed) return json({ ok: false, error: "Unauthorized" }, 401);

  const vapid = getVapidConfig(env);
  if (!vapid) return json({ ok: false, error: "Missing VAPID env vars." }, 500);

  const body = await request.json().catch(() => ({}));
  const category = normalizeCategory(body.category || "");

  const payload = {
    title: body.title || "VC Watch Test",
    body: body.body || "Test notification from VC Watch.",
    icon: body.icon || "/icons/icon-192.png",
    badge: body.badge || "/icons/icon-192.png",
    data: { url: body.url || "/" },
  };

  let subs = await listSubscriptions(kv);
  if (category) {
    subs = subs.filter((sub) => shouldNotifyForCategory(category, sub.prefs || {}));
  }

  const result = await sendToSubscriptions(subs, payload, vapid, kv);
  return json({ ok: true, ...result });
}

function isTestAllowed(request, env) {
  if (env.PUSH_TEST_SECRET) {
    return requireSecret(request, env, "PUSH_TEST_SECRET");
  }
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
