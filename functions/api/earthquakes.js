export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const window = (url.searchParams.get("window") || "hour").toLowerCase(); // hour|day|week

    // SoCal bounding box (tweak later if you want)
    // minLon, minLat, maxLon, maxLat
    const BBOX = { minLon: -121.5, minLat: 32.0, maxLon: -114.0, maxLat: 35.8 };

    // Time window -> starttime
    const now = new Date();
    let start = new Date(now);
    if (window === "week") start.setDate(now.getDate() - 7);
    else if (window === "day") start.setDate(now.getDate() - 1);
    else start.setHours(now.getHours() - 1); // hour

    const startISO = start.toISOString();

    // USGS query API
    const qs = new URLSearchParams({
      format: "geojson",
      starttime: startISO,
      minmagnitude: "3",
      minlatitude: String(BBOX.minLat),
      maxlatitude: String(BBOX.maxLat),
      minlongitude: String(BBOX.minLon),
      maxlongitude: String(BBOX.maxLon),
      orderby: "time",
      limit: "200"
    });

    const api = `https://earthquake.usgs.gov/fdsnws/event/1/query?${qs.toString()}`;

    const res = await fetch(api, {
      headers: { "Accept": "application/json", "User-Agent": "vc-incident-watch/1.0" }
    });
    if (!res.ok) return json({ error: `USGS HTTP ${res.status}` }, 502);

    const data = await res.json();
    const feats = Array.isArray(data?.features) ? data.features : [];

    const events = feats.map(f => {
      const p = f.properties || {};
      const c = f.geometry?.coordinates || []; // [lon,lat,depthKm]
      return {
        id: f.id || "",
        mag: p.mag,
        place: p.place || "",
        time: p.time || null,
        lat: Number(c[1]),
        lon: Number(c[0]),
        depthKm: Number.isFinite(Number(c[2])) ? Number(c[2]).toFixed(1) : null
      };
    }).filter(e => Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lon)));

    return json({
      updatedAt: new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
      window,
      events
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
