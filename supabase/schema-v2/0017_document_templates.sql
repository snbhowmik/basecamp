-- Basecamp v2 — document templates and generated documents
-- ============================================================
-- PRD.md §14.3/§14.4, TASK.md "Document Generation".
--
-- The pattern, which is the whole design: a template, populated from the
-- request's data, with the relevant people's stored signatures stamped in,
-- rendered the moment it is asked for. The PDF is disposable — it can be
-- regenerated identically at any time — so what is protected is the
-- generated_documents row: a reference code, a hash of exactly what was
-- signed, and which signatures were stamped. Verification looks up the code
-- and compares the hash. It does not care whether any file still exists.
--
-- NO FIXTURE DATA. Annexure 4.4 and the NOC are not shipped as hardcoded
-- strings; they are templates the captain authors in the dashboard, per
-- category, like every other configuration surface in this system.

-- ============================================================
-- request_state_hash() — the one definition of "what was signed"
-- ============================================================
-- decide_request() previously hashed reference_number, title, body and
-- category only. That left every custom field OUT of the signed state, so a
-- field value could change after approval and the hash would still match —
-- which makes PRD §14.4's "post-signature tampering is detectable" false for
-- exactly the data an approver is deciding on (dates, event name, venue).
--
-- Ordering is explicit (`order by field_key`) because a hash over an
-- unordered aggregate is not reproducible, and reproducibility is the entire
-- point: verification recomputes this later and compares.
--
-- Field VALUES are included; field definition ids are not. Renaming a label
-- must not invalidate a signed document, but changing a value must.
create or replace function request_state_hash(p_request_id uuid)
returns text language sql security definer stable set search_path = public as $$
  select encode(sha256(convert_to(
    coalesce(r.reference_number, '') || e'\x1f' ||
    coalesce(r.title, '')            || e'\x1f' ||
    coalesce(r.body, '')             || e'\x1f' ||
    r.category_id::text              || e'\x1f' ||
    r.requested_by::text             || e'\x1f' ||
    coalesce(r.submitted_at::text, '') || e'\x1e' ||
    coalesce((
      select string_agg(fd.field_key || '=' || coalesce(v.value #>> '{}', ''), e'\x1f' order by fd.field_key)
      from request_field_values v
      join field_definitions fd on fd.id = v.definition_id
      where v.request_id = r.id
    ), ''),
    'UTF8')), 'hex')
  from requests r
  where r.id = p_request_id;
$$;

grant execute on function request_state_hash(uuid) to authenticated;

-- ============================================================
-- html_escape() — substituted values are DATA, never markup
-- ============================================================
-- Every value that lands in a template goes through this. A student typing
-- `<script>` into an event name must not become markup in a document a dean
-- opens. Signature blocks are the sole exception and are assembled by this
-- file, not by any user.
create or replace function html_escape(p_text text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(
    coalesce(p_text, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

grant execute on function html_escape(text) to authenticated, anon;

-- ============================================================
-- document_templates — append-only versions
-- ============================================================
-- Versions are append-only for the same reason §14.4 exists: a document must
-- regenerate identically years later. If a captain could edit a template in
-- place, every document already generated from it would silently start
-- rendering differently, and the reference code would point at something that
-- no longer matches what was signed. Editing therefore writes a NEW version,
-- and generated_documents records the exact version it rendered.
create table document_templates (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references request_categories(id) on delete cascade,
  -- Captain-chosen, e.g. 'annexure_4_4' or 'noc'. Not an enum: the whole
  -- point is that a new document type needs no deploy.
  doc_type    text not null,
  name        text not null,
  version     int  not null,
  body_html   text not null,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  unique (category_id, doc_type, version)
);
create index document_templates_current on document_templates (category_id, doc_type, version desc);

alter table document_templates enable row level security;
alter table document_templates force row level security;

-- Readable by any signed-in user: rendering a document reads the template,
-- and a student downloading their own NOC is the main consumer.
create policy document_templates_read on document_templates for select
  to authenticated using (mfa_satisfied());

-- Insert only. No update policy and no delete policy anywhere — that is what
-- makes the version history append-only, and it is enforced by the absence of
-- the policy rather than by asking callers to behave.
create policy document_templates_insert on document_templates for insert
  to authenticated with check ((has_tag('admin') or can_bootstrap()) and mfa_satisfied());

-- generated_documents must remember which version produced it.
alter table generated_documents
  add column if not exists template_id uuid references document_templates(id);

-- ============================================================
-- save_document_template() — publish the next version
-- ============================================================
create or replace function save_document_template(
  p_category_id uuid,
  p_doc_type    text,
  p_name        text,
  p_body_html   text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_next int;
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can edit document templates.';
  end if;
  if coalesce(trim(p_doc_type), '') = '' then
    raise exception 'A document type is required.';
  end if;
  if coalesce(trim(p_body_html), '') = '' then
    raise exception 'The template body cannot be empty.';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from document_templates
  where category_id = p_category_id and doc_type = trim(p_doc_type);

  insert into document_templates (category_id, doc_type, name, version, body_html, created_by)
  values (p_category_id, trim(p_doc_type), trim(p_name), v_next, p_body_html, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function save_document_template(uuid, text, text, text) to authenticated;

-- ============================================================
-- document_binding_keys() — what the editor's field picker offers
-- ============================================================
-- Built-ins plus this category's own field_definitions, so the picker can
-- never offer a key that will not resolve at render time.
create or replace function document_binding_keys(p_category_id uuid)
returns table (key text, label text, source text)
language sql security definer stable set search_path = public as $$
  select * from (values
    ('reference_number', 'Reference number', 'built-in'),
    ('title',            'Request title',    'built-in'),
    ('body',             'Request details',  'built-in'),
    ('student_name',     'Requester name',   'built-in'),
    ('reg_no',           'Register number',  'built-in'),
    ('programme',        'Programme',        'built-in'),
    ('batch',            'Batch',            'built-in'),
    ('section',          'Section',          'built-in'),
    ('submitted_on',     'Submitted on',     'built-in'),
    ('today',            'Date of issue',    'built-in')
  ) as b(key, label, source)
  union all
  select fd.field_key, fd.label, 'field'
  from field_definitions fd
  where fd.category_id = p_category_id
  order by source desc, key;
$$;

grant execute on function document_binding_keys(uuid) to authenticated;

-- ============================================================
-- render_document() — the engine
-- ============================================================
-- Returns the populated HTML, the reference code, and the signature object
-- keys the browser needs to fetch. It deliberately does NOT produce a PDF:
-- PRD-V2 §14 rules out an API server, and §14.4 makes the file disposable, so
-- the authoritative artefact (content + hash + code) is minted here and the
-- browser merely paints it. Byte-identical PDFs across browsers do not matter
-- when the record is what is protected.
--
-- Signature images are returned as object keys, not URLs. Minting a signed
-- storage URL is the storage service's job, not the database's; the frontend
-- swaps the keys for URLs after this returns.
--
-- Re-downloading does NOT mint a new reference code. A document whose request
-- state and template version are unchanged is the same document, and issuing
-- a fresh code every click would make "look up this code" meaningless.
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
  -- SECURITY DEFINER bypasses RLS, so visibility is re-checked explicitly.
  -- Without this, any signed-in user could render any request's document by
  -- guessing an id — the document contains the request's contents.
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

  -- Built-ins, then this category's custom fields. Custom fields are added
  -- second and cannot clobber a built-in, because jsonb || overwrites left
  -- with right -- so a field_key of 'reg_no' would win. Guard it: built-ins
  -- are authoritative identity, a category author must not be able to shadow
  -- the register number printed on an official document.
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

  -- Signature slots first, because their replacement is trusted markup while
  -- every value below is escaped. A slot names a level: {{signature:Dean}}
  -- stamps whoever signed at the Dean rung on THIS request.
  for sig in
    select sg.id, sg.created_at, pl.name as level_name,
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

    v_html := replace(v_html, '{{signature:' || sig.level_name || '}}', v_block);
    v_sig_ids := array_append(v_sig_ids, sig.id);
    if sig.object_key is not null then
      v_keys := array_append(v_keys, sig.object_key);
    end if;
  end loop;

  -- Any signature slot with no matching signature stays an explicit, visible
  -- gap. Silently deleting it would produce a document that looks complete
  -- and signed when nobody has signed it.
  v_html := regexp_replace(v_html, '\{\{signature:[^}]*\}\}',
    '<span class="sig-stamp sig-pending">Not yet signed</span>', 'g');

  for kv in select key as k, value as val from jsonb_each_text(v_values) loop
    v_html := replace(v_html, '{{' || kv.k || '}}', html_escape(kv.val));
  end loop;

  -- An unresolved placeholder renders as a visible dash rather than vanishing.
  -- A blank would read as a real empty field ("granted to  of  ") and hide the
  -- authoring mistake from the person about to sign it.
  v_html := regexp_replace(v_html, '\{\{[^}]*\}\}', '<span class="tpl-missing">&mdash;</span>', 'g');

  v_hash := request_state_hash(p_request_id);

  -- Same request state, same template version => same document. Reuse the
  -- existing row and its code.
  select * into v_doc from generated_documents
  where request_id = p_request_id
    and doc_type = trim(p_doc_type)
    and state_hash = v_hash
    and template_id = tpl.id
  limit 1;

  if not found then
    -- 128 bits of randomness. Reference codes are handed out and looked up
    -- unauthenticated, so a guessable code would be an enumeration hole.
    -- gen_random_uuid() rather than pgcrypto's gen_random_bytes(): pgcrypto
    -- lives in the `extensions` schema, which is deliberately not on the
    -- pinned search_path, and a security definer function must not widen it.
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

grant execute on function render_document(uuid, text) to authenticated;

-- ============================================================
-- verify_document() — the public lookup (§14.4)
-- ============================================================
-- Granted to anon on purpose: anyone holding a printed document must be able
-- to confirm it without an account.
--
-- It returns NOTHING about the request's contents — no title, no body, no
-- fields. Only that a record exists, whether the request state still matches
-- what was signed, and who signed it. A verification endpoint that returned
-- the document would be a way to read arbitrary tickets by reference code.
create or replace function verify_document(p_reference_code text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
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
    -- The tamper check: recompute the request's state now and compare it with
    -- what was hashed when the document was issued.
    'intact',       request_state_hash(d.request_id) = d.state_hash,
    'signatures',   coalesce((
      select jsonb_agg(jsonb_build_object(
        'signer', pr.full_name,
        'role',   pl.name,
        'signed_at', sg.created_at
      ) order by sg.created_at)
      from signatures sg
      join profiles pr on pr.id = sg.signer_id
      left join priority_levels pl on pl.id = sg.level_id
      where sg.id = any(d.signature_ids)
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function verify_document(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- decide_request() — sign over the full request state
-- ============================================================
-- Unchanged except for the hash: it now calls request_state_hash() instead of
-- computing its own over four columns. Verification recomputes that same
-- function, so the two MUST agree — a document that hashes more than the
-- signature did would report every intact document as tampered.
--
-- Safe to change the hash definition here only because signatures is empty
-- (0 rows at the time of writing). Once signed rows exist, changing this
-- function's hash retroactively invalidates all of them.
create or replace function decide_request(
  p_request_id uuid,
  p_decision   text,
  p_note       text default null,
  p_acted_as   uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
  v_hash text;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  -- SECURITY DEFINER bypasses RLS, so holder identity is re-checked here.
  if r.current_holder <> auth.uid() and not has_tag('admin') then
    raise exception 'This request is not on your desk.';
  end if;

  -- Deciding is a sensitive action; it requires a completed second factor.
  if not has_mfa() then
    raise exception 'Two-factor authentication is required to decide a request.';
  end if;

  if required_checks_outstanding(p_request_id) > 0 then
    raise exception 'Required checks for this level are still outstanding.';
  end if;

  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'Unknown decision.';
  end if;

  -- Computed server-side from the row as stored. A client-supplied hash
  -- proves nothing about what was actually signed.
  v_hash := request_state_hash(p_request_id);

  -- log_only categories are acknowledged without a signature: there is no
  -- decision to countersign, only a review that happened.
  if r.decision_mode = 'approval' then
    insert into signatures (request_id, signer_id, acted_as, level_id, decision, state_hash, note)
    values (p_request_id, auth.uid(), p_acted_as, r.current_level_id, p_decision, v_hash, p_note);
  end if;

  update requests
  set status = case
        when p_decision = 'approved' then (case when r.decision_mode = 'log_only' then 'reviewed' else 'approved' end)::request_status
        when p_decision = 'rejected' then 'rejected'::request_status
        else 'changes_requested'::request_status
      end,
      current_holder = case when p_decision = 'changes_requested' then r.requested_by else null end,
      closed_at = case when p_decision in ('approved', 'rejected') then now() else null end
  where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, acted_as, action, note)
  values (p_request_id, auth.uid(), null, auth.uid(), p_acted_as, p_decision, p_note);
end;
$$;

notify pgrst, 'reload schema';
