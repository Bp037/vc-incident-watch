import { json, refreshVcfdCache, notifyNewIncidents, readVcfdCache } from "./_shared.js";

export async function onRequestPost({ env, request }) {
  const secret = env.REFRESH_SECRET;
  if (!secret) return json({ ok: false, error: "Missing REFRESH_SECRET." }, 500);

  const provided = request.headers.get("x-refresh-secret") || "";
  if (provided !== secret) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const { incidents, lastUpdated } = await refreshVcfdCache(env);
    const notifyResult = await notifyNewIncidents(env, incidents);
    return json({
      ok: true,
      fetched: incidents.length,
      stored: incidents.length,
      lastUpdated,
      notify: notifyResult,
    });
  } catch (err) {
    const fallback = await readVcfdCache(env);
    return json({
      ok: false,
      error: String(err?.message || err),
      lastUpdated: fallback.lastUpdated || null,
      cached: Array.isArray(fallback.incidents) ? fallback.incidents.length : 0,
    });
  }
}
