export async function onRequestGet() {
  try {
    const url = "https://tfr.faa.gov/tfr3/export/json";

    const res = await fetch(url, {
      headers: {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "vc-incident-watch/1.0"
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `FAA TFR HTTP ${res.status}` }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }

    // IMPORTANT: endpoint may not return application/json reliably
    const txt = await res.text();
    let list;
    try {
      list = JSON.parse(txt);
    } catch (e) {
      // If FAA ever wraps it in HTML, this will fail—return diagnostic
      return new Response(JSON.stringify({
        error: "FAA TFR response was not JSON",
        hint: "The upstream returned HTML or malformed JSON",
        sample: txt.slice(0, 200)
      }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }

    // SoCal-ish filter: start with CA + ZLA/ZOA (best-effort from FAA list fields)
    const socalFacilities = new Set(["ZLA", "ZOA"]);
    const filtered = (Array.isArray(list) ? list : [])
      .filter(x => {
        const stateOk = (x?.state || "").toUpperCase() === "CA";
        const facOk = socalFacilities.has((x?.facility || "").toUpperCase());
        // If state is missing (rare), facility can still help
        return stateOk || facOk;
      })
      .map(x => {
        const notamId = String(x?.notam_id || x?.notam || "").trim(); // e.g. "5/4029"
        const safe = notamId.replace("/", "_"); // "5_4029"
        return {
          date: x?.date || "",
          notam_id: notamId,
          facility: x?.facility || "",
          state: x?.state || "",
          type: x?.type || "",
          description: x?.description || "",
          // best-effort detail link pattern used by FAA TFR3 UI
          detailsUrl: notamId ? `https://tfr.faa.gov/tfr3/?page=detail_${safe}` : ""
        };
      });

    return new Response(JSON.stringify({
      updatedAt: new Date().toISOString(),
      count: filtered.length,
      tfrs: filtered
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
} 