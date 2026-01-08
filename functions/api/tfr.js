// functions/api/tfr.js
export async function onRequestGet() {
  const FAA_XML = "https://tfr.faa.gov/tfr3/export/xml";

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });

  try {
    const res = await fetch(FAA_XML, {
      headers: {
        // Some endpoints behave better with explicit headers
        "accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
        "user-agent": "vcwatch/1.0 (+https://vcwatch.org)",
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    const text = await res.text();

    // If the upstream returns HTML (common cause of "Unexpected token <")
    if (!res.ok || /^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) {
      return json(
        {
          updatedAt: new Date().toISOString(),
          count: 0,
          tfrs: [],
          error: `FAA upstream returned ${res.status} ${res.statusText}`,
        },
        502
      );
    }

    const getTag = (block, tag) => {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
      const m = block.match(re);
      return m ? m[1].trim() : "";
    };

    // Extract each <TFR>...</TFR> block
    const blocks = [...text.matchAll(/<TFR>([\s\S]*?)<\/TFR>/gi)].map(m => m[1]);

    const tfrsAll = blocks.map(b => {
      const date = getTag(b, "Date");
      const notam = getTag(b, "NOTAMID");
      const facility = getTag(b, "Facility");
      const state = getTag(b, "State");
      const type = getTag(b, "Type");
      const description = getTag(b, "Description");

      // Build useful links from NOTAMID (e.g., "5/0160" -> "detail_5_0160")
      const id = (notam || "").replace("/", "_");
      const details = id ? `https://tfr.faa.gov/tfr3/?page=detail_${id}` : "";
      const xml = id ? `https://tfr.faa.gov/tfr3/download/detail_${id}.xml` : "";
      const aixm = id ? `https://tfr.faa.gov/tfr3/download/detail_${id}.aixm` : "";

      return {
        date,
        notam,
        facility,
        state,
        type,
        description,
        links: { details, xml, aixm },
      };
    });

    // ✅ Keep it simple & reliable: return all CA TFRs (client can filter to "SoCal" if desired)
    const tfrs = tfrsAll.filter(x => (x.state || "").toUpperCase() === "CA");

    return json({
      updatedAt: new Date().toISOString(),
      count: tfrs.length,
      tfrs,
    });
  } catch (e) {
    return json(
      {
        updatedAt: new Date().toISOString(),
        count: 0,
        tfrs: [],
        error: String(e?.message || e),
      },
      502
    );
  }
}