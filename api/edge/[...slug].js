export default async function handler(req, res) {
  try {
    const slug = req.query.slug || [];
    const targetPath = Array.isArray(slug) ? slug.join("/") : slug;

    const resp = await fetch(
      `https://myrwcjurblksypvekuzb.supabase.co/functions/v1/${targetPath}`,
      {
        method: req.method,
        headers: {
          ...req.headers,
          authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      }
    );

    const text = await resp.text();
    res.status(resp.status).send(text);
  } catch (err) {
    res.status(500).json({ error: "Edge proxy failed", details: String(err) });
  }
}
