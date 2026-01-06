export async function onRequestGet(context) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30",
    "access-control-allow-origin": "*",
  };

  try {
    const [vcfd, chp] = await Promise.all([
      fetchVCFD(),
      fetchCHP(),
    ]);

    return new Response(JSON.stringify({
      ok: true,
      updatedAt: new Date().toISOString(),
      vcfd,
      chp
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err?.message || String(err)
    }), { status: 500, headers });
  }
}

// -------------------- VCFD --------------------
async function fetchVCFD() {
  const url = "https://firefeeds.venturacounty.gov/api/incidents";

  const json = await fetchWithTimeout(url, 8000, {
    headers: { "accept": "application/json" },
    cf: { cacheTtl: 30, cacheEverything: true },
  }).then(r => {
    if (!r.ok) throw new Error(`VCFD feed failed: ${r.status}`);
    return r.json();
  });

  const incidents = Array.isArray(json) ? json : (json?.incidents || json?.data || []);

  const normalized = incidents.slice(0, 300).map((x) => ({
    id: x.id || x.incident_id || x.IncidentID || x.IncidentNumber || null,
    dateTime: x.dateTime || x.datetime || x.time || x.received || x.received_time || x.CallReceived || x.Created || "",
    type: x.type || x.call_type || x.CallType || x.incidentType || x.IncidentType || x.Type || "",
    location: x.location || x.address || x.Address || x.Location || "",
    city: x.city || x.City || "",
  }));

  return { count: normalized.length, incidents: normalized };
}

// -------------------- CHP --------------------
async function fetchCHP() {
  const url = "https://quickmap.dot.ca.gov/data/chp-only.kml";

  const kmlText = await fetchWithTimeout(url, 8000, {
    headers: { "accept": "application/vnd.google-earth.kml+xml, application/xml;q=0.9,*/*;q=0.8" },
    cf: { cacheTtl: 30, cacheEverything: true },
  }).then(r => {
    if (!r.ok) throw new Error(`CHP feed failed: ${r.status}`);
    return r.text();
  });

  const incidents = parseChpKml(kmlText);

  const VC = { minLat: 33.90, maxLat: 34.95, minLon: -119.80, maxLon: -118.55 };

  const filtered = incidents.filter(i =>
    typeof i.latitude === "number" && typeof i.longitude === "number" &&
    i.latitude >= VC.minLat && i.latitude <= VC.maxLat &&
    i.longitude >= VC.minLon && i.longitude <= VC.maxLon
  ).slice(0, 300);

  filtered.sort((a,b) => (b.epochMs ?? 0) - (a.epochMs ?? 0));

  return { count: filtered.length, incidents: filtered };
}

function parseChpKml(kml) {
  const placemarks = kml.split("<Placemark>").slice(1);
  const out = [];

  for (const pm of placemarks) {
    const name = getTag(pm, "name");
    const desc = getTag(pm, "description");
    const coords = getTag(pm, "coordinates");
    if (!coords) continue;

    const [lonStr, latStr] = coords.trim().split(",");
    const longitude = Number(lonStr);
    const latitude = Number(latStr);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const plainDesc = stripHtml(desc || "").replace(/\s+/g, " ").trim();
    const dateTime = extractDateTime(plainDesc);

    let location = plainDesc;
    if (dateTime) location = location.replace(dateTime, "").trim();

    out.push({
      type: name || "CHP Incident",
      dateTime: dateTime || "",
      location: location || "",
      latitude,
      longitude,
      epochMs: dateTime ? Date.parse(dateTime) : null,
    });
  }
  return out;
}

function getTag(str, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = str.match(re);
  return m ? m[1] : "";
}

function stripHtml(html) {
  return String(html)
    .replace(/<!\\[CDATA\\[/g, "")
    .replace(/\\]\\]>/g, "")
    .replace(/<br\\s*\\/?\\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

function extractDateTime(text) {
  const patterns = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(AM|PM)?\b/i,
    /\b\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return "";
}

async function fetchWithTimeout(url, ms, init={}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

