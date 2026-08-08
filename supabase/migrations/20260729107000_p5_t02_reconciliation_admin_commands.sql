create or replace function public.admin_open_review_case(
  p_reconciliation_item_id uuid,
  p_idempotency_key text,
  p_reason_code text
)
returns table (
  review_case_id uuid,
  event_id uuid,
  created boolean,
  status text,
  version bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id uuid;
begin
  v_actor_profile_id := (select auth.uid());

  if v_actor_profile_id is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return query
    select
      opened.reconciliation_resolution_id,
      opened.event_id,
      opened.created,
      opened.status,
      opened.version
    from private.open_reconciliation_resolution(
      p_reconciliation_item_id,
      p_idempotency_key,
      v_actor_profile_id,
      p_reason_code
    ) as opened;
end;
$$;

comment on function public.admin_open_review_case(uuid, text, text) is
  'AAL2 ADMIN command wrapper for opening a reconciliation review case. The actor profile is derived from the authenticated session and the private lifecycle writer remains browser-execute blocked.';

create or replace function public.admin_transition_review_case(
  p_review_case_id uuid,
  p_expected_version bigint,
  p_target_status text,
  p_idempotency_key text,
  p_reason_code text
)
returns table (
  review_case_id uuid,
  event_id uuid,
  created boolean,
  status text,
  version bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_profile_id uuid;
  v_target_status text;
begin
  v_actor_profile_id := (select auth.uid());

  if v_actor_profile_id is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_target_status := pg_catalog.btrim(p_target_status);

  if v_target_status is null
    or v_target_status not in ('IN_REVIEW', 'RESOLVED', 'IGNORED')
  then
    raise exception 'reconciliation_review_target_status_invalid'
      using errcode = '22023';
  end if;

  return query
    select
      transitioned.reconciliation_resolution_id,
      transitioned.event_id,
      transitioned.created,
      transitioned.status,
      transitioned.version
    from private.transition_reconciliation_resolution(
      p_review_case_id,
      p_expected_version,
      v_target_status,
      p_idempotency_key,
      v_actor_profile_id,
      p_reason_code
    ) as transitioned;
end;
$$;

comment on function public.admin_transition_review_case(uuid, bigint, text, text, text) is
  'AAL2 ADMIN command wrapper for reconciliation review status transitions. Only IN_REVIEW, RESOLVED, and IGNORED are accepted from callers; actor and authorization are derived from the authenticated session.';

revoke execute on function public.admin_open_review_case(uuid, text, text)
  from public, anon, authenticated;

revoke execute on function public.admin_transition_review_case(uuid, bigint, text, text, text)
  from public, anon, authenticated;

grant execute on function public.admin_open_review_case(uuid, text, text)
  to authenticated;

grant execute on function public.admin_transition_review_case(uuid, bigint, text, text, text)
  to authenticated;
