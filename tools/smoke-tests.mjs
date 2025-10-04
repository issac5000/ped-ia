import fetch from 'node-fetch';

const env = {
  functionsUrl: 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15cndjanVyYmxrc3lwdmVrdXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczNjE4NjksImV4cCI6MjA3MjkzNzg2OX0.WOXYXA1GEFkqkLj_Str4yK4by7kmpwg9-KCBGPkDDQI',
};

async function hit(fn, body) {
  const url = `${env.functionsUrl}/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'apikey': env.anonKey,
      'Authorization': `Bearer ${env.anonKey}`
    },
    body: JSON.stringify(body||{})
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status}: ${text}`);
  console.log(fn, 'OK:', text.slice(0, 200));
}

(async () => {
  await hit('profiles-create-anon', {});
  await hit('anon-children', { action:'list' });
  // NOTE: likes-add nécessite un reply_id existant → juste vérifier 4xx/200 cohérent
  // await hit('likes-add', { replyId:'<un_id_valide>' });
})().catch(e => { console.error(e); process.exit(1); });
