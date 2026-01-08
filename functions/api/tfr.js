// /functions/api/tfr.js
export async function onRequestGet() {
  const UPDATED_AT = new Date().toISOString();

  // FAA "export" endpoints often return an HTML page that *contains* the JSON.
  const FAA_URL = "https://tfr.faa.gov/tfr3/export/json";

  // Rough SoCal bbox (San Luis Obispo-ish down to San Diego-ish)
  const SOCAL_BBOX = { minLat: 32.0, maxLat: 35.8, minLon: -121.5, maxLon: -114.0 };

  try {
    const res = await fetch(FAA_URL, {
      headers: {
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        // A real UA helps avoid “app shell” responses sometimes
        "User-Agent": "vcwatch/1.0 (Cloudflare Pages Function)"
      },
      cf: { cacheTtl: 60, cacheEverything: false }
    });

    const text = await res.text();
    const trimmed = text.trim();

    // 1) If FAA gave us raw JSON array, great.
    // 2) If FAA gave us HTML, it usually contains a JSON array inside: [ { ... }, ... ]
    let jsonStr = trimmed;

    if (trimmed.startsWith("<")) {
      const start = trimmed.indexOf("[");
      const end = trimmed.lastIndexOf("]");
      if (start === -1 || end === -1 || end <= start) {
        return jsonResponse({
          ok: false,
          updatedAt: UPDATED_AT,
          upstream: { status: res.status, statusText: res.statusText },
          note: "FAA did not return JSON payload inside HTML (temporary or blocked).",
          sample: trimmed.slice(0, 300),
          count: 0,
          tfrs: []
        }, 200);
      }
      jsonStr = trimmed.slice(start, end + 1);
    }

    let raw = [];
    try {
      raw = JSON.parse(jsonStr);
      if (!Array.isArray(raw)) raw = [];
    } catch (e) {
      return jsonResponse({
        ok: false,
        updatedAt: UPDATED_AT,
        upstream: { status: res.status, statusText: res.statusText },
        note: "Could not parse FAA JSON (format changed).",
        sample: jsonStr.slice(0, 300),
        count: 0,
        tfrs: []
      }, 200);
    }

    // Helpers to pull center coords (FAA field names vary)
    const toNum = (v) => (v == null ? null : Number(v));
    const pick = (obj, keys) => {
      for (const k of keys) {
        if (obj && obj[k] != null && obj[k] !== "") return obj[k];
      }
      return null;
    };

    const inBbox = (lat, lon) =>
      lat >= SOCAL_BBOX.minLat && lat <= SOCAL_BBOX.maxLat &&
      lon >= SOCAL_BBOX.minLon && lon <= SOCAL_BBOX.maxLon;

    const tfrs = raw
      .map((t) => {
        const notamId = pick(t, ["notam_id", "notamId", "NOTAM_ID"]) || "";
        const detailId = String(notamId).replace("/", "_");
        const detailUrl = notamId ? `https://tfr.faa.gov/tfr3/?page=detail_${detailId}` : "https://tfr.faa.gov/tfr3/";

        const lat = toNum(pick(t, ["lat", "latitude", "center_lat", "centerLatitude", "CENT_LAT"]));
        const lon = toNum(pick(t, ["lon", "lng", "longitude", "center_lon", "center_lng", "centerLongitude", "CENT_LON"]));

        return {
          notam_id: notamId,
          type: pick(t, ["type", "tfr_type", "TFR_TYPE"]) || "",
          facility: pick(t, ["facility", "artcc", "ARTCC"]) || "",
          state: pick(t, ["state", "STATE"]) || "",
          description: pick(t, ["description", "desc", "DESCRIPTION"]) || "",
          effective_start: pick(t, ["effective_start", "start_time", "start", "EFFECTIVE_START"]) || "",
          effective_end: pick(t, ["effective_end", "end_time", "end", "EFFECTIVE_END"]) || "",
          lat,
          lon,
          url: detailUrl,
          // keep original fields in case you want to display more later
          _raw: t
        };
      })
      // Filter to SoCal best-effort: either bbox match OR ZLA facility OR CA state
      .filter((t) => {
        const bboxOk = (t.lat != null && t.lon != null) ? inBbox(t.lat, t.lon) : false;
        const facilityOk = String(t.facility || "").toUpperCase().includes("ZLA");
        const stateOk = String(t.state || "").toUpperCase() === "CA";
        return bboxOk || facilityOk || stateOk;
      });

    return jsonResponse({
      ok: true,
      updatedAt: UPDATED_AT,
      upstream: { status: res.status, statusText: res.statusText },
      count: tfrs.length,
      tfrs
    }, 200);

  } catch (err) {
    return jsonResponse({
      ok: false,
      updatedAt: UPDATED_AT,
      note: "TFR API failed in function (network/FAA response).",
      error: String(err?.message || err),
      count: 0,
      tfrs: []
    }, 200);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}