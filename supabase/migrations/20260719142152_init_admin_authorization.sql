create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles as profiles
      inner join public.user_roles as user_roles
        on user_roles.user_id = profiles.id
      where profiles.id = (select auth.uid())
        and profiles.account_status = 'ACTIVE'
        and user_roles.role = 'ADMIN'
        and user_roles.revoked_at is null
    ),
    false
  );
$$;

comment on function public.is_current_user_admin() is
  'Returns true only for the current authenticated user when their profile is ACTIVE and they have an active ADMIN role.';

create or replace function public.is_current_user_admin_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_current_user_admin()
    and coalesce((select auth.jwt() ->> 'aal') = 'aal2', false);
$$;

comment on function public.is_current_user_admin_aal2() is
  'Returns true only for the current authenticated user when they are an ACTIVE ADMIN and the current JWT has AAL2.';

revoke execute on function public.is_current_user_admin()
  from public, anon, authenticated;

revoke execute on function public.is_current_user_admin_aal2()
  from public, anon, authenticated;

grant execute on function public.is_current_user_admin()
  to authenticated;

grant execute on function public.is_current_user_admin_aal2()
  to authenticated;
