begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regprocedure('private.assert_custody_observer_worker_role_contract()') is not null,
  'ACL edge custody observer worker role assertion exists'
);

select extensions.ok(
  not has_function_privilege(
    'custody_observer_worker',
    'private.assert_custody_observer_worker_role_contract()'::regprocedure,
    'execute'
  ),
  'custody observer worker still cannot execute its private ACL assertion'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'ACL edge baseline custody observer worker ACL contract passes'
);

create table public.p5t03_acl_edge_table_fixture (
  id integer primary key,
  amount_atomic_units numeric(38, 0) not null default 0
);

revoke all on public.p5t03_acl_edge_table_fixture
  from public;

grant select (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects direct public column SELECT contamination'
);

revoke select (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after direct public column SELECT contamination is revoked'
);

grant insert (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects direct public column INSERT contamination'
);

revoke insert (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after direct public column INSERT contamination is revoked'
);

grant update (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects direct public column UPDATE contamination'
);

revoke update (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after direct public column UPDATE contamination is revoked'
);

grant references (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects direct public column REFERENCES contamination'
);

revoke references (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after direct public column REFERENCES contamination is revoked'
);

grant select (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public column SELECT grant option contamination'
);

revoke select (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public column SELECT grant option contamination is revoked'
);

grant insert (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public column INSERT grant option contamination'
);

revoke insert (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public column INSERT grant option contamination is revoked'
);

grant update (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public column UPDATE grant option contamination'
);

revoke update (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public column UPDATE grant option contamination is revoked'
);

grant references (id) on public.p5t03_acl_edge_table_fixture
  to custody_observer_worker with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects public column REFERENCES grant option contamination'
);

revoke references (id) on public.p5t03_acl_edge_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after public column REFERENCES grant option contamination is revoked'
);

create table private.p5t03_acl_edge_private_table_fixture (
  id integer primary key
);

grant select (id) on private.p5t03_acl_edge_private_table_fixture
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects private table column SELECT contamination'
);

revoke select (id) on private.p5t03_acl_edge_private_table_fixture
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after private table column SELECT contamination is revoked'
);

grant select (id) on public.p5t03_acl_edge_table_fixture
  to public;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects PUBLIC column SELECT contamination'
);

revoke select (id) on public.p5t03_acl_edge_table_fixture
  from public;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after PUBLIC column SELECT contamination is revoked'
);

grant create on schema public
  to public;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects PUBLIC CREATE on public schema contamination'
);

revoke create on schema public
  from public;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after PUBLIC CREATE on public schema contamination is revoked'
);

create schema p5t03_acl_edge_schema_fixture;

revoke all on schema p5t03_acl_edge_schema_fixture
  from public;

grant create on schema p5t03_acl_edge_schema_fixture
  to public;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects PUBLIC CREATE on synthetic schema contamination'
);

revoke create on schema p5t03_acl_edge_schema_fixture
  from public;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after PUBLIC CREATE on synthetic schema contamination is revoked'
);

drop schema p5t03_acl_edge_schema_fixture;

drop table private.p5t03_acl_edge_private_table_fixture;

drop table public.p5t03_acl_edge_table_fixture;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'ACL edge final custody observer worker ACL contract passes after fixtures are dropped'
);

select * from extensions.finish();

rollback;
