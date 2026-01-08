// /functions/api/tfr.js
export async function onRequestGet() {
  const FAA_XML = "https://tfr.faa.gov/tfr3/export/xml";

  // hard timeout so the function never hangs into a CF 502
  const controller = new AbortController();
  const timeoutMs = 8000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

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

    // Parse each <TFR>...</TFR> block (simple + reliable for this feed)
    const blocks = xml.match(/<TFR>[\s\S]*?<\/TFR>/g) || [];

    const tfrs = blocks.map(b => {
      const get = (tag) => {
        const m = b.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return m ? decodeXml(m[1].trim()) : "";
      };

      // Common tags in FAA export (some may be blank depending on record)
      const notamId = get("NOTAMID");
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

    // IMPORTANT: return ALL records (no filtering yet)
    return json({
      updatedAt: new Date().toISOString(),
      count: tfrs.length,
      tfrs
    }, 200);

  } catch (e) {
    const msg =
      e?.name === "AbortError" ? `Upstream timeout (FAA) after ${timeoutMs}ms` : String(e?.message || e);
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

function decodeXml(s) {
  // basic XML entity decode
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}