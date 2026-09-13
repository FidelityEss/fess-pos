-- T2-31 (2026-09-13): the module keeps its own device registration current without a new exchange — a refreshed push
-- token (the host's FCM / OneSignal token can change at any time, docs/03 §3 PosPushConfig, B2.2) or a new module, host
-- app or OS version. Called by POST /v1/device for the calling session's own device only. Revoked devices are refused.
-- An explicit JSON null push_token clears the push registration (provider included); an absent key leaves it as is.

create function pos_rpc.device_update(p_user_id uuid, p_device_id uuid, p_device jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.devices;
  v_clear_push boolean := coalesce(jsonb_typeof(p_device -> 'push_token') = 'null', false);
begin
  select * into v from pos.devices where user_id = p_user_id and device_id = p_device_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'device not registered for this user; sign in again'); end if;
  if v.revoked_at is not null then perform pos_rpc.fail('DEVICE_REVOKED', 'this device has been revoked'); end if;

  update pos.devices
     set push_provider = case when v_clear_push then null else coalesce(p_device ->> 'push_provider', push_provider) end,
         push_token = case when v_clear_push then null else coalesce(p_device ->> 'push_token', push_token) end,
         platform = coalesce(p_device ->> 'platform', platform),
         model = coalesce(p_device ->> 'model', model),
         os_version = coalesce(p_device ->> 'os_version', os_version),
         host_app_version = coalesce(p_device ->> 'host_app_version', host_app_version),
         module_version = coalesce(p_device ->> 'module_version', module_version),
         capabilities = coalesce(p_device -> 'capabilities', capabilities),
         last_seen_at = now()
   where id = v.id
  returning * into v;

  return jsonb_build_object('device_id', v.device_id, 'push_provider', v.push_provider, 'push_registered', v.push_token is not null,
                            'module_version', v.module_version, 'host_app_version', v.host_app_version,
                            'last_seen_at', v.last_seen_at);
end $$;
