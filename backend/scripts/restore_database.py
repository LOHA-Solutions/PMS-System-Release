"""Create an isolated local restore database and remove only that sandbox."""

import secrets
import uuid
from contextlib import contextmanager

import psycopg
from psycopg import sql
from sqlalchemy import URL, make_url
from sqlalchemy.exc import ArgumentError


def admin_config(value):
    try:
        url = make_url(value or "")
    except ArgumentError:
        raise ValueError("A valid explicit loopback PostgreSQL admin URL is required") from None
    if (
        url.get_backend_name() != "postgresql"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.database != "postgres"
        or url.query
        or not url.username
        or not url.password
    ):
        raise ValueError(
            "Use an explicit loopback PostgreSQL admin URL for database postgres, without query overrides."
        )
    return {
        "host": url.host,
        "port": url.port or 5432,
        "user": url.username,
        "password": url.password,
        "dbname": "postgres",
        "connect_timeout": 5,
    }


@contextmanager
def disposable_database(config):
    token = uuid.uuid4().hex
    database = "pms_restore_check_" + token
    migrator, runtime = f"pms_restore_{token}_m", f"pms_restore_{token}_a"
    passwords = {role: secrets.token_urlsafe(32) for role in (migrator, runtime)}
    created_roles, created_database = [], False
    try:
        with psycopg.connect(**config, autocommit=True) as connection:
            for role in (migrator, runtime):
                connection.execute(
                    sql.SQL(
                        "CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD {}"
                    ).format(
                        sql.Identifier(role),
                        sql.Literal(passwords[role]),
                    )
                )
                created_roles.append(role)
            connection.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(database), sql.Identifier(migrator)
                )
            )
            created_database = True
        with psycopg.connect(**{**config, "dbname": database}, autocommit=True) as connection:
            connection.execute(
                sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(database))
            )
            connection.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(database), sql.Identifier(runtime)
                )
            )
            connection.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
            connection.execute(
                sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(runtime))
            )
            for grants, target in (
                ("SELECT, INSERT, UPDATE, DELETE", "TABLES"),
                ("USAGE, SELECT", "SEQUENCES"),
            ):
                connection.execute(
                    sql.SQL(
                        "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT "
                        + grants
                        + " ON "
                        + target
                        + " TO {}"
                    ).format(
                        sql.Identifier(migrator),
                        sql.Identifier(runtime),
                    )
                )
        urls = {
            role: URL.create(
                "postgresql+psycopg",
                username=role,
                password=passwords[role],
                host=config["host"],
                port=config["port"],
                database=database,
            ).render_as_string(hide_password=False)
            for role in (migrator, runtime)
        }
        yield {
            "database": database,
            "migrator": migrator,
            "runtime": runtime,
            "environment": {
                "DATABASE_URL": urls[runtime],
                "DATABASE_MIGRATION_URL": urls[migrator],
            },
        }
    finally:
        # Names are generated here; existing roles/databases are never adopted or dropped.
        with psycopg.connect(**config, autocommit=True) as connection:
            if created_database:
                connection.execute(
                    sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database))
                )
            for role in reversed(created_roles):
                connection.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
