// functions/api/tfr.js
export async function onRequestGet({ request }) {
  const FAA_XML = "https://tfr.faa.gov/tfr3/export/xml";

  const reply = (obj, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });

  try {
    const res = await fetch(FAA_XML, {
      headers: {
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        "user-agent": "vcwatch/1.0 (+https://vcwatch.org)",
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    const text = await res.text();

    // If FAA is down or returns HTML, DO NOT throw.
    const looksHtml = /^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text);

    if (!res.ok || looksHtml) {
      return reply(
        {
          ok: false,
          updatedAt: new Date().toISOString(),
          upstream: { status: res.status, statusText: res.statusText },
          note: "FAA did not return XML (often temporary).",
          sample: text.slice(0, 250),
          count: 0,
          tfrs: [],
        },
        200
      );
    }

    // Safe tag getter (case-insensitive)
    const getTag = (block, tag) => {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
      const m = block.match(re);
      return m ? m[1].trim() : "";
    };

    // Extract <TFR>...</TFR>
    const matches = text.match(/<TFR>[\s\S]*?<\/TFR>/gi) || [];
    const blocks = matches.map(s => s.replace(/^<TFR>|<\/TFR>$/gi, ""));

    const tfrsAll = blocks.map(b => {
      const date = getTag(b, "Date");
      const notam = getTag(b, "NOTAMID");
      const facility = getTag(b, "Facility");
      const state = getTag(b, "State");
      const type = getTag(b, "Type");
      const description = getTag(b, "Description");

      const id = (notam || "").replace("/", "_");
      const details = id ? `https://tfr.faa.gov/tfr3/?page=detail_${id}` : "";

      return {
        date,
        notam_id: notam,
        facility,
        state,
        type,
        desc: description,
        url: details,
      };
    });

    // Return CA only (simple + reliable). You can filter SoCal on the client later.
    const tfrs = tfrsAll.filter(x => (x.state || "").toUpperCase() === "CA");

    return reply({
      ok: true,
      updatedAt: new Date().toISOString(),
      upstream: { status: res.status },
      totalParsed: tfrsAll.length,
      count: tfrs.length,
      tfrs,
    });
  } catch (e) {
    // NEVER 502: always return JSON so you can see the error.
    return reply(
      {
        ok: false,
        updatedAt: new Date().toISOString(),
        error: String(e?.stack || e?.message || e),
        count: 0,
        tfrs: [],
      },
      200
    );
  }
}