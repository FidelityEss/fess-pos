import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show definitionHash;

const PosLogger _log = PosLogger('pull');

/// Jobs and review outcomes (T2-14): the `jobs` and `reviews` streams. Each
/// job is kept whole as pulled; a later version replaces it.
class JobsSection implements PullSection {
  JobsSection(this.db);

  final PosDatabase db;

  @override
  Set<String> get streams => const {'jobs', 'reviews'};

  @override
  Future<void> describeHave(Map<String, Object?> have) async {}

  @override
  Future<void> apply(Map<String, Object?> page) async {
    for (final job in _items(_map(page['jobs'])?['items'])) {
      final id = job['id'];
      final reference = job['reference'];
      final status = job['status'];
      final updatedAt = job['updated_at'];
      if (id is! String ||
          reference is! String ||
          status is! String ||
          updatedAt is! String) {
        _log.error('a pulled job lacks id, reference, status or updated_at');
        continue;
      }
      final bank = _map(job['bank']);
      final start = job['scheduled_start'];
      await db
          .into(db.jobs)
          .insertOnConflictUpdate(
            JobsCompanion.insert(
              id: id,
              reference: reference,
              status: status,
              updatedAt: updatedAt,
              assignedToMe: Value(job['assigned_to_me'] == true),
              bankId: Value(
                bank?['id'] is String ? bank!['id']! as String : null,
              ),
              scheduledStartMs: Value(
                start is String
                    ? DateTime.tryParse(start)?.millisecondsSinceEpoch
                    : null,
              ),
              body: jsonEncode(job),
            ),
          );
    }
    for (final review in _items(_map(page['reviews'])?['items'])) {
      final id = review['id'];
      final jobId = review['job_id'];
      final inspectionId = review['inspection_id'];
      final attempt = review['attempt'];
      final decision = review['decision'];
      final decidedAt = review['decided_at'];
      if (id is! String ||
          jobId is! String ||
          inspectionId is! String ||
          attempt is! int ||
          decision is! String ||
          decidedAt is! String) {
        _log.error('a pulled review lacks one of its required fields');
        continue;
      }
      await db
          .into(db.reviews)
          .insertOnConflictUpdate(
            ReviewsCompanion.insert(
              id: id,
              jobId: jobId,
              inspectionId: inspectionId,
              attempt: attempt,
              decision: decision,
              decidedAt: decidedAt,
              body: jsonEncode(review),
            ),
          );
    }
  }
}

/// Definitions of every kind (docs/04 §7, docs/08 §2): the bodies the
/// device lacks, each stored only if its `definition_hash` matches its
/// content, and the manifest of what is in force per context. Pinning,
/// eviction and capability fallbacks come with T3-07.
class DefinitionsSection implements PullSection {
  DefinitionsSection(this.db);

  /// The API takes up to 2000 ids in `have.definition_version_ids`.
  static const int maxHave = 2000;

  final PosDatabase db;

  @override
  Set<String> get streams => const {};

  @override
  Future<void> describeHave(Map<String, Object?> have) async {
    final column = db.definitionVersions.versionId;
    final ids =
        await (db.selectOnly(db.definitionVersions)
              ..addColumns([column])
              ..limit(maxHave))
            .map((r) => r.read(column)!)
            .get();
    if (ids.isNotEmpty) have['definition_version_ids'] = ids;
  }

  @override
  Future<void> apply(Map<String, Object?> page) async {
    final definitions = _map(page['definitions']);
    if (definitions == null) return;
    for (final body in _items(definitions['bodies'])) {
      final id = body['id'];
      final familyId = body['family_id'];
      final kind = body['kind'];
      final key = body['key'];
      final version = body['version'];
      final spec = body['spec_version'];
      final hash = body['definition_hash'];
      final definition = body['definition'];
      if (id is! String ||
          familyId is! String ||
          kind is! String ||
          key is! String ||
          version is! int ||
          spec is! String ||
          hash is! String ||
          definition is! Map<String, Object?>) {
        _log.error('a pulled definition lacks one of its required fields');
        continue;
      }
      if (definitionHash(definition) != hash) {
        // Never render or pin a definition that isn't what was published.
        _log.error('definition $kind/$key v$version failed its hash check');
        continue;
      }
      await db
          .into(db.definitionVersions)
          .insert(
            DefinitionVersionsCompanion.insert(
              versionId: id,
              familyId: familyId,
              kind: kind,
              key: key,
              bankId: Value(
                body['bank_id'] is String ? body['bank_id']! as String : null,
              ),
              version: version,
              specVersion: spec,
              hash: hash,
              body: jsonEncode(definition),
            ),
            mode: InsertMode.insertOrIgnore,
          );
    }
    final manifest = definitions['manifest'];
    if (manifest is! List<Object?>) return;
    await db.delete(db.activeDefinitions).go();
    for (final entry in _items(manifest)) {
      final kind = entry['kind'];
      final key = entry['key'];
      final versionId = entry['version_id'];
      if (kind is! String || key is! String || versionId is! String) continue;
      final bank = entry['context_bank_id'];
      await db
          .into(db.activeDefinitions)
          .insertOnConflictUpdate(
            ActiveDefinitionsCompanion.insert(
              context: bank is String ? bank : '',
              kind: kind,
              key: key,
              versionId: versionId,
            ),
          );
    }
  }
}

Map<String, Object?>? _map(Object? v) => v is Map<String, Object?> ? v : null;

List<Map<String, Object?>> _items(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];
