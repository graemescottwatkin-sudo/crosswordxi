# Migrations

One file per structural change, numbered, applied in order. Each must be safe to
run twice — D1 has no migration table, so re-running is how mistakes get fixed.

```bash
npx wrangler d1 execute crosswordxi --remote --file=data/migrations/001-....sql
```

Never edit a migration that has been applied; add another.

`data/schema.sql` creates a fresh database with everything already in place, so
a new environment needs the schema only, not the migration history.
