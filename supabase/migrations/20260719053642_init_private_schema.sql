create schema if not exists private;

comment on schema private is
  'Server-only database objects and controlled business functions.';

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
