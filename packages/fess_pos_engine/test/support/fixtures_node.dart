import 'dart:js_interop';

@JS('process')
external _Process get _process;

extension type _Process._(JSObject _) implements JSObject {
  external _Fs getBuiltinModule(String name);
}

extension type _Fs._(JSObject _) implements JSObject {
  external JSString readFileSync(String path, String encoding);
  external JSArray<JSString> readdirSync(String path);
}

_Fs get _fs => _process.getBuiltinModule('fs');

String readText(String path) => _fs.readFileSync(path, 'utf8').toDart;

List<String> listJsonFiles(String dir) =>
    _fs
        .readdirSync(dir)
        .toDart
        .map((s) => s.toDart)
        .where((n) => n.endsWith('.json'))
        .toList()
      ..sort();
