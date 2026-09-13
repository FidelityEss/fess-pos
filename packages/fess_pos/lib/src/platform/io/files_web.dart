Future<bool> fileExists(String path) async => false;

Future<void> deleteFileIfExists(String path) async {}

Future<void> ensureDirectory(String path) =>
    Future.error(UnsupportedError('there is no file system on the web'));
