const SUB_PREFIX = "push_sub:";
const SENT_PREFIX = "push_sent:";

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function normalizePrefs(prefs) {
  return {
    fire: prefs?.fire !== false,
    traffic: prefs?.traffic !== false,
  };
}

export function normalizeCategory(category) {
  return String(category || "").trim().toUpperCase();
}

export function isSupportedCategory(category) {
  const cat = normalizeCategory(category);
  return cat === "FIRE" || cat === "TRAFFIC_COLLISION";
}

export function shouldNotifyForCategory(category, prefs) {
  const cat = normalizeCategory(category);
  if (cat === "FIRE") return !!prefs?.fire;
  if (cat === "TRAFFIC_COLLISION") return !!prefs?.traffic;
  return false;
}

export async function getSubscriptionKey(endpoint) {
  const hash = await hashEndpoint(endpoint);
  return `${SUB_PREFIX}${hash}`;
}

export async function listSubscriptions(kv) {
  const out = [];
  let cursor = undefined;
  let listComplete = false;

  while (!listComplete) {
    const res = await kv.list({ prefix: SUB_PREFIX, cursor });
    cursor = res.cursor;
    listComplete = res.list_complete;
    for (const key of res.keys) {
      const val = await kv.get(key.name, "json");
      if (val) out.push(val);
    }
  }
  return out;
}

export async function storeSubscription(kv, record) {
  const key = await getSubscriptionKey(record.endpoint);
  await kv.put(key, JSON.stringify(record));
}

export async function removeSubscriptionByEndpoint(kv, endpoint) {
  const key = await getSubscriptionKey(endpoint);
  await kv.delete(key);
}

export async function removeSubscriptionsByDeviceId(kv, deviceId) {
  const subs = await listSubscriptions(kv);
  let removed = 0;
  for (const sub of subs) {
    if (sub.deviceId && sub.deviceId === deviceId) {
      await removeSubscriptionByEndpoint(kv, sub.endpoint);
      removed += 1;
    }
  }
  return removed;
}

export async function isEventAlreadySent(kv, eventId) {
  if (!eventId) return false;
  const key = `${SENT_PREFIX}${eventId}`;
  const exists = await kv.get(key);
  return !!exists;
}

export async function markEventSent(kv, eventId, ttlSeconds = 60 * 60 * 24) {
  if (!eventId) return;
  const key = `${SENT_PREFIX}${eventId}`;
  await kv.put(key, "1", { expirationTtl: ttlSeconds });
}

export function requireSecret(request, env, secretName) {
  const secret = env[secretName];
  if (!secret) return false;
  const provided = request.headers.get("x-push-secret") || "";
  return provided === secret;
}

function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashEndpoint(endpoint) {
  const data = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}
