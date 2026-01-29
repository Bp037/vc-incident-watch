import { json, listSubscriptions } from "./_shared.js";

export async function onRequestGet({ env, request }) {
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId") || "";
  const endpoint = url.searchParams.get("endpoint") || "";

  if (!deviceId && !endpoint) {
    return json({ ok: false, error: "Missing deviceId or endpoint." }, 400);
  }

  const subs = await listSubscriptions(kv);
  const found = subs.find((s) => (deviceId && s.deviceId === deviceId) || (endpoint && s.endpoint === endpoint));

  if (!found) {
    return json({ ok: true, prefs: { fire: false, traffic: false, medical: false, hazmat: false } });
  }

  return json({ ok: true, prefs: found.prefs || {} });
}
