// @ts-nocheck

import { supabaseRequest } from './anon-children.ts';

export async function fetchLikeCount(supaUrl, headers, replyId) {
  const params = new URLSearchParams({ select: 'reply_id' });
  params.append('reply_id', `eq.${replyId}`);
  const rows = await supabaseRequest(
    `${supaUrl}/rest/v1/forum_reply_likes?${params.toString()}`,
    { headers }
  );
  return Array.isArray(rows) ? rows.length : 0;
}
