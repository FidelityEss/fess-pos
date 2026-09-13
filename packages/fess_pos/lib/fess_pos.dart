/// FESS POS merchant site verification — the module's public API
/// (docs/03 §3). This is the only library a host imports; nothing in
/// `src/` is part of the contract.
library;

export 'src/contract/access.dart';
export 'src/contract/bootstrap.dart';
export 'src/contract/errors.dart';
export 'src/contract/events.dart';
export 'src/contract/host_config.dart';
export 'src/contract/identity.dart';
export 'src/contract/module_info.dart';
export 'src/contract/theme.dart';
export 'src/pos_module.dart';
