export async function onRequestGet() {
  try {
    // FAA TFR JSON export (official TFR website)
    const FAA_TFR_JSON = "https://tfr.faa.gov/tfr3/export/json";

    const res = await fetch(FAA_TFR_JSON, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "vc-incident-watch/1.0"
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `FAA HTTP ${res.status}` }), {
        status: 502,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
      });
    }

    const text = await res.text();
    // Some endpoints might return whitespace before JSON; parse safely
    const tfrs = JSON.parse(text);

    return new Response(JSON.stringify({
      updatedAt: new Date().toLocaleString(),
      tfrs
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        // light caching helps mobile speed
        "cache-control": "public, max-age=60"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
    });
  }
}