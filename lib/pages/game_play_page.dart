import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class GamePlayPage extends StatefulWidget {
  final int currentUserId;
  final String view; // e.g. "games"
  final int? opponentId;
  final String? opponentName;
  final String? opponentAvatar;
  final String? opponentUsername;
  final bool embedded;
  final bool isDarkMode;

  const GamePlayPage({
    super.key,
    required this.currentUserId,
    this.view = 'games',
    this.opponentId,
    this.opponentName,
    this.opponentAvatar,
    this.opponentUsername,
    this.embedded = false,
    this.isDarkMode = false,
  });

  @override
  State<GamePlayPage> createState() => _GamePlayPageState();
}

class _GamePlayPageState extends State<GamePlayPage> {
  late final WebViewController _controller;
  bool _isLoading = true;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (int progress) {
            if (progress > 35 && _isLoading && mounted) {
              setState(() {
                _isLoading = false;
              });
            }
          },
          onPageStarted: (String url) {
            // Keep WebView rendering visible as early as possible
          },
          onPageFinished: (String url) {
            if (_isLoading && mounted) {
              setState(() {
                _isLoading = false;
              });
            }
          },
          onWebResourceError: (WebResourceError error) {
            debugPrint("WebView error: ${error.description}");
          },
        ),
      );

    _authenticateAndLoadUrl();
  }

  Future<void> _authenticateAndLoadUrl() async {
    try {
      // 1. Call api/auth/mobile-token to get signed signature
      final response = await http.get(
        Uri.parse('https://trasx.com/api/auth/mobile-token'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );

      if (response.statusCode != 200) {
        throw Exception('Erreur d\'authentification (${response.statusCode})');
      }

      final data = json.decode(response.body);
      if (data['success'] != true) {
        throw Exception(data['error'] ?? 'Impossible de se connecter.');
      }

      final String token = data['token'];
      final int timestamp = data['timestamp'];

      // 2. Build authenticated session login URL
      var sessionUrl = 'https://trasx.com/api/auth/mobile-session'
          '?userId=${widget.currentUserId}'
          '&token=$token'
          '&timestamp=$timestamp'
          '&view=${widget.view}'
          '&theme=${widget.isDarkMode ? 'dark' : 'light'}';

      if (widget.opponentId != null) {
        sessionUrl += '&opponentId=${widget.opponentId}';
      }
      if (widget.opponentName != null) {
        sessionUrl += '&opponentName=${Uri.encodeComponent(widget.opponentName!)}';
      }
      if (widget.opponentAvatar != null) {
        sessionUrl += '&opponentAvatar=${Uri.encodeComponent(widget.opponentAvatar!)}';
      }
      if (widget.opponentUsername != null) {
        sessionUrl += '&opponentUsername=${Uri.encodeComponent(widget.opponentUsername!)}';
      }

      // 3. Load URL in WebViewController
      await _controller.loadRequest(Uri.parse(sessionUrl));
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMsg = e.toString().replaceFirst('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = Stack(
      children: [
        WebViewWidget(controller: _controller),
        if (_isLoading)
          const Center(
            child: CircularProgressIndicator(
              valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF6F63FF)),
            ),
          ),
        if (_errorMsg != null)
          Container(
            color: const Color(0xFF121317),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, color: Colors.redAccent, size: 64),
                    const SizedBox(height: 16),
                    Text(
                      _errorMsg!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 16),
                    ),
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: () {
                        setState(() {
                          _errorMsg = null;
                          _isLoading = true;
                        });
                        _authenticateAndLoadUrl();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF6F63FF),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: const Text('Réessayer'),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );

    if (widget.embedded) {
      return body;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'TrasX Games',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontFamily: 'Outfit',
          ),
        ),
        backgroundColor: const Color(0xFF121317),
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      backgroundColor: const Color(0xFF121317),
      body: body,
    );
  }
}
