-- 0035 — narrow signature access to "this request", tier verify_document by auth
-- ============================================================
-- Two follow-ups raised by the captain, both from the same document-view
-- code path:
--
-- 1. can_read_signature(object_key) (0017) checked "does this object's owner
--    have a signature on ANY request the caller can see" — loose on purpose
--    at the time (V3-WORKFLOW.md §5 flagged it), but storage.objects RLS
--    only ever sees the object key, never a request_id, so there was no way
--    to narrow it at that layer. Fix: render_document() already knows both
--    the caller and exactly which signature keys it is handing back for
--    THIS request — so it now stamps a short-lived, per-viewer grant for
--    those keys, and the storage policy checks the grant instead of "any
--    request they can see". A grant that nobody minted denies by default.
--
-- 2. verify_document() (0017) returned signer name/role/date to anyone with
--    the reference code, signed in or not — deliberate at the time ("who
--    signed it" was part of the public-by-design answer). The captain wants
--    two tiers instead: unauthenticated scanning a QR code sees only that
--    the document is genuine; signed in (any role) sees who signed it and
--    when. Fix: gate the `signatures` key on auth.uid() being non-null.

create table signature_access_grants (
  object_key  text not null,
  granted_to  uuid not null references profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  primary key (object_key, granted_to)
);

alter table signature_access_grants enable row level security;
alter table signature_access_grants force row level security;
-- No policies: only render_document() and can_read_signature(), both
-- security definer, ever touch this table. Nobody gets a policy-level path in.

create or replace function can_read_signature(p_object_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from signature_assets sa
    where sa.object_key = p_object_key and sa.user_id = auth.uid()
  ) or exists (
    select 1 from signature_access_grants g
    where g.object_key = p_object_key and g.granted_to = auth.uid() and g.expires_at > now()
  );
$$;

create or replace function render_document(p_request_id uuid, p_doc_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r          requests%rowtype;
  tpl        document_templates%rowtype;
  v_html     text;
  v_hash     text;
  v_code     text;
  v_doc      generated_documents%rowtype;
  v_values   jsonb;
  v_sig_ids  uuid[];
  v_keys     text[];
  kv         record;
  sig        record;
  v_block    text;
begin
  if not can_see_request(p_request_id) then
    raise exception 'No such request.';
  end if;

  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  select * into tpl from document_templates
  where category_id = r.category_id and doc_type = trim(p_doc_type)
  order by version desc limit 1;
  if not found then
    raise exception 'No % template exists for this category yet.', trim(p_doc_type);
  end if;

  select jsonb_build_object(
    'reference_number', r.reference_number,
    'title',            r.title,
    'body',             r.body,
    'student_name',     p.full_name,
    'reg_no',           coalesce(mp.reg_no, ''),
    'programme',        coalesce(ou.name, ''),
    'batch',            coalesce(b.name, ''),
    'section',          coalesce(s.name, ''),
    'submitted_on',     coalesce(to_char(r.submitted_at, 'DD Mon YYYY'), ''),
    'today',            to_char(now(), 'DD Mon YYYY')
  )
  into v_values
  from profiles p
  left join member_profiles mp on mp.user_id = p.id
  left join org_units ou on ou.id = mp.org_unit_id
  left join batches   b  on b.id  = mp.batch_id
  left join sections  s  on s.id  = mp.section_id
  where p.id = r.requested_by;

  -- Custom fields cannot shadow a built-in: a category author must not be
  -- able to override the register number printed on an official document.
  for kv in
    select fd.field_key as k, coalesce(v.value #>> '{}', '') as val
    from request_field_values v
    join field_definitions fd on fd.id = v.definition_id
    where v.request_id = r.id
      and not v_values ? fd.field_key
  loop
    v_values := v_values || jsonb_build_object(kv.k, kv.val);
  end loop;

  v_html := tpl.body_html;

  -- Signature slots first: their replacement is trusted markup assembled
  -- here, while every value substituted below is escaped.
  for sig in
    select sg.id, sg.created_at, sg.level_id, pl.name as level_name,
           pr.full_name as signer_name, sa.object_key
    from signatures sg
    join priority_levels pl on pl.id = sg.level_id
    join profiles pr on pr.id = sg.signer_id
    left join signature_assets sa on sa.user_id = sg.signer_id and sa.is_active
    where sg.request_id = r.id and sg.decision = 'approved'
  loop
    v_block :=
      '<span class="sig-stamp">' ||
      case when sig.object_key is null then ''
           else '<img class="sig-img" data-signature-key="' || html_escape(sig.object_key) ||
                '" alt="Signature of ' || html_escape(sig.signer_name) || '" />' end ||
      '<span class="sig-name">' || html_escape(sig.signer_name) || '</span>' ||
      '<span class="sig-role">' || html_escape(sig.level_name) || '</span>' ||
      '<span class="sig-date">' || html_escape(to_char(sig.created_at, 'DD Mon YYYY')) || '</span>' ||
      '</span>';

    -- Id form is authoritative; the name form is the compatibility path.
    v_html := replace(v_html, '{{signature:' || sig.level_id::text || '}}', v_block);
    v_html := replace(v_html, '{{signature:' || sig.level_name || '}}', v_block);

    v_sig_ids := array_append(v_sig_ids, sig.id);
    if sig.object_key is not null then
      v_keys := array_append(v_keys, sig.object_key);
    end if;
  end loop;

  v_html := regexp_replace(v_html, '\{\{signature:[^}]*\}\}',
    '<span class="sig-stamp sig-pending">Not yet signed</span>', 'g');

  for kv in select key as k, value as val from jsonb_each_text(v_values) loop
    v_html := replace(v_html, '{{' || kv.k || '}}', html_escape(kv.val));
  end loop;

  v_html := regexp_replace(v_html, '\{\{[^}]*\}\}', '<span class="tpl-missing">&mdash;</span>', 'g');

  v_hash := request_state_hash(p_request_id);

  select * into v_doc from generated_documents
  where request_id = p_request_id
    and doc_type = trim(p_doc_type)
    and state_hash = v_hash
    and template_id = tpl.id
  limit 1;

  if not found then
    v_code := upper(replace(gen_random_uuid()::text, '-', ''));
    insert into generated_documents
      (request_id, doc_type, reference_code, state_hash, signature_ids, generated_by, template_id)
    values
      (p_request_id, trim(p_doc_type), v_code, v_hash,
       coalesce(v_sig_ids, '{}'), auth.uid(), tpl.id)
    returning * into v_doc;
  end if;

  -- Grant the caller read access to exactly the signature images this
  -- render just showed them, for this sitting — narrows "a request they
  -- signed" (the old rule) to "this request, this viewer, right now".
  if v_keys is not null then
    insert into signature_access_grants (object_key, granted_to, expires_at)
    select k, auth.uid(), now() + interval '15 minutes'
    from unnest(v_keys) as k
    on conflict (object_key, granted_to) do update set expires_at = excluded.expires_at;
  end if;

  return jsonb_build_object(
    'html',             v_html,
    'reference_code',   v_doc.reference_code,
    'state_hash',       v_doc.state_hash,
    'doc_type',         v_doc.doc_type,
    'template_name',    tpl.name,
    'template_version', tpl.version,
    'signature_keys',   to_jsonb(coalesce(v_keys, '{}')),
    'generated_at',     v_doc.created_at
  );
end;
$$;

create or replace function verify_document(p_reference_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d generated_documents%rowtype;
begin
  select * into d from generated_documents
  where reference_code = upper(trim(coalesce(p_reference_code, '')));

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found',        true,
    'doc_type',     d.doc_type,
    'issued_at',    d.created_at,
    'intact',       request_state_hash(d.request_id) = d.state_hash,
    -- Signer detail only for someone signed in — anonymous, QR-scan access
    -- (the common case for a printed or shared document) sees just the
    -- genuine/not-genuine mark.
    'signatures',   case when auth.uid() is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'signer', pr.full_name,
        'role',   pl.name,
        'signed_at', sg.created_at
      ) order by sg.created_at)
      from signatures sg
      join profiles pr on pr.id = sg.signer_id
      left join priority_levels pl on pl.id = sg.level_id
      where sg.id = any(d.signature_ids)
    ), '[]'::jsonb) end
  );
end;
$$;
