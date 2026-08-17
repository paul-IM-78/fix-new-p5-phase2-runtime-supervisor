begin;
select extensions.plan(27);

insert into public.supported_assets (id, asset_code, symbol, display_name, network, asset_type, decimals, status)
values ('00000000-0000-4000-8000-000000111101', 'P6T11SOL', 'P611', 'P6 T11 Synthetic Asset', 'SOLANA', 'NATIVE', 9, 'DRAFT');
insert into private.custody_providers (id, provider_code, display_name, provider_type, supports_balance_observation, status, approved_at)
values ('00000000-0000-4000-8000-000000111102', 'P6T11BITGO', 'P6 T11 Synthetic Provider', 'MPC_CUSTODIAN', true, 'DRAFT', null);
insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role, status, approved_at)
values ('00000000-0000-4000-8000-000000111103', '00000000-0000-4000-8000-000000111102', '00000000-0000-4000-8000-000000111101', 'p6-t11-synthetic', 'P6 T11 Synthetic Binding', 'TREASURY', 'DRAFT', null);

select extensions.ok(pg_catalog.to_regclass('private.custody_wallet_id_registry') is not null, 'P6T11-REG-001 registry table exists');
select extensions.ok(pg_catalog.to_regclass('private.custody_wallet_id_registry_audit_events') is not null, 'P6T11-REG-002 audit table exists');
select extensions.ok(not pg_catalog.has_table_privilege('anon', 'private.custody_wallet_id_registry', 'select,insert,update,delete'), 'P6T11-REG-003 anon has no registry access');
select extensions.ok(not pg_catalog.has_table_privilege('custody_wallet_id_registry_reader', 'private.custody_wallet_id_registry', 'insert,update,delete'), 'P6T11-REG-004 reader is read-boundary only');
select extensions.ok(not pg_catalog.has_table_privilege('custody_wallet_id_registry_provisioner', 'private.custody_wallet_id_registry', 'select,insert,update,delete'), 'P6T11-REG-005 provisioner has no direct table access');
select extensions.ok(pg_catalog.has_function_privilege('custody_wallet_id_registry_reader', 'private.load_active_custody_wallet_id_registry(text)'::regprocedure, 'execute'), 'P6T11-REG-006 reader may execute load function');
select extensions.ok(pg_catalog.has_function_privilege('custody_wallet_id_registry_provisioner', 'private.provision_custody_wallet_id_registry(uuid,text,text,uuid,text)'::regprocedure, 'execute'), 'P6T11-REG-007 provisioner may execute provision function');

select * from private.provision_custody_wallet_id_registry('00000000-0000-4000-8000-000000111103', 'TEST', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '00000000-0000-4000-8000-000000111104', 'SYNTHETIC_PROVISION');

select extensions.is((select version from private.custody_wallet_id_registry where custody_account_binding_id = '00000000-0000-4000-8000-000000111103'), 1::bigint, 'P6T11-REG-008 provision starts at version one');
select extensions.is((select count(*) from private.custody_wallet_id_registry where deactivated_at is null), 1::bigint, 'P6T11-REG-009 active uniqueness has one row');
select extensions.throws_ok($$select * from private.provision_custody_wallet_id_registry('00000000-0000-4000-8000-000000111103', 'TEST', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '00000000-0000-4000-8000-000000111105', 'SYNTHETIC_DUPLICATE')$$, '23505', 'wallet_registry_active_binding_exists', 'P6T11-REG-010 duplicate active binding is rejected');
select * from private.replace_custody_wallet_id_registry((select id from private.custody_wallet_id_registry), 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '00000000-0000-4000-8000-000000111106', 'SYNTHETIC_REPLACE');
select extensions.is((select version from private.custody_wallet_id_registry), 2::bigint, 'P6T11-REG-011 replacement increments version');
select extensions.throws_ok($$select * from private.replace_custody_wallet_id_registry((select id from private.custody_wallet_id_registry), 1, 'cccccccccccccccccccccccccccccccc', '00000000-0000-4000-8000-000000111107', 'SYNTHETIC_STALE')$$, '23514', 'wallet_registry_version_conflict', 'P6T11-REG-012 stale version fails closed');
select * from private.deactivate_custody_wallet_id_registry((select id from private.custody_wallet_id_registry), 2, '00000000-0000-4000-8000-000000111108', 'SYNTHETIC_DEACTIVATE');
select extensions.ok((select deactivated_at is not null from private.custody_wallet_id_registry), 'P6T11-REG-013 deactivate is a lifecycle update');
select extensions.is((select count(*) from private.custody_wallet_id_registry where deactivated_at is null), 0::bigint, 'P6T11-REG-014 inactive row is excluded from active set');
select extensions.throws_ok($$select * from private.provision_custody_wallet_id_registry('00000000-0000-4000-8000-000000111103', 'TEST', 'invalid', '00000000-0000-4000-8000-000000111109', 'SYNTHETIC_INVALID')$$, '22023', 'wallet_registry_provision_input_invalid', 'P6T11-REG-015 malformed wallet identifier fails closed');
select extensions.throws_ok($$select * from private.provision_custody_wallet_id_registry('00000000-0000-4000-8000-000000111103', 'PRODUCTION', 'cccccccccccccccccccccccccccccccc', '00000000-0000-4000-8000-000000111110', 'SYNTHETIC_PRODUCTION')$$, '22023', 'wallet_registry_provision_input_invalid', 'P6T11-REG-016 TEST-only provisioner rejects production');
select extensions.throws_ok($$select * from private.load_active_custody_wallet_id_registry('PRODUCTION')$$, '42501', 'wallet_registry_read_not_authorized', 'P6T11-REG-017 loader rejects production environment');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'private.load_active_custody_wallet_id_registry(text)'::regprocedure, 'execute'), 'P6T11-REG-018 browser roles cannot execute loader');
select extensions.ok((select count(*) from information_schema.columns where table_schema = 'private' and table_name = 'custody_wallet_id_registry_audit_events' and column_name = 'wallet_id') = 0, 'P6T11-REG-019 audit has no wallet id column');
select extensions.is((select operation from private.custody_wallet_id_registry_audit_events order by occurred_at limit 1), 'PROVISION', 'P6T11-REG-020 audit records safe operation metadata');
select extensions.ok(not pg_catalog.has_function_privilege('custody_wallet_id_registry_reader', 'private.provision_custody_wallet_id_registry(uuid,text,text,uuid,text)'::regprocedure, 'execute'), 'P6T11-REG-021 reader cannot provision');
select extensions.ok(not pg_catalog.has_function_privilege('custody_wallet_id_registry_provisioner', 'private.load_active_custody_wallet_id_registry(text)'::regprocedure, 'execute'), 'P6T11-REG-022 provisioner cannot load');
select extensions.ok((select count(*) from pg_catalog.pg_proc where oid = 'private.load_active_custody_wallet_id_registry(text)'::regprocedure and prosecdef and proconfig @> array['search_path=""']) = 1, 'P6T11-REG-023 loader search path is hardened');
select extensions.ok((select count(*) from pg_catalog.pg_proc where oid = 'private.provision_custody_wallet_id_registry(uuid,text,text,uuid,text)'::regprocedure and prosecdef and proconfig @> array['search_path=""']) = 1, 'P6T11-REG-024 provisioner search path is hardened');
select extensions.ok(not pg_catalog.has_table_privilege('service_role', 'private.custody_wallet_id_registry', 'select,insert,update,delete'), 'P6T11-REG-025 service role has no direct registry access');
select extensions.ok((select version = 3 from private.custody_wallet_id_registry), 'P6T11-REG-026 deactivation advances optimistic version');
select extensions.ok((select count(*) = 3 from private.custody_wallet_id_registry_audit_events), 'P6T11-REG-027 authority and lifecycle audit count is exact');

select * from extensions.finish();
rollback;
