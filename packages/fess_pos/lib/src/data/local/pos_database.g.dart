// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pos_database.dart';

// ignore_for_file: type=lint
class $ModuleMetaTable extends ModuleMeta
    with TableInfo<$ModuleMetaTable, ModuleMetaRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ModuleMetaTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<String> updatedAt = GeneratedColumn<String>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value, updatedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'module_meta';
  @override
  VerificationContext validateIntegrity(
    Insertable<ModuleMetaRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  ModuleMetaRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ModuleMetaRow(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $ModuleMetaTable createAlias(String alias) {
    return $ModuleMetaTable(attachedDatabase, alias);
  }
}

class ModuleMetaRow extends DataClass implements Insertable<ModuleMetaRow> {
  final String key;
  final String value;

  /// ISO-8601 with the device's offset (docs/12 §11).
  final String updatedAt;
  const ModuleMetaRow({
    required this.key,
    required this.value,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    map['updated_at'] = Variable<String>(updatedAt);
    return map;
  }

  ModuleMetaCompanion toCompanion(bool nullToAbsent) {
    return ModuleMetaCompanion(
      key: Value(key),
      value: Value(value),
      updatedAt: Value(updatedAt),
    );
  }

  factory ModuleMetaRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ModuleMetaRow(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
      updatedAt: serializer.fromJson<String>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
      'updatedAt': serializer.toJson<String>(updatedAt),
    };
  }

  ModuleMetaRow copyWith({String? key, String? value, String? updatedAt}) =>
      ModuleMetaRow(
        key: key ?? this.key,
        value: value ?? this.value,
        updatedAt: updatedAt ?? this.updatedAt,
      );
  ModuleMetaRow copyWithCompanion(ModuleMetaCompanion data) {
    return ModuleMetaRow(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ModuleMetaRow(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ModuleMetaRow &&
          other.key == this.key &&
          other.value == this.value &&
          other.updatedAt == this.updatedAt);
}

class ModuleMetaCompanion extends UpdateCompanion<ModuleMetaRow> {
  final Value<String> key;
  final Value<String> value;
  final Value<String> updatedAt;
  final Value<int> rowid;
  const ModuleMetaCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ModuleMetaCompanion.insert({
    required String key,
    required String value,
    required String updatedAt,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value),
       updatedAt = Value(updatedAt);
  static Insertable<ModuleMetaRow> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<String>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ModuleMetaCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<String>? updatedAt,
    Value<int>? rowid,
  }) {
    return ModuleMetaCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<String>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ModuleMetaCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncStateTable extends SyncState
    with TableInfo<$SyncStateTable, SyncStateRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncStateTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<String> updatedAt = GeneratedColumn<String>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value, updatedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_state';
  @override
  VerificationContext validateIntegrity(
    Insertable<SyncStateRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  SyncStateRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncStateRow(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $SyncStateTable createAlias(String alias) {
    return $SyncStateTable(attachedDatabase, alias);
  }
}

class SyncStateRow extends DataClass implements Insertable<SyncStateRow> {
  final String key;
  final String value;

  /// ISO-8601 with the device's offset (docs/12 §11).
  final String updatedAt;
  const SyncStateRow({
    required this.key,
    required this.value,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    map['updated_at'] = Variable<String>(updatedAt);
    return map;
  }

  SyncStateCompanion toCompanion(bool nullToAbsent) {
    return SyncStateCompanion(
      key: Value(key),
      value: Value(value),
      updatedAt: Value(updatedAt),
    );
  }

  factory SyncStateRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncStateRow(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
      updatedAt: serializer.fromJson<String>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
      'updatedAt': serializer.toJson<String>(updatedAt),
    };
  }

  SyncStateRow copyWith({String? key, String? value, String? updatedAt}) =>
      SyncStateRow(
        key: key ?? this.key,
        value: value ?? this.value,
        updatedAt: updatedAt ?? this.updatedAt,
      );
  SyncStateRow copyWithCompanion(SyncStateCompanion data) {
    return SyncStateRow(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncStateRow(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncStateRow &&
          other.key == this.key &&
          other.value == this.value &&
          other.updatedAt == this.updatedAt);
}

class SyncStateCompanion extends UpdateCompanion<SyncStateRow> {
  final Value<String> key;
  final Value<String> value;
  final Value<String> updatedAt;
  final Value<int> rowid;
  const SyncStateCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncStateCompanion.insert({
    required String key,
    required String value,
    required String updatedAt,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value),
       updatedAt = Value(updatedAt);
  static Insertable<SyncStateRow> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<String>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncStateCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<String>? updatedAt,
    Value<int>? rowid,
  }) {
    return SyncStateCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<String>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncStateCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $OutboxTable extends Outbox with TableInfo<$OutboxTable, OutboxRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OutboxTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deviceSeqMeta = const VerificationMeta(
    'deviceSeq',
  );
  @override
  late final GeneratedColumn<int> deviceSeq = GeneratedColumn<int>(
    'device_seq',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways('UNIQUE'),
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _typeVersionMeta = const VerificationMeta(
    'typeVersion',
  );
  @override
  late final GeneratedColumn<int> typeVersion = GeneratedColumn<int>(
    'type_version',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _laneMeta = const VerificationMeta('lane');
  @override
  late final GeneratedColumn<int> lane = GeneratedColumn<int>(
    'lane',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _userIdMeta = const VerificationMeta('userId');
  @override
  late final GeneratedColumn<String> userId = GeneratedColumn<String>(
    'user_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _envelopeMeta = const VerificationMeta(
    'envelope',
  );
  @override
  late final GeneratedColumn<String> envelope = GeneratedColumn<String>(
    'envelope',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadHashMeta = const VerificationMeta(
    'payloadHash',
  );
  @override
  late final GeneratedColumn<String> payloadHash = GeneratedColumn<String>(
    'payload_hash',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bytesMeta = const VerificationMeta('bytes');
  @override
  late final GeneratedColumn<int> bytes = GeneratedColumn<int>(
    'bytes',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _receiptStateMeta = const VerificationMeta(
    'receiptState',
  );
  @override
  late final GeneratedColumn<String> receiptState = GeneratedColumn<String>(
    'receipt_state',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _receiptMeta = const VerificationMeta(
    'receipt',
  );
  @override
  late final GeneratedColumn<String> receipt = GeneratedColumn<String>(
    'receipt',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _nextAttemptMsMeta = const VerificationMeta(
    'nextAttemptMs',
  );
  @override
  late final GeneratedColumn<int> nextAttemptMs = GeneratedColumn<int>(
    'next_attempt_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _entityRefMeta = const VerificationMeta(
    'entityRef',
  );
  @override
  late final GeneratedColumn<String> entityRef = GeneratedColumn<String>(
    'entity_ref',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<String> createdAt = GeneratedColumn<String>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMsMeta = const VerificationMeta(
    'createdAtMs',
  );
  @override
  late final GeneratedColumn<int> createdAtMs = GeneratedColumn<int>(
    'created_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<String> updatedAt = GeneratedColumn<String>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _committedAtMsMeta = const VerificationMeta(
    'committedAtMs',
  );
  @override
  late final GeneratedColumn<int> committedAtMs = GeneratedColumn<int>(
    'committed_at_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    deviceSeq,
    type,
    typeVersion,
    lane,
    userId,
    envelope,
    payloadHash,
    bytes,
    state,
    receiptState,
    receipt,
    lastError,
    attempts,
    nextAttemptMs,
    entityRef,
    createdAt,
    createdAtMs,
    updatedAt,
    committedAtMs,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'outbox';
  @override
  VerificationContext validateIntegrity(
    Insertable<OutboxRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('device_seq')) {
      context.handle(
        _deviceSeqMeta,
        deviceSeq.isAcceptableOrUnknown(data['device_seq']!, _deviceSeqMeta),
      );
    } else if (isInserting) {
      context.missing(_deviceSeqMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('type_version')) {
      context.handle(
        _typeVersionMeta,
        typeVersion.isAcceptableOrUnknown(
          data['type_version']!,
          _typeVersionMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_typeVersionMeta);
    }
    if (data.containsKey('lane')) {
      context.handle(
        _laneMeta,
        lane.isAcceptableOrUnknown(data['lane']!, _laneMeta),
      );
    } else if (isInserting) {
      context.missing(_laneMeta);
    }
    if (data.containsKey('user_id')) {
      context.handle(
        _userIdMeta,
        userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta),
      );
    }
    if (data.containsKey('envelope')) {
      context.handle(
        _envelopeMeta,
        envelope.isAcceptableOrUnknown(data['envelope']!, _envelopeMeta),
      );
    } else if (isInserting) {
      context.missing(_envelopeMeta);
    }
    if (data.containsKey('payload_hash')) {
      context.handle(
        _payloadHashMeta,
        payloadHash.isAcceptableOrUnknown(
          data['payload_hash']!,
          _payloadHashMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_payloadHashMeta);
    }
    if (data.containsKey('bytes')) {
      context.handle(
        _bytesMeta,
        bytes.isAcceptableOrUnknown(data['bytes']!, _bytesMeta),
      );
    } else if (isInserting) {
      context.missing(_bytesMeta);
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    } else if (isInserting) {
      context.missing(_stateMeta);
    }
    if (data.containsKey('receipt_state')) {
      context.handle(
        _receiptStateMeta,
        receiptState.isAcceptableOrUnknown(
          data['receipt_state']!,
          _receiptStateMeta,
        ),
      );
    }
    if (data.containsKey('receipt')) {
      context.handle(
        _receiptMeta,
        receipt.isAcceptableOrUnknown(data['receipt']!, _receiptMeta),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('next_attempt_ms')) {
      context.handle(
        _nextAttemptMsMeta,
        nextAttemptMs.isAcceptableOrUnknown(
          data['next_attempt_ms']!,
          _nextAttemptMsMeta,
        ),
      );
    }
    if (data.containsKey('entity_ref')) {
      context.handle(
        _entityRefMeta,
        entityRef.isAcceptableOrUnknown(data['entity_ref']!, _entityRefMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('created_at_ms')) {
      context.handle(
        _createdAtMsMeta,
        createdAtMs.isAcceptableOrUnknown(
          data['created_at_ms']!,
          _createdAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_createdAtMsMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    if (data.containsKey('committed_at_ms')) {
      context.handle(
        _committedAtMsMeta,
        committedAtMs.isAcceptableOrUnknown(
          data['committed_at_ms']!,
          _committedAtMsMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  OutboxRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OutboxRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      deviceSeq: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}device_seq'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      typeVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}type_version'],
      )!,
      lane: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}lane'],
      )!,
      userId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_id'],
      ),
      envelope: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}envelope'],
      )!,
      payloadHash: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload_hash'],
      )!,
      bytes: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}bytes'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      receiptState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}receipt_state'],
      ),
      receipt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}receipt'],
      ),
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      nextAttemptMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}next_attempt_ms'],
      ),
      entityRef: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}entity_ref'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}created_at'],
      )!,
      createdAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}created_at_ms'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}updated_at'],
      )!,
      committedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}committed_at_ms'],
      ),
    );
  }

  @override
  $OutboxTable createAlias(String alias) {
    return $OutboxTable(attachedDatabase, alias);
  }
}

class OutboxRow extends DataClass implements Insertable<OutboxRow> {
  /// The envelope id: UUIDv7, the server's idempotency key.
  final String id;

  /// The per-device counter, one per envelope (docs/12 §15).
  final int deviceSeq;
  final String type;
  final int typeVersion;

  /// The send lane, 1–4 (docs/08 §3).
  final int lane;

  /// The user whose session sends it; null for device reports, which go
  /// with whoever is signed in.
  final String? userId;

  /// The envelope exactly as it is sent, fixed when the action happened.
  final String envelope;
  final String payloadHash;
  final int bytes;

  /// `queued`, `in_flight`, `durable`, `committed` or `needs_attention`
  /// (docs/08 §1).
  final String state;

  /// The last receipt's state, or `refused` / `parked`.
  final String? receiptState;

  /// The last receipt, as received.
  final String? receipt;
  final String? lastError;
  final int attempts;

  /// Not before this time (epoch ms); null means as soon as possible.
  final int? nextAttemptMs;

  /// The record it is about, e.g. `job:<id>`, for the sync screens.
  final String? entityRef;

  /// ISO-8601 with the device's offset (docs/12 §11).
  final String createdAt;
  final int createdAtMs;
  final String updatedAt;

  /// When a receipt or the pull said committed (epoch ms). Retention counts
  /// from here (docs/08 §4).
  final int? committedAtMs;
  const OutboxRow({
    required this.id,
    required this.deviceSeq,
    required this.type,
    required this.typeVersion,
    required this.lane,
    this.userId,
    required this.envelope,
    required this.payloadHash,
    required this.bytes,
    required this.state,
    this.receiptState,
    this.receipt,
    this.lastError,
    required this.attempts,
    this.nextAttemptMs,
    this.entityRef,
    required this.createdAt,
    required this.createdAtMs,
    required this.updatedAt,
    this.committedAtMs,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['device_seq'] = Variable<int>(deviceSeq);
    map['type'] = Variable<String>(type);
    map['type_version'] = Variable<int>(typeVersion);
    map['lane'] = Variable<int>(lane);
    if (!nullToAbsent || userId != null) {
      map['user_id'] = Variable<String>(userId);
    }
    map['envelope'] = Variable<String>(envelope);
    map['payload_hash'] = Variable<String>(payloadHash);
    map['bytes'] = Variable<int>(bytes);
    map['state'] = Variable<String>(state);
    if (!nullToAbsent || receiptState != null) {
      map['receipt_state'] = Variable<String>(receiptState);
    }
    if (!nullToAbsent || receipt != null) {
      map['receipt'] = Variable<String>(receipt);
    }
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || nextAttemptMs != null) {
      map['next_attempt_ms'] = Variable<int>(nextAttemptMs);
    }
    if (!nullToAbsent || entityRef != null) {
      map['entity_ref'] = Variable<String>(entityRef);
    }
    map['created_at'] = Variable<String>(createdAt);
    map['created_at_ms'] = Variable<int>(createdAtMs);
    map['updated_at'] = Variable<String>(updatedAt);
    if (!nullToAbsent || committedAtMs != null) {
      map['committed_at_ms'] = Variable<int>(committedAtMs);
    }
    return map;
  }

  OutboxCompanion toCompanion(bool nullToAbsent) {
    return OutboxCompanion(
      id: Value(id),
      deviceSeq: Value(deviceSeq),
      type: Value(type),
      typeVersion: Value(typeVersion),
      lane: Value(lane),
      userId: userId == null && nullToAbsent
          ? const Value.absent()
          : Value(userId),
      envelope: Value(envelope),
      payloadHash: Value(payloadHash),
      bytes: Value(bytes),
      state: Value(state),
      receiptState: receiptState == null && nullToAbsent
          ? const Value.absent()
          : Value(receiptState),
      receipt: receipt == null && nullToAbsent
          ? const Value.absent()
          : Value(receipt),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      attempts: Value(attempts),
      nextAttemptMs: nextAttemptMs == null && nullToAbsent
          ? const Value.absent()
          : Value(nextAttemptMs),
      entityRef: entityRef == null && nullToAbsent
          ? const Value.absent()
          : Value(entityRef),
      createdAt: Value(createdAt),
      createdAtMs: Value(createdAtMs),
      updatedAt: Value(updatedAt),
      committedAtMs: committedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(committedAtMs),
    );
  }

  factory OutboxRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OutboxRow(
      id: serializer.fromJson<String>(json['id']),
      deviceSeq: serializer.fromJson<int>(json['deviceSeq']),
      type: serializer.fromJson<String>(json['type']),
      typeVersion: serializer.fromJson<int>(json['typeVersion']),
      lane: serializer.fromJson<int>(json['lane']),
      userId: serializer.fromJson<String?>(json['userId']),
      envelope: serializer.fromJson<String>(json['envelope']),
      payloadHash: serializer.fromJson<String>(json['payloadHash']),
      bytes: serializer.fromJson<int>(json['bytes']),
      state: serializer.fromJson<String>(json['state']),
      receiptState: serializer.fromJson<String?>(json['receiptState']),
      receipt: serializer.fromJson<String?>(json['receipt']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      attempts: serializer.fromJson<int>(json['attempts']),
      nextAttemptMs: serializer.fromJson<int?>(json['nextAttemptMs']),
      entityRef: serializer.fromJson<String?>(json['entityRef']),
      createdAt: serializer.fromJson<String>(json['createdAt']),
      createdAtMs: serializer.fromJson<int>(json['createdAtMs']),
      updatedAt: serializer.fromJson<String>(json['updatedAt']),
      committedAtMs: serializer.fromJson<int?>(json['committedAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'deviceSeq': serializer.toJson<int>(deviceSeq),
      'type': serializer.toJson<String>(type),
      'typeVersion': serializer.toJson<int>(typeVersion),
      'lane': serializer.toJson<int>(lane),
      'userId': serializer.toJson<String?>(userId),
      'envelope': serializer.toJson<String>(envelope),
      'payloadHash': serializer.toJson<String>(payloadHash),
      'bytes': serializer.toJson<int>(bytes),
      'state': serializer.toJson<String>(state),
      'receiptState': serializer.toJson<String?>(receiptState),
      'receipt': serializer.toJson<String?>(receipt),
      'lastError': serializer.toJson<String?>(lastError),
      'attempts': serializer.toJson<int>(attempts),
      'nextAttemptMs': serializer.toJson<int?>(nextAttemptMs),
      'entityRef': serializer.toJson<String?>(entityRef),
      'createdAt': serializer.toJson<String>(createdAt),
      'createdAtMs': serializer.toJson<int>(createdAtMs),
      'updatedAt': serializer.toJson<String>(updatedAt),
      'committedAtMs': serializer.toJson<int?>(committedAtMs),
    };
  }

  OutboxRow copyWith({
    String? id,
    int? deviceSeq,
    String? type,
    int? typeVersion,
    int? lane,
    Value<String?> userId = const Value.absent(),
    String? envelope,
    String? payloadHash,
    int? bytes,
    String? state,
    Value<String?> receiptState = const Value.absent(),
    Value<String?> receipt = const Value.absent(),
    Value<String?> lastError = const Value.absent(),
    int? attempts,
    Value<int?> nextAttemptMs = const Value.absent(),
    Value<String?> entityRef = const Value.absent(),
    String? createdAt,
    int? createdAtMs,
    String? updatedAt,
    Value<int?> committedAtMs = const Value.absent(),
  }) => OutboxRow(
    id: id ?? this.id,
    deviceSeq: deviceSeq ?? this.deviceSeq,
    type: type ?? this.type,
    typeVersion: typeVersion ?? this.typeVersion,
    lane: lane ?? this.lane,
    userId: userId.present ? userId.value : this.userId,
    envelope: envelope ?? this.envelope,
    payloadHash: payloadHash ?? this.payloadHash,
    bytes: bytes ?? this.bytes,
    state: state ?? this.state,
    receiptState: receiptState.present ? receiptState.value : this.receiptState,
    receipt: receipt.present ? receipt.value : this.receipt,
    lastError: lastError.present ? lastError.value : this.lastError,
    attempts: attempts ?? this.attempts,
    nextAttemptMs: nextAttemptMs.present
        ? nextAttemptMs.value
        : this.nextAttemptMs,
    entityRef: entityRef.present ? entityRef.value : this.entityRef,
    createdAt: createdAt ?? this.createdAt,
    createdAtMs: createdAtMs ?? this.createdAtMs,
    updatedAt: updatedAt ?? this.updatedAt,
    committedAtMs: committedAtMs.present
        ? committedAtMs.value
        : this.committedAtMs,
  );
  OutboxRow copyWithCompanion(OutboxCompanion data) {
    return OutboxRow(
      id: data.id.present ? data.id.value : this.id,
      deviceSeq: data.deviceSeq.present ? data.deviceSeq.value : this.deviceSeq,
      type: data.type.present ? data.type.value : this.type,
      typeVersion: data.typeVersion.present
          ? data.typeVersion.value
          : this.typeVersion,
      lane: data.lane.present ? data.lane.value : this.lane,
      userId: data.userId.present ? data.userId.value : this.userId,
      envelope: data.envelope.present ? data.envelope.value : this.envelope,
      payloadHash: data.payloadHash.present
          ? data.payloadHash.value
          : this.payloadHash,
      bytes: data.bytes.present ? data.bytes.value : this.bytes,
      state: data.state.present ? data.state.value : this.state,
      receiptState: data.receiptState.present
          ? data.receiptState.value
          : this.receiptState,
      receipt: data.receipt.present ? data.receipt.value : this.receipt,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      nextAttemptMs: data.nextAttemptMs.present
          ? data.nextAttemptMs.value
          : this.nextAttemptMs,
      entityRef: data.entityRef.present ? data.entityRef.value : this.entityRef,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      createdAtMs: data.createdAtMs.present
          ? data.createdAtMs.value
          : this.createdAtMs,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      committedAtMs: data.committedAtMs.present
          ? data.committedAtMs.value
          : this.committedAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OutboxRow(')
          ..write('id: $id, ')
          ..write('deviceSeq: $deviceSeq, ')
          ..write('type: $type, ')
          ..write('typeVersion: $typeVersion, ')
          ..write('lane: $lane, ')
          ..write('userId: $userId, ')
          ..write('envelope: $envelope, ')
          ..write('payloadHash: $payloadHash, ')
          ..write('bytes: $bytes, ')
          ..write('state: $state, ')
          ..write('receiptState: $receiptState, ')
          ..write('receipt: $receipt, ')
          ..write('lastError: $lastError, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptMs: $nextAttemptMs, ')
          ..write('entityRef: $entityRef, ')
          ..write('createdAt: $createdAt, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('committedAtMs: $committedAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    deviceSeq,
    type,
    typeVersion,
    lane,
    userId,
    envelope,
    payloadHash,
    bytes,
    state,
    receiptState,
    receipt,
    lastError,
    attempts,
    nextAttemptMs,
    entityRef,
    createdAt,
    createdAtMs,
    updatedAt,
    committedAtMs,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OutboxRow &&
          other.id == this.id &&
          other.deviceSeq == this.deviceSeq &&
          other.type == this.type &&
          other.typeVersion == this.typeVersion &&
          other.lane == this.lane &&
          other.userId == this.userId &&
          other.envelope == this.envelope &&
          other.payloadHash == this.payloadHash &&
          other.bytes == this.bytes &&
          other.state == this.state &&
          other.receiptState == this.receiptState &&
          other.receipt == this.receipt &&
          other.lastError == this.lastError &&
          other.attempts == this.attempts &&
          other.nextAttemptMs == this.nextAttemptMs &&
          other.entityRef == this.entityRef &&
          other.createdAt == this.createdAt &&
          other.createdAtMs == this.createdAtMs &&
          other.updatedAt == this.updatedAt &&
          other.committedAtMs == this.committedAtMs);
}

class OutboxCompanion extends UpdateCompanion<OutboxRow> {
  final Value<String> id;
  final Value<int> deviceSeq;
  final Value<String> type;
  final Value<int> typeVersion;
  final Value<int> lane;
  final Value<String?> userId;
  final Value<String> envelope;
  final Value<String> payloadHash;
  final Value<int> bytes;
  final Value<String> state;
  final Value<String?> receiptState;
  final Value<String?> receipt;
  final Value<String?> lastError;
  final Value<int> attempts;
  final Value<int?> nextAttemptMs;
  final Value<String?> entityRef;
  final Value<String> createdAt;
  final Value<int> createdAtMs;
  final Value<String> updatedAt;
  final Value<int?> committedAtMs;
  final Value<int> rowid;
  const OutboxCompanion({
    this.id = const Value.absent(),
    this.deviceSeq = const Value.absent(),
    this.type = const Value.absent(),
    this.typeVersion = const Value.absent(),
    this.lane = const Value.absent(),
    this.userId = const Value.absent(),
    this.envelope = const Value.absent(),
    this.payloadHash = const Value.absent(),
    this.bytes = const Value.absent(),
    this.state = const Value.absent(),
    this.receiptState = const Value.absent(),
    this.receipt = const Value.absent(),
    this.lastError = const Value.absent(),
    this.attempts = const Value.absent(),
    this.nextAttemptMs = const Value.absent(),
    this.entityRef = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.createdAtMs = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.committedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  OutboxCompanion.insert({
    required String id,
    required int deviceSeq,
    required String type,
    required int typeVersion,
    required int lane,
    this.userId = const Value.absent(),
    required String envelope,
    required String payloadHash,
    required int bytes,
    required String state,
    this.receiptState = const Value.absent(),
    this.receipt = const Value.absent(),
    this.lastError = const Value.absent(),
    this.attempts = const Value.absent(),
    this.nextAttemptMs = const Value.absent(),
    this.entityRef = const Value.absent(),
    required String createdAt,
    required int createdAtMs,
    required String updatedAt,
    this.committedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       deviceSeq = Value(deviceSeq),
       type = Value(type),
       typeVersion = Value(typeVersion),
       lane = Value(lane),
       envelope = Value(envelope),
       payloadHash = Value(payloadHash),
       bytes = Value(bytes),
       state = Value(state),
       createdAt = Value(createdAt),
       createdAtMs = Value(createdAtMs),
       updatedAt = Value(updatedAt);
  static Insertable<OutboxRow> custom({
    Expression<String>? id,
    Expression<int>? deviceSeq,
    Expression<String>? type,
    Expression<int>? typeVersion,
    Expression<int>? lane,
    Expression<String>? userId,
    Expression<String>? envelope,
    Expression<String>? payloadHash,
    Expression<int>? bytes,
    Expression<String>? state,
    Expression<String>? receiptState,
    Expression<String>? receipt,
    Expression<String>? lastError,
    Expression<int>? attempts,
    Expression<int>? nextAttemptMs,
    Expression<String>? entityRef,
    Expression<String>? createdAt,
    Expression<int>? createdAtMs,
    Expression<String>? updatedAt,
    Expression<int>? committedAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (deviceSeq != null) 'device_seq': deviceSeq,
      if (type != null) 'type': type,
      if (typeVersion != null) 'type_version': typeVersion,
      if (lane != null) 'lane': lane,
      if (userId != null) 'user_id': userId,
      if (envelope != null) 'envelope': envelope,
      if (payloadHash != null) 'payload_hash': payloadHash,
      if (bytes != null) 'bytes': bytes,
      if (state != null) 'state': state,
      if (receiptState != null) 'receipt_state': receiptState,
      if (receipt != null) 'receipt': receipt,
      if (lastError != null) 'last_error': lastError,
      if (attempts != null) 'attempts': attempts,
      if (nextAttemptMs != null) 'next_attempt_ms': nextAttemptMs,
      if (entityRef != null) 'entity_ref': entityRef,
      if (createdAt != null) 'created_at': createdAt,
      if (createdAtMs != null) 'created_at_ms': createdAtMs,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (committedAtMs != null) 'committed_at_ms': committedAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  OutboxCompanion copyWith({
    Value<String>? id,
    Value<int>? deviceSeq,
    Value<String>? type,
    Value<int>? typeVersion,
    Value<int>? lane,
    Value<String?>? userId,
    Value<String>? envelope,
    Value<String>? payloadHash,
    Value<int>? bytes,
    Value<String>? state,
    Value<String?>? receiptState,
    Value<String?>? receipt,
    Value<String?>? lastError,
    Value<int>? attempts,
    Value<int?>? nextAttemptMs,
    Value<String?>? entityRef,
    Value<String>? createdAt,
    Value<int>? createdAtMs,
    Value<String>? updatedAt,
    Value<int?>? committedAtMs,
    Value<int>? rowid,
  }) {
    return OutboxCompanion(
      id: id ?? this.id,
      deviceSeq: deviceSeq ?? this.deviceSeq,
      type: type ?? this.type,
      typeVersion: typeVersion ?? this.typeVersion,
      lane: lane ?? this.lane,
      userId: userId ?? this.userId,
      envelope: envelope ?? this.envelope,
      payloadHash: payloadHash ?? this.payloadHash,
      bytes: bytes ?? this.bytes,
      state: state ?? this.state,
      receiptState: receiptState ?? this.receiptState,
      receipt: receipt ?? this.receipt,
      lastError: lastError ?? this.lastError,
      attempts: attempts ?? this.attempts,
      nextAttemptMs: nextAttemptMs ?? this.nextAttemptMs,
      entityRef: entityRef ?? this.entityRef,
      createdAt: createdAt ?? this.createdAt,
      createdAtMs: createdAtMs ?? this.createdAtMs,
      updatedAt: updatedAt ?? this.updatedAt,
      committedAtMs: committedAtMs ?? this.committedAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (deviceSeq.present) {
      map['device_seq'] = Variable<int>(deviceSeq.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (typeVersion.present) {
      map['type_version'] = Variable<int>(typeVersion.value);
    }
    if (lane.present) {
      map['lane'] = Variable<int>(lane.value);
    }
    if (userId.present) {
      map['user_id'] = Variable<String>(userId.value);
    }
    if (envelope.present) {
      map['envelope'] = Variable<String>(envelope.value);
    }
    if (payloadHash.present) {
      map['payload_hash'] = Variable<String>(payloadHash.value);
    }
    if (bytes.present) {
      map['bytes'] = Variable<int>(bytes.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (receiptState.present) {
      map['receipt_state'] = Variable<String>(receiptState.value);
    }
    if (receipt.present) {
      map['receipt'] = Variable<String>(receipt.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (nextAttemptMs.present) {
      map['next_attempt_ms'] = Variable<int>(nextAttemptMs.value);
    }
    if (entityRef.present) {
      map['entity_ref'] = Variable<String>(entityRef.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<String>(createdAt.value);
    }
    if (createdAtMs.present) {
      map['created_at_ms'] = Variable<int>(createdAtMs.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<String>(updatedAt.value);
    }
    if (committedAtMs.present) {
      map['committed_at_ms'] = Variable<int>(committedAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OutboxCompanion(')
          ..write('id: $id, ')
          ..write('deviceSeq: $deviceSeq, ')
          ..write('type: $type, ')
          ..write('typeVersion: $typeVersion, ')
          ..write('lane: $lane, ')
          ..write('userId: $userId, ')
          ..write('envelope: $envelope, ')
          ..write('payloadHash: $payloadHash, ')
          ..write('bytes: $bytes, ')
          ..write('state: $state, ')
          ..write('receiptState: $receiptState, ')
          ..write('receipt: $receipt, ')
          ..write('lastError: $lastError, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptMs: $nextAttemptMs, ')
          ..write('entityRef: $entityRef, ')
          ..write('createdAt: $createdAt, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('committedAtMs: $committedAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedDocumentsTable extends CachedDocuments
    with TableInfo<$CachedDocumentsTable, CachedDocumentRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedDocumentsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bodyMeta = const VerificationMeta('body');
  @override
  late final GeneratedColumn<String> body = GeneratedColumn<String>(
    'body',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hashMeta = const VerificationMeta('hash');
  @override
  late final GeneratedColumn<String> hash = GeneratedColumn<String>(
    'hash',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<String> updatedAt = GeneratedColumn<String>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, body, hash, updatedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_documents';
  @override
  VerificationContext validateIntegrity(
    Insertable<CachedDocumentRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('body')) {
      context.handle(
        _bodyMeta,
        body.isAcceptableOrUnknown(data['body']!, _bodyMeta),
      );
    } else if (isInserting) {
      context.missing(_bodyMeta);
    }
    if (data.containsKey('hash')) {
      context.handle(
        _hashMeta,
        hash.isAcceptableOrUnknown(data['hash']!, _hashMeta),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  CachedDocumentRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedDocumentRow(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      body: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}body'],
      )!,
      hash: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}hash'],
      ),
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $CachedDocumentsTable createAlias(String alias) {
    return $CachedDocumentsTable(attachedDatabase, alias);
  }
}

class CachedDocumentRow extends DataClass
    implements Insertable<CachedDocumentRow> {
  final String key;

  /// The document as JSON.
  final String body;

  /// The server's hash or version id for it, when it has one.
  final String? hash;

  /// ISO-8601 with the device's offset (docs/12 §11).
  final String updatedAt;
  const CachedDocumentRow({
    required this.key,
    required this.body,
    this.hash,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['body'] = Variable<String>(body);
    if (!nullToAbsent || hash != null) {
      map['hash'] = Variable<String>(hash);
    }
    map['updated_at'] = Variable<String>(updatedAt);
    return map;
  }

  CachedDocumentsCompanion toCompanion(bool nullToAbsent) {
    return CachedDocumentsCompanion(
      key: Value(key),
      body: Value(body),
      hash: hash == null && nullToAbsent ? const Value.absent() : Value(hash),
      updatedAt: Value(updatedAt),
    );
  }

  factory CachedDocumentRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedDocumentRow(
      key: serializer.fromJson<String>(json['key']),
      body: serializer.fromJson<String>(json['body']),
      hash: serializer.fromJson<String?>(json['hash']),
      updatedAt: serializer.fromJson<String>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'body': serializer.toJson<String>(body),
      'hash': serializer.toJson<String?>(hash),
      'updatedAt': serializer.toJson<String>(updatedAt),
    };
  }

  CachedDocumentRow copyWith({
    String? key,
    String? body,
    Value<String?> hash = const Value.absent(),
    String? updatedAt,
  }) => CachedDocumentRow(
    key: key ?? this.key,
    body: body ?? this.body,
    hash: hash.present ? hash.value : this.hash,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  CachedDocumentRow copyWithCompanion(CachedDocumentsCompanion data) {
    return CachedDocumentRow(
      key: data.key.present ? data.key.value : this.key,
      body: data.body.present ? data.body.value : this.body,
      hash: data.hash.present ? data.hash.value : this.hash,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedDocumentRow(')
          ..write('key: $key, ')
          ..write('body: $body, ')
          ..write('hash: $hash, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, body, hash, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedDocumentRow &&
          other.key == this.key &&
          other.body == this.body &&
          other.hash == this.hash &&
          other.updatedAt == this.updatedAt);
}

class CachedDocumentsCompanion extends UpdateCompanion<CachedDocumentRow> {
  final Value<String> key;
  final Value<String> body;
  final Value<String?> hash;
  final Value<String> updatedAt;
  final Value<int> rowid;
  const CachedDocumentsCompanion({
    this.key = const Value.absent(),
    this.body = const Value.absent(),
    this.hash = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedDocumentsCompanion.insert({
    required String key,
    required String body,
    this.hash = const Value.absent(),
    required String updatedAt,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       body = Value(body),
       updatedAt = Value(updatedAt);
  static Insertable<CachedDocumentRow> custom({
    Expression<String>? key,
    Expression<String>? body,
    Expression<String>? hash,
    Expression<String>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (body != null) 'body': body,
      if (hash != null) 'hash': hash,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedDocumentsCompanion copyWith({
    Value<String>? key,
    Value<String>? body,
    Value<String?>? hash,
    Value<String>? updatedAt,
    Value<int>? rowid,
  }) {
    return CachedDocumentsCompanion(
      key: key ?? this.key,
      body: body ?? this.body,
      hash: hash ?? this.hash,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (body.present) {
      map['body'] = Variable<String>(body.value);
    }
    if (hash.present) {
      map['hash'] = Variable<String>(hash.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<String>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedDocumentsCompanion(')
          ..write('key: $key, ')
          ..write('body: $body, ')
          ..write('hash: $hash, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $JobsTable extends Jobs with TableInfo<$JobsTable, JobRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $JobsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _referenceMeta = const VerificationMeta(
    'reference',
  );
  @override
  late final GeneratedColumn<String> reference = GeneratedColumn<String>(
    'reference',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<String> updatedAt = GeneratedColumn<String>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _assignedToMeMeta = const VerificationMeta(
    'assignedToMe',
  );
  @override
  late final GeneratedColumn<bool> assignedToMe = GeneratedColumn<bool>(
    'assigned_to_me',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("assigned_to_me" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _bankIdMeta = const VerificationMeta('bankId');
  @override
  late final GeneratedColumn<String> bankId = GeneratedColumn<String>(
    'bank_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _scheduledStartMsMeta = const VerificationMeta(
    'scheduledStartMs',
  );
  @override
  late final GeneratedColumn<int> scheduledStartMs = GeneratedColumn<int>(
    'scheduled_start_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _bodyMeta = const VerificationMeta('body');
  @override
  late final GeneratedColumn<String> body = GeneratedColumn<String>(
    'body',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    reference,
    status,
    updatedAt,
    assignedToMe,
    bankId,
    scheduledStartMs,
    body,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'jobs';
  @override
  VerificationContext validateIntegrity(
    Insertable<JobRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('reference')) {
      context.handle(
        _referenceMeta,
        reference.isAcceptableOrUnknown(data['reference']!, _referenceMeta),
      );
    } else if (isInserting) {
      context.missing(_referenceMeta);
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    if (data.containsKey('assigned_to_me')) {
      context.handle(
        _assignedToMeMeta,
        assignedToMe.isAcceptableOrUnknown(
          data['assigned_to_me']!,
          _assignedToMeMeta,
        ),
      );
    }
    if (data.containsKey('bank_id')) {
      context.handle(
        _bankIdMeta,
        bankId.isAcceptableOrUnknown(data['bank_id']!, _bankIdMeta),
      );
    }
    if (data.containsKey('scheduled_start_ms')) {
      context.handle(
        _scheduledStartMsMeta,
        scheduledStartMs.isAcceptableOrUnknown(
          data['scheduled_start_ms']!,
          _scheduledStartMsMeta,
        ),
      );
    }
    if (data.containsKey('body')) {
      context.handle(
        _bodyMeta,
        body.isAcceptableOrUnknown(data['body']!, _bodyMeta),
      );
    } else if (isInserting) {
      context.missing(_bodyMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  JobRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return JobRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      reference: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reference'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}updated_at'],
      )!,
      assignedToMe: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}assigned_to_me'],
      )!,
      bankId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}bank_id'],
      ),
      scheduledStartMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}scheduled_start_ms'],
      ),
      body: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}body'],
      )!,
    );
  }

  @override
  $JobsTable createAlias(String alias) {
    return $JobsTable(attachedDatabase, alias);
  }
}

class JobRow extends DataClass implements Insertable<JobRow> {
  final String id;
  final String reference;
  final String status;

  /// The server's `updated_at`.
  final String updatedAt;
  final bool assignedToMe;
  final String? bankId;

  /// `scheduled_start` in epoch ms, for sorting; null when unscheduled.
  final int? scheduledStartMs;

  /// The job as pulled (`schema/api/sync-pull-response.schema.json`).
  final String body;
  const JobRow({
    required this.id,
    required this.reference,
    required this.status,
    required this.updatedAt,
    required this.assignedToMe,
    this.bankId,
    this.scheduledStartMs,
    required this.body,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['reference'] = Variable<String>(reference);
    map['status'] = Variable<String>(status);
    map['updated_at'] = Variable<String>(updatedAt);
    map['assigned_to_me'] = Variable<bool>(assignedToMe);
    if (!nullToAbsent || bankId != null) {
      map['bank_id'] = Variable<String>(bankId);
    }
    if (!nullToAbsent || scheduledStartMs != null) {
      map['scheduled_start_ms'] = Variable<int>(scheduledStartMs);
    }
    map['body'] = Variable<String>(body);
    return map;
  }

  JobsCompanion toCompanion(bool nullToAbsent) {
    return JobsCompanion(
      id: Value(id),
      reference: Value(reference),
      status: Value(status),
      updatedAt: Value(updatedAt),
      assignedToMe: Value(assignedToMe),
      bankId: bankId == null && nullToAbsent
          ? const Value.absent()
          : Value(bankId),
      scheduledStartMs: scheduledStartMs == null && nullToAbsent
          ? const Value.absent()
          : Value(scheduledStartMs),
      body: Value(body),
    );
  }

  factory JobRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return JobRow(
      id: serializer.fromJson<String>(json['id']),
      reference: serializer.fromJson<String>(json['reference']),
      status: serializer.fromJson<String>(json['status']),
      updatedAt: serializer.fromJson<String>(json['updatedAt']),
      assignedToMe: serializer.fromJson<bool>(json['assignedToMe']),
      bankId: serializer.fromJson<String?>(json['bankId']),
      scheduledStartMs: serializer.fromJson<int?>(json['scheduledStartMs']),
      body: serializer.fromJson<String>(json['body']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'reference': serializer.toJson<String>(reference),
      'status': serializer.toJson<String>(status),
      'updatedAt': serializer.toJson<String>(updatedAt),
      'assignedToMe': serializer.toJson<bool>(assignedToMe),
      'bankId': serializer.toJson<String?>(bankId),
      'scheduledStartMs': serializer.toJson<int?>(scheduledStartMs),
      'body': serializer.toJson<String>(body),
    };
  }

  JobRow copyWith({
    String? id,
    String? reference,
    String? status,
    String? updatedAt,
    bool? assignedToMe,
    Value<String?> bankId = const Value.absent(),
    Value<int?> scheduledStartMs = const Value.absent(),
    String? body,
  }) => JobRow(
    id: id ?? this.id,
    reference: reference ?? this.reference,
    status: status ?? this.status,
    updatedAt: updatedAt ?? this.updatedAt,
    assignedToMe: assignedToMe ?? this.assignedToMe,
    bankId: bankId.present ? bankId.value : this.bankId,
    scheduledStartMs: scheduledStartMs.present
        ? scheduledStartMs.value
        : this.scheduledStartMs,
    body: body ?? this.body,
  );
  JobRow copyWithCompanion(JobsCompanion data) {
    return JobRow(
      id: data.id.present ? data.id.value : this.id,
      reference: data.reference.present ? data.reference.value : this.reference,
      status: data.status.present ? data.status.value : this.status,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      assignedToMe: data.assignedToMe.present
          ? data.assignedToMe.value
          : this.assignedToMe,
      bankId: data.bankId.present ? data.bankId.value : this.bankId,
      scheduledStartMs: data.scheduledStartMs.present
          ? data.scheduledStartMs.value
          : this.scheduledStartMs,
      body: data.body.present ? data.body.value : this.body,
    );
  }

  @override
  String toString() {
    return (StringBuffer('JobRow(')
          ..write('id: $id, ')
          ..write('reference: $reference, ')
          ..write('status: $status, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('assignedToMe: $assignedToMe, ')
          ..write('bankId: $bankId, ')
          ..write('scheduledStartMs: $scheduledStartMs, ')
          ..write('body: $body')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    reference,
    status,
    updatedAt,
    assignedToMe,
    bankId,
    scheduledStartMs,
    body,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is JobRow &&
          other.id == this.id &&
          other.reference == this.reference &&
          other.status == this.status &&
          other.updatedAt == this.updatedAt &&
          other.assignedToMe == this.assignedToMe &&
          other.bankId == this.bankId &&
          other.scheduledStartMs == this.scheduledStartMs &&
          other.body == this.body);
}

class JobsCompanion extends UpdateCompanion<JobRow> {
  final Value<String> id;
  final Value<String> reference;
  final Value<String> status;
  final Value<String> updatedAt;
  final Value<bool> assignedToMe;
  final Value<String?> bankId;
  final Value<int?> scheduledStartMs;
  final Value<String> body;
  final Value<int> rowid;
  const JobsCompanion({
    this.id = const Value.absent(),
    this.reference = const Value.absent(),
    this.status = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.assignedToMe = const Value.absent(),
    this.bankId = const Value.absent(),
    this.scheduledStartMs = const Value.absent(),
    this.body = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  JobsCompanion.insert({
    required String id,
    required String reference,
    required String status,
    required String updatedAt,
    this.assignedToMe = const Value.absent(),
    this.bankId = const Value.absent(),
    this.scheduledStartMs = const Value.absent(),
    required String body,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       reference = Value(reference),
       status = Value(status),
       updatedAt = Value(updatedAt),
       body = Value(body);
  static Insertable<JobRow> custom({
    Expression<String>? id,
    Expression<String>? reference,
    Expression<String>? status,
    Expression<String>? updatedAt,
    Expression<bool>? assignedToMe,
    Expression<String>? bankId,
    Expression<int>? scheduledStartMs,
    Expression<String>? body,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (reference != null) 'reference': reference,
      if (status != null) 'status': status,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (assignedToMe != null) 'assigned_to_me': assignedToMe,
      if (bankId != null) 'bank_id': bankId,
      if (scheduledStartMs != null) 'scheduled_start_ms': scheduledStartMs,
      if (body != null) 'body': body,
      if (rowid != null) 'rowid': rowid,
    });
  }

  JobsCompanion copyWith({
    Value<String>? id,
    Value<String>? reference,
    Value<String>? status,
    Value<String>? updatedAt,
    Value<bool>? assignedToMe,
    Value<String?>? bankId,
    Value<int?>? scheduledStartMs,
    Value<String>? body,
    Value<int>? rowid,
  }) {
    return JobsCompanion(
      id: id ?? this.id,
      reference: reference ?? this.reference,
      status: status ?? this.status,
      updatedAt: updatedAt ?? this.updatedAt,
      assignedToMe: assignedToMe ?? this.assignedToMe,
      bankId: bankId ?? this.bankId,
      scheduledStartMs: scheduledStartMs ?? this.scheduledStartMs,
      body: body ?? this.body,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (reference.present) {
      map['reference'] = Variable<String>(reference.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<String>(updatedAt.value);
    }
    if (assignedToMe.present) {
      map['assigned_to_me'] = Variable<bool>(assignedToMe.value);
    }
    if (bankId.present) {
      map['bank_id'] = Variable<String>(bankId.value);
    }
    if (scheduledStartMs.present) {
      map['scheduled_start_ms'] = Variable<int>(scheduledStartMs.value);
    }
    if (body.present) {
      map['body'] = Variable<String>(body.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('JobsCompanion(')
          ..write('id: $id, ')
          ..write('reference: $reference, ')
          ..write('status: $status, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('assignedToMe: $assignedToMe, ')
          ..write('bankId: $bankId, ')
          ..write('scheduledStartMs: $scheduledStartMs, ')
          ..write('body: $body, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ReviewsTable extends Reviews with TableInfo<$ReviewsTable, ReviewRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ReviewsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _jobIdMeta = const VerificationMeta('jobId');
  @override
  late final GeneratedColumn<String> jobId = GeneratedColumn<String>(
    'job_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _inspectionIdMeta = const VerificationMeta(
    'inspectionId',
  );
  @override
  late final GeneratedColumn<String> inspectionId = GeneratedColumn<String>(
    'inspection_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _attemptMeta = const VerificationMeta(
    'attempt',
  );
  @override
  late final GeneratedColumn<int> attempt = GeneratedColumn<int>(
    'attempt',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _decisionMeta = const VerificationMeta(
    'decision',
  );
  @override
  late final GeneratedColumn<String> decision = GeneratedColumn<String>(
    'decision',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _decidedAtMeta = const VerificationMeta(
    'decidedAt',
  );
  @override
  late final GeneratedColumn<String> decidedAt = GeneratedColumn<String>(
    'decided_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bodyMeta = const VerificationMeta('body');
  @override
  late final GeneratedColumn<String> body = GeneratedColumn<String>(
    'body',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    jobId,
    inspectionId,
    attempt,
    decision,
    decidedAt,
    body,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'reviews';
  @override
  VerificationContext validateIntegrity(
    Insertable<ReviewRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('job_id')) {
      context.handle(
        _jobIdMeta,
        jobId.isAcceptableOrUnknown(data['job_id']!, _jobIdMeta),
      );
    } else if (isInserting) {
      context.missing(_jobIdMeta);
    }
    if (data.containsKey('inspection_id')) {
      context.handle(
        _inspectionIdMeta,
        inspectionId.isAcceptableOrUnknown(
          data['inspection_id']!,
          _inspectionIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_inspectionIdMeta);
    }
    if (data.containsKey('attempt')) {
      context.handle(
        _attemptMeta,
        attempt.isAcceptableOrUnknown(data['attempt']!, _attemptMeta),
      );
    } else if (isInserting) {
      context.missing(_attemptMeta);
    }
    if (data.containsKey('decision')) {
      context.handle(
        _decisionMeta,
        decision.isAcceptableOrUnknown(data['decision']!, _decisionMeta),
      );
    } else if (isInserting) {
      context.missing(_decisionMeta);
    }
    if (data.containsKey('decided_at')) {
      context.handle(
        _decidedAtMeta,
        decidedAt.isAcceptableOrUnknown(data['decided_at']!, _decidedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_decidedAtMeta);
    }
    if (data.containsKey('body')) {
      context.handle(
        _bodyMeta,
        body.isAcceptableOrUnknown(data['body']!, _bodyMeta),
      );
    } else if (isInserting) {
      context.missing(_bodyMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  ReviewRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ReviewRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      jobId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}job_id'],
      )!,
      inspectionId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}inspection_id'],
      )!,
      attempt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempt'],
      )!,
      decision: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}decision'],
      )!,
      decidedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}decided_at'],
      )!,
      body: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}body'],
      )!,
    );
  }

  @override
  $ReviewsTable createAlias(String alias) {
    return $ReviewsTable(attachedDatabase, alias);
  }
}

class ReviewRow extends DataClass implements Insertable<ReviewRow> {
  final String id;
  final String jobId;
  final String inspectionId;
  final int attempt;

  /// `approved`, `returned` or `rejected`.
  final String decision;
  final String decidedAt;

  /// The review as pulled.
  final String body;
  const ReviewRow({
    required this.id,
    required this.jobId,
    required this.inspectionId,
    required this.attempt,
    required this.decision,
    required this.decidedAt,
    required this.body,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['job_id'] = Variable<String>(jobId);
    map['inspection_id'] = Variable<String>(inspectionId);
    map['attempt'] = Variable<int>(attempt);
    map['decision'] = Variable<String>(decision);
    map['decided_at'] = Variable<String>(decidedAt);
    map['body'] = Variable<String>(body);
    return map;
  }

  ReviewsCompanion toCompanion(bool nullToAbsent) {
    return ReviewsCompanion(
      id: Value(id),
      jobId: Value(jobId),
      inspectionId: Value(inspectionId),
      attempt: Value(attempt),
      decision: Value(decision),
      decidedAt: Value(decidedAt),
      body: Value(body),
    );
  }

  factory ReviewRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ReviewRow(
      id: serializer.fromJson<String>(json['id']),
      jobId: serializer.fromJson<String>(json['jobId']),
      inspectionId: serializer.fromJson<String>(json['inspectionId']),
      attempt: serializer.fromJson<int>(json['attempt']),
      decision: serializer.fromJson<String>(json['decision']),
      decidedAt: serializer.fromJson<String>(json['decidedAt']),
      body: serializer.fromJson<String>(json['body']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'jobId': serializer.toJson<String>(jobId),
      'inspectionId': serializer.toJson<String>(inspectionId),
      'attempt': serializer.toJson<int>(attempt),
      'decision': serializer.toJson<String>(decision),
      'decidedAt': serializer.toJson<String>(decidedAt),
      'body': serializer.toJson<String>(body),
    };
  }

  ReviewRow copyWith({
    String? id,
    String? jobId,
    String? inspectionId,
    int? attempt,
    String? decision,
    String? decidedAt,
    String? body,
  }) => ReviewRow(
    id: id ?? this.id,
    jobId: jobId ?? this.jobId,
    inspectionId: inspectionId ?? this.inspectionId,
    attempt: attempt ?? this.attempt,
    decision: decision ?? this.decision,
    decidedAt: decidedAt ?? this.decidedAt,
    body: body ?? this.body,
  );
  ReviewRow copyWithCompanion(ReviewsCompanion data) {
    return ReviewRow(
      id: data.id.present ? data.id.value : this.id,
      jobId: data.jobId.present ? data.jobId.value : this.jobId,
      inspectionId: data.inspectionId.present
          ? data.inspectionId.value
          : this.inspectionId,
      attempt: data.attempt.present ? data.attempt.value : this.attempt,
      decision: data.decision.present ? data.decision.value : this.decision,
      decidedAt: data.decidedAt.present ? data.decidedAt.value : this.decidedAt,
      body: data.body.present ? data.body.value : this.body,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ReviewRow(')
          ..write('id: $id, ')
          ..write('jobId: $jobId, ')
          ..write('inspectionId: $inspectionId, ')
          ..write('attempt: $attempt, ')
          ..write('decision: $decision, ')
          ..write('decidedAt: $decidedAt, ')
          ..write('body: $body')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, jobId, inspectionId, attempt, decision, decidedAt, body);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ReviewRow &&
          other.id == this.id &&
          other.jobId == this.jobId &&
          other.inspectionId == this.inspectionId &&
          other.attempt == this.attempt &&
          other.decision == this.decision &&
          other.decidedAt == this.decidedAt &&
          other.body == this.body);
}

class ReviewsCompanion extends UpdateCompanion<ReviewRow> {
  final Value<String> id;
  final Value<String> jobId;
  final Value<String> inspectionId;
  final Value<int> attempt;
  final Value<String> decision;
  final Value<String> decidedAt;
  final Value<String> body;
  final Value<int> rowid;
  const ReviewsCompanion({
    this.id = const Value.absent(),
    this.jobId = const Value.absent(),
    this.inspectionId = const Value.absent(),
    this.attempt = const Value.absent(),
    this.decision = const Value.absent(),
    this.decidedAt = const Value.absent(),
    this.body = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ReviewsCompanion.insert({
    required String id,
    required String jobId,
    required String inspectionId,
    required int attempt,
    required String decision,
    required String decidedAt,
    required String body,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       jobId = Value(jobId),
       inspectionId = Value(inspectionId),
       attempt = Value(attempt),
       decision = Value(decision),
       decidedAt = Value(decidedAt),
       body = Value(body);
  static Insertable<ReviewRow> custom({
    Expression<String>? id,
    Expression<String>? jobId,
    Expression<String>? inspectionId,
    Expression<int>? attempt,
    Expression<String>? decision,
    Expression<String>? decidedAt,
    Expression<String>? body,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (jobId != null) 'job_id': jobId,
      if (inspectionId != null) 'inspection_id': inspectionId,
      if (attempt != null) 'attempt': attempt,
      if (decision != null) 'decision': decision,
      if (decidedAt != null) 'decided_at': decidedAt,
      if (body != null) 'body': body,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ReviewsCompanion copyWith({
    Value<String>? id,
    Value<String>? jobId,
    Value<String>? inspectionId,
    Value<int>? attempt,
    Value<String>? decision,
    Value<String>? decidedAt,
    Value<String>? body,
    Value<int>? rowid,
  }) {
    return ReviewsCompanion(
      id: id ?? this.id,
      jobId: jobId ?? this.jobId,
      inspectionId: inspectionId ?? this.inspectionId,
      attempt: attempt ?? this.attempt,
      decision: decision ?? this.decision,
      decidedAt: decidedAt ?? this.decidedAt,
      body: body ?? this.body,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (jobId.present) {
      map['job_id'] = Variable<String>(jobId.value);
    }
    if (inspectionId.present) {
      map['inspection_id'] = Variable<String>(inspectionId.value);
    }
    if (attempt.present) {
      map['attempt'] = Variable<int>(attempt.value);
    }
    if (decision.present) {
      map['decision'] = Variable<String>(decision.value);
    }
    if (decidedAt.present) {
      map['decided_at'] = Variable<String>(decidedAt.value);
    }
    if (body.present) {
      map['body'] = Variable<String>(body.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ReviewsCompanion(')
          ..write('id: $id, ')
          ..write('jobId: $jobId, ')
          ..write('inspectionId: $inspectionId, ')
          ..write('attempt: $attempt, ')
          ..write('decision: $decision, ')
          ..write('decidedAt: $decidedAt, ')
          ..write('body: $body, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $DefinitionVersionsTable extends DefinitionVersions
    with TableInfo<$DefinitionVersionsTable, DefinitionVersionRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DefinitionVersionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _versionIdMeta = const VerificationMeta(
    'versionId',
  );
  @override
  late final GeneratedColumn<String> versionId = GeneratedColumn<String>(
    'version_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _familyIdMeta = const VerificationMeta(
    'familyId',
  );
  @override
  late final GeneratedColumn<String> familyId = GeneratedColumn<String>(
    'family_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bankIdMeta = const VerificationMeta('bankId');
  @override
  late final GeneratedColumn<String> bankId = GeneratedColumn<String>(
    'bank_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _versionMeta = const VerificationMeta(
    'version',
  );
  @override
  late final GeneratedColumn<int> version = GeneratedColumn<int>(
    'version',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _specVersionMeta = const VerificationMeta(
    'specVersion',
  );
  @override
  late final GeneratedColumn<String> specVersion = GeneratedColumn<String>(
    'spec_version',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hashMeta = const VerificationMeta('hash');
  @override
  late final GeneratedColumn<String> hash = GeneratedColumn<String>(
    'hash',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bodyMeta = const VerificationMeta('body');
  @override
  late final GeneratedColumn<String> body = GeneratedColumn<String>(
    'body',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    versionId,
    familyId,
    kind,
    key,
    bankId,
    version,
    specVersion,
    hash,
    body,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'definition_versions';
  @override
  VerificationContext validateIntegrity(
    Insertable<DefinitionVersionRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('version_id')) {
      context.handle(
        _versionIdMeta,
        versionId.isAcceptableOrUnknown(data['version_id']!, _versionIdMeta),
      );
    } else if (isInserting) {
      context.missing(_versionIdMeta);
    }
    if (data.containsKey('family_id')) {
      context.handle(
        _familyIdMeta,
        familyId.isAcceptableOrUnknown(data['family_id']!, _familyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_familyIdMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('bank_id')) {
      context.handle(
        _bankIdMeta,
        bankId.isAcceptableOrUnknown(data['bank_id']!, _bankIdMeta),
      );
    }
    if (data.containsKey('version')) {
      context.handle(
        _versionMeta,
        version.isAcceptableOrUnknown(data['version']!, _versionMeta),
      );
    } else if (isInserting) {
      context.missing(_versionMeta);
    }
    if (data.containsKey('spec_version')) {
      context.handle(
        _specVersionMeta,
        specVersion.isAcceptableOrUnknown(
          data['spec_version']!,
          _specVersionMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_specVersionMeta);
    }
    if (data.containsKey('hash')) {
      context.handle(
        _hashMeta,
        hash.isAcceptableOrUnknown(data['hash']!, _hashMeta),
      );
    } else if (isInserting) {
      context.missing(_hashMeta);
    }
    if (data.containsKey('body')) {
      context.handle(
        _bodyMeta,
        body.isAcceptableOrUnknown(data['body']!, _bodyMeta),
      );
    } else if (isInserting) {
      context.missing(_bodyMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {versionId};
  @override
  DefinitionVersionRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DefinitionVersionRow(
      versionId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}version_id'],
      )!,
      familyId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}family_id'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      bankId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}bank_id'],
      ),
      version: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}version'],
      )!,
      specVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}spec_version'],
      )!,
      hash: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}hash'],
      )!,
      body: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}body'],
      )!,
    );
  }

  @override
  $DefinitionVersionsTable createAlias(String alias) {
    return $DefinitionVersionsTable(attachedDatabase, alias);
  }
}

class DefinitionVersionRow extends DataClass
    implements Insertable<DefinitionVersionRow> {
  final String versionId;
  final String familyId;

  /// `form`, `flow`, `view`, `content`, `app`, `job_schema`.
  final String kind;
  final String key;
  final String? bankId;
  final int version;
  final String specVersion;

  /// `definition_hash`: SHA-256 of the definition's canonical JSON.
  final String hash;

  /// The definition as JSON.
  final String body;
  const DefinitionVersionRow({
    required this.versionId,
    required this.familyId,
    required this.kind,
    required this.key,
    this.bankId,
    required this.version,
    required this.specVersion,
    required this.hash,
    required this.body,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['version_id'] = Variable<String>(versionId);
    map['family_id'] = Variable<String>(familyId);
    map['kind'] = Variable<String>(kind);
    map['key'] = Variable<String>(key);
    if (!nullToAbsent || bankId != null) {
      map['bank_id'] = Variable<String>(bankId);
    }
    map['version'] = Variable<int>(version);
    map['spec_version'] = Variable<String>(specVersion);
    map['hash'] = Variable<String>(hash);
    map['body'] = Variable<String>(body);
    return map;
  }

  DefinitionVersionsCompanion toCompanion(bool nullToAbsent) {
    return DefinitionVersionsCompanion(
      versionId: Value(versionId),
      familyId: Value(familyId),
      kind: Value(kind),
      key: Value(key),
      bankId: bankId == null && nullToAbsent
          ? const Value.absent()
          : Value(bankId),
      version: Value(version),
      specVersion: Value(specVersion),
      hash: Value(hash),
      body: Value(body),
    );
  }

  factory DefinitionVersionRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DefinitionVersionRow(
      versionId: serializer.fromJson<String>(json['versionId']),
      familyId: serializer.fromJson<String>(json['familyId']),
      kind: serializer.fromJson<String>(json['kind']),
      key: serializer.fromJson<String>(json['key']),
      bankId: serializer.fromJson<String?>(json['bankId']),
      version: serializer.fromJson<int>(json['version']),
      specVersion: serializer.fromJson<String>(json['specVersion']),
      hash: serializer.fromJson<String>(json['hash']),
      body: serializer.fromJson<String>(json['body']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'versionId': serializer.toJson<String>(versionId),
      'familyId': serializer.toJson<String>(familyId),
      'kind': serializer.toJson<String>(kind),
      'key': serializer.toJson<String>(key),
      'bankId': serializer.toJson<String?>(bankId),
      'version': serializer.toJson<int>(version),
      'specVersion': serializer.toJson<String>(specVersion),
      'hash': serializer.toJson<String>(hash),
      'body': serializer.toJson<String>(body),
    };
  }

  DefinitionVersionRow copyWith({
    String? versionId,
    String? familyId,
    String? kind,
    String? key,
    Value<String?> bankId = const Value.absent(),
    int? version,
    String? specVersion,
    String? hash,
    String? body,
  }) => DefinitionVersionRow(
    versionId: versionId ?? this.versionId,
    familyId: familyId ?? this.familyId,
    kind: kind ?? this.kind,
    key: key ?? this.key,
    bankId: bankId.present ? bankId.value : this.bankId,
    version: version ?? this.version,
    specVersion: specVersion ?? this.specVersion,
    hash: hash ?? this.hash,
    body: body ?? this.body,
  );
  DefinitionVersionRow copyWithCompanion(DefinitionVersionsCompanion data) {
    return DefinitionVersionRow(
      versionId: data.versionId.present ? data.versionId.value : this.versionId,
      familyId: data.familyId.present ? data.familyId.value : this.familyId,
      kind: data.kind.present ? data.kind.value : this.kind,
      key: data.key.present ? data.key.value : this.key,
      bankId: data.bankId.present ? data.bankId.value : this.bankId,
      version: data.version.present ? data.version.value : this.version,
      specVersion: data.specVersion.present
          ? data.specVersion.value
          : this.specVersion,
      hash: data.hash.present ? data.hash.value : this.hash,
      body: data.body.present ? data.body.value : this.body,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DefinitionVersionRow(')
          ..write('versionId: $versionId, ')
          ..write('familyId: $familyId, ')
          ..write('kind: $kind, ')
          ..write('key: $key, ')
          ..write('bankId: $bankId, ')
          ..write('version: $version, ')
          ..write('specVersion: $specVersion, ')
          ..write('hash: $hash, ')
          ..write('body: $body')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    versionId,
    familyId,
    kind,
    key,
    bankId,
    version,
    specVersion,
    hash,
    body,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DefinitionVersionRow &&
          other.versionId == this.versionId &&
          other.familyId == this.familyId &&
          other.kind == this.kind &&
          other.key == this.key &&
          other.bankId == this.bankId &&
          other.version == this.version &&
          other.specVersion == this.specVersion &&
          other.hash == this.hash &&
          other.body == this.body);
}

class DefinitionVersionsCompanion
    extends UpdateCompanion<DefinitionVersionRow> {
  final Value<String> versionId;
  final Value<String> familyId;
  final Value<String> kind;
  final Value<String> key;
  final Value<String?> bankId;
  final Value<int> version;
  final Value<String> specVersion;
  final Value<String> hash;
  final Value<String> body;
  final Value<int> rowid;
  const DefinitionVersionsCompanion({
    this.versionId = const Value.absent(),
    this.familyId = const Value.absent(),
    this.kind = const Value.absent(),
    this.key = const Value.absent(),
    this.bankId = const Value.absent(),
    this.version = const Value.absent(),
    this.specVersion = const Value.absent(),
    this.hash = const Value.absent(),
    this.body = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  DefinitionVersionsCompanion.insert({
    required String versionId,
    required String familyId,
    required String kind,
    required String key,
    this.bankId = const Value.absent(),
    required int version,
    required String specVersion,
    required String hash,
    required String body,
    this.rowid = const Value.absent(),
  }) : versionId = Value(versionId),
       familyId = Value(familyId),
       kind = Value(kind),
       key = Value(key),
       version = Value(version),
       specVersion = Value(specVersion),
       hash = Value(hash),
       body = Value(body);
  static Insertable<DefinitionVersionRow> custom({
    Expression<String>? versionId,
    Expression<String>? familyId,
    Expression<String>? kind,
    Expression<String>? key,
    Expression<String>? bankId,
    Expression<int>? version,
    Expression<String>? specVersion,
    Expression<String>? hash,
    Expression<String>? body,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (versionId != null) 'version_id': versionId,
      if (familyId != null) 'family_id': familyId,
      if (kind != null) 'kind': kind,
      if (key != null) 'key': key,
      if (bankId != null) 'bank_id': bankId,
      if (version != null) 'version': version,
      if (specVersion != null) 'spec_version': specVersion,
      if (hash != null) 'hash': hash,
      if (body != null) 'body': body,
      if (rowid != null) 'rowid': rowid,
    });
  }

  DefinitionVersionsCompanion copyWith({
    Value<String>? versionId,
    Value<String>? familyId,
    Value<String>? kind,
    Value<String>? key,
    Value<String?>? bankId,
    Value<int>? version,
    Value<String>? specVersion,
    Value<String>? hash,
    Value<String>? body,
    Value<int>? rowid,
  }) {
    return DefinitionVersionsCompanion(
      versionId: versionId ?? this.versionId,
      familyId: familyId ?? this.familyId,
      kind: kind ?? this.kind,
      key: key ?? this.key,
      bankId: bankId ?? this.bankId,
      version: version ?? this.version,
      specVersion: specVersion ?? this.specVersion,
      hash: hash ?? this.hash,
      body: body ?? this.body,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (versionId.present) {
      map['version_id'] = Variable<String>(versionId.value);
    }
    if (familyId.present) {
      map['family_id'] = Variable<String>(familyId.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (bankId.present) {
      map['bank_id'] = Variable<String>(bankId.value);
    }
    if (version.present) {
      map['version'] = Variable<int>(version.value);
    }
    if (specVersion.present) {
      map['spec_version'] = Variable<String>(specVersion.value);
    }
    if (hash.present) {
      map['hash'] = Variable<String>(hash.value);
    }
    if (body.present) {
      map['body'] = Variable<String>(body.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DefinitionVersionsCompanion(')
          ..write('versionId: $versionId, ')
          ..write('familyId: $familyId, ')
          ..write('kind: $kind, ')
          ..write('key: $key, ')
          ..write('bankId: $bankId, ')
          ..write('version: $version, ')
          ..write('specVersion: $specVersion, ')
          ..write('hash: $hash, ')
          ..write('body: $body, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ActiveDefinitionsTable extends ActiveDefinitions
    with TableInfo<$ActiveDefinitionsTable, ActiveDefinitionRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ActiveDefinitionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _contextMeta = const VerificationMeta(
    'context',
  );
  @override
  late final GeneratedColumn<String> context = GeneratedColumn<String>(
    'context',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _versionIdMeta = const VerificationMeta(
    'versionId',
  );
  @override
  late final GeneratedColumn<String> versionId = GeneratedColumn<String>(
    'version_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [context, kind, key, versionId];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'active_definitions';
  @override
  VerificationContext validateIntegrity(
    Insertable<ActiveDefinitionRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('context')) {
      context.handle(
        _contextMeta,
        this.context.isAcceptableOrUnknown(data['context']!, _contextMeta),
      );
    } else if (isInserting) {
      context.missing(_contextMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('version_id')) {
      context.handle(
        _versionIdMeta,
        versionId.isAcceptableOrUnknown(data['version_id']!, _versionIdMeta),
      );
    } else if (isInserting) {
      context.missing(_versionIdMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {context, kind, key};
  @override
  ActiveDefinitionRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ActiveDefinitionRow(
      context: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}context'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      versionId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}version_id'],
      )!,
    );
  }

  @override
  $ActiveDefinitionsTable createAlias(String alias) {
    return $ActiveDefinitionsTable(attachedDatabase, alias);
  }
}

class ActiveDefinitionRow extends DataClass
    implements Insertable<ActiveDefinitionRow> {
  /// `''` for the default context, otherwise the bank id.
  final String context;
  final String kind;
  final String key;
  final String versionId;
  const ActiveDefinitionRow({
    required this.context,
    required this.kind,
    required this.key,
    required this.versionId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['context'] = Variable<String>(context);
    map['kind'] = Variable<String>(kind);
    map['key'] = Variable<String>(key);
    map['version_id'] = Variable<String>(versionId);
    return map;
  }

  ActiveDefinitionsCompanion toCompanion(bool nullToAbsent) {
    return ActiveDefinitionsCompanion(
      context: Value(context),
      kind: Value(kind),
      key: Value(key),
      versionId: Value(versionId),
    );
  }

  factory ActiveDefinitionRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ActiveDefinitionRow(
      context: serializer.fromJson<String>(json['context']),
      kind: serializer.fromJson<String>(json['kind']),
      key: serializer.fromJson<String>(json['key']),
      versionId: serializer.fromJson<String>(json['versionId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'context': serializer.toJson<String>(context),
      'kind': serializer.toJson<String>(kind),
      'key': serializer.toJson<String>(key),
      'versionId': serializer.toJson<String>(versionId),
    };
  }

  ActiveDefinitionRow copyWith({
    String? context,
    String? kind,
    String? key,
    String? versionId,
  }) => ActiveDefinitionRow(
    context: context ?? this.context,
    kind: kind ?? this.kind,
    key: key ?? this.key,
    versionId: versionId ?? this.versionId,
  );
  ActiveDefinitionRow copyWithCompanion(ActiveDefinitionsCompanion data) {
    return ActiveDefinitionRow(
      context: data.context.present ? data.context.value : this.context,
      kind: data.kind.present ? data.kind.value : this.kind,
      key: data.key.present ? data.key.value : this.key,
      versionId: data.versionId.present ? data.versionId.value : this.versionId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ActiveDefinitionRow(')
          ..write('context: $context, ')
          ..write('kind: $kind, ')
          ..write('key: $key, ')
          ..write('versionId: $versionId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(context, kind, key, versionId);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ActiveDefinitionRow &&
          other.context == this.context &&
          other.kind == this.kind &&
          other.key == this.key &&
          other.versionId == this.versionId);
}

class ActiveDefinitionsCompanion extends UpdateCompanion<ActiveDefinitionRow> {
  final Value<String> context;
  final Value<String> kind;
  final Value<String> key;
  final Value<String> versionId;
  final Value<int> rowid;
  const ActiveDefinitionsCompanion({
    this.context = const Value.absent(),
    this.kind = const Value.absent(),
    this.key = const Value.absent(),
    this.versionId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ActiveDefinitionsCompanion.insert({
    required String context,
    required String kind,
    required String key,
    required String versionId,
    this.rowid = const Value.absent(),
  }) : context = Value(context),
       kind = Value(kind),
       key = Value(key),
       versionId = Value(versionId);
  static Insertable<ActiveDefinitionRow> custom({
    Expression<String>? context,
    Expression<String>? kind,
    Expression<String>? key,
    Expression<String>? versionId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (context != null) 'context': context,
      if (kind != null) 'kind': kind,
      if (key != null) 'key': key,
      if (versionId != null) 'version_id': versionId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ActiveDefinitionsCompanion copyWith({
    Value<String>? context,
    Value<String>? kind,
    Value<String>? key,
    Value<String>? versionId,
    Value<int>? rowid,
  }) {
    return ActiveDefinitionsCompanion(
      context: context ?? this.context,
      kind: kind ?? this.kind,
      key: key ?? this.key,
      versionId: versionId ?? this.versionId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (context.present) {
      map['context'] = Variable<String>(context.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (versionId.present) {
      map['version_id'] = Variable<String>(versionId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ActiveDefinitionsCompanion(')
          ..write('context: $context, ')
          ..write('kind: $kind, ')
          ..write('key: $key, ')
          ..write('versionId: $versionId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $TileCacheIndexTable extends TileCacheIndex
    with TableInfo<$TileCacheIndexTable, TileRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TileCacheIndexTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sourceMeta = const VerificationMeta('source');
  @override
  late final GeneratedColumn<String> source = GeneratedColumn<String>(
    'source',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bytesMeta = const VerificationMeta('bytes');
  @override
  late final GeneratedColumn<int> bytes = GeneratedColumn<int>(
    'bytes',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _fetchedAtMsMeta = const VerificationMeta(
    'fetchedAtMs',
  );
  @override
  late final GeneratedColumn<int> fetchedAtMs = GeneratedColumn<int>(
    'fetched_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lastUsedMsMeta = const VerificationMeta(
    'lastUsedMs',
  );
  @override
  late final GeneratedColumn<int> lastUsedMs = GeneratedColumn<int>(
    'last_used_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    key,
    source,
    bytes,
    fetchedAtMs,
    lastUsedMs,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'tile_cache_index';
  @override
  VerificationContext validateIntegrity(
    Insertable<TileRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('source')) {
      context.handle(
        _sourceMeta,
        source.isAcceptableOrUnknown(data['source']!, _sourceMeta),
      );
    } else if (isInserting) {
      context.missing(_sourceMeta);
    }
    if (data.containsKey('bytes')) {
      context.handle(
        _bytesMeta,
        bytes.isAcceptableOrUnknown(data['bytes']!, _bytesMeta),
      );
    } else if (isInserting) {
      context.missing(_bytesMeta);
    }
    if (data.containsKey('fetched_at_ms')) {
      context.handle(
        _fetchedAtMsMeta,
        fetchedAtMs.isAcceptableOrUnknown(
          data['fetched_at_ms']!,
          _fetchedAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_fetchedAtMsMeta);
    }
    if (data.containsKey('last_used_ms')) {
      context.handle(
        _lastUsedMsMeta,
        lastUsedMs.isAcceptableOrUnknown(
          data['last_used_ms']!,
          _lastUsedMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_lastUsedMsMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  TileRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TileRow(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      source: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}source'],
      )!,
      bytes: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}bytes'],
      )!,
      fetchedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}fetched_at_ms'],
      )!,
      lastUsedMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}last_used_ms'],
      )!,
    );
  }

  @override
  $TileCacheIndexTable createAlias(String alias) {
    return $TileCacheIndexTable(attachedDatabase, alias);
  }
}

class TileRow extends DataClass implements Insertable<TileRow> {
  /// `z/x/y`.
  final String key;

  /// The provider it came from (a hash of `maps.tile_url`), so a new
  /// provider's tiles replace the old ones.
  final String source;
  final int bytes;
  final int fetchedAtMs;
  final int lastUsedMs;
  const TileRow({
    required this.key,
    required this.source,
    required this.bytes,
    required this.fetchedAtMs,
    required this.lastUsedMs,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['source'] = Variable<String>(source);
    map['bytes'] = Variable<int>(bytes);
    map['fetched_at_ms'] = Variable<int>(fetchedAtMs);
    map['last_used_ms'] = Variable<int>(lastUsedMs);
    return map;
  }

  TileCacheIndexCompanion toCompanion(bool nullToAbsent) {
    return TileCacheIndexCompanion(
      key: Value(key),
      source: Value(source),
      bytes: Value(bytes),
      fetchedAtMs: Value(fetchedAtMs),
      lastUsedMs: Value(lastUsedMs),
    );
  }

  factory TileRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TileRow(
      key: serializer.fromJson<String>(json['key']),
      source: serializer.fromJson<String>(json['source']),
      bytes: serializer.fromJson<int>(json['bytes']),
      fetchedAtMs: serializer.fromJson<int>(json['fetchedAtMs']),
      lastUsedMs: serializer.fromJson<int>(json['lastUsedMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'source': serializer.toJson<String>(source),
      'bytes': serializer.toJson<int>(bytes),
      'fetchedAtMs': serializer.toJson<int>(fetchedAtMs),
      'lastUsedMs': serializer.toJson<int>(lastUsedMs),
    };
  }

  TileRow copyWith({
    String? key,
    String? source,
    int? bytes,
    int? fetchedAtMs,
    int? lastUsedMs,
  }) => TileRow(
    key: key ?? this.key,
    source: source ?? this.source,
    bytes: bytes ?? this.bytes,
    fetchedAtMs: fetchedAtMs ?? this.fetchedAtMs,
    lastUsedMs: lastUsedMs ?? this.lastUsedMs,
  );
  TileRow copyWithCompanion(TileCacheIndexCompanion data) {
    return TileRow(
      key: data.key.present ? data.key.value : this.key,
      source: data.source.present ? data.source.value : this.source,
      bytes: data.bytes.present ? data.bytes.value : this.bytes,
      fetchedAtMs: data.fetchedAtMs.present
          ? data.fetchedAtMs.value
          : this.fetchedAtMs,
      lastUsedMs: data.lastUsedMs.present
          ? data.lastUsedMs.value
          : this.lastUsedMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TileRow(')
          ..write('key: $key, ')
          ..write('source: $source, ')
          ..write('bytes: $bytes, ')
          ..write('fetchedAtMs: $fetchedAtMs, ')
          ..write('lastUsedMs: $lastUsedMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, source, bytes, fetchedAtMs, lastUsedMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TileRow &&
          other.key == this.key &&
          other.source == this.source &&
          other.bytes == this.bytes &&
          other.fetchedAtMs == this.fetchedAtMs &&
          other.lastUsedMs == this.lastUsedMs);
}

class TileCacheIndexCompanion extends UpdateCompanion<TileRow> {
  final Value<String> key;
  final Value<String> source;
  final Value<int> bytes;
  final Value<int> fetchedAtMs;
  final Value<int> lastUsedMs;
  final Value<int> rowid;
  const TileCacheIndexCompanion({
    this.key = const Value.absent(),
    this.source = const Value.absent(),
    this.bytes = const Value.absent(),
    this.fetchedAtMs = const Value.absent(),
    this.lastUsedMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  TileCacheIndexCompanion.insert({
    required String key,
    required String source,
    required int bytes,
    required int fetchedAtMs,
    required int lastUsedMs,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       source = Value(source),
       bytes = Value(bytes),
       fetchedAtMs = Value(fetchedAtMs),
       lastUsedMs = Value(lastUsedMs);
  static Insertable<TileRow> custom({
    Expression<String>? key,
    Expression<String>? source,
    Expression<int>? bytes,
    Expression<int>? fetchedAtMs,
    Expression<int>? lastUsedMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (source != null) 'source': source,
      if (bytes != null) 'bytes': bytes,
      if (fetchedAtMs != null) 'fetched_at_ms': fetchedAtMs,
      if (lastUsedMs != null) 'last_used_ms': lastUsedMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  TileCacheIndexCompanion copyWith({
    Value<String>? key,
    Value<String>? source,
    Value<int>? bytes,
    Value<int>? fetchedAtMs,
    Value<int>? lastUsedMs,
    Value<int>? rowid,
  }) {
    return TileCacheIndexCompanion(
      key: key ?? this.key,
      source: source ?? this.source,
      bytes: bytes ?? this.bytes,
      fetchedAtMs: fetchedAtMs ?? this.fetchedAtMs,
      lastUsedMs: lastUsedMs ?? this.lastUsedMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (source.present) {
      map['source'] = Variable<String>(source.value);
    }
    if (bytes.present) {
      map['bytes'] = Variable<int>(bytes.value);
    }
    if (fetchedAtMs.present) {
      map['fetched_at_ms'] = Variable<int>(fetchedAtMs.value);
    }
    if (lastUsedMs.present) {
      map['last_used_ms'] = Variable<int>(lastUsedMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TileCacheIndexCompanion(')
          ..write('key: $key, ')
          ..write('source: $source, ')
          ..write('bytes: $bytes, ')
          ..write('fetchedAtMs: $fetchedAtMs, ')
          ..write('lastUsedMs: $lastUsedMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$PosDatabase extends GeneratedDatabase {
  _$PosDatabase(QueryExecutor e) : super(e);
  $PosDatabaseManager get managers => $PosDatabaseManager(this);
  late final $ModuleMetaTable moduleMeta = $ModuleMetaTable(this);
  late final $SyncStateTable syncState = $SyncStateTable(this);
  late final $OutboxTable outbox = $OutboxTable(this);
  late final $CachedDocumentsTable cachedDocuments = $CachedDocumentsTable(
    this,
  );
  late final $JobsTable jobs = $JobsTable(this);
  late final $ReviewsTable reviews = $ReviewsTable(this);
  late final $DefinitionVersionsTable definitionVersions =
      $DefinitionVersionsTable(this);
  late final $ActiveDefinitionsTable activeDefinitions =
      $ActiveDefinitionsTable(this);
  late final $TileCacheIndexTable tileCacheIndex = $TileCacheIndexTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    moduleMeta,
    syncState,
    outbox,
    cachedDocuments,
    jobs,
    reviews,
    definitionVersions,
    activeDefinitions,
    tileCacheIndex,
  ];
  @override
  DriftDatabaseOptions get options =>
      const DriftDatabaseOptions(storeDateTimeAsText: true);
}

typedef $$ModuleMetaTableCreateCompanionBuilder =
    ModuleMetaCompanion Function({
      required String key,
      required String value,
      required String updatedAt,
      Value<int> rowid,
    });
typedef $$ModuleMetaTableUpdateCompanionBuilder =
    ModuleMetaCompanion Function({
      Value<String> key,
      Value<String> value,
      Value<String> updatedAt,
      Value<int> rowid,
    });

class $$ModuleMetaTableFilterComposer
    extends Composer<_$PosDatabase, $ModuleMetaTable> {
  $$ModuleMetaTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$ModuleMetaTableOrderingComposer
    extends Composer<_$PosDatabase, $ModuleMetaTable> {
  $$ModuleMetaTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$ModuleMetaTableAnnotationComposer
    extends Composer<_$PosDatabase, $ModuleMetaTable> {
  $$ModuleMetaTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);

  GeneratedColumn<String> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$ModuleMetaTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $ModuleMetaTable,
          ModuleMetaRow,
          $$ModuleMetaTableFilterComposer,
          $$ModuleMetaTableOrderingComposer,
          $$ModuleMetaTableAnnotationComposer,
          $$ModuleMetaTableCreateCompanionBuilder,
          $$ModuleMetaTableUpdateCompanionBuilder,
          (
            ModuleMetaRow,
            BaseReferences<_$PosDatabase, $ModuleMetaTable, ModuleMetaRow>,
          ),
          ModuleMetaRow,
          PrefetchHooks Function()
        > {
  $$ModuleMetaTableTableManager(_$PosDatabase db, $ModuleMetaTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ModuleMetaTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ModuleMetaTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ModuleMetaTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<String> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => ModuleMetaCompanion(
                key: key,
                value: value,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String key,
                required String value,
                required String updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => ModuleMetaCompanion.insert(
                key: key,
                value: value,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$ModuleMetaTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $ModuleMetaTable,
      ModuleMetaRow,
      $$ModuleMetaTableFilterComposer,
      $$ModuleMetaTableOrderingComposer,
      $$ModuleMetaTableAnnotationComposer,
      $$ModuleMetaTableCreateCompanionBuilder,
      $$ModuleMetaTableUpdateCompanionBuilder,
      (
        ModuleMetaRow,
        BaseReferences<_$PosDatabase, $ModuleMetaTable, ModuleMetaRow>,
      ),
      ModuleMetaRow,
      PrefetchHooks Function()
    >;
typedef $$SyncStateTableCreateCompanionBuilder =
    SyncStateCompanion Function({
      required String key,
      required String value,
      required String updatedAt,
      Value<int> rowid,
    });
typedef $$SyncStateTableUpdateCompanionBuilder =
    SyncStateCompanion Function({
      Value<String> key,
      Value<String> value,
      Value<String> updatedAt,
      Value<int> rowid,
    });

class $$SyncStateTableFilterComposer
    extends Composer<_$PosDatabase, $SyncStateTable> {
  $$SyncStateTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SyncStateTableOrderingComposer
    extends Composer<_$PosDatabase, $SyncStateTable> {
  $$SyncStateTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SyncStateTableAnnotationComposer
    extends Composer<_$PosDatabase, $SyncStateTable> {
  $$SyncStateTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);

  GeneratedColumn<String> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$SyncStateTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $SyncStateTable,
          SyncStateRow,
          $$SyncStateTableFilterComposer,
          $$SyncStateTableOrderingComposer,
          $$SyncStateTableAnnotationComposer,
          $$SyncStateTableCreateCompanionBuilder,
          $$SyncStateTableUpdateCompanionBuilder,
          (
            SyncStateRow,
            BaseReferences<_$PosDatabase, $SyncStateTable, SyncStateRow>,
          ),
          SyncStateRow,
          PrefetchHooks Function()
        > {
  $$SyncStateTableTableManager(_$PosDatabase db, $SyncStateTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncStateTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncStateTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncStateTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<String> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncStateCompanion(
                key: key,
                value: value,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String key,
                required String value,
                required String updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => SyncStateCompanion.insert(
                key: key,
                value: value,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SyncStateTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $SyncStateTable,
      SyncStateRow,
      $$SyncStateTableFilterComposer,
      $$SyncStateTableOrderingComposer,
      $$SyncStateTableAnnotationComposer,
      $$SyncStateTableCreateCompanionBuilder,
      $$SyncStateTableUpdateCompanionBuilder,
      (
        SyncStateRow,
        BaseReferences<_$PosDatabase, $SyncStateTable, SyncStateRow>,
      ),
      SyncStateRow,
      PrefetchHooks Function()
    >;
typedef $$OutboxTableCreateCompanionBuilder =
    OutboxCompanion Function({
      required String id,
      required int deviceSeq,
      required String type,
      required int typeVersion,
      required int lane,
      Value<String?> userId,
      required String envelope,
      required String payloadHash,
      required int bytes,
      required String state,
      Value<String?> receiptState,
      Value<String?> receipt,
      Value<String?> lastError,
      Value<int> attempts,
      Value<int?> nextAttemptMs,
      Value<String?> entityRef,
      required String createdAt,
      required int createdAtMs,
      required String updatedAt,
      Value<int?> committedAtMs,
      Value<int> rowid,
    });
typedef $$OutboxTableUpdateCompanionBuilder =
    OutboxCompanion Function({
      Value<String> id,
      Value<int> deviceSeq,
      Value<String> type,
      Value<int> typeVersion,
      Value<int> lane,
      Value<String?> userId,
      Value<String> envelope,
      Value<String> payloadHash,
      Value<int> bytes,
      Value<String> state,
      Value<String?> receiptState,
      Value<String?> receipt,
      Value<String?> lastError,
      Value<int> attempts,
      Value<int?> nextAttemptMs,
      Value<String?> entityRef,
      Value<String> createdAt,
      Value<int> createdAtMs,
      Value<String> updatedAt,
      Value<int?> committedAtMs,
      Value<int> rowid,
    });

class $$OutboxTableFilterComposer
    extends Composer<_$PosDatabase, $OutboxTable> {
  $$OutboxTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get deviceSeq => $composableBuilder(
    column: $table.deviceSeq,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get typeVersion => $composableBuilder(
    column: $table.typeVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lane => $composableBuilder(
    column: $table.lane,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get userId => $composableBuilder(
    column: $table.userId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get envelope => $composableBuilder(
    column: $table.envelope,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payloadHash => $composableBuilder(
    column: $table.payloadHash,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get receiptState => $composableBuilder(
    column: $table.receiptState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get receipt => $composableBuilder(
    column: $table.receipt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get nextAttemptMs => $composableBuilder(
    column: $table.nextAttemptMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get entityRef => $composableBuilder(
    column: $table.entityRef,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get committedAtMs => $composableBuilder(
    column: $table.committedAtMs,
    builder: (column) => ColumnFilters(column),
  );
}

class $$OutboxTableOrderingComposer
    extends Composer<_$PosDatabase, $OutboxTable> {
  $$OutboxTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get deviceSeq => $composableBuilder(
    column: $table.deviceSeq,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get typeVersion => $composableBuilder(
    column: $table.typeVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lane => $composableBuilder(
    column: $table.lane,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get userId => $composableBuilder(
    column: $table.userId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get envelope => $composableBuilder(
    column: $table.envelope,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payloadHash => $composableBuilder(
    column: $table.payloadHash,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get receiptState => $composableBuilder(
    column: $table.receiptState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get receipt => $composableBuilder(
    column: $table.receipt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get nextAttemptMs => $composableBuilder(
    column: $table.nextAttemptMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get entityRef => $composableBuilder(
    column: $table.entityRef,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get committedAtMs => $composableBuilder(
    column: $table.committedAtMs,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$OutboxTableAnnotationComposer
    extends Composer<_$PosDatabase, $OutboxTable> {
  $$OutboxTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get deviceSeq =>
      $composableBuilder(column: $table.deviceSeq, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<int> get typeVersion => $composableBuilder(
    column: $table.typeVersion,
    builder: (column) => column,
  );

  GeneratedColumn<int> get lane =>
      $composableBuilder(column: $table.lane, builder: (column) => column);

  GeneratedColumn<String> get userId =>
      $composableBuilder(column: $table.userId, builder: (column) => column);

  GeneratedColumn<String> get envelope =>
      $composableBuilder(column: $table.envelope, builder: (column) => column);

  GeneratedColumn<String> get payloadHash => $composableBuilder(
    column: $table.payloadHash,
    builder: (column) => column,
  );

  GeneratedColumn<int> get bytes =>
      $composableBuilder(column: $table.bytes, builder: (column) => column);

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<String> get receiptState => $composableBuilder(
    column: $table.receiptState,
    builder: (column) => column,
  );

  GeneratedColumn<String> get receipt =>
      $composableBuilder(column: $table.receipt, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<int> get nextAttemptMs => $composableBuilder(
    column: $table.nextAttemptMs,
    builder: (column) => column,
  );

  GeneratedColumn<String> get entityRef =>
      $composableBuilder(column: $table.entityRef, builder: (column) => column);

  GeneratedColumn<String> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<String> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  GeneratedColumn<int> get committedAtMs => $composableBuilder(
    column: $table.committedAtMs,
    builder: (column) => column,
  );
}

class $$OutboxTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $OutboxTable,
          OutboxRow,
          $$OutboxTableFilterComposer,
          $$OutboxTableOrderingComposer,
          $$OutboxTableAnnotationComposer,
          $$OutboxTableCreateCompanionBuilder,
          $$OutboxTableUpdateCompanionBuilder,
          (OutboxRow, BaseReferences<_$PosDatabase, $OutboxTable, OutboxRow>),
          OutboxRow,
          PrefetchHooks Function()
        > {
  $$OutboxTableTableManager(_$PosDatabase db, $OutboxTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OutboxTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OutboxTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OutboxTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<int> deviceSeq = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<int> typeVersion = const Value.absent(),
                Value<int> lane = const Value.absent(),
                Value<String?> userId = const Value.absent(),
                Value<String> envelope = const Value.absent(),
                Value<String> payloadHash = const Value.absent(),
                Value<int> bytes = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<String?> receiptState = const Value.absent(),
                Value<String?> receipt = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<int?> nextAttemptMs = const Value.absent(),
                Value<String?> entityRef = const Value.absent(),
                Value<String> createdAt = const Value.absent(),
                Value<int> createdAtMs = const Value.absent(),
                Value<String> updatedAt = const Value.absent(),
                Value<int?> committedAtMs = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => OutboxCompanion(
                id: id,
                deviceSeq: deviceSeq,
                type: type,
                typeVersion: typeVersion,
                lane: lane,
                userId: userId,
                envelope: envelope,
                payloadHash: payloadHash,
                bytes: bytes,
                state: state,
                receiptState: receiptState,
                receipt: receipt,
                lastError: lastError,
                attempts: attempts,
                nextAttemptMs: nextAttemptMs,
                entityRef: entityRef,
                createdAt: createdAt,
                createdAtMs: createdAtMs,
                updatedAt: updatedAt,
                committedAtMs: committedAtMs,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required int deviceSeq,
                required String type,
                required int typeVersion,
                required int lane,
                Value<String?> userId = const Value.absent(),
                required String envelope,
                required String payloadHash,
                required int bytes,
                required String state,
                Value<String?> receiptState = const Value.absent(),
                Value<String?> receipt = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<int?> nextAttemptMs = const Value.absent(),
                Value<String?> entityRef = const Value.absent(),
                required String createdAt,
                required int createdAtMs,
                required String updatedAt,
                Value<int?> committedAtMs = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => OutboxCompanion.insert(
                id: id,
                deviceSeq: deviceSeq,
                type: type,
                typeVersion: typeVersion,
                lane: lane,
                userId: userId,
                envelope: envelope,
                payloadHash: payloadHash,
                bytes: bytes,
                state: state,
                receiptState: receiptState,
                receipt: receipt,
                lastError: lastError,
                attempts: attempts,
                nextAttemptMs: nextAttemptMs,
                entityRef: entityRef,
                createdAt: createdAt,
                createdAtMs: createdAtMs,
                updatedAt: updatedAt,
                committedAtMs: committedAtMs,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$OutboxTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $OutboxTable,
      OutboxRow,
      $$OutboxTableFilterComposer,
      $$OutboxTableOrderingComposer,
      $$OutboxTableAnnotationComposer,
      $$OutboxTableCreateCompanionBuilder,
      $$OutboxTableUpdateCompanionBuilder,
      (OutboxRow, BaseReferences<_$PosDatabase, $OutboxTable, OutboxRow>),
      OutboxRow,
      PrefetchHooks Function()
    >;
typedef $$CachedDocumentsTableCreateCompanionBuilder =
    CachedDocumentsCompanion Function({
      required String key,
      required String body,
      Value<String?> hash,
      required String updatedAt,
      Value<int> rowid,
    });
typedef $$CachedDocumentsTableUpdateCompanionBuilder =
    CachedDocumentsCompanion Function({
      Value<String> key,
      Value<String> body,
      Value<String?> hash,
      Value<String> updatedAt,
      Value<int> rowid,
    });

class $$CachedDocumentsTableFilterComposer
    extends Composer<_$PosDatabase, $CachedDocumentsTable> {
  $$CachedDocumentsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get hash => $composableBuilder(
    column: $table.hash,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$CachedDocumentsTableOrderingComposer
    extends Composer<_$PosDatabase, $CachedDocumentsTable> {
  $$CachedDocumentsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get hash => $composableBuilder(
    column: $table.hash,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$CachedDocumentsTableAnnotationComposer
    extends Composer<_$PosDatabase, $CachedDocumentsTable> {
  $$CachedDocumentsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get body =>
      $composableBuilder(column: $table.body, builder: (column) => column);

  GeneratedColumn<String> get hash =>
      $composableBuilder(column: $table.hash, builder: (column) => column);

  GeneratedColumn<String> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$CachedDocumentsTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $CachedDocumentsTable,
          CachedDocumentRow,
          $$CachedDocumentsTableFilterComposer,
          $$CachedDocumentsTableOrderingComposer,
          $$CachedDocumentsTableAnnotationComposer,
          $$CachedDocumentsTableCreateCompanionBuilder,
          $$CachedDocumentsTableUpdateCompanionBuilder,
          (
            CachedDocumentRow,
            BaseReferences<
              _$PosDatabase,
              $CachedDocumentsTable,
              CachedDocumentRow
            >,
          ),
          CachedDocumentRow,
          PrefetchHooks Function()
        > {
  $$CachedDocumentsTableTableManager(
    _$PosDatabase db,
    $CachedDocumentsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedDocumentsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedDocumentsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedDocumentsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> body = const Value.absent(),
                Value<String?> hash = const Value.absent(),
                Value<String> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => CachedDocumentsCompanion(
                key: key,
                body: body,
                hash: hash,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String key,
                required String body,
                Value<String?> hash = const Value.absent(),
                required String updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => CachedDocumentsCompanion.insert(
                key: key,
                body: body,
                hash: hash,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$CachedDocumentsTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $CachedDocumentsTable,
      CachedDocumentRow,
      $$CachedDocumentsTableFilterComposer,
      $$CachedDocumentsTableOrderingComposer,
      $$CachedDocumentsTableAnnotationComposer,
      $$CachedDocumentsTableCreateCompanionBuilder,
      $$CachedDocumentsTableUpdateCompanionBuilder,
      (
        CachedDocumentRow,
        BaseReferences<_$PosDatabase, $CachedDocumentsTable, CachedDocumentRow>,
      ),
      CachedDocumentRow,
      PrefetchHooks Function()
    >;
typedef $$JobsTableCreateCompanionBuilder =
    JobsCompanion Function({
      required String id,
      required String reference,
      required String status,
      required String updatedAt,
      Value<bool> assignedToMe,
      Value<String?> bankId,
      Value<int?> scheduledStartMs,
      required String body,
      Value<int> rowid,
    });
typedef $$JobsTableUpdateCompanionBuilder =
    JobsCompanion Function({
      Value<String> id,
      Value<String> reference,
      Value<String> status,
      Value<String> updatedAt,
      Value<bool> assignedToMe,
      Value<String?> bankId,
      Value<int?> scheduledStartMs,
      Value<String> body,
      Value<int> rowid,
    });

class $$JobsTableFilterComposer extends Composer<_$PosDatabase, $JobsTable> {
  $$JobsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reference => $composableBuilder(
    column: $table.reference,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get assignedToMe => $composableBuilder(
    column: $table.assignedToMe,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get bankId => $composableBuilder(
    column: $table.bankId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get scheduledStartMs => $composableBuilder(
    column: $table.scheduledStartMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnFilters(column),
  );
}

class $$JobsTableOrderingComposer extends Composer<_$PosDatabase, $JobsTable> {
  $$JobsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reference => $composableBuilder(
    column: $table.reference,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get assignedToMe => $composableBuilder(
    column: $table.assignedToMe,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get bankId => $composableBuilder(
    column: $table.bankId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get scheduledStartMs => $composableBuilder(
    column: $table.scheduledStartMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$JobsTableAnnotationComposer
    extends Composer<_$PosDatabase, $JobsTable> {
  $$JobsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get reference =>
      $composableBuilder(column: $table.reference, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  GeneratedColumn<bool> get assignedToMe => $composableBuilder(
    column: $table.assignedToMe,
    builder: (column) => column,
  );

  GeneratedColumn<String> get bankId =>
      $composableBuilder(column: $table.bankId, builder: (column) => column);

  GeneratedColumn<int> get scheduledStartMs => $composableBuilder(
    column: $table.scheduledStartMs,
    builder: (column) => column,
  );

  GeneratedColumn<String> get body =>
      $composableBuilder(column: $table.body, builder: (column) => column);
}

class $$JobsTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $JobsTable,
          JobRow,
          $$JobsTableFilterComposer,
          $$JobsTableOrderingComposer,
          $$JobsTableAnnotationComposer,
          $$JobsTableCreateCompanionBuilder,
          $$JobsTableUpdateCompanionBuilder,
          (JobRow, BaseReferences<_$PosDatabase, $JobsTable, JobRow>),
          JobRow,
          PrefetchHooks Function()
        > {
  $$JobsTableTableManager(_$PosDatabase db, $JobsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$JobsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$JobsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$JobsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> reference = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<String> updatedAt = const Value.absent(),
                Value<bool> assignedToMe = const Value.absent(),
                Value<String?> bankId = const Value.absent(),
                Value<int?> scheduledStartMs = const Value.absent(),
                Value<String> body = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => JobsCompanion(
                id: id,
                reference: reference,
                status: status,
                updatedAt: updatedAt,
                assignedToMe: assignedToMe,
                bankId: bankId,
                scheduledStartMs: scheduledStartMs,
                body: body,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String reference,
                required String status,
                required String updatedAt,
                Value<bool> assignedToMe = const Value.absent(),
                Value<String?> bankId = const Value.absent(),
                Value<int?> scheduledStartMs = const Value.absent(),
                required String body,
                Value<int> rowid = const Value.absent(),
              }) => JobsCompanion.insert(
                id: id,
                reference: reference,
                status: status,
                updatedAt: updatedAt,
                assignedToMe: assignedToMe,
                bankId: bankId,
                scheduledStartMs: scheduledStartMs,
                body: body,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$JobsTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $JobsTable,
      JobRow,
      $$JobsTableFilterComposer,
      $$JobsTableOrderingComposer,
      $$JobsTableAnnotationComposer,
      $$JobsTableCreateCompanionBuilder,
      $$JobsTableUpdateCompanionBuilder,
      (JobRow, BaseReferences<_$PosDatabase, $JobsTable, JobRow>),
      JobRow,
      PrefetchHooks Function()
    >;
typedef $$ReviewsTableCreateCompanionBuilder =
    ReviewsCompanion Function({
      required String id,
      required String jobId,
      required String inspectionId,
      required int attempt,
      required String decision,
      required String decidedAt,
      required String body,
      Value<int> rowid,
    });
typedef $$ReviewsTableUpdateCompanionBuilder =
    ReviewsCompanion Function({
      Value<String> id,
      Value<String> jobId,
      Value<String> inspectionId,
      Value<int> attempt,
      Value<String> decision,
      Value<String> decidedAt,
      Value<String> body,
      Value<int> rowid,
    });

class $$ReviewsTableFilterComposer
    extends Composer<_$PosDatabase, $ReviewsTable> {
  $$ReviewsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get jobId => $composableBuilder(
    column: $table.jobId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get inspectionId => $composableBuilder(
    column: $table.inspectionId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempt => $composableBuilder(
    column: $table.attempt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get decision => $composableBuilder(
    column: $table.decision,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get decidedAt => $composableBuilder(
    column: $table.decidedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnFilters(column),
  );
}

class $$ReviewsTableOrderingComposer
    extends Composer<_$PosDatabase, $ReviewsTable> {
  $$ReviewsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get jobId => $composableBuilder(
    column: $table.jobId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get inspectionId => $composableBuilder(
    column: $table.inspectionId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempt => $composableBuilder(
    column: $table.attempt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get decision => $composableBuilder(
    column: $table.decision,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get decidedAt => $composableBuilder(
    column: $table.decidedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$ReviewsTableAnnotationComposer
    extends Composer<_$PosDatabase, $ReviewsTable> {
  $$ReviewsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get jobId =>
      $composableBuilder(column: $table.jobId, builder: (column) => column);

  GeneratedColumn<String> get inspectionId => $composableBuilder(
    column: $table.inspectionId,
    builder: (column) => column,
  );

  GeneratedColumn<int> get attempt =>
      $composableBuilder(column: $table.attempt, builder: (column) => column);

  GeneratedColumn<String> get decision =>
      $composableBuilder(column: $table.decision, builder: (column) => column);

  GeneratedColumn<String> get decidedAt =>
      $composableBuilder(column: $table.decidedAt, builder: (column) => column);

  GeneratedColumn<String> get body =>
      $composableBuilder(column: $table.body, builder: (column) => column);
}

class $$ReviewsTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $ReviewsTable,
          ReviewRow,
          $$ReviewsTableFilterComposer,
          $$ReviewsTableOrderingComposer,
          $$ReviewsTableAnnotationComposer,
          $$ReviewsTableCreateCompanionBuilder,
          $$ReviewsTableUpdateCompanionBuilder,
          (ReviewRow, BaseReferences<_$PosDatabase, $ReviewsTable, ReviewRow>),
          ReviewRow,
          PrefetchHooks Function()
        > {
  $$ReviewsTableTableManager(_$PosDatabase db, $ReviewsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ReviewsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ReviewsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ReviewsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> jobId = const Value.absent(),
                Value<String> inspectionId = const Value.absent(),
                Value<int> attempt = const Value.absent(),
                Value<String> decision = const Value.absent(),
                Value<String> decidedAt = const Value.absent(),
                Value<String> body = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => ReviewsCompanion(
                id: id,
                jobId: jobId,
                inspectionId: inspectionId,
                attempt: attempt,
                decision: decision,
                decidedAt: decidedAt,
                body: body,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String jobId,
                required String inspectionId,
                required int attempt,
                required String decision,
                required String decidedAt,
                required String body,
                Value<int> rowid = const Value.absent(),
              }) => ReviewsCompanion.insert(
                id: id,
                jobId: jobId,
                inspectionId: inspectionId,
                attempt: attempt,
                decision: decision,
                decidedAt: decidedAt,
                body: body,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$ReviewsTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $ReviewsTable,
      ReviewRow,
      $$ReviewsTableFilterComposer,
      $$ReviewsTableOrderingComposer,
      $$ReviewsTableAnnotationComposer,
      $$ReviewsTableCreateCompanionBuilder,
      $$ReviewsTableUpdateCompanionBuilder,
      (ReviewRow, BaseReferences<_$PosDatabase, $ReviewsTable, ReviewRow>),
      ReviewRow,
      PrefetchHooks Function()
    >;
typedef $$DefinitionVersionsTableCreateCompanionBuilder =
    DefinitionVersionsCompanion Function({
      required String versionId,
      required String familyId,
      required String kind,
      required String key,
      Value<String?> bankId,
      required int version,
      required String specVersion,
      required String hash,
      required String body,
      Value<int> rowid,
    });
typedef $$DefinitionVersionsTableUpdateCompanionBuilder =
    DefinitionVersionsCompanion Function({
      Value<String> versionId,
      Value<String> familyId,
      Value<String> kind,
      Value<String> key,
      Value<String?> bankId,
      Value<int> version,
      Value<String> specVersion,
      Value<String> hash,
      Value<String> body,
      Value<int> rowid,
    });

class $$DefinitionVersionsTableFilterComposer
    extends Composer<_$PosDatabase, $DefinitionVersionsTable> {
  $$DefinitionVersionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get versionId => $composableBuilder(
    column: $table.versionId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get familyId => $composableBuilder(
    column: $table.familyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get bankId => $composableBuilder(
    column: $table.bankId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get version => $composableBuilder(
    column: $table.version,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get specVersion => $composableBuilder(
    column: $table.specVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get hash => $composableBuilder(
    column: $table.hash,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnFilters(column),
  );
}

class $$DefinitionVersionsTableOrderingComposer
    extends Composer<_$PosDatabase, $DefinitionVersionsTable> {
  $$DefinitionVersionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get versionId => $composableBuilder(
    column: $table.versionId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get familyId => $composableBuilder(
    column: $table.familyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get bankId => $composableBuilder(
    column: $table.bankId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get version => $composableBuilder(
    column: $table.version,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get specVersion => $composableBuilder(
    column: $table.specVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get hash => $composableBuilder(
    column: $table.hash,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get body => $composableBuilder(
    column: $table.body,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$DefinitionVersionsTableAnnotationComposer
    extends Composer<_$PosDatabase, $DefinitionVersionsTable> {
  $$DefinitionVersionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get versionId =>
      $composableBuilder(column: $table.versionId, builder: (column) => column);

  GeneratedColumn<String> get familyId =>
      $composableBuilder(column: $table.familyId, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get bankId =>
      $composableBuilder(column: $table.bankId, builder: (column) => column);

  GeneratedColumn<int> get version =>
      $composableBuilder(column: $table.version, builder: (column) => column);

  GeneratedColumn<String> get specVersion => $composableBuilder(
    column: $table.specVersion,
    builder: (column) => column,
  );

  GeneratedColumn<String> get hash =>
      $composableBuilder(column: $table.hash, builder: (column) => column);

  GeneratedColumn<String> get body =>
      $composableBuilder(column: $table.body, builder: (column) => column);
}

class $$DefinitionVersionsTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $DefinitionVersionsTable,
          DefinitionVersionRow,
          $$DefinitionVersionsTableFilterComposer,
          $$DefinitionVersionsTableOrderingComposer,
          $$DefinitionVersionsTableAnnotationComposer,
          $$DefinitionVersionsTableCreateCompanionBuilder,
          $$DefinitionVersionsTableUpdateCompanionBuilder,
          (
            DefinitionVersionRow,
            BaseReferences<
              _$PosDatabase,
              $DefinitionVersionsTable,
              DefinitionVersionRow
            >,
          ),
          DefinitionVersionRow,
          PrefetchHooks Function()
        > {
  $$DefinitionVersionsTableTableManager(
    _$PosDatabase db,
    $DefinitionVersionsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$DefinitionVersionsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$DefinitionVersionsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$DefinitionVersionsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> versionId = const Value.absent(),
                Value<String> familyId = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> key = const Value.absent(),
                Value<String?> bankId = const Value.absent(),
                Value<int> version = const Value.absent(),
                Value<String> specVersion = const Value.absent(),
                Value<String> hash = const Value.absent(),
                Value<String> body = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => DefinitionVersionsCompanion(
                versionId: versionId,
                familyId: familyId,
                kind: kind,
                key: key,
                bankId: bankId,
                version: version,
                specVersion: specVersion,
                hash: hash,
                body: body,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String versionId,
                required String familyId,
                required String kind,
                required String key,
                Value<String?> bankId = const Value.absent(),
                required int version,
                required String specVersion,
                required String hash,
                required String body,
                Value<int> rowid = const Value.absent(),
              }) => DefinitionVersionsCompanion.insert(
                versionId: versionId,
                familyId: familyId,
                kind: kind,
                key: key,
                bankId: bankId,
                version: version,
                specVersion: specVersion,
                hash: hash,
                body: body,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$DefinitionVersionsTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $DefinitionVersionsTable,
      DefinitionVersionRow,
      $$DefinitionVersionsTableFilterComposer,
      $$DefinitionVersionsTableOrderingComposer,
      $$DefinitionVersionsTableAnnotationComposer,
      $$DefinitionVersionsTableCreateCompanionBuilder,
      $$DefinitionVersionsTableUpdateCompanionBuilder,
      (
        DefinitionVersionRow,
        BaseReferences<
          _$PosDatabase,
          $DefinitionVersionsTable,
          DefinitionVersionRow
        >,
      ),
      DefinitionVersionRow,
      PrefetchHooks Function()
    >;
typedef $$ActiveDefinitionsTableCreateCompanionBuilder =
    ActiveDefinitionsCompanion Function({
      required String context,
      required String kind,
      required String key,
      required String versionId,
      Value<int> rowid,
    });
typedef $$ActiveDefinitionsTableUpdateCompanionBuilder =
    ActiveDefinitionsCompanion Function({
      Value<String> context,
      Value<String> kind,
      Value<String> key,
      Value<String> versionId,
      Value<int> rowid,
    });

class $$ActiveDefinitionsTableFilterComposer
    extends Composer<_$PosDatabase, $ActiveDefinitionsTable> {
  $$ActiveDefinitionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get context => $composableBuilder(
    column: $table.context,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get versionId => $composableBuilder(
    column: $table.versionId,
    builder: (column) => ColumnFilters(column),
  );
}

class $$ActiveDefinitionsTableOrderingComposer
    extends Composer<_$PosDatabase, $ActiveDefinitionsTable> {
  $$ActiveDefinitionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get context => $composableBuilder(
    column: $table.context,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get versionId => $composableBuilder(
    column: $table.versionId,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$ActiveDefinitionsTableAnnotationComposer
    extends Composer<_$PosDatabase, $ActiveDefinitionsTable> {
  $$ActiveDefinitionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get context =>
      $composableBuilder(column: $table.context, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get versionId =>
      $composableBuilder(column: $table.versionId, builder: (column) => column);
}

class $$ActiveDefinitionsTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $ActiveDefinitionsTable,
          ActiveDefinitionRow,
          $$ActiveDefinitionsTableFilterComposer,
          $$ActiveDefinitionsTableOrderingComposer,
          $$ActiveDefinitionsTableAnnotationComposer,
          $$ActiveDefinitionsTableCreateCompanionBuilder,
          $$ActiveDefinitionsTableUpdateCompanionBuilder,
          (
            ActiveDefinitionRow,
            BaseReferences<
              _$PosDatabase,
              $ActiveDefinitionsTable,
              ActiveDefinitionRow
            >,
          ),
          ActiveDefinitionRow,
          PrefetchHooks Function()
        > {
  $$ActiveDefinitionsTableTableManager(
    _$PosDatabase db,
    $ActiveDefinitionsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ActiveDefinitionsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ActiveDefinitionsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ActiveDefinitionsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> context = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> key = const Value.absent(),
                Value<String> versionId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => ActiveDefinitionsCompanion(
                context: context,
                kind: kind,
                key: key,
                versionId: versionId,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String context,
                required String kind,
                required String key,
                required String versionId,
                Value<int> rowid = const Value.absent(),
              }) => ActiveDefinitionsCompanion.insert(
                context: context,
                kind: kind,
                key: key,
                versionId: versionId,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$ActiveDefinitionsTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $ActiveDefinitionsTable,
      ActiveDefinitionRow,
      $$ActiveDefinitionsTableFilterComposer,
      $$ActiveDefinitionsTableOrderingComposer,
      $$ActiveDefinitionsTableAnnotationComposer,
      $$ActiveDefinitionsTableCreateCompanionBuilder,
      $$ActiveDefinitionsTableUpdateCompanionBuilder,
      (
        ActiveDefinitionRow,
        BaseReferences<
          _$PosDatabase,
          $ActiveDefinitionsTable,
          ActiveDefinitionRow
        >,
      ),
      ActiveDefinitionRow,
      PrefetchHooks Function()
    >;
typedef $$TileCacheIndexTableCreateCompanionBuilder =
    TileCacheIndexCompanion Function({
      required String key,
      required String source,
      required int bytes,
      required int fetchedAtMs,
      required int lastUsedMs,
      Value<int> rowid,
    });
typedef $$TileCacheIndexTableUpdateCompanionBuilder =
    TileCacheIndexCompanion Function({
      Value<String> key,
      Value<String> source,
      Value<int> bytes,
      Value<int> fetchedAtMs,
      Value<int> lastUsedMs,
      Value<int> rowid,
    });

class $$TileCacheIndexTableFilterComposer
    extends Composer<_$PosDatabase, $TileCacheIndexTable> {
  $$TileCacheIndexTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get source => $composableBuilder(
    column: $table.source,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get fetchedAtMs => $composableBuilder(
    column: $table.fetchedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lastUsedMs => $composableBuilder(
    column: $table.lastUsedMs,
    builder: (column) => ColumnFilters(column),
  );
}

class $$TileCacheIndexTableOrderingComposer
    extends Composer<_$PosDatabase, $TileCacheIndexTable> {
  $$TileCacheIndexTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get source => $composableBuilder(
    column: $table.source,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get fetchedAtMs => $composableBuilder(
    column: $table.fetchedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lastUsedMs => $composableBuilder(
    column: $table.lastUsedMs,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$TileCacheIndexTableAnnotationComposer
    extends Composer<_$PosDatabase, $TileCacheIndexTable> {
  $$TileCacheIndexTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get source =>
      $composableBuilder(column: $table.source, builder: (column) => column);

  GeneratedColumn<int> get bytes =>
      $composableBuilder(column: $table.bytes, builder: (column) => column);

  GeneratedColumn<int> get fetchedAtMs => $composableBuilder(
    column: $table.fetchedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get lastUsedMs => $composableBuilder(
    column: $table.lastUsedMs,
    builder: (column) => column,
  );
}

class $$TileCacheIndexTableTableManager
    extends
        RootTableManager<
          _$PosDatabase,
          $TileCacheIndexTable,
          TileRow,
          $$TileCacheIndexTableFilterComposer,
          $$TileCacheIndexTableOrderingComposer,
          $$TileCacheIndexTableAnnotationComposer,
          $$TileCacheIndexTableCreateCompanionBuilder,
          $$TileCacheIndexTableUpdateCompanionBuilder,
          (
            TileRow,
            BaseReferences<_$PosDatabase, $TileCacheIndexTable, TileRow>,
          ),
          TileRow,
          PrefetchHooks Function()
        > {
  $$TileCacheIndexTableTableManager(
    _$PosDatabase db,
    $TileCacheIndexTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$TileCacheIndexTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$TileCacheIndexTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$TileCacheIndexTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> source = const Value.absent(),
                Value<int> bytes = const Value.absent(),
                Value<int> fetchedAtMs = const Value.absent(),
                Value<int> lastUsedMs = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => TileCacheIndexCompanion(
                key: key,
                source: source,
                bytes: bytes,
                fetchedAtMs: fetchedAtMs,
                lastUsedMs: lastUsedMs,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String key,
                required String source,
                required int bytes,
                required int fetchedAtMs,
                required int lastUsedMs,
                Value<int> rowid = const Value.absent(),
              }) => TileCacheIndexCompanion.insert(
                key: key,
                source: source,
                bytes: bytes,
                fetchedAtMs: fetchedAtMs,
                lastUsedMs: lastUsedMs,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$TileCacheIndexTableProcessedTableManager =
    ProcessedTableManager<
      _$PosDatabase,
      $TileCacheIndexTable,
      TileRow,
      $$TileCacheIndexTableFilterComposer,
      $$TileCacheIndexTableOrderingComposer,
      $$TileCacheIndexTableAnnotationComposer,
      $$TileCacheIndexTableCreateCompanionBuilder,
      $$TileCacheIndexTableUpdateCompanionBuilder,
      (TileRow, BaseReferences<_$PosDatabase, $TileCacheIndexTable, TileRow>),
      TileRow,
      PrefetchHooks Function()
    >;

class $PosDatabaseManager {
  final _$PosDatabase _db;
  $PosDatabaseManager(this._db);
  $$ModuleMetaTableTableManager get moduleMeta =>
      $$ModuleMetaTableTableManager(_db, _db.moduleMeta);
  $$SyncStateTableTableManager get syncState =>
      $$SyncStateTableTableManager(_db, _db.syncState);
  $$OutboxTableTableManager get outbox =>
      $$OutboxTableTableManager(_db, _db.outbox);
  $$CachedDocumentsTableTableManager get cachedDocuments =>
      $$CachedDocumentsTableTableManager(_db, _db.cachedDocuments);
  $$JobsTableTableManager get jobs => $$JobsTableTableManager(_db, _db.jobs);
  $$ReviewsTableTableManager get reviews =>
      $$ReviewsTableTableManager(_db, _db.reviews);
  $$DefinitionVersionsTableTableManager get definitionVersions =>
      $$DefinitionVersionsTableTableManager(_db, _db.definitionVersions);
  $$ActiveDefinitionsTableTableManager get activeDefinitions =>
      $$ActiveDefinitionsTableTableManager(_db, _db.activeDefinitions);
  $$TileCacheIndexTableTableManager get tileCacheIndex =>
      $$TileCacheIndexTableTableManager(_db, _db.tileCacheIndex);
}
