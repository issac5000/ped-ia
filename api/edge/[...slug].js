import { parse } from "url";

export default async function handler(req, res) {
  const { pathname } = parse(req.url, true);
  const slug = pathname.replace(/^\/api\/edge\//, ""); // enlève le prefix

  if (!slug) {
    return res.status(400).json({ error: "Missing target function slug" });
  }

  const url = `https://myrwcjurblksypvekuzb.supabase.co/functions/v1/${slug}`;

  try {
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
    res.status(500).json({ error: "Edge proxy failed", details: err.message });
  }
}
