import { supabase } from './supabase';

// request_participants — see schema-v2/0002 (table), 0027
// (add_participant_by_reg_no), 0032 (respond_to_participation). Accept/
// decline goes through an RPC rather than 0003's participants_update policy
// directly: that policy has no WITH CHECK, so it constrains which row a
// participant may touch but not which columns — parent_consent_verified and
// the snapshot_* fields sit on the same row and are not the student's to
// self-certify. 0032 writes exactly acceptance_status/accepted_at.
export interface Participant {
  id: string;
  request_id: string;
  member_id: string;
  snapshot_name: string;
  snapshot_reg_no: string;
  is_leader: boolean;
  acceptance_status: 'pending' | 'accepted' | 'declined';
  accepted_at: string | null;
  parent_consent_verified: boolean;
}

export async function listParticipants(requestId: string): Promise<Participant[]> {
  const { data, error } = await supabase
    .from('request_participants')
    .select('id, request_id, member_id, snapshot_name, snapshot_reg_no, is_leader, acceptance_status, accepted_at, parent_consent_verified')
    .eq('request_id', requestId)
    .order('is_leader', { ascending: false })
    .order('snapshot_name');
  if (error) throw error;
  return data ?? [];
}

export async function addParticipantByRegNo(requestId: string, regNo: string): Promise<string> {
  const { data, error } = await supabase.rpc('add_participant_by_reg_no', {
    p_request_id: requestId,
    p_reg_no: regNo,
  });
  if (error) throw error;
  return data as string;
}

export async function respondToParticipation(participantId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_to_participation', {
    p_participant_id: participantId,
    p_accept: accept,
  });
  if (error) throw error;
}
