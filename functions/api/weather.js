export async function onRequestGet() {
  try {
    // Pull CA alerts and filter to Ventura mentions (simple + reliable)
    const api = "https://api.weather.gov/alerts/active?area=CA";

    const res = await fetch(api, {
      headers: {
        "Accept": "application/geo+json",
        "User-Agent": "vc-incident-watch/1.0"
      }
    });
    if (!res.ok) return json({ error: `NWS HTTP ${res.status}` }, 502);

    const data = await res.json();
    const feats = Array.isArray(data?.features) ? data.features : [];

    const alerts = feats
      .filter(f => {
        const area = (f?.properties?.areaDesc || "").toLowerCase();
        return area.includes("ventura");
      })
      .map(f => {
        const p = f.properties || {};
        return {
          id: f.id || "",
          event: p.event || "",
          headline: p.headline || "",
          severity: p.severity || "",
          sent: p.sent || "",
          ends: p.ends || p.expires || "",
          areaDesc: p.areaDesc || "",
          geometry: f.geometry || null
        };
      });

    return json({
      updatedAt: new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
      alerts
    });
  } catch (err) {
    return json({ error: err?.message || "Unknown error" }, 500);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}
