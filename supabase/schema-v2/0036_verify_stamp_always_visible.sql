-- 0036 — the approval stamp is public, same as a physical stamp would be
-- ============================================================
-- 0035 gated verify_document()'s `signatures` field on auth.uid(): anonymous
-- saw only genuine/not-genuine, signed in saw who signed and when. The
-- captain's follow-up, building the ticket/stamp views: the last signer's
-- stamp should be visible to anyone who scans the code, not just someone
-- with an account — the same way a physical stamp or visa stamp is meant to
-- be checked by whoever is holding the document, not gated behind a login.
--
-- This does not reopen the document's contents. verify_document() still
-- never returns reference_number, student name, body, or any other request
-- field — only doc_type/issued_at/intact/signatures, exactly as before.
-- Signer identity (who holds the authority this document claims) was always
-- meant to be public per the original "public by design" comment on this
-- function (0017); 0035 narrowed that for an unrelated reason (the captain
-- wanted the printed QR to lead somewhere that didn't require a login) and
-- this un-narrows just that one field now that the actual ask is clearer.

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
