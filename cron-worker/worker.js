export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env));
  },
};

async function runRefresh(env) {
  const url = env.REFRESH_URL || "https://vcwatch.org/api/incidents/refresh";
  const secret = env.REFRESH_SECRET;
  if (!secret) {
    throw new Error("Missing REFRESH_SECRET");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "x-refresh-secret": secret },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${text.slice(0, 120)}`);
  }
}
