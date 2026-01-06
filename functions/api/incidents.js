export async function onRequestGet() {
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };

  try {
    const [vcfd, chp] = await Promise.all([fetchVCFD(), fetchCHP()]);
    return new Response(JSON.stringify({ ok:true, updatedAt:new Date().toISOString(), vcfd, chp }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:e.message }), { status:500, headers });
  }
}

async function fetchVCFD() {
  const res = await fetch("https://firefeeds.venturacounty.gov/api/incidents");
  const json = await res.json();
  const list = Array.isArray(json) ? json : json.incidents || [];
  return { count:list.length, incidents:list.slice(0,200) };
}

async function fetchCHP() {
  const res = await fetch("https://quickmap.dot.ca.gov/data/chp-only.kml");
  const text = await res.text();
  const items = text.split("<Placemark>").slice(1).map(p => {
    const coord = p.match(/<coordinates>([^<]+)<\/coordinates>/)?.[1];
    if (!coord) return null;
    const [lon, lat] = coord.split(",").map(Number);
    const name = p.match(/<name>([^<]+)<\/name>/)?.[1] || "CHP";
    return { type:name, latitude:lat, longitude:lon, location:"", dateTime:"" };
  }).filter(Boolean);
  return { count:items.length, incidents:items };
}
