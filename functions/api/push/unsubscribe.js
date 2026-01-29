import { json, listSubscriptions, removeSubscriptionByEndpoint, removeSubscriptionsByDeviceId } from "./_shared.js";

export async function onRequestPost({ env, request }) {
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

  const endpoint = body.endpoint || body.subscription?.endpoint || "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";

  let removed = 0;
  if (endpoint) {
    await removeSubscriptionByEndpoint(kv, endpoint);
    removed += 1;
  }

  if (deviceId) {
    removed += await removeSubscriptionsByDeviceId(kv, deviceId);
  }

  if (!endpoint && !deviceId) {
    return json({ ok: false, error: "Missing endpoint or deviceId." }, 400);
  }

  const remaining = await listSubscriptions(kv);
  return json({ ok: true, removed, count: remaining.length });
}
