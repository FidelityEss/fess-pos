// The local store's web worker (T3-24). A web host serves the compiled
// file as `drift_worker.js` next to its `index.html`, with `sqlite3.wasm`
// from the sqlite3 release this module pins (HOST_INTEGRATION.md §4).
// Rebuild it after a drift upgrade, from packages/fess_pos:
//
//   dart compile js -O4 --no-source-maps tool/drift_worker.dart \
//     -o example/web/drift_worker.js && rm example/web/drift_worker.js.deps
import 'package:drift/wasm.dart';

void main() => WasmDatabase.workerMainForOpen();
