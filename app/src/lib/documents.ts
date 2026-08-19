import { supabase } from './supabase';

// Document templates and generated documents — PRD.md §14.3/§14.4.
//
// The database is the engine: it stores the versioned template, substitutes
// the request's data, stamps the signatures, mints the reference code and
// computes the hash. This module is a thin RPC layer plus the one thing SQL
// cannot do — turn a storage object key into a URL the browser can load.
//
// Writes are RPC-only, like everything else since the direct-table-access
// cleanup. The browser holds an anon JWT and never touches a table.

export interface BindingKey {
  key: string;
  label: string;
  source: string; // 'built-in' | 'field'
}

export interface DocumentTemplate {
  id: string;
  category_id: string;
  doc_type: string;
  name: string;
  version: number;
  body_html: string;
  created_at: string;
}

export interface RenderedDocument {
  html: string;
  reference_code: string;
  state_hash: string;
  doc_type: string;
  template_name: string;
  template_version: number;
  signature_keys: string[];
  generated_at: string;
}

export interface VerificationResult {
  found: boolean;
  doc_type?: string;
  issued_at?: string;
  intact?: boolean;
  signatures?: { signer: string; role: string; signed_at: string }[];
}

export async function listBindingKeys(categoryId: string): Promise<BindingKey[]> {
  const { data, error } = await supabase.rpc('document_binding_keys', { p_category_id: categoryId });
  if (error) throw error;
  return data ?? [];
}

// Every version ever published, newest first. Old versions are kept because a
// document generated from one must regenerate identically — see the
// append-only note in 0017_document_templates.sql.
export async function listTemplates(categoryId: string): Promise<DocumentTemplate[]> {
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('category_id', categoryId)
    .order('doc_type')
    .order('version', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveTemplate(
  categoryId: string,
  docType: string,
  name: string,
  bodyHtml: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('save_document_template', {
    p_category_id: categoryId,
    p_doc_type: docType,
    p_name: name,
    p_body_html: bodyHtml,
  });
  if (error) throw error;
  return data as string;
}

// Swaps every data-signature-key in the rendered HTML for a short-lived signed
// URL. The database returns object keys rather than URLs on purpose: minting a
// signed URL is the storage service's job, and a URL baked into a stored
// document would expire and rot.
async function inlineSignatureImages(html: string, keys: string[]): Promise<string> {
  if (keys.length === 0) return html;

  const unique = Array.from(new Set(keys));
  const { data, error } = await supabase.storage
    .from('signatures')
    .createSignedUrls(unique, 300);
  if (error) throw error;

  let out = html;
  for (const row of data ?? []) {
    if (!row.signedUrl || !row.path) continue;
    // Attribute-targeted replacement rather than a blind string swap, so a key
    // appearing in document text cannot be turned into an image source.
    out = out.replaceAll(
      `data-signature-key="${row.path}"`,
      `src="${row.signedUrl}" data-signature-key="${row.path}"`,
    );
  }
  return out;
}

export async function renderDocument(requestId: string, docType: string): Promise<RenderedDocument> {
  const { data, error } = await supabase.rpc('render_document', {
    p_request_id: requestId,
    p_doc_type: docType,
  });
  if (error) throw error;

  const doc = data as RenderedDocument;
  return { ...doc, html: await inlineSignatureImages(doc.html, doc.signature_keys ?? []) };
}

// Unauthenticated by design: someone holding a printed document must be able
// to check it without an account. Returns no request contents — see
// verify_document() in 0017.
export async function verifyDocument(referenceCode: string): Promise<VerificationResult> {
  const { data, error } = await supabase.rpc('verify_document', { p_reference_code: referenceCode });
  if (error) throw error;
  return data as VerificationResult;
}

// ============================================================
// Signatures
// ============================================================

export async function getMySignatureUrl(): Promise<string | null> {
  const { data: key, error } = await supabase.rpc('my_signature');
  if (error) throw error;
  if (!key) return null;
  const { data, error: urlErr } = await supabase.storage
    .from('signatures')
    .createSignedUrl(key as string, 300);
  if (urlErr) throw urlErr;
  return data?.signedUrl ?? null;
}

// The object path's first segment is the owner's id, which is what the storage
// policy and set_my_signature() both check. A fresh filename each time — a
// stamp is never overwritten in place, because documents generated earlier
// still point at the old key.
export async function uploadSignature(png: Blob): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const key = `${user.id}/${crypto.randomUUID()}.png`;
  const { error: upErr } = await supabase.storage
    .from('signatures')
    .upload(key, png, { contentType: 'image/png', upsert: false });
  if (upErr) throw upErr;

  const { error } = await supabase.rpc('set_my_signature', { p_object_key: key });
  if (error) throw error;
}

// ============================================================
// Sanitising template HTML
// ============================================================
// Templates are authored by the captain, who is already the most trusted
// account in the system — so this is not a privilege boundary. It exists
// because the editor is contenteditable, which means anything pasted from a
// web page arrives as markup: scripts, iframes, inline handlers and remote
// images that would phone home from every document anyone opens.
//
// Applied on save AND on display. Sanitising only on the way in would leave
// rows written before this existed rendering unchecked.
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S',
  'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'IMG',
]);
const ALLOWED_ATTRS = new Set(['class', 'style', 'colspan', 'rowspan', 'align', 'alt', 'data-signature-key', 'src']);

export function sanitizeDocumentHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // Keep the text, drop the element. Unwrapping rather than deleting
        // means pasting from Word loses the wrapper, not the sentence.
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!ALLOWED_ATTRS.has(name)) { child.removeAttribute(attr.name); continue; }
        // Only signature stamps may carry a source, and only one this app
        // minted — never a remote URL, and never a javascript: payload.
        if (name === 'src' && !attr.value.startsWith('blob:') && !attr.value.startsWith('/') &&
            !attr.value.startsWith(window.location.origin)) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}
