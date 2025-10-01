export default async function handler(req, res) {
  try {
    // Extract slug after /api/edge/
    const urlPath = req.url.split('/api/edge/')[1];
    if (!urlPath) {
      return res.status(400).json({ error: "Missing target function slug" });
    }

    const targetUrl = `https://myrwcjurblksypvekuzb.supabase.co/functions/v1/${urlPath}`;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: req.method !== "GET" ? JSON.stringify(req.body || {}) : undefined,
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(text);
  } catch (err) {
    console.error("Edge proxy error:", err);
    res.status(500).json({ error: err.message });
  }
}
