import { json, readVcfdCache } from "./_shared.js";

export async function onRequestGet({ env }) {
  const kv = env.INCIDENTS_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding INCIDENTS_KV." }, 500);

  const { incidents, lastUpdated, stale } = await readVcfdCache(env);
  return json({ ok: true, lastUpdated: lastUpdated || null, stale: !!stale, incidents: incidents || [] });
}
