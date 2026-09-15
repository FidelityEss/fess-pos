import 'package:fess_pos/src/domain/navigation/pos_link.dart';
import 'package:flutter_test/flutter_test.dart';

const String _job = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

void main() {
  test('links under /pos on either FESS scheme', () {
    expect(
      PosLink.parse(Uri.parse('fidelity://fess.com/pos/job/$_job')),
      const JobLink(_job),
    );
    expect(
      PosLink.parse(Uri.parse('fess://pos/job/$_job')),
      const JobLink(_job),
    );
    expect(PosLink.parse(Uri.parse('fess://pos/card')), const CardLink());
    expect(
      PosLink.parse(Uri.parse('fidelity://fess.com/pos')),
      const HomeLink(),
    );
    expect(PosLink.parse(Uri.parse('fess://pos')), const HomeLink());
  });

  test('a preview link carries its token (T3-08)', () {
    const token = 'pv_0123456789abcdefABCDEF';
    expect(
      PosLink.parse(Uri.parse('fess://pos/preview/$token')),
      const PreviewLink(token),
    );
    expect(const PreviewLink(token).page, 'preview');
    expect(
      PosLink.parse(Uri.parse('fess://pos/preview/short')),
      const HomeLink(),
      reason: 'not a token',
    );
  });

  test("a POS page this build doesn't know opens home", () {
    expect(PosLink.parse(Uri.parse('fess://pos/receipt/1')), const HomeLink());
    expect(
      PosLink.parse(Uri.parse('fess://pos/job/not%20an%20id')),
      const HomeLink(),
    );
  });

  test("the host's own links aren't the module's", () {
    expect(PosLink.parse(Uri.parse('fidelity://fess.com/home')), isNull);
    expect(PosLink.parse(Uri.parse('fidelity://fess.com/possum')), isNull);
  });

  test('telemetry names the page, never the record', () {
    expect(const JobLink(_job).page, 'job');
    expect(const CardLink().page, 'card');
    expect(const HomeLink().page, 'home');
  });
}
