import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test("keys are namespaced and the host's keys are left alone", () async {
    FlutterSecureStorage.setMockInitialValues({
      'persistent_device_id': 'host-device',
    });
    final store = FlutterSecureStore();
    const raw = FlutterSecureStorage();

    await store.write('db_key.v1', 'secret');
    expect(await store.read('db_key.v1'), 'secret');
    expect(await raw.read(key: 'fess_pos.db_key.v1'), 'secret');

    await store.delete('db_key.v1');
    expect(await store.read('db_key.v1'), isNull);
    expect(await raw.read(key: 'persistent_device_id'), 'host-device');
  });

  test('the bootstrap cache lives in the secure store', () async {
    final store = MemorySecureStore();
    final cache = SecureStoreBootstrapCache(store);
    expect(await cache.read(), isNull);
    await cache.write('{"pos":{"enabled":false}}');
    expect(store.values[SecureStoreBootstrapCache.key], isNotNull);
    expect(await cache.read(), '{"pos":{"enabled":false}}');
  });
}
