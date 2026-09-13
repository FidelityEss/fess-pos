import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

enum PosLogLevel { debug, info, warning, error }

/// A log record, handed to [PosLogger.sink] in tests.
@immutable
class PosLogRecord {
  const PosLogRecord(
    this.level,
    this.logger,
    this.message, {
    this.error,
    this.stackTrace,
  });

  final PosLogLevel level;
  final String logger;
  final String message;
  final Object? error;
  final StackTrace? stackTrace;
}

/// The module's logger. It writes to `dart:developer` under `fess_pos.*` and
/// installs nothing global.
///
/// Rule (docs/DEVELOPMENT-GUIDELINES.md §4): messages are fixed text plus
/// ids. Never log personal data, coordinates, tokens or evidence hashes.
class PosLogger {
  const PosLogger(this.name);

  /// Replaces the output, for tests. `null` = `dart:developer`.
  @visibleForTesting
  static void Function(PosLogRecord record)? sink;

  final String name;

  void debug(String message) {
    if (kDebugMode) _log(PosLogLevel.debug, message);
  }

  void info(String message) => _log(PosLogLevel.info, message);

  void warning(String message, {Object? error, StackTrace? stackTrace}) =>
      _log(PosLogLevel.warning, message, error: error, stackTrace: stackTrace);

  void error(String message, {Object? error, StackTrace? stackTrace}) =>
      _log(PosLogLevel.error, message, error: error, stackTrace: stackTrace);

  void _log(
    PosLogLevel level,
    String message, {
    Object? error,
    StackTrace? stackTrace,
  }) {
    final record = PosLogRecord(
      level,
      'fess_pos.$name',
      message,
      error: error,
      stackTrace: stackTrace,
    );
    final s = sink;
    if (s != null) {
      s(record);
      return;
    }
    developer.log(
      message,
      name: record.logger,
      level: switch (level) {
        PosLogLevel.debug => 500,
        PosLogLevel.info => 800,
        PosLogLevel.warning => 900,
        PosLogLevel.error => 1000,
      },
      error: error,
      stackTrace: stackTrace,
    );
  }
}
