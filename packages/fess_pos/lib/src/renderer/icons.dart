import 'package:flutter/material.dart';

/// The icons a definition can name (navigation items, action buttons,
/// outcome pages): a fixed set, so every name means the same on every
/// build. An unknown name draws no icon.
const Map<String, IconData> posIcons = {
  'home': Icons.home_outlined,
  'list': Icons.list_alt_outlined,
  'badge': Icons.badge_outlined,
  'add': Icons.add,
  'assignment': Icons.assignment_outlined,
  'form': Icons.edit_note_outlined,
  'map': Icons.map_outlined,
  'location': Icons.place_outlined,
  'sync': Icons.sync,
  'refresh': Icons.refresh,
  'search': Icons.search,
  'info': Icons.info_outline,
  'help': Icons.help_outline,
  'warning': Icons.warning_amber_outlined,
  'error': Icons.error_outline,
  'check_circle': Icons.check_circle_outline,
  'cloud_upload': Icons.cloud_upload_outlined,
  'camera': Icons.photo_camera_outlined,
  'person': Icons.person_outline,
  'phone': Icons.phone_outlined,
  'sms': Icons.sms_outlined,
  'email': Icons.email_outlined,
  'schedule': Icons.schedule,
  'calendar': Icons.calendar_today_outlined,
  'store': Icons.storefront_outlined,
  'receipt': Icons.receipt_long_outlined,
  'history': Icons.history,
  'notifications': Icons.notifications_none,
  'flag': Icons.flag_outlined,
  'settings': Icons.settings_outlined,
};

/// The icon named [name], or null.
IconData? posIcon(Object? name) => name is String ? posIcons[name] : null;
