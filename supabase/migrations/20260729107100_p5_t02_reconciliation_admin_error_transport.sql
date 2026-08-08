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
exception
  when sqlstate '40001' then
    if SQLERRM = 'reconciliation_resolution_version_conflict'
      and nullif(
        pg_catalog.current_setting('request.method', true),
        ''
      ) is not null
    then
      raise exception 'reconciliation_resolution_version_conflict'
        using errcode = 'PT409';
    end if;

    raise;
end;
$$;

comment on function public.admin_transition_review_case(uuid, bigint, text, text, text) is
  'AAL2 ADMIN command wrapper for reconciliation review status transitions. It preserves the private 40001 optimistic concurrency contract for direct database callers and translates exact version conflicts to PT409 only at the PostgREST transport boundary.';

revoke execute on function public.admin_transition_review_case(uuid, bigint, text, text, text)
  from public, anon, authenticated;

grant execute on function public.admin_transition_review_case(uuid, bigint, text, text, text)
  to authenticated;
