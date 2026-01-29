import { json, normalizePrefs, storeSubscription } from "./_shared.js";

export async function onRequestPost({ env, request }) {
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

  const subscription = body.subscription || null;
  const endpoint = subscription?.endpoint || "";
  if (!endpoint) return json({ ok: false, error: "Missing subscription endpoint." }, 400);

  const prefs = normalizePrefs(body.prefs || {});
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";

  const now = new Date().toISOString();
  const record = {
    endpoint,
    subscription,
    prefs,
    deviceId,
    updatedAt: now,
  };

  await storeSubscription(kv, record);

  return json({ ok: true });
}
