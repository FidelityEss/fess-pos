// The module's preview build (T3-08), which the admin's definitions studio
// embeds (T3-12). The studio's origins are the only pages it listens to:
//
//   flutter build web --target lib/preview.dart \
//     --dart-define=POS_PREVIEW_ORIGINS=https://admin.example
//
// Without the define it listens only to its own origin.
import 'package:fess_pos/fess_pos.dart';
import 'package:flutter/material.dart';

const String _origins = String.fromEnvironment('POS_PREVIEW_ORIGINS');

void main() => runApp(
  MaterialApp(
    title: 'POS preview',
    debugShowCheckedModeBanner: false,
    home: PosModule.previewEntryPoint(
      allowedOrigins: [
        for (final o in _origins.split(','))
          if (o.trim().isNotEmpty) o.trim(),
      ],
    ),
  ),
);
