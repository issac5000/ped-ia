// Fonction serverless unique : /api/ai (regroupe story, advice, comment, recipes)
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const typeFromQuery = req?.query?.type;
    const type = typeof body.type === 'string' && body.type ? body.type : (typeof typeFromQuery === 'string' ? typeFromQuery : '');

    switch (type) {
      case 'story': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
        const child = safeChildSummary(body.child);
        const theme = String(body.theme || '').slice(0, 200);
        const duration = Math.max(1, Math.min(10, Number(body.duration || 3)));
        const sleepy = !!body.sleepy;

        const system = `Tu es Ped’IA, créateur d’histoires courtes pour 0–7 ans.
Rédige une histoire de ${duration} minute(s), adaptée à l’âge, avec le prénom.
Style ${sleepy ? 'très apaisant, vocabulaire doux, propice au coucher' : 'dynamique et bienveillant'}.
Texte clair, phrases courtes. Termine par une petite morale positive.`;
        const user = `Contexte enfant: ${JSON.stringify(child)}\nThème souhaité: ${theme || 'libre'}`;

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method:'POST', headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.7, messages:[
            {role:'system', content: system}, {role:'user', content: user}
          ]})
        });
        if (!r.ok){ const t=await r.text(); return res.status(502).json({ error:'OpenAI error', details:t }); }
        const j = await r.json();
        const text = j.choices?.[0]?.message?.content?.trim() || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
      case 'advice': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

        const question = String(body.question || '').slice(0, 2000);
        const child = safeChildSummary(body.child);
        const history = Array.isArray(body.history) ? body.history.slice(-20) : [];

        const system = `Tu es Ped’IA, un assistant parental pour enfants 0–7 ans.
Réponds de manière bienveillante, concrète et structurée en puces.
Inclure: Sommeil, Alimentation, Repères de développement et Quand consulter.
Prends en compte les champs du profil (allergies, type d’alimentation, style d’appétit, infos de sommeil, jalons, mesures) si présents.`;
        const user = `Contexte enfant: ${JSON.stringify(child)}\nQuestion du parent: ${question}`;

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.4,
            messages: [
              { role: 'system', content: system },
              ...history.filter(m=>m && (m.role==='user'||m.role==='assistant') && typeof m.content==='string').map(m=>({ role:m.role, content: m.content.slice(0,2000) })),
              { role: 'user', content: user }
            ]
          })
        });
        if (!r.ok) {
          const t = await r.text();
          return res.status(502).json({ error: 'OpenAI error', details: t });
        }
        const json = await r.json();
        const text = json.choices?.[0]?.message?.content?.trim() || '';

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
     case 'comment': {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  const content = String(body.content || '').slice(0, 2000);
  const system = `Tu es Ped’IA, un assistant bienveillant pour parents. 
  Ta mission est de rédiger un commentaire bref et clair (max 80 mots) sur la mise à jour donnée. 

  - Sois objectif et factuel.  
  - Si le changement est positif, félicite et encourage.  
  - Si le changement est négatif ou préoccupant, relève la difficulté avec empathie et propose un conseil pratique adapté, tout en terminant sur une note rassurante.  
  - Évite les tournures vagues ou trop générales.  
  - Le ton doit être chaleureux, encourageant et accessible à tous les parents.`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${apiKey}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    })
  });
        if (!r.ok) {
          const t = await r.text();
          return res.status(502).json({ error: 'OpenAI error', details: t });
        }
        const j = await r.json();
        const text = j.choices?.[0]?.message?.content?.trim() || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
      case 'recipes': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
        const child = safeChildSummary(body.child);
        const prefs = String(body.prefs || '').slice(0, 400);

        const system = `Tu es Ped’IA, assistant nutrition 0–3 ans.
Donne des idées de menus et recettes adaptées à l’âge, en excluant les allergènes indiqués.
Prends en compte le type d’alimentation (allaitement/biberon/diversification), le style d’appétit, et les préférences fournies.
Structure la réponse avec: Idées de repas, Portions suggérées, Conseils pratiques, Liste de courses.`;
        const user = `Contexte enfant: ${JSON.stringify(child)}\nPréférences/contraintes: ${prefs}`;

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method:'POST', headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.4, messages:[
            {role:'system', content: system}, {role:'user', content: user}
          ]})
        });
        if (!r.ok){ const t=await r.text(); return res.status(502).json({ error:'OpenAI error', details:t }); }
        const j = await r.json();
        const text = j.choices?.[0]?.message?.content?.trim() || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
      default:
        return res.status(400).json({ error: 'Type non reconnu' });
    }
  } catch (e){
    return res.status(500).json({ error: 'IA indisponible', details: String(e?.message || e) });
  }
}

// Limite les informations enfant transmises à l’IA pour raconter l’histoire et générer des conseils ou repas
function safeChildSummary(child) {
  if (!child) return 'Aucun profil';
  return {
    prenom: child.firstName,
    sexe: child.sex,
    date_naissance: child.dob,
    contexte: child.context,
    jalons: child.milestones,
    mesures: child.growth,
  };
}

// Lit l’intégralité du corps de la requête tout en limitant la taille
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
