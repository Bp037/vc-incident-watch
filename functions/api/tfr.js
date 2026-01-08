export async function onRequestGet() {
  const FAA_XML = "https://tfr.faa.gov/tfr3/export/xml";

  // hard timeout so the function never hangs into a CF 502
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(FAA_XML, {
      signal: controller.signal,
      headers: {
        "Accept": "application/xml,text/xml,*/*",
        "User-Agent": "vc-incident-watch/1.0"
      }
    });

    if (!res.ok) {
      return json({ error: `FAA HTTP ${res.status}` }, 502);
    }

    const xml = await res.text();

    // Minimal XML parsing (no libs) for this known structure:
    // <TFR><Date>...</Date><NOTAMID>...</NOTAMID><Facility>...</Facility><State>...</State><Type>...</Type>...</TFR>
    const blocks = xml.match(/<TFR>[\s\S]*?<\/TFR>/g) || [];

    const tfrs = blocks.map(b => {
      const get = (tag) => {
        const m = b.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return m ? decode(m[1].trim()) : "";
      };

      const notamId = get("NOTAMID"); // ex: 5/0160
      const safe = notamId ? notamId.replace("/", "_") : "";

      return {
        date: get("Date"),
        notam_id: notamId,
        facility: get("Facility"),
        state: get("State"),
        type: get("Type"),
        desc: get("Descr") || get("Description") || "",
        url: safe ? `https://tfr.faa.gov/tfr3/?page=detail_${safe}` : ""
      };
    });

    // Best-effort SoCal bounds: CA + (ZLA/ZOA) tends to cover SoCal/CA centers
    const socalFacilities = new Set(["ZLA", "ZOA"]);
    const filtered = tfrs.filter(x => {
      const st = (x.state || "").toUpperCase();
      const fac = (x.facility || "").toUpperCase();
      return st === "CA" || socalFacilities.has(fac);
    });

    return json({
      updatedAt: new Date().toISOString(),
      count: filtered.length,
      tfrs: filtered
    }, 200);

  } catch (e) {
    const msg =
      e?.name === "AbortError" ? "Upstream timeout (FAA)" : String(e?.message || e);
    return json({ error: msg }, 502);
  } finally {
    clearTimeout(t);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function decode(s) {
  // basic XML entity decode
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}