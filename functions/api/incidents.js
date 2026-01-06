export async function onRequestGet() {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=30",
  };

  try {
    const [vcfd, chp] = await Promise.all([getVCFD(), getCHP()]);
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

// ---------------- VCFD ----------------
// VCFD feed returns JSON
async function getVCFD() {
  const url = "https://firefeeds.venturacounty.gov/api/incidents";
  const res = await fetch(url, {
    cf: { cacheTtl: 30, cacheEverything: true }
  });
  if (!res.ok) throw new Error(`VCFD fetch failed: ${res.status}`);
  const json = await res.json();

  const incidents = Array.isArray(json) ? json : (json?.incidents || json?.data || []);
  const normalized = incidents.slice(0, 300).map(x => ({
    id: x.id || x.incident_id || x.IncidentID || x.IncidentNumber || null,
    dateTime: x.dateTime || x.datetime || x.time || x.received || x.received_time || x.CallReceived || x.Created || "",
    type: x.type || x.call_type || x.CallType || x.incidentType || x.IncidentType || x.Type || "",
    location: x.location || x.address || x.Address || x.Location || "",
    city: x.city || x.City || "",
  }));

  return { count: normalized.length, incidents: normalized };
}

// ---------------- CHP ----------------
// CHP feed returns KML; we parse Placemark name/description/coordinates.
// Ventura County bbox filter is applied.
async function getCHP() {
  const url = "https://quickmap.dot.ca.gov/data/chp-only.kml";
  const res = await fetch(url, {
    cf: { cacheTtl: 30, cacheEverything: true }
  });
  if (!res.ok) throw new Error(`CHP fetch failed: ${res.status}`);
  const kml = await res.text();

  const incidents = parseCHPKml(kml);

  const VC = { minLat: 33.90, maxLat: 34.95, minLon: -119.80, maxLon: -118.55 };
  const filtered = incidents.filter(i =>
    Number.isFinite(i.latitude) && Number.isFinite(i.longitude) &&
    i.latitude >= VC.minLat && i.latitude <= VC.maxLat &&
    i.longitude >= VC.minLon && i.longitude <= VC.maxLon
  ).slice(0, 300);

  filtered.sort((a,b) => (b.epochMs ?? 0) - (a.epochMs ?? 0));

  return { count: filtered.length, incidents: filtered };
}

function parseCHPKml(kml) {
  const placemarks = kml.split("<Placemark>").slice(1);
  const out = [];

  for (const pm of placemarks) {
    const type = decodeXml(getTag(pm, "name")) || "CHP Incident";
    const descRaw = getTag(pm, "description") || "";
    const coords = (getTag(pm, "coordinates") || "").trim();
    if (!coords) continue;

    const [lonStr, latStr] = coords.split(",");
    const longitude = Number(lonStr);
    const latitude = Number(latStr);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    // Turn HTML-ish description into plain text without regex weirdness
    const plain = htmlToText(descRaw);

    const dateTime = extractDateTime(plain);
    let location = plain;
    if (dateTime) location = plain.replace(dateTime, "").trim();

    out.push({
      type,
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

function htmlToText(input) {
  // Safe-ish: remove CDATA markers and strip tags using non-problematic patterns
  let s = String(input);
  s = s.replace("<![CDATA[", "").replace("]]>", "");
  s = s.split("<br>").join(" ").split("<br/>").join(" ").split("<br />").join(" ");
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return decodeXml(s);
}

function decodeXml(s) {
  return String(s)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
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
