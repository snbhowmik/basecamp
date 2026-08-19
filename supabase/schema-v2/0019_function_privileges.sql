-- Basecamp v2 — take EXECUTE away from PUBLIC on the document functions
-- ============================================================
-- The Supabase image sets ALTER DEFAULT PRIVILEGES granting EXECUTE on every
-- new function to anon, authenticated and service_role (pg_default_acl,
-- defaclobjtype 'f'). So the `grant execute ... to authenticated` lines
-- throughout schema-v2 never restricted anything — they re-granted a
-- privilege the role already held, and anon can call every RPC in this
-- schema, including admin_delete(), assign_role() and setup_levels().
--
-- Note this is a DIRECT grant to the anon role, not one inherited via PUBLIC:
-- `revoke ... from public` is a no-op against it and silently changes
-- nothing. The revoke has to name the role.
--
-- Nothing is currently exploitable through that: each of those functions
-- re-checks has_tag('admin') and has_mfa() internally and raises. But that
-- single in-function check is then the ONLY control, which is the same shape
-- as the aal1 bypass fixed in 0016 — one layer, and no second one behind it.
--
-- This file closes it for the functions added in 0017 and 0018 only. The
-- wider sweep is deliberately NOT done here: the anon-facing
-- pa_self_register policy calls reg_no_matches_batch(), and RLS predicates
-- are evaluated with the *caller's* privileges, so revoking PUBLIC across the
-- schema without auditing which helpers policies depend on would break
-- student self-registration and anything else in that family. That audit is
-- worth doing as its own change, where it can be tested on its own.
--
-- Note that a security definer function calling another function does so as
-- its owner, so the internal helpers below need no grant to callers at all --
-- only the ones reached directly over PostgREST or named in a policy do.

revoke execute on function render_document(uuid, text)               from anon;
revoke execute on function save_document_template(uuid, text, text, text) from anon;
revoke execute on function document_binding_keys(uuid)               from anon;
revoke execute on function request_state_hash(uuid)                  from anon;
revoke execute on function html_escape(text)                         from anon;
revoke execute on function set_my_signature(text)                    from anon;
revoke execute on function my_signature()                            from anon;
revoke execute on function can_read_signature(text)                  from anon;

-- Re-granted explicitly so the intended role keeps what it needs.
grant execute on function render_document(uuid, text)                to authenticated;
grant execute on function save_document_template(uuid, text, text, text) to authenticated;
grant execute on function document_binding_keys(uuid)                to authenticated;
grant execute on function request_state_hash(uuid)                   to authenticated;
grant execute on function html_escape(text)                          to authenticated;
grant execute on function set_my_signature(text)                     to authenticated;
grant execute on function my_signature()                             to authenticated;
-- Named in the storage.objects read policy, which is evaluated as the caller.
grant execute on function can_read_signature(text)                   to authenticated;

-- verify_document() stays reachable by anon: PRD §14.4 requires that someone
-- holding a printed document can check it without an account. It returns no
-- request contents -- only existence, the tamper check, and who signed.
-- verify_document keeps its anon grant; the block above simply must not
-- remove it, so it is listed here rather than among the revokes.
grant execute on function verify_document(text) to anon, authenticated;

notify pgrst, 'reload schema';
