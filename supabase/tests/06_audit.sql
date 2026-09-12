-- Audit log row capture (docs/07 §6): every audited table records its row id and before/after images, minus the columns
-- its trigger excludes. Regression: triggers without excluded columns used to log empty images.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

create temp view t_last as select * from pos.audit_log order by seq desc limit 1;

insert into pos.banks (id, code, name) values ('b0000000-0000-0000-0000-0000000000a1', 'TAUDIT', 'Audit Bank');
select is((select table_name || ':' || row_id from t_last), 'banks:b0000000-0000-0000-0000-0000000000a1',
          'row id recorded for a table audited without excluded columns');
select is((select after ->> 'code' from t_last), 'TAUDIT', 'after image recorded on insert');
select ok((select before is null from t_last), 'no before image on insert');

update pos.banks set name = 'Audit Bank Renamed' where id = 'b0000000-0000-0000-0000-0000000000a1';
select is((select before ->> 'name' from t_last), 'Audit Bank', 'before image recorded on update');
select is((select after ->> 'name' from t_last), 'Audit Bank Renamed', 'after image recorded on update');

insert into pos.pos_users (id, employee_number, first_name, last_name, role) values
  ('d0000000-0000-0000-0000-0000000000a1', 'TAUDIT1', 'Audrey', 'Dit', 'pos_agent');
select is((select after ->> 'employee_number' from t_last), 'TAUDIT1', 'pos_users rows are captured');

insert into pos.devices (user_id, device_id, push_token) values
  ('d0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'push-secret');
select is((select after ->> 'device_id' from t_last), 'a0000000-0000-0000-0000-0000000000a1', 'devices rows are captured');
select ok(not ((select after from t_last) ? 'push_token'), 'columns the trigger excludes stay out of the log');

select * from finish();
rollback;
