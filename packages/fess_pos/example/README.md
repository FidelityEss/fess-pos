# fess_pos_example — harness host

A minimal host app for the `fess_pos` module, for development and CI only (`docs/03` §2). It does what a real host
does: `PosModule.initialize` at startup, then push `PosModule.entryPoint()`.

```bash
flutter run \
  --dart-define=POS_API_URL=https://<ref>.supabase.co/functions/v1/api \
  --dart-define=POS_PUBLISHABLE_KEY=sb_publishable_…
flutter build web          # the module must keep building for web (docs/13 §8)
flutter test
```

Point it at **fess-pos-qa** only. Nothing is compiled in; without the defines the module starts against an address that
doesn't exist.

Still to come (T1-24): the stand-in identity issuer for sign-in on QA, and Android/iOS/web runs in CI.
