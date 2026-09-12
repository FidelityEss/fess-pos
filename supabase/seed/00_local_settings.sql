-- LOCAL ONLY (supabase db reset). Environment wiring for the local Docker stack.
-- Staging/prod set these rows once per project; they are not migrations because the values differ per environment.
insert into pos.settings (key, value, note) values
  ('api.base_url', '"http://kong:8000/functions/v1"'::jsonb, 'Functions base URL as seen from the database (pg_net)'),
  ('env.name', '"local"'::jsonb, 'Environment name shown in the admin panel')
on conflict (key) do nothing;
