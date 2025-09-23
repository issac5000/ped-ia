import { randomUUID } from 'crypto';
import {
  buildProfileResponse,
  buildProfileUpdatePayload,
  extractAnonCode,
  sanitizeParentUpdateRow,
} from '../../lib/anon-profile.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    if (!serviceKey || !supaUrl) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let payload = {};
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch (e) {
        console.error('updateAnonProfile invalid JSON body', e);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const code = extractAnonCode(payload);
    if (!code) {
      console.error('updateAnonProfile missing code_unique');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'code_unique is required' });
    }

    const updatePayload = buildProfileUpdatePayload(payload.profileUpdate || payload);
    const parentUpdateRaw = payload.parentUpdate || payload.parent_update || null;

    const profileQuery = `${supaUrl}/rest/v1/profiles?select=id,user_id,code_unique,full_name,avatar_url,parent_role,show_children_count,marital_status,number_of_children,parental_employment,parental_emotion,parental_stress,parental_fatigue,context_parental&code_unique=eq.${encodeURIComponent(code)}&limit=1`;
    const profileRes = await fetch(profileQuery, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });

    if (!profileRes.ok) {
      const details = await profileRes.text().catch(() => '');
      console.error('updateAnonProfile fetch existing failed', profileRes.status, details);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(500).json({ error: 'Failed to fetch profile', details: details || undefined });
    }

    const existingList = await profileRes.json().catch(() => []);
    const existing = Array.isArray(existingList) ? existingList[0] : existingList;
    if (existing) {
      if (existing.user_id) {
        console.error('updateAnonProfile non anonymous profile attempted update', { code, user_id: existing.user_id });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(403).json({ error: 'Only anonymous profiles can update via code' });
      }

      if (!existing.full_name && !updatePayload.full_name && !payload.fullName) {
        console.error('updateAnonProfile missing full_name for existing profile');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(400).json({ error: 'full_name is required' });
      }

      let updatedRow = existing;
      if (Object.keys(updatePayload).length) {
        const updateUrl = `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(existing.id)}`;
        const updateRes = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(updatePayload)
        });

        const updateText = await updateRes.text().catch(() => '');
        let updateJson = null;
        if (updateText) {
          try {
            updateJson = JSON.parse(updateText);
          } catch (e) {
            console.error('updateAnonProfile invalid JSON response', e);
          }
        }

        if (!updateRes.ok) {
          console.error('updateAnonProfile update failed', updateRes.status, updateText);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(updateRes.status).json({ error: 'Update failed', details: updateText || undefined });
        }

        const updated = Array.isArray(updateJson) ? updateJson[0] : updateJson;
        if (!updated) {
          console.error('updateAnonProfile update returned empty payload', updateJson);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(500).json({ error: 'Update succeeded but no data returned' });
        }
        updatedRow = updated;
      }

      if (parentUpdateRaw) {
        const sanitizedRow = sanitizeParentUpdateRow(parentUpdateRaw, existing.id);
        if (sanitizedRow) {
          const insertRes = await fetch(`${supaUrl}/rest/v1/parent_updates`, {
            method: 'POST',
            headers: {
              'apikey': serviceKey,
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(sanitizedRow)
          });
          if (!insertRes.ok) {
            const details = await insertRes.text().catch(() => '');
            console.error('updateAnonProfile parent_updates insert failed', insertRes.status, details);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.status(insertRes.status).json({ error: 'Parent update failed', details: details || undefined });
          }
        }
      }

      const profile = buildProfileResponse({ updated: updatedRow, existing, code });

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json({ profile });
    }

    if (!Object.prototype.hasOwnProperty.call(updatePayload, 'full_name') || typeof updatePayload.full_name !== 'string' || !updatePayload.full_name.trim()) {
      console.error('updateAnonProfile missing full_name for creation');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'full_name is required' });
    }

    const insertPayload = {
      ...updatePayload,
      id: randomUUID(),
      code_unique: code,
      user_id: null
    };

    const insertRes = await fetch(`${supaUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(insertPayload)
    });

    const insertText = await insertRes.text().catch(() => '');
    let insertJson = null;
    if (insertText) {
      try {
        insertJson = JSON.parse(insertText);
      } catch (e) {
        console.error('updateAnonProfile invalid insert JSON response', e);
      }
    }

    if (!insertRes.ok) {
      console.error('updateAnonProfile insert failed', insertRes.status, insertText);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(insertRes.status).json({ error: 'Insert failed', details: insertText || undefined });
    }

    const created = Array.isArray(insertJson) ? insertJson[0] : insertJson;
    if (!created) {
      console.error('updateAnonProfile insert returned empty payload', insertJson);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(500).json({ error: 'Insert succeeded but no data returned' });
    }

    if (parentUpdateRaw) {
      const sanitizedRow = sanitizeParentUpdateRow(parentUpdateRaw, created.id || insertPayload.id);
      if (sanitizedRow) {
        const parentInsertRes = await fetch(`${supaUrl}/rest/v1/parent_updates`, {
          method: 'POST',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(sanitizedRow)
        });
        if (!parentInsertRes.ok) {
          const details = await parentInsertRes.text().catch(() => '');
          console.error('updateAnonProfile parent_updates insert failed (create)', parentInsertRes.status, details);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(parentInsertRes.status).json({ error: 'Parent update failed', details: details || undefined });
        }
      }
    }

    const profile = buildProfileResponse({ updated: created, existing: insertPayload, code });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ profile });
  } catch (e) {
    console.error('updateAnonProfile handler error', e);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}
