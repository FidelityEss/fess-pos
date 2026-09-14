import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:flutter_test/flutter_test.dart';

final String _token = 'ab' * 16;

void main() {
  test('a card token reads only when it is one', () {
    final card = CardToken.tryParse({
      'token': _token,
      'valid_to': '2026-09-15T10:00:00Z',
    });
    expect(card?.token, _token);
    expect(card?.validTo, DateTime.utc(2026, 9, 15, 10));
    expect(card!.validAt(DateTime.utc(2026, 9, 15, 9)), isTrue);
    expect(card.validAt(DateTime.utc(2026, 9, 15, 10)), isFalse);
    expect(card.toString(), isNot(contains(_token)), reason: 'a bearer secret');
    expect(
      CardToken.tryParse({'token': 'short', 'valid_to': '2026-09-15T10:00Z'}),
      isNull,
    );
    expect(CardToken.tryParse({'token': _token, 'valid_to': 'soon'}), isNull);
    expect(CardToken.tryParse(null), isNull);
  });

  test('the QR opens the public verify page on the POS API', () {
    expect(
      verifyUrl(
        Uri.parse('https://ref.supabase.co/functions/v1/api'),
        _token,
      ).toString(),
      'https://ref.supabase.co/functions/v1/api/v1/public/verify/$_token',
    );
    expect(
      verifyUrl(Uri.parse('https://pos.test/'), _token).toString(),
      'https://pos.test/v1/public/verify/$_token',
    );
  });
}
