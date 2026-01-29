export async function onRequestGet({ env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=30",
  };

  try {
    const [vcfd, chp] = await Promise.all([getVCFD(env), getCHP()]);
    return new Response(
      JSON.stringify({
        ok: true,
        updatedAt: new Date().toISOString(),
        vcfd,
        chp,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || String(err),
      }),
      { status: 500, headers }
    );
  }
}

// ---------------- VCFD ----------------
async function getVCFD(env) {
  const kv = env?.INCIDENTS_KV;
  if (kv) {
    const cached = await kv.get("vcfd:latest", "json");
    const lastUpdated = await kv.get("vcfd:lastUpdated");
    if (Array.isArray(cached)) {
      return { count: cached.length, incidents: cached, lastUpdated: lastUpdated || null };
    }
  }

  const url = "https://firefeeds.venturacounty.gov/api/incidents";
  const res = await fetch(url, { cf: { cacheTtl: 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`VCFD fetch failed: ${res.status}`);

  const json = await res.json();
  const incidents = Array.isArray(json) ? json : (json?.incidents || json?.data || []);

  const normalized = incidents.slice(0, 300).map((x) => ({
    incidentNumber: x.incidentNumber ?? x.IncidentNumber ?? x.id ?? x.IncidentID ?? null,
    responseDate: x.responseDate ?? x.ResponseDate ?? x.dateTime ?? x.datetime ?? x.time ?? "",
    block: x.block ?? x.Block ?? "",
    address: x.address ?? x.Address ?? x.location ?? x.Location ?? "",
    city: x.city ?? x.City ?? "",
    incidentType: x.incidentType ?? x.IncidentType ?? x.type ?? x.Type ?? "",
    status: x.status ?? x.Status ?? "",
    units: x.units ?? x.Units ?? "",
    latitude:
      x.latitude ?? x.Latitude ?? (Number.isFinite(x.lat) ? x.lat : null) ?? null,
    longitude:
      x.longitude ?? x.Longitude ?? (Number.isFinite(x.lon) ? x.lon : null) ?? null,
  }));

  return { count: normalized.length, incidents: normalized, lastUpdated: new Date().toISOString() };
}

// ---------------- CHP ----------------
async function getCHP() {
  const url = "https://quickmap.dot.ca.gov/data/chp-only.kml";
  const res = await fetch(url, { cf: { cacheTtl: 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`CHP fetch failed: ${res.status}`);

  const kml = await res.text();
  const incidents = parseCHPKml(kml);

  // Your extended polygon (lon,lat)
  const VC_POLY = [
    [-118.5300939712794, 34.03185528637208],
    [-118.6116939741298, 34.17101829902782],
    [-118.6177474087175, 34.27981381684283],
    [-118.6632372442538, 34.44835224334707],
    [-119.4411823124322, 34.88620317325202],
    [-119.5484842202537, 34.89739469624134],
    [-119.5958387202233, 34.36956110989777],
    [-118.9209564383981, 33.94545298049609],
  ];

  const filtered = incidents
    .filter((i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude))
    .filter((i) => pointInPolygon(i.longitude, i.latitude, VC_POLY))
    .slice(0, 300);

  filtered.sort((a, b) => (b.epochMs ?? 0) - (a.epochMs ?? 0));

  return { count: filtered.length, incidents: filtered };
}

// ---------------- Utilities ----------------

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
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
      epochMs: parseChpDate(dateTime),
    });
  }

  return out;
}

function parseChpDate(str) {
  if (!str) return null;

  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)/i);
  if (!m) return null;

  let [, mm, dd, yyyy, hh, min, ap] = m;
  mm = Number(mm);
  dd = Number(dd);
  yyyy = Number(yyyy);
  hh = Number(hh);
  min = Number(min);

  if (ap.toLowerCase() === "pm" && hh !== 12) hh += 12;
  if (ap.toLowerCase() === "am" && hh === 12) hh = 0;

  return new Date(yyyy, mm - 1, dd, hh, min).getTime();
}

function getTag(str, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = str.match(re);
  return m ? m[1] : "";
}

function htmlToText(input) {
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
