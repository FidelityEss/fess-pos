/// Reads the shared contract fixtures in `schema/fixtures`, on the VM
/// (dart:io) and on Node (`dart test -p node`), so the web build's hashing is
/// held to the same fixtures as native.
library;

import 'dart:convert';

import 'fixtures_io.dart'
    if (dart.library.js_interop) 'fixtures_node.dart'
    as impl;

/// The fixtures directory, relative to this package's root (the working
/// directory of `dart test`).
const String fixturesRoot = '../../schema/fixtures';

/// A decoded fixture file.
class Fixture {
  const Fixture(this.name, this.data);

  final String name;
  final Map<String, Object?> data;

  List<Map<String, Object?>> get cases =>
      (data['cases']! as List<Object?>).cast<Map<String, Object?>>();
}

/// A JSON file under `schema/fixtures/`, e.g. `definitions/valid/x.json`.
Map<String, Object?> fixtureJson(String path) =>
    jsonDecode(impl.readText('$fixturesRoot/$path')) as Map<String, Object?>;

/// A JSON file under `schema/`, e.g. `rules/operators.json`.
Map<String, Object?> schemaJson(String path) =>
    jsonDecode(impl.readText('../../schema/$path')) as Map<String, Object?>;

/// Every `*.json` file in `schema/fixtures/<dir>`, sorted by name.
List<Fixture> fixtures(String dir) => [
  for (final name in impl.listJsonFiles('$fixturesRoot/$dir'))
    Fixture(
      name,
      jsonDecode(impl.readText('$fixturesRoot/$dir/$name'))
          as Map<String, Object?>,
    ),
];
