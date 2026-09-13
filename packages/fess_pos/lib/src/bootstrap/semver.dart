/// Minimal semver ordering for `min_module_version.*` checks (docs/13 §4).
library;

final RegExp _semver = RegExp(
  r'^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$',
);

bool isSemver(String v) => _semver.hasMatch(v);

/// Negative, zero or positive as [a] is below, equal to or above [b].
/// Build metadata is ignored; a pre-release sorts below its release.
/// Throws [FormatException] for anything that isn't semver.
int compareSemver(String a, String b) {
  final ma = _semver.firstMatch(a);
  final mb = _semver.firstMatch(b);
  if (ma == null) throw FormatException('not semver', a);
  if (mb == null) throw FormatException('not semver', b);
  for (var i = 1; i <= 3; i++) {
    final d = int.parse(ma.group(i)!).compareTo(int.parse(mb.group(i)!));
    if (d != 0) return d;
  }
  final pa = ma.group(4);
  final pb = mb.group(4);
  if (pa == null && pb == null) return 0;
  if (pa == null) return 1;
  if (pb == null) return -1;
  return _comparePreRelease(pa, pb);
}

int _comparePreRelease(String a, String b) {
  final xs = a.split('.');
  final ys = b.split('.');
  for (var i = 0; i < xs.length && i < ys.length; i++) {
    final x = int.tryParse(xs[i]);
    final y = int.tryParse(ys[i]);
    final int d;
    if (x != null && y != null) {
      d = x.compareTo(y);
    } else if (x != null) {
      d = -1; // numeric identifiers sort below alphanumeric ones
    } else if (y != null) {
      d = 1;
    } else {
      d = xs[i].compareTo(ys[i]);
    }
    if (d != 0) return d;
  }
  return xs.length.compareTo(ys.length);
}
