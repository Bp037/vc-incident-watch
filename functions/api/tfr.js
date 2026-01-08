export async function onRequestGet() {
  try {
    // Official FAA TFR export (JSON)
    const FAA_URL = "https://tfr.faa.gov/tfr3/export/json";

    const res = await fetch(FAA_URL, {
      headers: {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "vc-incident-watch/1.0"
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `FAA HTTP ${res.status}` }), {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // IMPORTANT: treat as text first (FAA sometimes serves it oddly)
    const txt = await res.text();

    let tfrs;
    try {
      tfrs = JSON.parse(txt);
    } catch (e) {
      // Upstream returned HTML or non-JSON
      return new Response(JSON.stringify({
        error: "Upstream did not return JSON",
        upstreamSample: txt.slice(0, 160)
      }), {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    return new Response(JSON.stringify({
      updatedAt: new Date().toISOString(),
      tfrs: Array.isArray(tfrs) ? tfrs : []
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}