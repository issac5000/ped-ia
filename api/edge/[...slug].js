export default async function handler(req, res) {
  const { slug } = req.query;
  const targetPath = Array.isArray(slug) ? slug.join("/") : slug;

  if (!targetPath) {
    res.status(400).json({ error: "Missing target function slug" });
    return;
  }

  const url = `https://myrwcjurblksypvekuzb.supabase.co/functions/v1/${targetPath}`;

  try {
    console.log(`Edge proxy forwarding to: ${targetPath}`);
    const response = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: req.method !== "GET" ? JSON.stringify(req.body || {}) : undefined,
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Edge proxy failed", details: err?.message || String(err) });
  }
}
