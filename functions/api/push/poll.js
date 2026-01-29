import { json, notifyNewIncidents, readVcfdCache } from "../incidents/_shared.js";

export async function onRequestPost({ env, request }) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return json({ ok: false, error: "Missing PUSH_NOTIFY_SECRET." }, 500);

  const provided = request.headers.get("x-push-secret") || "";
  if (provided !== secret) return json({ ok: false, error: "Unauthorized" }, 401);

  const { incidents, lastUpdated } = await readVcfdCache(env);
  const result = await notifyNewIncidents(env, incidents || []);
  return json({
    ok: true,
    lastUpdated: lastUpdated || null,
    ...result,
  });
}
