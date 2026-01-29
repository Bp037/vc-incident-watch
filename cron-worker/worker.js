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

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Refresh failed: ${res.status} ${text.slice(0, 120)}`);
  }
  try {
    const data = JSON.parse(text);
    if (data?.ok === false) {
      console.warn("Refresh completed with upstream error:", data?.error || "Unknown error");
    }
  } catch {
    // ignore non-JSON
  }
}
