#
# The fess_pos module's iOS pod. It carries link settings only (no code).
#
# The module's local store is SQLCipher (sqlcipher_flutter_libs links the
# SQLCipher pod). When the host app also links the system SQLite — FESS does,
# through sqflite and Firebase — the system library satisfies every SQLite
# symbol first, so SQLCipher is never linked and the module would have no
# encryption (it then refuses to store anything: LOCAL_STORE_NOT_ENCRYPTED).
#
# `-u _sqlcipher_codec_pragma` makes the linker require a function only
# SQLCipher defines. It sits in the same object file as SQLCipher's SQLite,
# so the whole of SQLCipher is linked. (Apple's libsqlite3 also exports
# sqlite3_key and sqlite3_rekey, so those can't be used for this.) If a
# future SQLCipher renamed the function, the link would fail loudly, and the
# module's start-up check (PRAGMA cipher_version) would still refuse to store
# anything unencrypted. CocoaPods applies this to the host target by itself:
# nothing changes in the host's project (planning pack D-55, T1-41).
#
Pod::Spec.new do |s|
  s.name             = 'fess_pos'
  s.version          = '0.1.0'
  s.summary          = 'FESS POS module: iOS link settings for its encrypted local store.'
  s.description      = 'Makes sure SQLCipher is linked into the app even when the host also links the system SQLite.'
  s.homepage         = 'https://github.com/FidelityEss/fess-pos'
  s.license          = { :type => 'Proprietary', :text => 'Fidelity Services Group. All rights reserved.' }
  s.author           = { 'Fidelity ESS' => 'https://github.com/FidelityEss' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform         = :ios, '12.0'
  s.user_target_xcconfig = { 'OTHER_LDFLAGS' => '$(inherited) -Wl,-u,_sqlcipher_codec_pragma' }
end
