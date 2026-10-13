/**
 * Unit-test isolation.
 *
 * `src/lib/db.ts` reads `DATABASE_URL` ONCE at module evaluation into a
 * module-level constant, and `durable()` is just "is that constant non-empty".
 * The unit tests deliberately exercise the in-memory store, and several of them
 * assert the honesty invariants that only make sense on that path (a coin with
 * no signature must not report a cluster, a cluster, or an explorer link).
 *
 * The tests used to clear `process.env.DATABASE_URL` in their own `beforeEach`,
 * which is too late: if the ambient environment already exported a real
 * connection string, the first import of `db.ts` — hoisted above the test body —
 * captured it, `durable()` came back true, and the "unit" tests happily wrote to
 * live Postgres. Ten of them then failed for reasons that had nothing to do with
 * the code under test, and passed again when the same command was run without
 * env loaded. A gate that depends on how the shell was configured is not a gate.
 *
 * Deleting the variables here, in a setup file that runs before any test module
 * is imported, makes `durable()` deterministically false for the whole unit
 * suite. The live database still gets covered — by the round-trip script in
 * `src/lib/__live__/`, which loads `/home/coder/.env` itself and is run
 * explicitly rather than as part of `npm test`.
 */

delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL_UNPOOLED;
