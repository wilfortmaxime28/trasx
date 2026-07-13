import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  
  // Retrieve the persistent login session status and theme preference
  final prefs = await SharedPreferences.getInstance();
  final bool isLoggedIn = prefs.getBool('is_logged_in') ?? false;
  final bool isDarkMode = prefs.getBool('is_dark_mode') ?? true;

  runApp(MyApp(isLoggedIn: isLoggedIn, initialDarkMode: isDarkMode));
}

class MyApp extends StatefulWidget {
  final bool isLoggedIn;
  final bool? initialDarkMode;
  
  const MyApp({
    super.key,
    required this.isLoggedIn,
    this.initialDarkMode = true,
  });

  static _MyAppState of(BuildContext context) {
    final _MyAppState? result = context.findAncestorStateOfType<_MyAppState>();
    if (result != null) return result;
    throw FlutterError('MyAppState not found in context');
  }

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  late bool _isDarkMode;

  bool get isDarkMode => _isDarkMode;

  @override
  void initState() {
    super.initState();
    _isDarkMode = widget.initialDarkMode ?? true;
  }

  void toggleTheme(bool value) async {
    setState(() {
      _isDarkMode = value;
    });
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('is_dark_mode', value);
  }

  @override
  Widget build(BuildContext context) {
    // Dynamic overlay styling to prevent default OS blur/gradients on notches
    final overlayStyle = SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: _isDarkMode ? Brightness.light : Brightness.dark,
      statusBarBrightness: _isDarkMode ? Brightness.dark : Brightness.light,
      systemNavigationBarColor: _isDarkMode ? const Color(0xFF000000) : const Color(0xFFF9F9F9),
      systemNavigationBarIconBrightness: _isDarkMode ? Brightness.light : Brightness.dark,
      systemNavigationBarDividerColor: Colors.transparent,
    );
    SystemChrome.setSystemUIOverlayStyle(overlayStyle);

    return MaterialApp(
      title: 'TrasX',
      debugShowCheckedModeBanner: false,
      themeMode: _isDarkMode ? ThemeMode.dark : ThemeMode.light,
      theme: ThemeData(
        brightness: Brightness.light,
        scaffoldBackgroundColor: const Color(0xFFF9F9F9),
        appBarTheme: const AppBarTheme(
          systemOverlayStyle: SystemUiOverlayStyle.dark,
        ),
        fontFamily: 'Montserrat',
        colorScheme: const ColorScheme.light(
          primary: Colors.black,
          secondary: Color(0xFFE1306C),
          surface: Colors.white,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF000000),
        appBarTheme: const AppBarTheme(
          systemOverlayStyle: SystemUiOverlayStyle.light,
        ),
        fontFamily: 'Montserrat',
        colorScheme: const ColorScheme.dark(
          primary: Colors.white,
          secondary: Color(0xFFE1306C),
          surface: Color(0xFF121212),
        ),
        useMaterial3: true,
      ),
      home: widget.isLoggedIn ? const DashboardPage() : const OnboardingPage(),
      builder: (context, child) {
        // Smooth background theme animation enclosing the application screens
        return AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeInOut,
          color: _isDarkMode ? const Color(0xFF000000) : const Color(0xFFF9F9F9),
          child: child!,
        );
      },
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
