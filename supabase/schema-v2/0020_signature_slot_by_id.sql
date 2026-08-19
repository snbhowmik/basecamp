-- Basecamp v2 — match signature slots by level id, not by level name
-- ============================================================
-- 0017 replaced {{signature:<level name>}} by matching on the level's NAME.
-- Levels are renameable (rename_level(), 0011), and templates are append-only
-- — so renaming "Dean" to "Dean of Engineering" would leave every existing
-- template's slot unmatched. render_document() would then fall through to the
-- "Not yet signed" placeholder: no error, no warning, and a document that
-- has been signed printing as though nobody had signed it.
--
-- Slots now carry the level's id, which never changes. The name form is still
-- accepted so templates authored before this migration keep working, and
-- because a captain hand-typing a slot will reach for the name.
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

revoke execute on function render_document(uuid, text) from anon;
grant  execute on function render_document(uuid, text) to authenticated;

notify pgrst, 'reload schema';
