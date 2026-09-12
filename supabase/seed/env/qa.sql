-- Environment settings for fess-pos-qa — QA / testing (docs/15, D-48). Runs after the reference seed
-- (config.toml [remotes.qa.db.seed]). Idempotent inserts.
insert into pos.settings (key, value, note) values
  ('env.name', '"qa"'::jsonb, 'Environment name shown in the admin panel'),
  ('api.base_url', '"https://ysbgdxhdexpjvmlnjofc.supabase.co/functions/v1"'::jsonb,
   'Edge Functions base URL; pg_cron kicks the workers function here')
on conflict (key) do nothing;
