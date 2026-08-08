begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regprocedure('private.assert_custody_observer_worker_role_contract()') is not null,
  'final custody observer worker role assertion exists'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'final baseline custody observer worker ACL contract passes'
);

do $$
begin
  execute format(
    'grant connect on database %I to custody_observer_worker with grant option',
    current_database()
  );
end;
$$;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects database CONNECT grant option contamination'
);

do $$
begin
  execute format(
    'revoke connect on database %I from custody_observer_worker',
    current_database()
  );
  execute format(
    'grant connect on database %I to custody_observer_worker',
    current_database()
  );
end;
$$;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after database CONNECT grant option contamination is revoked'
);

do $$
begin
  execute format(
    'grant temporary on database %I to custody_observer_worker',
    current_database()
  );
end;
$$;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects direct database TEMP contamination'
);

do $$
begin
  execute format(
    'revoke temporary on database %I from custody_observer_worker',
    current_database()
  );
end;
$$;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after direct database TEMP contamination is revoked'
);

do $$
begin
  execute format(
    'grant temporary on database %I to custody_observer_worker with grant option',
    current_database()
  );
end;
$$;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects direct database TEMP grant option contamination'
);

do $$
begin
  execute format(
    'revoke temporary on database %I from custody_observer_worker',
    current_database()
  );
end;
$$;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after direct database TEMP grant option contamination is revoked'
);

grant usage on schema private
  to custody_observer_worker with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects private schema USAGE grant option contamination'
);

revoke grant option for usage on schema private
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after private schema USAGE grant option contamination is revoked'
);

grant create on schema public
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public schema CREATE contamination'
);

revoke create on schema public
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public schema CREATE contamination is revoked'
);

create function public.inspect_observer_contract_fixture()
returns text
language sql
stable
as $$
  select 'fixture'::text;
$$;

revoke execute on function public.inspect_observer_contract_fixture()
  from public;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion ignores non-executable public fixture function'
);

grant execute on function public.inspect_observer_contract_fixture()
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public function EXECUTE contamination'
);

revoke execute on function public.inspect_observer_contract_fixture()
  from custody_observer_worker;

drop function public.inspect_observer_contract_fixture();

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public function contamination is removed'
);

grant execute on function private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
) to anon;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects unexpected atomic command grantee contamination'
);

revoke execute on function private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
) from anon;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after unexpected atomic command grantee is revoked'
);

create table public.p5t03_final_acl_table_fixture (
  id integer primary key
);

revoke all on public.p5t03_final_acl_table_fixture
  from public;

grant select on public.p5t03_final_acl_table_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public table privilege contamination'
);

revoke select on public.p5t03_final_acl_table_fixture
  from custody_observer_worker;

drop table public.p5t03_final_acl_table_fixture;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public table contamination is removed'
);

create sequence public.p5t03_final_acl_sequence_fixture;

revoke all on sequence public.p5t03_final_acl_sequence_fixture
  from public;

grant usage on sequence public.p5t03_final_acl_sequence_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public sequence privilege contamination'
);

revoke usage on sequence public.p5t03_final_acl_sequence_fixture
  from custody_observer_worker;

drop sequence public.p5t03_final_acl_sequence_fixture;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public sequence contamination is removed'
);

create sequence private.p5t03_final_acl_private_sequence_fixture;

grant usage on sequence private.p5t03_final_acl_private_sequence_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects private sequence privilege contamination'
);

revoke usage on sequence private.p5t03_final_acl_private_sequence_fixture
  from custody_observer_worker;

drop sequence private.p5t03_final_acl_private_sequence_fixture;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after private sequence contamination is removed'
);

select extensions.finish();

rollback;
