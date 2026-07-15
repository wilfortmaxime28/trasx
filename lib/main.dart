import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'onboarding_page.dart';
import 'dashboard_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _AppBootstrap());
}

class _AppBootstrap extends StatefulWidget {
  const _AppBootstrap();

  @override
  State<_AppBootstrap> createState() => _AppBootstrapState();
}

class _AppBootstrapState extends State<_AppBootstrap> {
  bool? _isLoggedIn;
  bool _isDarkMode = true;

  @override
  void initState() {
    super.initState();
    unawaited(_bootstrapApp());
  }

  Future<void> _bootstrapApp() async {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_enableWakelock());
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      if (!mounted) return;
      setState(() {
        _isLoggedIn = prefs.getBool('is_logged_in') ?? false;
        _isDarkMode = prefs.getBool('is_dark_mode') ?? true;
      });
    } catch (error) {
      debugPrint('App bootstrap error: $error');
      if (!mounted) return;
      setState(() {
        _isLoggedIn = false;
        _isDarkMode = true;
      });
    }
  }

  Future<void> _enableWakelock() async {
    try {
      await WakelockPlus.enable();
    } catch (error) {
      debugPrint('Wakelock enable error: $error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final isReady = _isLoggedIn != null;
    if (!isReady) {
      return const MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          backgroundColor: Colors.black,
          body: Center(
            child: Text(
              'TrasX',
              style: TextStyle(
                color: Colors.white,
                fontSize: 28,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.6,
              ),
            ),
          ),
        ),
      );
    }

    return MyApp(
      isLoggedIn: _isLoggedIn ?? false,
      initialDarkMode: _isDarkMode,
    );
  }
}

abstract class AppThemeController {
  bool get isDarkMode;
  void toggleTheme(bool value);
}

class MyApp extends StatefulWidget {
  final bool isLoggedIn;
  final bool? initialDarkMode;

  const MyApp({
    super.key,
    required this.isLoggedIn,
    this.initialDarkMode = true,
  });

  static AppThemeController of(BuildContext context) {
    final _MyAppState? result = context.findAncestorStateOfType<_MyAppState>();
    if (result != null) return result;
    throw FlutterError('MyAppState not found in context');
  }

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> implements AppThemeController {
  late bool _isDarkMode;

  @override
  bool get isDarkMode => _isDarkMode;

  @override
  void initState() {
    super.initState();
    _isDarkMode = widget.initialDarkMode ?? true;
    _applySystemUiOverlayStyle();
  }

  void _applySystemUiOverlayStyle() {
    final overlayStyle = SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: _isDarkMode ? Brightness.light : Brightness.dark,
      statusBarBrightness: _isDarkMode ? Brightness.dark : Brightness.light,
      systemNavigationBarColor: _isDarkMode
          ? const Color(0xFF000000)
          : const Color(0xFFF9F9F9),
      systemNavigationBarIconBrightness: _isDarkMode
          ? Brightness.light
          : Brightness.dark,
      systemNavigationBarDividerColor: Colors.transparent,
    );
    SystemChrome.setSystemUIOverlayStyle(overlayStyle);
  }

  @override
  void toggleTheme(bool value) async {
    setState(() {
      _isDarkMode = value;
    });
    _applySystemUiOverlayStyle();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('is_dark_mode', value);
  }

  @override
  Widget build(BuildContext context) {
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
          color: _isDarkMode
              ? const Color(0xFF000000)
              : const Color(0xFFF9F9F9),
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
    return const Scaffold(body: Center(child: Text('TrasX')));
  }
}
