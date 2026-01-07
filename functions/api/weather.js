export async function onRequestGet(ctx) {
  try {
    // NWS asks for a User-Agent
    const headers = {
      "User-Agent": "VCIncidentWatch (contact: you@example.com)",
      "Accept": "application/geo+json"
    };

    // Pull active alerts for CA (fast, simple)
    const url = "https://api.weather.gov/alerts/active?area=CA";
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`NWS alerts HTTP ${res.status}`);

    const geo = await res.json();
    const feats = Array.isArray(geo?.features) ? geo.features : [];

    // Filter to Ventura-ish alerts (adjust anytime)
    const isVenturaRelated = (p) => {
      const area = (p?.areaDesc || "").toLowerCase();
      return area.includes("ventura") || area.includes("ventura county");
    };

    // Convert to the small objects your UI uses,
    // BUT keep affectedZones, and build geometry from zones when missing.
    const alerts = [];
    for (const f of feats) {
      const p = f?.properties || {};
      if (!isVenturaRelated(p)) continue;

      const affectedZones = Array.isArray(p.affectedZones) ? p.affectedZones : [];
      let geometry = f?.geometry || null;

      // If alert has no geometry, build it from zone GeoJSON (server-side, no CORS issues)
      if (!geometry && affectedZones.length) {
        const zoneUrls = affectedZones.slice(0, 20);

        // Fetch zones and extract polygon features
        const zoneJsons = await Promise.all(
          zoneUrls.map(async (z) => {
            try {
              const zr = await fetch(z, { headers: { ...headers, "Accept": "application/geo+json" } });
              if (!zr.ok) return null;
              return await zr.json();
            } catch {
              return null;
            }
          })
        );

        const features = [];
        for (const z of zoneJsons) {
          if (!z) continue;
          if (z.type === "FeatureCollection" && Array.isArray(z.features)) features.push(...z.features);
          else if (z.type === "Feature") features.push(z);
          else if (z.type && z.coordinates) features.push({ type: "Feature", properties: {}, geometry: z });
        }

        if (features.length) {
          // IMPORTANT: your frontend already supports FeatureCollection
          geometry = { type: "FeatureCollection", features };
        }
      }

      alerts.push({
        id: p.id || f.id || "",
        event: p.event || "",
        headline: p.headline || "",
        severity: p.severity || "",
        sent: p.sent || "",
        ends: p.ends || p.expires || "",
        areaDesc: p.areaDesc || "",

        // ✅ KEY FIXES FOR POLYGONS
        affectedZones,
        geometry
      });
    }

    const payload = {
      updatedAt: new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
      alerts
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // allow your site JS to call it
        "Access-Control-Allow-Origin": "*",
        // small cache so you don’t hammer NWS
        "Cache-Control": "public, max-age=60"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ updatedAt: null, alerts: [], error: String(err?.message || err) }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    });
  }
}
