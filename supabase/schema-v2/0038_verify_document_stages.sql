-- 0038 — verify_document() names the stage each signature cleared
-- ============================================================
-- The captain wants /verify to read as a longer, itemized receipt — one
-- line per approval stage, not just "who signed last" — rather than the
-- flat signer list 0035/0036 built. 'role' (priority_levels.name) already
-- comes back per signature, but that's the level's own title ("Head of
-- Department"), not necessarily the stage's configured label ("HOD
-- Approval") — a captain can name a stage differently from the level it
-- runs at, and the stage name is what actually shows up in a request's
-- own Activity timeline, so it's the more legible word here.
--
-- Joined through the request's category_id + the signature's level_id,
-- the same pair category_stages is already keyed on everywhere else in
-- this schema (advance_stage, can_print, …). A signature with no matching
-- stage row (the category was reconfigured after it was signed) falls
-- back to the level name rather than showing nothing.

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
    'signatures',   coalesce((
      select jsonb_agg(jsonb_build_object(
        'signer', pr.full_name,
        'role',   pl.name,
        'stage',  coalesce(cs.name, pl.name),
        'signed_at', sg.created_at
      ) order by sg.created_at)
      from signatures sg
      join profiles pr on pr.id = sg.signer_id
      left join priority_levels pl on pl.id = sg.level_id
      left join requests r on r.id = d.request_id
      left join category_stages cs on cs.category_id = r.category_id and cs.level_id = sg.level_id
      where sg.id = any(d.signature_ids)
    ), '[]'::jsonb)
  );
end;
$$;
