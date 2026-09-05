\set ON_ERROR_STOP on

-- Required psql variables:
--   db_name: wenmi_rebuild_dev or wenmi_rebuild_test_<suffix>
--   app_role: wenmi_rebuild_app
--   app_password: supplied outside Git
--   migrator_role: wenmi_rebuild_migrator
--   migrator_password: supplied outside Git

SELECT
  CASE WHEN current_setting('port') = '54329' THEN 'true' ELSE 'false' END AS port_ok,
  CASE WHEN COALESCE(inet_server_addr() IN (inet '127.0.0.1', inet '::1'), false) THEN 'true' ELSE 'false' END AS host_ok,
  CASE WHEN :'db_name' ~ '^wenmi_rebuild_(dev|test_[A-Za-z0-9_]+)$' THEN 'true' ELSE 'false' END AS db_name_ok,
  CASE WHEN :'app_role' = 'wenmi_rebuild_app' THEN 'true' ELSE 'false' END AS app_role_name_ok,
  CASE WHEN :'migrator_role' = 'wenmi_rebuild_migrator' THEN 'true' ELSE 'false' END AS migrator_role_name_ok,
  CASE WHEN :'app_role' <> :'migrator_role' THEN 'true' ELSE 'false' END AS roles_differ,
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') THEN 'true' ELSE 'false' END AS database_absent,
  CASE WHEN COALESCE((
    SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    FROM pg_roles
    WHERE rolname = :'app_role'
  ), true) THEN 'true' ELSE 'false' END AS app_role_safe,
  CASE WHEN COALESCE((
    SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    FROM pg_roles
    WHERE rolname = :'migrator_role'
  ), true) THEN 'true' ELSE 'false' END AS migrator_role_safe
\gset guard_

\if :guard_port_ok
\else
  \echo 'refusing provisioning: PostgreSQL port is not 54329'
  SELECT 1 / 0;
\endif
\if :guard_host_ok
\else
  \echo 'refusing provisioning: PostgreSQL server address is not loopback'
  SELECT 1 / 0;
\endif
\if :guard_db_name_ok
\else
  \echo 'refusing provisioning: database name is not a rebuild dev/test name'
  SELECT 1 / 0;
\endif
\if :guard_app_role_name_ok
\else
  \echo 'refusing provisioning: app role name is not wenmi_rebuild_app'
  SELECT 1 / 0;
\endif
\if :guard_migrator_role_name_ok
\else
  \echo 'refusing provisioning: migrator role name is not wenmi_rebuild_migrator'
  SELECT 1 / 0;
\endif
\if :guard_roles_differ
\else
  \echo 'refusing provisioning: app and migrator roles must differ'
  SELECT 1 / 0;
\endif
\if :guard_database_absent
\else
  \echo 'refusing provisioning: target database already exists'
  SELECT 1 / 0;
\endif
\if :guard_app_role_safe
\else
  \echo 'refusing provisioning: existing app role has elevated privileges'
  SELECT 1 / 0;
\endif
\if :guard_migrator_role_safe
\else
  \echo 'refusing provisioning: existing migrator role has elevated privileges'
  SELECT 1 / 0;
\endif

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'app_role',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'migrator_role',
  :'migrator_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'migrator_role')
\gexec

\connect :db_name

REVOKE CONNECT, TEMPORARY ON DATABASE :"db_name" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db_name" TO :"migrator_role";
GRANT CREATE, USAGE ON SCHEMA public TO :"migrator_role";
GRANT CONNECT, TEMPORARY ON DATABASE :"db_name" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";

CREATE TABLE public.rebuild_environment_guard (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  environment_marker text NOT NULL,
  database_name text NOT NULL,
  app_role text NOT NULL,
  migrator_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.rebuild_environment_guard (id, environment_marker, database_name, app_role, migrator_role)
VALUES (true, 'wenmi-rebuild-local-v1', :'db_name', :'app_role', :'migrator_role');

GRANT SELECT ON TABLE public.rebuild_environment_guard TO :"app_role";
GRANT SELECT ON TABLE public.rebuild_environment_guard TO :"migrator_role";
