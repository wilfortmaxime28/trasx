import 'package:flutter_test/flutter_test.dart';
import 'package:trasx/main.dart';
import 'package:trasx/onboarding_page.dart';

void main() {
  testWidgets('App starts on OnboardingPage when not logged in', (WidgetTester tester) async {
    await tester.runAsync(() async {
      await tester.pumpWidget(const MyApp(isLoggedIn: false));
      expect(find.byType(OnboardingPage), findsOneWidget);
    });
  });
}
