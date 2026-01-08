// functions/api/tfr.js
export async function onRequestGet() {
  const reply = (obj, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });

  const looksHtml = (t) =>
    /^\s*<!doctype/i.test(t) || /^\s*<html/i.test(t);

  // Try multiple known export endpoints + cache busters
  const now = Date.now();
  const CANDIDATES = [
    // XML export (what we want)
    `https://tfr.faa.gov/tfr3/export/xml?cb=${now}`,
    // Some mirrors/variants that sometimes work better
    `https://tfr.faa.gov/tfr3/export/XML?cb=${now}`,
    // JSON export (fallback)
    `https://tfr.faa.gov/tfr3/export/json?cb=${now}`,
    `https://tfr.faa.gov/tfr3/export/JSON?cb=${now}`,
  ];

  async function fetchText(url) {
    const res = await fetch(url, {
      headers: {
        // Force “file-like” behavior
        "accept": "application/xml,text/xml,application/json,text/plain,*/*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "user-agent": "vcwatch/1.0 (+https://vcwatch.org)",
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    return { res, text: await res.text(), url };
  }

  function parseXmlList(xml) {
    const getTag = (block, tag) => {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
      const m = block.match(re);
      return m ? m[1].trim() : "";
    };

    const matches = xml.match(/<TFR>[\s\S]*?<\/TFR>/gi) || [];
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

    return tfrsAll;
  }

  function parseJsonList(txt) {
    // FAA json export formats vary; we handle arrays + nested structures
    const data = JSON.parse(txt);
    const raw =
      Array.isArray(data) ? data :
      Array.isArray(data?.tfrs) ? data.tfrs :
      Array.isArray(data?.TFRs) ? data.TFRs :
      Array.isArray(data?.records) ? data.records :
      [];

    return raw.map(x => {
      const notam = x.NOTAMID || x.notam_id || x.notam || x.id || "";
      const date = x.Date || x.date || x.effective || "";
      const facility = x.Facility || x.facility || "";
      const state = x.State || x.state || "";
      const type = x.Type || x.type || "";
      const desc = x.Description || x.description || x.desc || "";

      const id = String(notam).replace("/", "_");
      const url = id ? `https://tfr.faa.gov/tfr3/?page=detail_${id}` : "";

      return { date, notam_id: notam, facility, state, type, desc, url };
    });
  }

  try {
    let last = null;

    for (const url of CANDIDATES) {
      const r = await fetchText(url);
      last = r;

      // ignore html app shell
      if (looksHtml(r.text)) continue;

      // JSON?
      if (/^\s*[\[{]/.test(r.text)) {
        const all = parseJsonList(r.text);
        const ca = all.filter(x => (x.state || "").toUpperCase() === "CA");
        return reply({
          ok: true,
          source: url,
          updatedAt: new Date().toISOString(),
          totalParsed: all.length,
          count: ca.length,
          tfrs: ca,
        });
      }

      // XML?
      if (/<\s*TFR\b/i.test(r.text) || /<\s*TFRs?\b/i.test(r.text)) {
        const all = parseXmlList(r.text);
        const ca = all.filter(x => (x.state || "").toUpperCase() === "CA");
        return reply({
          ok: true,
          source: url,
          updatedAt: new Date().toISOString(),
          totalParsed: all.length,
          count: ca.length,
          tfrs: ca,
        });
      }
    }

    // If we got here, every candidate returned HTML (app shell)
    return reply({
      ok: false,
      updatedAt: new Date().toISOString(),
      note: "All FAA export endpoints returned HTML app shell from this environment.",
      lastTried: last?.url,
      upstream: last ? { status: last.res.status, statusText: last.res.statusText } : null,
      sample: last?.text ? last.text.slice(0, 300) : null,
      count: 0,
      tfrs: [],
    });
  } catch (e) {
    return reply({
      ok: false,
      updatedAt: new Date().toISOString(),
      error: String(e?.stack || e?.message || e),
      count: 0,
      tfrs: [],
    });
  }
}