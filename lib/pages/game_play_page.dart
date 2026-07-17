import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'native_game_board_page.dart';


class GamePlayPage extends StatefulWidget {
  final int currentUserId;
  final String? currentUserAvatar;
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
  bool _showNativeBoard = false; // true when playing native connect4/gomoku
  String? _errorMsg;

  // Selected game options
  String _selectedGame = 'connect4'; // connect4, gomoku, ludo, tablefootball, echecs
  String _opponentType = 'bot'; // bot, player
  String _botDifficulty = '1'; // 1=easy, 2=medium, 3=hard
  String _entryMode = 'free'; // free, paid
  double _betAmount = 1.00;
  int _rounds = 1;

  // Search and online players state variables
  final TextEditingController _searchController = TextEditingController();
  List<dynamic> _onlineUsers = [];
  List<dynamic> _searchResults = [];
  bool _isSearching = false;
  bool _isLoadingUsers = false;
  String _searchQuery = '';

  // Tab navigation & Live Matches state
  int _activeTab = 0; // 0 = Création, 1 = Matchs en direct
  int? _selectedOpponentId;
  List<dynamic> _liveMatches = [];
  bool _isLoadingLiveMatches = false;

  /// Games rendered natively (no WebView)
  static const _nativeBoardGames = {'connect4', 'gomoku', 'ludo', 'tablefootball', 'echecs'};

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
    // Native board games use NativeGameBoardPage
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
            opponentId: _opponentType == 'player' ? _selectedOpponentId : null,
          ),
        ),
      );
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
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String? _formatAvatarUrl(String? avatarPath) {
    if (avatarPath == null || avatarPath.isEmpty) return null;
    if (avatarPath.startsWith('http')) return avatarPath;
    final cleanPath = avatarPath.startsWith('/') ? avatarPath : '/$avatarPath';
    return 'https://trasx.com$cleanPath';
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

  Widget _buildPlayersList(bool isDark, Color textColor) {
    if (_searchQuery.isNotEmpty && _isSearching) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16.0),
          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF673DE6)),
        ),
      );
    }

    if (_searchQuery.isEmpty && _isLoadingUsers) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16.0),
          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF673DE6)),
        ),
      );
    }

    final list = _searchQuery.isNotEmpty ? _searchResults : _onlineUsers;

    if (list.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _searchQuery.isNotEmpty ? Icons.search_off_rounded : Icons.people_outline_rounded,
                color: Colors.grey,
                size: 28,
              ),
              const SizedBox(height: 8),
              Text(
                _searchQuery.isNotEmpty
                    ? 'Aucun joueur trouvé'
                    : 'Aucun joueur en ligne actuellement',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.grey, fontSize: 13),
              ),
            ],
          ),
        ),
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.all(8),
      itemCount: list.length,
      separatorBuilder: (context, index) => Divider(height: 1, color: isDark ? Colors.white10 : Colors.black12),
      itemBuilder: (context, index) {
        final player = list[index];
        final name = player['first_name'] != null || player['last_name'] != null
            ? '${player['first_name'] ?? ''} ${player['last_name'] ?? ''}'.trim()
            : player['username'] ?? 'Joueur';
        final username = player['username'] ?? '';
        final avatar = player['avatar'] != null ? _formatAvatarUrl(player['avatar'].toString()) : null;
        
        final bool isOnline = player['isOnline'] == true || player['is_online'] == true;

        final playerId = int.tryParse(player['id']?.toString() ?? '');
        final isSelected = _selectedOpponentId == playerId;

        return GestureDetector(
          onTap: () {
            setState(() {
              _selectedOpponentId = playerId;
            });
          },
          child: Container(
            decoration: BoxDecoration(
              color: isSelected
                  ? (isDark ? const Color(0xFF673DE6).withOpacity(0.15) : const Color(0xFF673DE6).withOpacity(0.08))
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
            ),
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
            child: Row(
              children: [
              CircleAvatar(
                radius: 16,
                backgroundImage: avatar != null && avatar.isNotEmpty ? NetworkImage(avatar) : null,
                child: avatar == null || avatar.isEmpty
                    ? Text(name.substring(0, 1).toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold))
                    : null,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(
                        color: textColor,
                        fontSize: 13.5,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Text(
                          '@$username',
                          style: const TextStyle(
                            color: Colors.grey,
                            fontSize: 11,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: isOnline ? const Color(0xFF22C55E) : Colors.redAccent,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          isOnline ? 'En ligne' : 'N\'est pas en ligne',
                          style: TextStyle(
                            color: isOnline ? const Color(0xFF22C55E) : Colors.redAccent,
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (isOnline)
                Container(
                  height: 30,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [
                        Color(0xFF833AB4),
                        Color(0xFFC13584),
                        Color(0xFFE1306C),
                        Color(0xFFFD1D1D),
                        Color(0xFFF77737),
                        Color(0xFFFCAF45),
                      ],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  padding: const EdgeInsets.all(1.2),
                  child: Container(
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF0F0F0F) : Colors.white,
                      borderRadius: BorderRadius.circular(7.0),
                    ),
                    child: TextButton(
                      onPressed: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => NativeGameBoardPage(
                              currentUserId: widget.currentUserId,
                              currentUserAvatar: widget.currentUserAvatar,
                              gameType: _selectedGame,
                              opponentType: 'player',
                              entryMode: _entryMode,
                              betAmount: _betAmount,
                              rounds: _rounds,
                              botDifficulty: _botDifficulty,
                              opponentId: int.tryParse(player['id']?.toString() ?? ''),
                              isDarkMode: widget.isDarkMode,
                              onBackToLobby: () => Navigator.pop(context),
                            ),
                          ),
                        );
                      },
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: ShaderMask(
                        shaderCallback: (bounds) => const LinearGradient(
                          colors: [
                            Color(0xFF833AB4),
                            Color(0xFFC13584),
                            Color(0xFFE1306C),
                            Color(0xFFFD1D1D),
                            Color(0xFFF77737),
                            Color(0xFFFCAF45),
                          ],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ).createShader(bounds),
                        child: const Text(
                          'Défier',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ),
                )
              else
                Container(
                  height: 30,
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.04),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'Indisponible',
                    style: TextStyle(
                      color: Colors.grey,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_showNativeLobby) {
      return Scaffold(
        backgroundColor: widget.isDarkMode ? const Color(0xFF0B0F19) : const Color(0xFFF4F6FA),
        body: _buildNativeLobby(),
      );
    }

    // WebView integration for other games (ludo, chess, etc.)

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
              backgroundColor: const Color(0xFF673DE6),
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
    final primaryColor = const Color(0xFF673DE6);
    final cardColor = isDark ? const Color(0xFF151F32) : Colors.white;
    final textColor = isDark ? Colors.white : Colors.black87;

    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.only(left: 20.0, right: 20.0, top: 24.0, bottom: 32.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top Tab Bar
          Container(
            height: 48,
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF1E293B).withOpacity(0.5) : const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: isDark ? Colors.white10 : Colors.black12),
            ),
            padding: const EdgeInsets.all(4),
            child: Row(
              children: [
                _buildTabButton(
                  title: 'Créer une partie',
                  isActive: _activeTab == 0,
                  onTap: () {
                    setState(() {
                      _activeTab = 0;
                    });
                  },
                  isDark: isDark,
                ),
                _buildTabButton(
                  title: 'Matchs en direct',
                  isActive: _activeTab == 1,
                  onTap: () {
                    setState(() {
                      _activeTab = 1;
                    });
                    _fetchLiveMatches();
                  },
                  isDark: isDark,
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          if (_activeTab == 0) ...[
            // Header
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
                        children: [
                          Icon(
                            val['icon'] as IconData,
                            color: isSelected ? Colors.white : gradient[0],
                            size: 28,
                          ),
                          const Spacer(),
                          Text(
                            val['title'] as String,
                            style: TextStyle(
                              color: isSelected ? Colors.white : textColor,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            val['desc'] as String,
                            style: TextStyle(
                              color: isSelected ? Colors.white70 : Colors.grey,
                              fontSize: 10,
                              height: 1.2,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  );
                }).toList(),
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


            // Opponent Mode Selector
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
                      _fetchOnlineUsers();
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),


            if (_opponentType == 'player') ...[
              _buildSelectorRow(
                title: 'Rechercher un joueur',
                child: Container(
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isDark ? Colors.white10 : Colors.black12),
                  ),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (val) {
                      setState(() {
                        _searchQuery = val;
                      });
                      _performSearch(val);
                    },
                    style: TextStyle(color: textColor),
                    decoration: InputDecoration(
                      hintText: 'Saisissez le nom d\'utilisateur...',
                      hintStyle: const TextStyle(color: Colors.grey, fontSize: 13.5),
                      prefixIcon: const Icon(Icons.search_rounded, color: Colors.grey, size: 20),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear_rounded, color: Colors.grey, size: 18),
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
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _buildSelectorRow(
                title: _searchQuery.isNotEmpty ? 'Résultats de la recherche' : 'Joueurs en ligne',
                child: Container(
                  constraints: const BoxConstraints(maxHeight: 220),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1E293B).withOpacity(0.5) : const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: isDark ? Colors.white10 : Colors.black12),
                  ),
                  child: _buildPlayersList(isDark, textColor),
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
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Entry Mode settings (Free or Paid)
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
                    label: 'Payant (Mise)',
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

            // Bet amount slider (only if entryMode is Paid)
            if (_entryMode == 'paid') ...[
              _buildSelectorRow(
                title: 'Montant de la mise (Tokens)',
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isDark ? Colors.white10 : Colors.black12),
                  ),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Mise', style: TextStyle(color: textColor, fontSize: 13)),
                          Text(
                            '${_betAmount.toStringAsFixed(2)} Tokens',
                            style: TextStyle(
                              color: primaryColor,
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Slider(
                        value: _betAmount,
                        min: 0.10,
                        max: 10.00,
                        divisions: 99,
                        activeColor: primaryColor,
                        inactiveColor: isDark ? Colors.white24 : Colors.black12,
                        onChanged: (val) {
                          setState(() {
                            _betAmount = val;
                          });
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ],

            const SizedBox(height: 20),

            // Actions Buttons
            Container(
              width: double.infinity,
              height: 45,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFF833AB4),
                    Color(0xFFC13584),
                    Color(0xFFE1306C),
                    Color(0xFFFD1D1D),
                    Color(0xFFF77737),
                    Color(0xFFFCAF45),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFC13584).withOpacity(0.2),
                    blurRadius: 8,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: ElevatedButton(
                onPressed: (_nativeBoardGames.contains(_selectedGame) || _opponentType == 'bot')
                    ? _startGame
                    : _openOnlineLobby,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  foregroundColor: Colors.white,
                  shadowColor: Colors.transparent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 0,
                ),
                child: Text(
                  _opponentType == 'bot' ? 'LANCER LE MATCH' : 'REJOINDRE LE SALON',
                  style: const TextStyle(
                    fontFamily: 'Outfit',
                    fontWeight: FontWeight.w900,
                    fontSize: 14,
                    color: Colors.white,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Online lobbies quick link (only for Web View games)
            if (_opponentType == 'bot' &&
                !_nativeBoardGames.contains(_selectedGame))
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
          ] else ...[
            // Matchs en direct Tab View
            _buildLiveMatchesList(isDark, textColor, cardColor),
          ],
        ],
      ),
    );
  }

  Widget _buildTabButton({
    required String title,
    required bool isActive,
    required VoidCallback onTap,
    required bool isDark,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            gradient: isActive
                ? const LinearGradient(
                    colors: [
                      Color(0xFF833AB4),
                      Color(0xFFC13584),
                      Color(0xFFE1306C),
                      Color(0xFFFD1D1D),
                      Color(0xFFF77737),
                      Color(0xFFFCAF45),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : null,
            borderRadius: BorderRadius.circular(9),
          ),
          alignment: Alignment.center,
          child: Text(
            title,
            style: TextStyle(
              color: isActive ? Colors.white : (isDark ? Colors.white60 : Colors.black54),
              fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
              fontSize: 13,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLiveMatchesList(bool isDark, Color textColor, Color cardColor) {
    if (_isLoadingLiveMatches) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(40.0),
          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF673DE6)),
        ),
      );
    }

    if (_liveMatches.isEmpty) {
      return RefreshIndicator(
        onRefresh: _fetchLiveMatches,
        color: const Color(0xFF673DE6),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: Container(
            height: 300,
            alignment: Alignment.center,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.videogame_asset_outlined, color: Colors.grey, size: 48),
                const SizedBox(height: 12),
                Text(
                  'Aucun match en direct actuellement.',
                  style: TextStyle(color: textColor.withOpacity(0.6), fontSize: 14),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _fetchLiveMatches,
                  child: const Text('Actualiser', style: TextStyle(color: Color(0xFF673DE6), fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchLiveMatches,
      color: const Color(0xFF673DE6),
      child: ListView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _liveMatches.length,
        itemBuilder: (context, index) {
          final game = _liveMatches[index];
          final String gameId = game['id'] ?? '';
          final String type = game['gameType'] ?? 'connect4';
          final String status = game['status'] ?? 'playing';
          final int round = game['currentRound'] ?? 1;

          final p1 = game['player1'];
          final p2 = game['player2'];

          final String name1 = p1 != null
              ? (p1['first_name'] != null || p1['last_name'] != null
                  ? '${p1['first_name'] ?? ''} ${p1['last_name'] ?? ''}'.trim()
                  : p1['username'] ?? 'Joueur 1')
              : 'Joueur 1';

          final String name2 = p2 != null
              ? (p2['isBot'] == true ? 'Robot IA' : (p2['first_name'] != null || p2['last_name'] != null
                  ? '${p2['first_name'] ?? ''} ${p2['last_name'] ?? ''}'.trim()
                  : p2['username'] ?? 'Joueur 2'))
              : 'En attente...';

          final details = _gameDetails[type] ?? _gameDetails['connect4']!;
          final List<Color> gradient = details['gradient'] as List<Color>;
          final String title = details['title'] ?? 'Puissance 4';

          return Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isDark ? Colors.white10 : Colors.black12),
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: gradient,
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    details['icon'] as IconData? ?? Icons.grid_3x3_outlined,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: textColor,
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$name1 vs $name2',
                        style: const TextStyle(
                          color: Colors.grey,
                          fontSize: 13,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: status == 'playing' ? Colors.green.withOpacity(0.1) : Colors.orange.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              status == 'playing' ? 'En cours' : 'Attente',
                              style: TextStyle(
                                color: status == 'playing' ? Colors.green : Colors.orange,
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Manche $round',
                            style: const TextStyle(
                              color: Colors.grey,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  height: 32,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [
                        Color(0xFF833AB4),
                        Color(0xFFC13584),
                        Color(0xFFE1306C),
                        Color(0xFFFD1D1D),
                        Color(0xFFF77737),
                        Color(0xFFFCAF45),
                      ],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: ElevatedButton(
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
                      backgroundColor: Colors.transparent,
                      foregroundColor: Colors.white,
                      shadowColor: Colors.transparent,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      elevation: 0,
                    ),
                    child: const Text(
                      'Regarder',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
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
    final isDark = widget.isDarkMode;

    return Expanded(
      child: GestureDetector(
        onTap: onPressed,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 40,
          decoration: BoxDecoration(
            color: isSelected
                ? (isDark ? Colors.white.withOpacity(0.1) : const Color(0xFF673DE6).withOpacity(0.08))
                : (isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03)),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected
                  ? const Color(0xFF673DE6).withOpacity(0.5)
                  : (isDark ? Colors.white10 : Colors.black12),
              width: isSelected ? 1.5 : 1.0,
            ),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (isSelected) ...[
                const Icon(
                  Icons.check_circle_rounded,
                  size: 14,
                  color: Color(0xFF673DE6),
                ),
                const SizedBox(width: 6),
              ],
              Text(
                label,
                style: TextStyle(
                  color: isSelected
                      ? const Color(0xFF673DE6)
                      : (isDark ? Colors.white70 : Colors.black87),
                  fontSize: 12.5,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
