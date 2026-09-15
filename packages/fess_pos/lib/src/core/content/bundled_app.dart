import 'package:fess_pos/src/contract/capabilities.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';

/// The bundled `app` definition (docs/04 §3.6, "safe fallback"): it runs
/// until the server's arrives, and whenever the one in force can't be
/// used. The home page lists the agent's jobs, a job opens its page and
/// the card opens from the home page. It's data, like the server's.
abstract final class BundledApp {
  static const Map<String, Object?> definition = {
    'spec_version': '1.0',
    'kind': 'app',
    'family': 'agent_app',
    'version': 0,
    'home': 'home',
    'navigation': {'style': 'none', 'items': <Object?>[]},
    'pages': {
      'home': {'type': 'view_page', 'view': 'home'},
      'job_detail': {'type': 'view_page', 'view': 'job_detail'},
      'agent_card': {'type': 'view_page', 'view': 'agent_card'},
    },
  };

  static final AppSpec spec = AppSpec.parse(
    definition,
    pageTypes: supportedPageTypes.keys.toSet(),
  );
}
