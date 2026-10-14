import { supabase } from './supabase';

// Notifications are derived from history and comments (0041); the only stored
// state is when this person last looked.
export interface NotificationItem {
  id: string;
  kind: string; // assigned | progress | comment | outcome:<approved|rejected|changes_requested|reviewed>
  request_id: string;
  reference: string;
  title: string;
  at: string;
  detail: string | null;
  actor: string | null;
}

export interface NotificationFeed { seen_at: string | null; items: NotificationItem[] }

export async function getNotifications(limit = 50): Promise<NotificationFeed> {
  const { data, error } = await supabase.rpc('my_notifications', { p_limit: limit });
  if (error) throw error;
  return data as NotificationFeed;
}

export async function markNotificationsSeen(): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_seen');
  if (error) throw error;
}

export function describe(n: NotificationItem): { text: string; tone: 'green' | 'red' | 'amber' | 'blue' | 'gray' } {
  const who = n.actor ?? 'Someone';
  const t = n.title ? `“${n.title}”` : n.reference;
  switch (n.kind) {
    case 'assigned': return { text: `${who} sent ${t} to you — it needs your decision.`, tone: 'blue' };
    case 'outcome:approved': return { text: `Your request ${t} was approved by ${who}.`, tone: 'green' };
    case 'outcome:rejected': return { text: `Your request ${t} was rejected by ${who}.`, tone: 'red' };
    case 'outcome:changes_requested': return { text: `${who} asked for changes to ${t}.`, tone: 'amber' };
    case 'outcome:reviewed': return { text: `Your request ${t} was reviewed by ${who}.`, tone: 'green' };
    case 'progress': return { text: `${t} moved on${n.detail ? ` to ${n.detail}` : ''}.`, tone: 'gray' };
    case 'comment': return { text: `${who} commented on ${t}.`, tone: 'gray' };
    default: return { text: `${t} was updated.`, tone: 'gray' };
  }
}
