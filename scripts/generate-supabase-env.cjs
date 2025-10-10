const fs = require("fs");
const path = require("path");

const outPath = path.join(__dirname, "../assets/supabase-env.json");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!url || !anonKey) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY manquant !");
  process.exit(1);
}

const json = { url, anonKey };

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(json, null, 2));

console.log("✅ supabase-env.json généré :", outPath);
