export default async function handler(req, res) {
  const { slug } = req.query;
  const targetPath = Array.isArray(slug) ? slug.join("/") : slug;

  const url = `https://myrwcjurblksypvekuzb.supabase.co/functions/v1/${targetPath}`;

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: req.method !== "GET" ? JSON.stringify(req.body || {}) : undefined,
    });

    // Pass back Supabase response as-is
    const text = await response.text();
    res.status(response.status);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(text);
  } catch (err) {
    console.error("Edge proxy failed:", err);
    res.status(500).json({ error: "Edge proxy failed", details: String(err) });
  }
}
