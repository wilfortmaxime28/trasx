import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'native_game_board_page.dart';


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
  bool _isLoading = false;
  bool _showNativeLobby = true;
  bool _showNativeBoard = false; // true when playing native connect4/gomoku
  String? _errorMsg;

  // Selected game options
  String _selectedGame = 'connect4'; // connect4, gomoku, ludo, tablefootball, echecs
  String _opponentType = 'bot'; // bot, player
  String _botDifficulty = '1'; // 1=easy, 2=medium, 3=hard
  String _entryMode = 'free'; // free, paid
  double _betAmount = 1.00;
  int _rounds = 1;

  /// Games rendered natively (no WebView)
  static const _nativeBoardGames = {'connect4', 'gomoku'};

  final Map<String, Map<String, dynamic>> _gameDetails = {
    'connect4': {
      'title': 'Puissance 4',
      'desc': 'Alignez 4 jetons pour vaincre votre adversaire.',
      'icon': Icons.grid_3x3_outlined,
      'gradient': [const Color(0xFFEF4444), const Color(0xFFF97316)],
    },
    'gomoku': {
      'title': 'Gomoku',
      'desc': 'Alignez 5 pierres sur le plateau.',
      'icon': Icons.grid_on_outlined,
      'gradient': [const Color(0xFF3B82F6), const Color(0xFF06B6D4)],
    },
    'ludo': {
      'title': 'Ludo',
      'desc': 'Jeu de société traditionnel à 2 joueurs.',
      'icon': Icons.casino_outlined,
      'gradient': [const Color(0xFFEAB308), const Color(0xFFF97316)],
    },
    'tablefootball': {
      'title': 'Baby-foot',
      'desc': 'Un match intense de football de table.',
      'icon': Icons.sports_soccer_outlined,
      'gradient': [const Color(0xFF10B981), const Color(0xFF14B8A6)],
    },
    'echecs': {
      'title': 'Échecs',
      'desc': 'Stratégie et tactique classiques.',
      'icon': Icons.emoji_events_outlined,
      'gradient': [const Color(0xFF8B5CF6), const Color(0xFFEC4899)],
    },
  };

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

    // If an opponent or custom view is pre-provided, bypass native lobby
    if (widget.opponentId != null || widget.view != 'games') {
      _showNativeLobby = false;
      _isLoading = true;
      _authenticateAndLoadUrl();
    }
  }

  Future<void> _authenticateAndLoadUrl({
    bool createGame = false,
    String? gameType,
    String? opponentType,
    String? entryMode,
    double? betAmount,
    int? rounds,
    String? botId,
  }) async {
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
          '&view=${createGame ? 'games' : widget.view}'
          '&theme=${widget.isDarkMode ? 'dark' : 'light'}';

      if (createGame) {
        sessionUrl += '&createGame=true'
            '&gameType=$gameType'
            '&opponentType=$opponentType'
            '&entryMode=$entryMode'
            '&betAmount=$betAmount'
            '&rounds=$rounds'
            '&botId=$botId';
      }

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

  void _startGame() {
    // Connect4 and Gomoku use native Flutter boards
    if (_nativeBoardGames.contains(_selectedGame)) {
      setState(() {
        _showNativeLobby = false;
        _showNativeBoard = true;
        _errorMsg = null;
      });
      return;
    }
    setState(() {
      _isLoading = true;
      _showNativeLobby = false;
      _showNativeBoard = false;
      _errorMsg = null;
    });

    _startGameAsync();
  }

  Future<void> _startGameAsync() async {
    await _authenticateAndLoadUrl(
      createGame: _opponentType == 'bot',
      gameType: _selectedGame,
      opponentType: _opponentType,
      entryMode: _entryMode,
      betAmount: _betAmount,
      rounds: _rounds,
      botId: _botDifficulty,
    );
  }

  void _openOnlineLobby() {
    setState(() {
      _isLoading = true;
      _showNativeLobby = false;
      _errorMsg = null;
    });

    _authenticateAndLoadUrl(createGame: false);
  }

  @override
  Widget build(BuildContext context) {
    if (_showNativeLobby) {
      return Scaffold(
        backgroundColor: widget.isDarkMode ? const Color(0xFF0B0F19) : const Color(0xFFF4F6FA),
        body: _buildNativeLobby(),
      );
    }

    // Native board (connect4, gomoku)
    if (_showNativeBoard) {
      return NativeGameBoardPage(
        currentUserId: widget.currentUserId,
        gameType: _selectedGame,
        opponentType: _opponentType,
        entryMode: _entryMode,
        betAmount: _betAmount,
        rounds: _rounds,
        botDifficulty: _botDifficulty,
        isDarkMode: widget.isDarkMode,
        onBackToLobby: () => setState(() {
          _showNativeBoard = false;
          _showNativeLobby = true;
        }),
      );
    }

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
                        if (_opponentType == 'bot') {
                          _startGameAsync();
                        } else {
                          _authenticateAndLoadUrl(createGame: false);
                        }
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
        // Floating Back Button to exit gameplay and return to native lobby
        Positioned(
          top: 16,
          left: 16,
          child: SafeArea(
            child: FloatingActionButton.small(
              backgroundColor: Colors.black87,
              foregroundColor: Colors.white,
              elevation: 4,
              onPressed: () {
                setState(() {
                  _showNativeLobby = true;
                  _isLoading = false;
                });
              },
              child: const Icon(Icons.arrow_back),
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

  Widget _buildNativeLobby() {
    final theme = Theme.of(context);
    final isDark = widget.isDarkMode;
    final primaryColor = theme.primaryColor;
    final cardColor = isDark ? const Color(0xFF151F32) : Colors.white;
    final textColor = isDark ? Colors.white : Colors.black87;

    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.only(left: 20.0, right: 20.0, top: 48.0, bottom: 32.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(
                  colors: [Color(0xFF8B5CF6), Color(0xFF3B82F6)],
                ).createShader(bounds),
                child: const Text(
                  'TrasX Arcade',
                  style: TextStyle(
                    fontFamily: 'Outfit',
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                  ),
                ),
              ),
              const Spacer(),
              Icon(
                Icons.sports_esports,
                color: isDark ? Colors.white60 : Colors.black54,
                size: 28,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Défiez l\'IA ou jouez en ligne avec vos amis',
            style: TextStyle(
              color: isDark ? Colors.white54 : Colors.black54,
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 24),

          // Horizontal games list
          const Text(
            'CHOISIR UN JEU',
            style: TextStyle(
              fontFamily: 'Outfit',
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.0,
              color: Colors.grey,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 120,
            child: ListView(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              children: _gameDetails.entries.map((entry) {
                final key = entry.key;
                final val = entry.value;
                final isSelected = _selectedGame == key;
                final gradient = val['gradient'] as List<Color>;

                return GestureDetector(
                  onTap: () {
                    setState(() {
                      _selectedGame = key;
                      // Ludo is bot-only or multiplayer players list
                      if (key == 'ludo') {
                        _opponentType = 'bot';
                        _entryMode = 'free';
                      }
                    });
                  },
                  child: Container(
                    width: 140,
                    margin: const EdgeInsets.only(right: 12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      gradient: isSelected
                          ? LinearGradient(
                              colors: gradient,
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            )
                          : null,
                      color: isSelected ? null : cardColor,
                      border: isSelected
                          ? null
                          : Border.all(
                              color: isDark ? Colors.white10 : Colors.black12,
                            ),
                      boxShadow: isSelected
                          ? [
                              BoxShadow(
                                color: gradient[0].withOpacity(0.3),
                                blurRadius: 8,
                                offset: const Offset(0, 4),
                              )
                            ]
                          : null,
                    ),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Icon(
                          val['icon'] as IconData,
                          color: isSelected ? Colors.white : (isDark ? Colors.white70 : Colors.black87),
                          size: 28,
                        ),
                        Text(
                          val['title'] as String,
                          style: TextStyle(
                            fontFamily: 'Outfit',
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: isSelected ? Colors.white : (isDark ? Colors.white : Colors.black87),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 18),

          // Game description
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDark ? Colors.white.withOpacity(0.03) : Colors.black.withOpacity(0.02),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              _gameDetails[_selectedGame]!['desc'] as String,
              style: TextStyle(
                fontSize: 12.5,
                color: isDark ? Colors.white70 : Colors.black87,
                height: 1.4,
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Configuration section
          const Text(
            'OPTIONS DE LA PARTIE',
            style: TextStyle(
              fontFamily: 'Outfit',
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.0,
              color: Colors.grey,
            ),
          ),
          const SizedBox(height: 12),

          // Opponent Mode Selector (Only shown if not Ludo)
          if (_selectedGame != 'ludo') ...[
            _buildSelectorRow(
              title: 'Adversaire',
              child: Row(
                children: [
                  _buildSegmentButton(
                    label: 'Robot IA',
                    isSelected: _opponentType == 'bot',
                    onPressed: () {
                      setState(() {
                        _opponentType = 'bot';
                      });
                    },
                  ),
                  const SizedBox(width: 10),
                  _buildSegmentButton(
                    label: 'En ligne (Multi)',
                    isSelected: _opponentType == 'player',
                    onPressed: () {
                      setState(() {
                        _opponentType = 'player';
                      });
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Bot settings (Only if opponent is Bot)
          if (_opponentType == 'bot') ...[
            _buildSelectorRow(
              title: 'Difficulté de l\'IA',
              child: Row(
                children: [
                  _buildSegmentButton(
                    label: 'Facile',
                    isSelected: _botDifficulty == '1',
                    onPressed: () {
                      setState(() {
                        _botDifficulty = '1';
                      });
                    },
                  ),
                  const SizedBox(width: 8),
                  _buildSegmentButton(
                    label: 'Moyen',
                    isSelected: _botDifficulty == '2',
                    onPressed: () {
                      setState(() {
                        _botDifficulty = '2';
                      });
                    },
                  ),
                  const SizedBox(width: 8),
                  _buildSegmentButton(
                    label: 'Difficile',
                    isSelected: _botDifficulty == '3',
                    onPressed: () {
                      setState(() {
                        _botDifficulty = '3';
                      });
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Rounds settings (rounds)
          _buildSelectorRow(
            title: 'Nombre de manches',
            child: Row(
              children: [
                _buildSegmentButton(
                  label: '1 Manche',
                  isSelected: _rounds == 1,
                  onPressed: () {
                    setState(() {
                      _rounds = 1;
                    });
                  },
                ),
                const SizedBox(width: 10),
                _buildSegmentButton(
                  label: '3 Manches',
                  isSelected: _rounds == 3,
                  onPressed: () {
                    setState(() {
                      _rounds = 3;
                    });
                  },
                ),
                const SizedBox(width: 10),
                _buildSegmentButton(
                  label: '5 Manches',
                  isSelected: _rounds == 5,
                  onPressed: () {
                    setState(() {
                      _rounds = 5;
                    });
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Entry Mode (Free / Paid) - Only if not Ludo
          if (_selectedGame != 'ludo') ...[
            _buildSelectorRow(
              title: 'Type de partie',
              child: Row(
                children: [
                  _buildSegmentButton(
                    label: 'Gratuit',
                    isSelected: _entryMode == 'free',
                    onPressed: () {
                      setState(() {
                        _entryMode = 'free';
                      });
                    },
                  ),
                  const SizedBox(width: 10),
                  _buildSegmentButton(
                    label: 'Pari (Tokens)',
                    isSelected: _entryMode == 'paid',
                    onPressed: () {
                      setState(() {
                        _entryMode = 'paid';
                      });
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Bet amount input
            if (_entryMode == 'paid') ...[
              _buildSelectorRow(
                title: 'Mise (Tokens)',
                child: Container(
                  height: 48,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white.withOpacity(0.05) : Colors.black.withOpacity(0.04),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.token, color: primaryColor, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextFormField(
                          initialValue: _betAmount.toStringAsFixed(2),
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          style: TextStyle(
                            color: textColor,
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                          ),
                          decoration: const InputDecoration(
                            border: InputBorder.none,
                            contentPadding: EdgeInsets.zero,
                          ),
                          onChanged: (val) {
                            final parsed = double.tryParse(val);
                            if (parsed != null) {
                              _betAmount = parsed;
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
          ],

          const SizedBox(height: 20),

          // Actions Buttons
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: _opponentType == 'bot' ? _startGame : _openOnlineLobby,
              style: ElevatedButton.styleFrom(
                backgroundColor: _gameDetails[_selectedGame]!['gradient'][0] as Color,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                elevation: 6,
                shadowColor: (_gameDetails[_selectedGame]!['gradient'][0] as Color).withOpacity(0.4),
              ),
              child: Text(
                _opponentType == 'bot' ? 'LANCER LE MATCH' : 'REJOINDRE LE SALON',
                style: const TextStyle(
                  fontFamily: 'Outfit',
                  fontWeight: FontWeight.w900,
                  fontSize: 15,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Online lobbies quick link
          if (_opponentType == 'bot')
            SizedBox(
              width: double.infinity,
              height: 48,
              child: TextButton.icon(
                onPressed: _openOnlineLobby,
                icon: const Icon(Icons.people_outline, size: 20),
                label: const Text(
                  'Rejoindre le salon multijoueur en ligne',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                style: TextButton.styleFrom(
                  foregroundColor: primaryColor,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSelectorRow({required String title, required Widget child}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: Colors.grey,
          ),
        ),
        const SizedBox(height: 8),
        child,
      ],
    );
  }

  Widget _buildSegmentButton({
    required String label,
    required bool isSelected,
    required VoidCallback onPressed,
  }) {
    final theme = Theme.of(context);
    final isDark = widget.isDarkMode;

    return Expanded(
      child: GestureDetector(
        onTap: onPressed,
        child: Container(
          height: 40,
          decoration: BoxDecoration(
            color: isSelected
                ? theme.primaryColor
                : (isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03)),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected
                  ? theme.primaryColor
                  : (isDark ? Colors.white10 : Colors.black12),
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              color: isSelected
                  ? Colors.white
                  : (isDark ? Colors.white70 : Colors.black87),
              fontSize: 12.5,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ),
      ),
    );
  }
}
