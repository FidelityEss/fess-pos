import 'package:meta/meta.dart';

/// Device integrity signals (docs/07 §5). They're recorded, and block only
/// where remote config says so (T4-09).
///
/// A null signal means "unknown", never "clean": the server treats absence
/// as unknown.
@immutable
class IntegritySnapshot {
  const IntegritySnapshot({
    required this.available,
    required this.source,
    this.rooted,
    this.emulator,
    this.debugger,
    this.hooked,
    this.tamperedApp,
    this.untrustedInstaller,
  });

  /// No signals: [source] says why.
  const IntegritySnapshot.unavailable(this.source)
    : available = false,
      rooted = null,
      emulator = null,
      debugger = null,
      hooked = null,
      tamperedApp = null,
      untrustedInstaller = null;

  final bool available;

  /// What produced the signals, or why there are none.
  final String source;
  final bool? rooted;
  final bool? emulator;
  final bool? debugger;
  final bool? hooked;
  final bool? tamperedApp;
  final bool? untrustedInstaller;

  Map<String, Object?> toJson() => {
    'available': available,
    'source': source,
    'rooted': rooted,
    'emulator': emulator,
    'debugger': debugger,
    'hooked': hooked,
    'tampered_app': tamperedApp,
    'untrusted_installer': untrustedInstaller,
  };
}

// An interface, not a typedef: platform adapters are swapped as objects.
// ignore: one_member_abstracts
abstract interface class IntegritySignalsProvider {
  Future<IntegritySnapshot> snapshot();
}

/// Until the RASP and attestation adapters exist (T4-09; D-07, D-08), the
/// module says plainly that it has no signals. Mock-location detection is
/// separate: it comes with each location fix.
class UnavailableIntegritySignals implements IntegritySignalsProvider {
  const UnavailableIntegritySignals();

  @override
  Future<IntegritySnapshot> snapshot() async =>
      const IntegritySnapshot.unavailable('not_implemented');
}
