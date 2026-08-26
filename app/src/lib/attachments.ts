import { supabase } from './supabase';

// request_attachments — table since 0002, storage bucket and upload path
// since 0033. Recording the row is an RPC (record_attachment), not a direct
// insert, matching documents.ts's signature pattern: upload to storage
// first, then have the database record what actually landed there rather
// than trusting the client's own claim about size or type.
export interface Attachment {
  id: string;
  request_id: string;
  uploaded_by: string;
  object_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export async function listAttachments(requestId: string): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from('request_attachments')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

// Returns the new row's id — a task answer of type "file" points at it
// rather than duplicating the upload path (StageTasks.tsx).
export async function uploadAttachment(requestId: string, file: File): Promise<string> {
  const key = `${requestId}/${crypto.randomUUID()}-${file.name}`;
  const { error: upErr } = await supabase.storage
    .from('attachments')
    .upload(key, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase.rpc('record_attachment', {
    p_request_id: requestId,
    p_object_key: key,
    p_file_name: file.name,
    p_mime_type: file.type || 'application/octet-stream',
    p_size_bytes: file.size,
  });
  if (error) throw error;
  return data as string;
}

export async function getAttachmentUrl(objectKey: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('attachments').createSignedUrl(objectKey, 300);
  if (error) throw error;
  return data?.signedUrl ?? null;
}
