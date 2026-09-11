import 'dart:async';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'native_game_board_page.dart';
import '../services/game_socket_service.dart';

class GamePlayPage extends StatefulWidget {
  final int currentUserId;
  final String? currentUserAvatar;
  final String view;
  final int? opponentId;
  final String? opponentName;
  final String? opponentAvatar;
  final String? opponentUsername;
  final bool embedded;
  final bool isDarkMode;

  const GamePlayPage({
    super.key,
    required this.currentUserId,
    this.currentUserAvatar,
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
  String? _errorMsg;

  // Selected game options
  String _selectedGame = 'connect4';
  String _opponentType = 'bot'; // bot, player
  String _botDifficulty = '1'; // 1=easy, 2=medium, 3=hard
  String _entryMode = 'free'; // free, paid
  double _betAmount = 1.00;
  int _rounds = 1;
  String _selectedTeam1 = 'BR';
  String _selectedTeam2 = 'FR';

  // Tab navigation & Live Matches state
  int _activeTab = 0; // 0 = Jouer & Défier, 1 = Matchs en direct
  int? _selectedOpponentId;
  String? _selectedOpponentName;
  String? _selectedOpponentAvatar;
  String? _selectedOpponentUsername;

  // Search and online players state variables
  final TextEditingController _searchController = TextEditingController();
  List<dynamic> _onlineUsers = [];
  List<dynamic> _searchResults = [];
  bool _isSearching = false;
  bool _isLoadingUsers = false;
  String _searchQuery = '';
  Timer? _pollTimer;
  StreamSubscription? _presenceSub;

  List<dynamic> _liveMatches = [];
  bool _isLoadingLiveMatches = false;

  /// Games rendered natively (no WebView)
  static const _nativeBoardGames = {'connect4', 'gomoku', 'ludo', 'tablefootball', 'echecs'};

  static const Map<String, String> _footballTeams = {
    'FR': '🇫🇷 France',
    'BR': '🇧🇷 Brésil',
    'AR': '🇦🇷 Argentine',
    'DE': '🇩🇪 Allemagne',
    'ES': '🇪🇸 Espagne',
    'IT': '🇮🇹 Italie',
    'PT': '🇵🇹 Portugal',
    'GB': '🇬🇧 Angleterre',
    'MA': '🇲🇦 Maroc',
    'SN': '🇸🇳 Sénégal',
    'BE': '🇧🇪 Belgique',
    'NL': '🇳🇱 Pays-Bas',
    'HR': '🇭🇷 Croatie',
    'UY': '🇺🇾 Uruguay',
    'CO': '🇨🇴 Colombie',
    'US': '🇺🇸 États-Unis',
    'MX': '🇲🇽 Mexique',
    'CM': '🇨🇲 Cameroun',
    'CI': '🇨🇮 Côte d\'Ivoire',
    'DZ': '🇩🇿 Algérie',
    'TN': '🇹🇳 Tunisie',
    'EG': '🇪🇬 Égypte',
    'JP': '🇯🇵 Japon',
    'KR': '🇰🇷 Corée du Sud',
    'SA': '🇸🇦 Arabie Saoudite',
    'CH': '🇨🇭 Suisse',
    'DK': '🇩🇰 Danemark',
    'SE': '🇸🇪 Suède',
    'NO': '🇳🇴 Norvège',
    'PL': '🇵🇱 Pologne',
    'UA': '🇺🇦 Ukraine',
    'TR': '🇹🇷 Turquie',
    'CA': '🇨🇦 Canada',
    'CL': '🇨🇱 Chili',
    'AU': '🇦🇺 Australie',
    'NG': '🇳🇬 Nigéria',
    'GH': '🇬🇭 Ghana',
    'AT': '🇦🇹 Autriche',
    'RO': '🇷🇴 Roumanie',
    'HU': '🇭🇺 Hongrie',
    'EC': '🇪🇨 Équateur',
    'PE': '🇵🇪 Pérou',
    'PY': '🇵🇾 Paraguay',
    'VE': '🇻🇪 Venezuela',
    'BO': '🇧🇴 Bolivie',
    'QA': '🇶🇦 Qatar',
    'IR': '🇮🇷 Iran',
    'NZ': '🇳🇿 Nouvelle-Zélande',
    'ZA': '🇿🇦 Afrique du Sud',
    'IE': '🇮🇪 Irlande',
    'HT': '🇭🇹 Haïti'
  };

  final Map<String, Map<String, dynamic>> _gameDetails = {
    'connect4': {
      'title': 'Puissance 4',
      'subtitle': 'Alignez 4 jetons',
      'tag': 'POPULAIRE',
      'icon': Icons.grid_3x3_rounded,
      'color': const Color(0xFFFE2C55),
    },
    'tablefootball': {
      'title': 'Baby-foot',
      'subtitle': 'Duel de football 1v1',
      'tag': 'FOOTBALL',
      'icon': Icons.sports_soccer_rounded,
      'color': const Color(0xFF10B981),
    },
    'gomoku': {
      'title': 'Gomoku',
      'subtitle': '5 pierres alignées',
      'tag': 'STRATÉGIE',
      'icon': Icons.grain_rounded,
      'color': const Color(0xFF38BDF8),
    },
    'ludo': {
      'title': 'Ludo',
      'subtitle': 'Jeu des petits chevaux',
      'tag': 'MULTIJOUEUR',
      'icon': Icons.casino_rounded,
      'color': const Color(0xFFF59E0B),
    },
    'echecs': {
      'title': 'Échecs',
      'subtitle': 'Tactique & réflexion',
      'tag': 'CLASSIQUE',
      'icon': Icons.psychology_rounded,
      'color': const Color(0xFFA855F7),
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
          onPageStarted: (_) {},
          onPageFinished: (_) {
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

    if (widget.opponentId != null || widget.view != 'games') {
      _showNativeLobby = false;
      _isLoading = true;
      _authenticateAndLoadUrl();
    } else {
      _fetchOnlineUsers();
      _fetchLiveMatches();

      // Real-time socket presence connection & listener
      GameSocketService.instance.connect(userId: widget.currentUserId);
      _presenceSub = GameSocketService.instance.onPresenceUpdated.listen((data) {
        if (mounted && _showNativeLobby) {
          debugPrint('[GameLobby] Real-time presence update received: $data');
          _fetchOnlineUsers();
        }
      });

      // Background periodic polling fallback
      _pollTimer = Timer.periodic(const Duration(seconds: 10), (_) {
        if (mounted && _showNativeLobby) {
          _fetchOnlineUsers();
          if (_activeTab == 1) {
            _fetchLiveMatches();
          }
        }
      });
    }
  }

  @override
  void dispose() {
    _presenceSub?.cancel();
    _pollTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  /// Compact number formatter (e.g. 999 -> 999, 1200 -> 1.2K, 15000 -> 15K, 1200000 -> 1.2M)
  String _formatCompactNumber(num number) {
    if (number >= 1000000000) {
      final val = number / 1000000000;
      return '${val.toStringAsFixed(val >= 10 ? 0 : 1).replaceAll(RegExp(r'\.0$'), '')}B';
    }
    if (number >= 1000000) {
      final val = number / 1000000;
      return '${val.toStringAsFixed(val >= 10 ? 0 : 1).replaceAll(RegExp(r'\.0$'), '')}M';
    }
    if (number >= 1000) {
      final val = number / 1000;
      return '${val.toStringAsFixed(val >= 10 ? 0 : 1).replaceAll(RegExp(r'\.0$'), '')}K';
    }
    return number.toString();
  }

  String? _formatAvatarUrl(String? avatarPath) {
    if (avatarPath == null || avatarPath.isEmpty) return null;
    if (avatarPath.startsWith('http')) return avatarPath;
    final cleanPath = avatarPath.startsWith('/') ? avatarPath : '/$avatarPath';
    return 'https://trasx.com$cleanPath';
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
        if (gameType == 'tablefootball') {
          sessionUrl += '&team1=$_selectedTeam1&team2=$_selectedTeam2';
        }
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

  void _startGame({int? directOpponentId}) {
    final opponentIdToUse = directOpponentId ?? (_opponentType == 'player' ? _selectedOpponentId : null);

    if (_opponentType == 'player' && opponentIdToUse == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Sélectionnez un joueur à défier.'),
          backgroundColor: const Color(0xFF262626),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      );
      return;
    }

    if (_nativeBoardGames.contains(_selectedGame)) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => NativeGameBoardPage(
            currentUserId: widget.currentUserId,
            currentUserAvatar: widget.currentUserAvatar,
            gameType: _selectedGame,
            opponentType: _opponentType,
            entryMode: _entryMode,
            betAmount: _betAmount,
            rounds: _rounds,
            botDifficulty: _botDifficulty,
            isDarkMode: widget.isDarkMode,
            onBackToLobby: () => Navigator.pop(context),
            opponentId: opponentIdToUse,
            team1: _selectedGame == 'tablefootball' ? _selectedTeam1 : null,
            team2: _selectedGame == 'tablefootball' ? _selectedTeam2 : null,
          ),
        ),
      );
      return;
    }

    setState(() {
      _isLoading = true;
      _showNativeLobby = false;
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

  Future<void> _fetchOnlineUsers() async {
    if (_isLoadingUsers) return;
    setState(() {
      _isLoadingUsers = true;
    });
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/users/search?onlineOnly=true'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final List<dynamic> users = jsonDecode(response.body);
        if (mounted) {
          setState(() {
            _onlineUsers = users.where((u) => u['id']?.toString() != '${widget.currentUserId}').toList();
          });
        }
      }
    } catch (e) {
      debugPrint('[Lobby] Error fetching online users: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingUsers = false;
        });
      }
    }
  }

  Future<void> _fetchLiveMatches() async {
    if (_isLoadingLiveMatches) return;
    setState(() {
      _isLoadingLiveMatches = true;
    });
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/games/live'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final List<dynamic> games = jsonDecode(response.body);
        if (mounted) {
          setState(() {
            _liveMatches = games;
          });
        }
      }
    } catch (e) {
      debugPrint('[Lobby] Error fetching live matches: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingLiveMatches = false;
        });
      }
    }
  }

  Future<void> _performSearch(String query) async {
    if (query.trim().isEmpty) {
      setState(() {
        _searchResults = [];
        _isSearching = false;
      });
      return;
    }
    setState(() {
      _isSearching = true;
    });
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/users/search?q=${Uri.encodeComponent(query)}'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final List<dynamic> users = jsonDecode(response.body);
        if (mounted) {
          setState(() {
            _searchResults = users.where((u) => u['id']?.toString() != '${widget.currentUserId}').toList();
          });
        }
      }
    } catch (e) {
      debugPrint('[Lobby] Error searching users: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isSearching = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_showNativeLobby) {
      return Scaffold(
        backgroundColor: widget.isDarkMode ? const Color(0xFF0F1117) : const Color(0xFFF6F8FB),
        body: _buildLobbyContent(),
      );
    }

    final body = Stack(
      children: [
        WebViewWidget(controller: _controller),
        if (_isLoading)
          const Center(
            child: CircularProgressIndicator(
              valueColor: AlwaysStoppedAnimation<Color>(Color(0xFFFE2C55)),
            ),
          ),
        if (_errorMsg != null)
          Container(
            color: widget.isDarkMode ? const Color(0xFF0F1117) : Colors.white,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline_rounded, color: Color(0xFFFE2C55), size: 48),
                    const SizedBox(height: 16),
                    Text(
                      _errorMsg!,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: widget.isDarkMode ? Colors.white : Colors.black87,
                        fontSize: 14,
                        fontFamily: 'Outfit',
                      ),
                    ),
                    const SizedBox(height: 20),
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
                        backgroundColor: const Color(0xFFFE2C55),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text('Réessayer'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        Positioned(
          top: 16,
          left: 16,
          child: SafeArea(
            child: Material(
              color: Colors.black.withValues(alpha: 0.5),
              shape: const CircleBorder(),
              child: IconButton(
                icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
                onPressed: () {
                  setState(() {
                    _showNativeLobby = true;
                    _isLoading = false;
                  });
                },
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
          'Jeux',
          style: TextStyle(fontWeight: FontWeight.w700, fontFamily: 'Outfit'),
        ),
        backgroundColor: widget.isDarkMode ? const Color(0xFF0F1117) : Colors.white,
        foregroundColor: widget.isDarkMode ? Colors.white : const Color(0xFF161823),
        elevation: 0,
      ),
      backgroundColor: widget.isDarkMode ? const Color(0xFF0F1117) : const Color(0xFFF6F8FB),
      body: body,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REFINED COMPACT & SOFT LOBBY
  // ══════════════════════════════════════════════════════════════════════════

  Widget _buildLobbyContent() {
    final isDark = widget.isDarkMode;
    final bgCard = isDark ? const Color(0xFF171A23) : Colors.white;
    final textPrimary = isDark ? Colors.white : const Color(0xFF0F172A);
    final textSecondary = isDark ? const Color(0xFF8E9BAE) : const Color(0xFF64748B);
    final borderSubtle = isDark ? Colors.white.withValues(alpha: 0.07) : const Color(0xFFE2E8F0);

    return SafeArea(
      bottom: false,
      child: Stack(
        children: [
          CustomScrollView(
            physics: const BouncingScrollPhysics(),
            slivers: [
              // 1. Top Header
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFE2C55).withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Text(
                              'ARENA',
                              style: TextStyle(
                                color: Color(0xFFFE2C55),
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.5,
                                fontFamily: 'Outfit',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Jeux & Duels',
                            style: TextStyle(
                              color: textPrimary,
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              fontFamily: 'Outfit',
                              letterSpacing: -0.3,
                            ),
                          ),
                        ],
                      ),
                      GestureDetector(
                        onTap: () {
                          _fetchOnlineUsers();
                          _fetchLiveMatches();
                        },
                        child: Row(
                          children: [
                            Container(
                              width: 6,
                              height: 6,
                              decoration: BoxDecoration(
                                color: _onlineUsers.isNotEmpty
                                    ? const Color(0xFF22C55E)
                                    : textSecondary.withValues(alpha: 0.4),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 5),
                            Text(
                              '${_formatCompactNumber(_onlineUsers.length)} en ligne',
                              style: TextStyle(
                                color: textSecondary,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // 2. Compact Segment Tab Switcher
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Container(
                    height: 38,
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF171A23) : const Color(0xFFEBECEE),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: borderSubtle),
                    ),
                    padding: const EdgeInsets.all(3),
                    child: Row(
                      children: [
                        _buildTab(
                          title: '⚡ Jouer',
                          isActive: _activeTab == 0,
                          isDark: isDark,
                          onTap: () => setState(() => _activeTab = 0),
                        ),
                        _buildTab(
                          title: '🔴 En direct',
                          isActive: _activeTab == 1,
                          badgeCount: _liveMatches.length,
                          isDark: isDark,
                          onTap: () {
                            setState(() => _activeTab = 1);
                            _fetchLiveMatches();
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              if (_activeTab == 0) ...[
                // 3. Compact Games Carousel
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 10, bottom: 4),
                    child: _buildCompactGamesCarousel(isDark, bgCard, textPrimary, textSecondary, borderSubtle),
                  ),
                ),

                // 4. Online Users Avatar Reel (Soft & Compact)
                if (_onlineUsers.isNotEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                      child: _buildCompactOnlineUsers(isDark, textPrimary, textSecondary),
                    ),
                  ),

                // 5. Match Configuration Options
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: _buildCompactOptionsCard(isDark, bgCard, textPrimary, textSecondary, borderSubtle),
                  ),
                ),

                const SliverToBoxAdapter(
                  child: SizedBox(height: 90),
                ),
              ] else ...[
                // Live Matches Tab
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: _buildLiveMatchesList(isDark, bgCard, textPrimary, textSecondary, borderSubtle),
                  ),
                ),
                const SliverToBoxAdapter(
                  child: SizedBox(height: 40),
                ),
              ],
            ],
          ),

          // 6. Compact Floating Action Bar
          if (_activeTab == 0)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _buildCompactBottomCTA(isDark),
            ),
        ],
      ),
    );
  }

  Widget _buildTab({
    required String title,
    required bool isActive,
    required bool isDark,
    required VoidCallback onTap,
    int? badgeCount,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          decoration: BoxDecoration(
            color: isActive
                ? (isDark ? const Color(0xFF262A36) : Colors.white)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            boxShadow: isActive
                ? [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.06),
                      blurRadius: 4,
                      offset: const Offset(0, 1),
                    )
                  ]
                : null,
          ),
          alignment: Alignment.center,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: isActive
                      ? (isDark ? Colors.white : const Color(0xFF0F172A))
                      : textSecondaryColor(isDark),
                  fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                  fontSize: 12.5,
                  fontFamily: 'Outfit',
                ),
              ),
              if (badgeCount != null && badgeCount > 0) ...[
                const SizedBox(width: 5),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFE2C55),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '$badgeCount',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Color textSecondaryColor(bool isDark) => isDark ? const Color(0xFF8E9BAE) : const Color(0xFF64748B);

  // ══════════════════════════════════════════════════════════════════════════
  // COMPACT GAMES CAROUSEL
  // ══════════════════════════════════════════════════════════════════════════

  Widget _buildCompactGamesCarousel(
    bool isDark,
    Color bgCard,
    Color textPrimary,
    Color textSecondary,
    Color borderSubtle,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            'CHOISIR UN JEU',
            style: TextStyle(
              color: textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
              fontFamily: 'Outfit',
            ),
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 118,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: _gameDetails.length,
            itemBuilder: (context, index) {
              final entry = _gameDetails.entries.elementAt(index);
              final key = entry.key;
              final val = entry.value;
              final isSelected = _selectedGame == key;
              final accentColor = val['color'] as Color;

              return GestureDetector(
                onTap: () {
                  setState(() {
                    _selectedGame = key;
                  });
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  width: 130,
                  margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? (isDark ? const Color(0xFF202532) : Colors.white)
                        : bgCard,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isSelected
                          ? const Color(0xFFFE2C55)
                          : borderSubtle,
                      width: isSelected ? 1.5 : 1.0,
                    ),
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color: const Color(0xFFFE2C55).withValues(alpha: 0.12),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            )
                          ]
                        : null,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: accentColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              val['tag'] as String,
                              style: TextStyle(
                                color: accentColor,
                                fontSize: 8.5,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.3,
                              ),
                            ),
                          ),
                          if (isSelected)
                            const Icon(Icons.check_circle_rounded, color: Color(0xFFFE2C55), size: 15),
                        ],
                      ),
                      Row(
                        children: [
                          Icon(
                            val['icon'] as IconData,
                            color: isSelected ? const Color(0xFFFE2C55) : (isDark ? Colors.white70 : const Color(0xFF0F172A)),
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  val['title'] as String,
                                  style: TextStyle(
                                    color: textPrimary,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 12.5,
                                    fontFamily: 'Outfit',
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                Text(
                                  val['subtitle'] as String,
                                  style: TextStyle(
                                    color: textSecondary,
                                    fontSize: 9.5,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMPACT ONLINE PLAYERS REEL
  // ══════════════════════════════════════════════════════════════════════════

  Widget _buildCompactOnlineUsers(bool isDark, Color textPrimary, Color textSecondary) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              _onlineUsers.isNotEmpty
                  ? 'JOUEURS EN LIGNE (${_formatCompactNumber(_onlineUsers.length)})'
                  : 'JOUEURS EN LIGNE',
              style: TextStyle(
                color: textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.6,
                fontFamily: 'Outfit',
              ),
            ),
            if (_opponentType != 'player')
              GestureDetector(
                onTap: () => setState(() => _opponentType = 'player'),
                child: const Text(
                  'Défier en 1v1',
                  style: TextStyle(
                    color: Color(0xFFFE2C55),
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 68,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            itemCount: _onlineUsers.length,
            itemBuilder: (context, index) {
              final player = _onlineUsers[index];
              final name = player['first_name'] != null || player['last_name'] != null
                  ? '${player['first_name'] ?? ''} ${player['last_name'] ?? ''}'.trim()
                  : player['username'] ?? 'Joueur';
              final username = player['username'] ?? '';
              final avatar = player['avatar'] != null ? _formatAvatarUrl(player['avatar'].toString()) : null;
              final playerId = int.tryParse(player['id']?.toString() ?? '');
              final isSelected = _selectedOpponentId == playerId;

              return GestureDetector(
                onTap: () {
                  setState(() {
                    _opponentType = 'player';
                    _selectedOpponentId = playerId;
                    _selectedOpponentName = name;
                    _selectedOpponentAvatar = avatar;
                    _selectedOpponentUsername = username;
                  });
                },
                child: Container(
                  margin: const EdgeInsets.only(right: 12),
                  child: Column(
                    children: [
                      Stack(
                        children: [
                          CircleAvatar(
                            radius: 18,
                            backgroundColor: isDark ? const Color(0xFF262A36) : const Color(0xFFEBECEE),
                            backgroundImage: avatar != null && avatar.isNotEmpty ? NetworkImage(avatar) : null,
                            child: avatar == null || avatar.isEmpty
                                ? Text(
                                    name.substring(0, 1).toUpperCase(),
                                    style: TextStyle(
                                      color: textPrimary,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 12,
                                    ),
                                  )
                                : null,
                          ),
                          if (isSelected)
                            Positioned.fill(
                              child: Container(
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(color: const Color(0xFFFE2C55), width: 2),
                                ),
                              ),
                            ),
                          Positioned(
                            right: 0,
                            bottom: 0,
                            child: Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: const Color(0xFF22C55E),
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: isDark ? const Color(0xFF0F1117) : Colors.white,
                                  width: 1.5,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      SizedBox(
                        width: 48,
                        child: Text(
                          name.split(' ').first,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: isSelected ? const Color(0xFFFE2C55) : textSecondary,
                            fontSize: 10,
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMPACT OPTIONS CARD
  // ══════════════════════════════════════════════════════════════════════════

  Widget _buildCompactOptionsCard(
    bool isDark,
    Color bgCard,
    Color textPrimary,
    Color textSecondary,
    Color borderSubtle,
  ) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bgCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Opponent Mode
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'ADVERSAIRE',
                style: TextStyle(
                  color: textSecondary,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _buildCompactPill(
                label: 'Robot IA',
                icon: Icons.smart_toy_outlined,
                isSelected: _opponentType == 'bot',
                isDark: isDark,
                onTap: () => setState(() => _opponentType = 'bot'),
              ),
              const SizedBox(width: 8),
              _buildCompactPill(
                label: 'Joueur réel',
                icon: Icons.person_outline_rounded,
                isSelected: _opponentType == 'player',
                isDark: isDark,
                onTap: () {
                  setState(() => _opponentType = 'player');
                  _fetchOnlineUsers();
                },
              ),
            ],
          ),

          // Bot Difficulty
          if (_opponentType == 'bot') ...[
            const SizedBox(height: 12),
            Text(
              'DIFFICULTÉ IA',
              style: TextStyle(
                color: textSecondary,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                _buildCompactPill(
                  label: 'Facile',
                  isSelected: _botDifficulty == '1',
                  isDark: isDark,
                  onTap: () => setState(() => _botDifficulty = '1'),
                ),
                const SizedBox(width: 6),
                _buildCompactPill(
                  label: 'Moyen',
                  isSelected: _botDifficulty == '2',
                  isDark: isDark,
                  onTap: () => setState(() => _botDifficulty = '2'),
                ),
                const SizedBox(width: 6),
                _buildCompactPill(
                  label: 'Difficile',
                  isSelected: _botDifficulty == '3',
                  isDark: isDark,
                  onTap: () => setState(() => _botDifficulty = '3'),
                ),
              ],
            ),
          ],

          // Search player in Player Mode
          if (_opponentType == 'player') ...[
            const SizedBox(height: 12),
            Container(
              height: 36,
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF202532) : const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(8),
              ),
              child: TextField(
                controller: _searchController,
                onChanged: (val) {
                  setState(() => _searchQuery = val);
                  _performSearch(val);
                },
                style: TextStyle(color: textPrimary, fontSize: 12.5),
                decoration: InputDecoration(
                  hintText: 'Rechercher un pseudo...',
                  hintStyle: TextStyle(color: textSecondary, fontSize: 12),
                  prefixIcon: const Icon(Icons.search_rounded, color: Colors.grey, size: 16),
                  suffixIcon: _searchQuery.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, color: Colors.grey, size: 14),
                          onPressed: () {
                            _searchController.clear();
                            setState(() {
                              _searchQuery = '';
                              _searchResults = [];
                            });
                          },
                        )
                      : null,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 8),
                ),
              ),
            ),
            if (_searchQuery.isNotEmpty) ...[
              const SizedBox(height: 6),
              Container(
                constraints: const BoxConstraints(maxHeight: 140),
                child: _buildSearchUsersList(isDark, textPrimary, textSecondary),
              ),
            ],
            if (_selectedOpponentId != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF202532) : const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 10,
                      backgroundImage: _selectedOpponentAvatar != null && _selectedOpponentAvatar!.isNotEmpty
                          ? NetworkImage(_selectedOpponentAvatar!)
                          : null,
                      child: _selectedOpponentAvatar == null || _selectedOpponentAvatar!.isEmpty
                          ? Text((_selectedOpponentName ?? 'J')[0].toUpperCase(), style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold))
                          : null,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${_selectedOpponentName ?? 'Joueur'}${_selectedOpponentUsername != null && _selectedOpponentUsername!.isNotEmpty ? ' (@$_selectedOpponentUsername)' : ''}',
                        style: TextStyle(
                          color: textPrimary,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    GestureDetector(
                      onTap: () {
                        setState(() {
                          _selectedOpponentId = null;
                          _selectedOpponentName = null;
                          _selectedOpponentAvatar = null;
                          _selectedOpponentUsername = null;
                        });
                      },
                      child: Icon(Icons.close_rounded, size: 15, color: textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ],

          // Football teams if Table Football
          if (_selectedGame == 'tablefootball') ...[
            const SizedBox(height: 12),
            Text(
              'ÉQUIPES',
              style: TextStyle(
                color: textSecondary,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: _buildCompactTeamTile(
                    label: 'Vous',
                    code: _selectedTeam1,
                    isDark: isDark,
                    onTap: () => _showTeamPickerModal(isTeam1: true),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _buildCompactTeamTile(
                    label: 'Adversaire',
                    code: _selectedTeam2,
                    isDark: isDark,
                    onTap: _opponentType == 'bot' ? () => _showTeamPickerModal(isTeam1: false) : null,
                  ),
                ),
              ],
            ),
          ],

          // Rounds (1 vs 3)
          const SizedBox(height: 12),
          Text(
            'MANCHES',
            style: TextStyle(
              color: textSecondary,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _buildCompactPill(
                label: '1 Manche',
                isSelected: _rounds == 1,
                isDark: isDark,
                onTap: () => setState(() => _rounds = 1),
              ),
              const SizedBox(width: 8),
              _buildCompactPill(
                label: '3 Manches',
                isSelected: _rounds == 3,
                isDark: isDark,
                onTap: () => setState(() => _rounds = 3),
              ),
            ],
          ),

          // Free vs Paid Mode
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'TYPE DE MATCH',
                style: TextStyle(
                  color: textSecondary,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                ),
              ),
              Row(
                children: [
                  _buildCompactToggle(
                    label: 'Gratuit',
                    isSelected: _entryMode == 'free',
                    isDark: isDark,
                    onTap: () => setState(() => _entryMode = 'free'),
                  ),
                  const SizedBox(width: 6),
                  _buildCompactToggle(
                    label: '🪙 Tokens',
                    isSelected: _entryMode == 'paid',
                    isDark: isDark,
                    onTap: () => setState(() => _entryMode = 'paid'),
                  ),
                ],
              ),
            ],
          ),

          if (_entryMode == 'paid') ...[
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [0.50, 1.00, 2.50, 5.00, 10.00].map((val) {
                final isCur = (_betAmount - val).abs() < 0.01;
                return GestureDetector(
                  onTap: () => setState(() => _betAmount = val),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: isCur
                          ? const Color(0xFFFE2C55)
                          : (isDark ? const Color(0xFF202532) : const Color(0xFFF1F5F9)),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${val.toStringAsFixed(val == val.roundToDouble() ? 0 : 2)} 🪙',
                      style: TextStyle(
                        color: isCur ? Colors.white : textSecondary,
                        fontWeight: isCur ? FontWeight.w700 : FontWeight.w500,
                        fontSize: 11,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCompactPill({
    required String label,
    IconData? icon,
    required bool isSelected,
    required bool isDark,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          height: 32,
          decoration: BoxDecoration(
            color: isSelected
                ? (isDark ? Colors.white : const Color(0xFF0F172A))
                : (isDark ? const Color(0xFF202532) : const Color(0xFFF1F5F9)),
            borderRadius: BorderRadius.circular(7),
          ),
          alignment: Alignment.center,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(
                  icon,
                  size: 14,
                  color: isSelected
                      ? (isDark ? Colors.black : Colors.white)
                      : (isDark ? Colors.white70 : const Color(0xFF0F172A)),
                ),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                style: TextStyle(
                  color: isSelected
                      ? (isDark ? Colors.black : Colors.white)
                      : (isDark ? Colors.white70 : const Color(0xFF0F172A)),
                  fontSize: 11.5,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCompactToggle({
    required String label,
    required bool isSelected,
    required bool isDark,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
        decoration: BoxDecoration(
          color: isSelected
              ? (isDark ? Colors.white : const Color(0xFF0F172A))
              : (isDark ? const Color(0xFF202532) : const Color(0xFFF1F5F9)),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected
                ? (isDark ? Colors.black : Colors.white)
                : (isDark ? Colors.white60 : const Color(0xFF64748B)),
            fontSize: 11,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _buildCompactTeamTile({
    required String label,
    required String code,
    required bool isDark,
    VoidCallback? onTap,
  }) {
    final name = _footballTeams[code] ?? code;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF202532) : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(7),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                name,
                style: TextStyle(
                  color: isDark ? Colors.white : const Color(0xFF0F172A),
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (onTap != null)
              const Icon(Icons.keyboard_arrow_down_rounded, size: 15, color: Colors.grey),
          ],
        ),
      ),
    );
  }

  void _showTeamPickerModal({required bool isTeam1}) {
    showModalBottomSheet(
      context: context,
      backgroundColor: widget.isDarkMode ? const Color(0xFF171A23) : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: _footballTeams.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, idx) {
            final entry = _footballTeams.entries.elementAt(idx);
            final isSelected = (isTeam1 ? _selectedTeam1 : _selectedTeam2) == entry.key;
            return ListTile(
              dense: true,
              title: Text(
                entry.value,
                style: TextStyle(
                  color: isSelected
                      ? const Color(0xFFFE2C55)
                      : (widget.isDarkMode ? Colors.white : Colors.black87),
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.normal,
                ),
              ),
              onTap: () {
                setState(() {
                  if (isTeam1) {
                    _selectedTeam1 = entry.key;
                  } else {
                    _selectedTeam2 = entry.key;
                  }
                });
                Navigator.pop(ctx);
              },
            );
          },
        );
      },
    );
  }

  Widget _buildSearchUsersList(bool isDark, Color textPrimary, Color textSecondary) {
    if (_isSearching) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(10),
          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFFE2C55)),
        ),
      );
    }
    if (_searchResults.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(10),
          child: Text('Aucun joueur trouvé.', style: TextStyle(color: Colors.grey, fontSize: 11.5)),
        ),
      );
    }
    return ListView.separated(
      shrinkWrap: true,
      itemCount: _searchResults.length,
      separatorBuilder: (_, _) => Divider(height: 1, color: isDark ? Colors.white10 : Colors.black12),
      itemBuilder: (ctx, i) {
        final u = _searchResults[i];
        final name = u['first_name'] != null || u['last_name'] != null
            ? '${u['first_name'] ?? ''} ${u['last_name'] ?? ''}'.trim()
            : u['username'] ?? 'Joueur';
        final username = u['username'] ?? '';
        final avatar = u['avatar'] != null ? _formatAvatarUrl(u['avatar'].toString()) : null;
        final uid = int.tryParse(u['id']?.toString() ?? '');

        return ListTile(
          dense: true,
          leading: CircleAvatar(
            radius: 12,
            backgroundImage: avatar != null ? NetworkImage(avatar) : null,
            child: avatar == null ? Text(name[0].toUpperCase(), style: const TextStyle(fontSize: 10)) : null,
          ),
          title: Text(name, style: TextStyle(color: textPrimary, fontWeight: FontWeight.w600, fontSize: 12)),
          subtitle: Text('@$username', style: TextStyle(color: textSecondary, fontSize: 10.5)),
          trailing: ElevatedButton(
            onPressed: () {
              setState(() {
                _selectedOpponentId = uid;
                _selectedOpponentName = name;
                _selectedOpponentAvatar = avatar;
                _selectedOpponentUsername = username;
                _searchQuery = '';
                _searchController.clear();
              });
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFE2C55),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              minimumSize: Size.zero,
              elevation: 0,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
            ),
            child: const Text('Choisir', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600)),
          ),
        );
      },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMPACT BOTTOM CTA (SIZED REFINED BUTTON)
  // ══════════════════════════════════════════════════════════════════════════

  Widget _buildCompactBottomCTA(bool isDark) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 8, 16, MediaQuery.of(context).padding.bottom + 8),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF0F1117).withValues(alpha: 0.95) : Colors.white.withValues(alpha: 0.95),
        border: Border(
          top: BorderSide(
            color: isDark ? Colors.white.withValues(alpha: 0.06) : Colors.black.withValues(alpha: 0.06),
          ),
        ),
      ),
      child: SizedBox(
        height: 42,
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () {
            if (_nativeBoardGames.contains(_selectedGame) || _opponentType == 'bot') {
              _startGame();
            } else {
              _openOnlineLobby();
            }
          },
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFFE2C55),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.flash_on_rounded, color: Colors.white, size: 17),
              const SizedBox(width: 6),
              Text(
                _opponentType == 'bot' ? 'Lancer la partie' : 'Défier & Jouer',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  fontFamily: 'Outfit',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIVE MATCHES ARENA (COMPACT PK BATTLE STYLE)
  // ══════════════════════════════════════════════════════════════════════════

  Widget _buildLiveMatchesList(
    bool isDark,
    Color bgCard,
    Color textPrimary,
    Color textSecondary,
    Color borderSubtle,
  ) {
    if (_isLoadingLiveMatches) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(28),
          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFFE2C55)),
        ),
      );
    }

    if (_liveMatches.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(24),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: bgCard,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: borderSubtle),
        ),
        child: Column(
          children: [
            Icon(Icons.videogame_asset_outlined, color: textSecondary, size: 32),
            const SizedBox(height: 10),
            Text(
              'Aucun match en direct',
              style: TextStyle(color: textPrimary, fontSize: 13.5, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              'Les matchs en cours apparaîtront ici.',
              style: TextStyle(color: textSecondary, fontSize: 11.5),
            ),
            const SizedBox(height: 14),
            ElevatedButton(
              onPressed: _fetchLiveMatches,
              style: ElevatedButton.styleFrom(
                backgroundColor: isDark ? const Color(0xFF202532) : const Color(0xFFF1F5F9),
                foregroundColor: textPrimary,
                elevation: 0,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(7)),
              ),
              child: const Text('Actualiser', style: TextStyle(fontSize: 12)),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _liveMatches.length,
      itemBuilder: (context, index) {
        final game = _liveMatches[index];
        final String gameId = game['id'] ?? '';
        final String type = game['gameType'] ?? 'connect4';
        final int round = game['currentRound'] ?? 1;

        final p1 = game['player1'];
        final p2 = game['player2'];

        final String name1 = p1 != null
            ? (p1['first_name'] != null || p1['last_name'] != null
                ? '${p1['first_name'] ?? ''} ${p1['last_name'] ?? ''}'.trim()
                : p1['username'] ?? 'Joueur 1')
            : 'Joueur 1';

        final String name2 = p2 != null
            ? (p2['isBot'] == true
                ? 'Robot IA'
                : (p2['first_name'] != null || p2['last_name'] != null
                    ? '${p2['first_name'] ?? ''} ${p2['last_name'] ?? ''}'.trim()
                    : p2['username'] ?? 'Joueur 2'))
            : 'En attente...';

        final details = _gameDetails[type] ?? _gameDetails['connect4']!;

        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: bgCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: borderSubtle),
          ),
          child: Row(
            children: [
              Icon(details['icon'] as IconData, color: textPrimary, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$name1 vs $name2',
                      style: TextStyle(color: textPrimary, fontWeight: FontWeight.w700, fontSize: 12.5),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${details['title']} • Manche $round',
                      style: TextStyle(color: textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              ElevatedButton(
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => NativeGameBoardPage(
                        currentUserId: widget.currentUserId,
                        currentUserAvatar: widget.currentUserAvatar,
                        gameType: type,
                        opponentType: p2?['isBot'] == true ? 'bot' : 'player',
                        entryMode: game['entryMode'] ?? 'free',
                        betAmount: (game['betAmount'] as num?)?.toDouble() ?? 0.0,
                        rounds: game['rounds'] ?? 1,
                        botDifficulty: '1',
                        opponentId: null,
                        isDarkMode: widget.isDarkMode,
                        gameId: gameId,
                        onBackToLobby: () => Navigator.pop(context),
                      ),
                    ),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFE2C55),
                  foregroundColor: Colors.white,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                ),
                child: const Text('Regarder', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        );
      },
    );
  }
}
