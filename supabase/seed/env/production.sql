-- Environment settings for fess-pos — PRODUCTION (docs/15, D-48). Runs after the reference seed
-- (config.toml [remotes.production.db.seed]). Never add test data here.
insert into pos.settings (key, value, note) values
  ('env.name', '"production"'::jsonb, 'Environment name shown in the admin panel'),
  ('api.base_url', '"https://zqunqunjdjhyriqsvzfr.supabase.co/functions/v1"'::jsonb,
   'Edge Functions base URL; pg_cron kicks the workers function here')
on conflict (key) do nothing;

-- The stand-in identity provider is for QA only. Production refuses it anyway (POS_ENV=production); keep it inactive too.
update pos.trusted_issuers set active = false where key = 'pos_dev' and active;
