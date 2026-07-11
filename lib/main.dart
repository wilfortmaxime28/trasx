import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'onboarding_page.dart';
import 'dashboard_page.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Keep the device screen turned on (prevent sleeping/dimming) while using TrasX
  try {
    await WakelockPlus.enable();
  } catch (e) {
    debugPrint('Wakelock enable error: $e');
  }
  
  // Retrieve the persistent login session status
  final prefs = await SharedPreferences.getInstance();
  final bool isLoggedIn = prefs.getBool('is_logged_in') ?? false;

  runApp(MyApp(isLoggedIn: isLoggedIn));
}

class MyApp extends StatelessWidget {
  final bool isLoggedIn;
  
  const MyApp({super.key, required this.isLoggedIn});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TrasX',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF000000),
        fontFamily: 'Montserrat',
        colorScheme: const ColorScheme.dark(
          primary: Colors.white,
          secondary: Color(0xFFE1306C),
          surface: Color(0xFF121212),
        ),
        useMaterial3: true,
      ),
      home: isLoggedIn ? const DashboardPage() : const OnboardingPage(),
    );
  }
}

// Keeping MyHomePage placeholder for compatibility if referenced in test files
class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key, required this.title});
  final String title;

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('TrasX')),
    );
  }
}
