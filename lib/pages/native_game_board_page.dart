import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/game_socket_service.dart';
import '../widgets/connect4_board.dart';
import '../widgets/gomoku_board.dart';

/// Shown after the user picks a game type in the lobby.
/// Replicates the web active match layout, including the scoreboard, headers, and status bars.
class NativeGameBoardPage extends StatefulWidget {
  final int currentUserId;
  final String gameType;     // connect4 | gomoku
  final String opponentType; // bot | player
  final String entryMode;    // free | paid
  final double betAmount;
  final int rounds;
  final String botDifficulty; // 1 | 2 | 3
  final bool isDarkMode;
  final VoidCallback onBackToLobby;

  const NativeGameBoardPage({
    super.key,
    required this.currentUserId,
    required this.gameType,
    required this.opponentType,
    required this.entryMode,
    required this.betAmount,
    required this.rounds,
    required this.botDifficulty,
    required this.isDarkMode,
    required this.onBackToLobby,
  });

  @override
  State<NativeGameBoardPage> createState() => _NativeGameBoardPageState();
}

class _NativeGameBoardPageState extends State<NativeGameBoardPage>
    with SingleTickerProviderStateMixin {
  // ── State ────────────────────────────────────────────────────────────────
  String _phase = 'creating'; // creating | playing | over | error
  String? _errorMsg;
  String? _gameId;

  Map<String, dynamic>? _game;    // full game object from server
  Map<String, dynamic>? _lastMove;
  List<Map<String, dynamic>>? _winningStones;
  Map<String, dynamic>? _gameOverData;

  final List<StreamSubscription> _subs = [];

  // Active turn ring animation
  late AnimationController _turnRingController;
  late Animation<double> _turnRingAnimation;

  // ── Init ─────────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    _turnRingController = AnimationController(
      duration: const Duration(milliseconds: 1200),
      vsync: this,
    )..repeat(reverse: true);
    _turnRingAnimation = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(parent: _turnRingController, curve: Curves.easeInOut),
    );
    _createGame();
  }

  @override
  void dispose() {
    _turnRingController.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    GameSocketService.instance.leaveRoom();
    super.dispose();
  }

  // ── Create game via REST ─────────────────────────────────────────────────
  Future<void> _createGame() async {
    debugPrint('[GameBoard] Starting game creation for user ${widget.currentUserId} and game type ${widget.gameType}');
    setState(() {
      _phase = 'creating';
      _errorMsg = null;
    });

    try {
      final requestBody = jsonEncode({
        'gameType': widget.gameType,
        'opponentType': widget.opponentType,
        'entryMode': widget.entryMode,
        'betAmount': widget.betAmount,
        'rounds': widget.rounds,
        'botId': widget.botDifficulty,
      });
      debugPrint('[GameBoard] POST Request body: $requestBody');

      final response = await http.post(
        Uri.parse('https://trasx.com/api/games/create-mobile'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
        body: requestBody,
      ).timeout(const Duration(seconds: 15));

      debugPrint('[GameBoard] Server Response Code: ${response.statusCode}');
      debugPrint('[GameBoard] Server Response Body: ${response.body}');

      if (response.statusCode != 200) {
        throw Exception('Erreur serveur (${response.statusCode})');
      }

      final data = jsonDecode(response.body);
      if (data['success'] != true) {
        throw Exception(data['error'] ?? 'Impossible de créer la partie.');
      }

      _gameId = data['gameId'] as String;
      debugPrint('[GameBoard] Game created successfully. Game ID: $_gameId');

      // Build game map from flat response fields
      _game = {
        'id': data['gameId'],
        'gameType': data['gameType'],
        'status': data['status'],
        'board': data['board'],
        'currentPlayer': data['currentPlayer'],
        'player1': data['player1'],
        'player2': data['player2'],
        'rounds': data['rounds'],
        'currentRound': data['currentRound'],
        'roundWins': data['roundWins'],
      };

      // Connect socket and join room
      debugPrint('[GameBoard] Connecting socket for user ${widget.currentUserId}');
      await GameSocketService.instance.connect(userId: widget.currentUserId);
      debugPrint('[GameBoard] Socket configured. Joining room: game:$_gameId');
      GameSocketService.instance.joinRoom(_gameId!);

      _listenToSocket();

      debugPrint('[GameBoard] Done. Switching phase to playing');
      setState(() => _phase = 'playing');
    } catch (e, stackTrace) {
      debugPrint('[GameBoard] Error creating game: $e');
      debugPrint('[GameBoard] Stacktrace: $stackTrace');
      setState(() {
        _phase = 'error';
        _errorMsg = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  // ── Forfeit game ─────────────────────────────────────────────────────────
  void _forfeitGame() {
    if (_gameId == null) return;
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Abandonner', style: TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Outfit')),
        content: const Text('Êtes-vous sûr de vouloir abandonner la partie ?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Annuler', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              // In client.js, forfeit is done by emitting forfeitGame socket message
              // Let's implement it inside GameSocketService
              GameSocketService.instance.leaveRoom();
              widget.onBackToLobby();
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            child: const Text('Abandonner', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  // ── Socket listeners ──────────────────────────────────────────────────────
  void _listenToSocket() {
    _subs.add(
      GameSocketService.instance.onGameStateUpdated.listen((data) {
        if (!mounted) return;
        final game = data['game'];
        if (game is Map) {
          setState(() {
            _game = Map<String, dynamic>.from(game);
            _lastMove = _game?['lastMove'] != null
                ? Map<String, dynamic>.from(_game!['lastMove'])
                : null;
            _winningStones = null; // clear winning on state update
          });
        }
      }),
    );

    _subs.add(
      GameSocketService.instance.onGameStarted.listen((game) {
        if (!mounted) return;
        setState(() {
          _game = Map<String, dynamic>.from(game);
          _phase = 'playing';
        });
      }),
    );

    _subs.add(
      GameSocketService.instance.onGameOver.listen((data) {
        if (!mounted) return;
        setState(() {
          _gameOverData = Map<String, dynamic>.from(data);
          _phase = 'over';
          // Apply winning stones if any
          final stones = data['winningStones'];
          if (stones is List) {
            _winningStones = stones
                .map((s) => Map<String, dynamic>.from(s))
                .toList();
          }
        });
      }),
    );

    _subs.add(
      GameSocketService.instance.onRoundOver.listen((data) {
        if (!mounted) return;
        // Show snackbar for round over, game continues
        final roundWins = data['roundWins'];
        if (mounted && roundWins != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Manche terminée ! Score: ${roundWins['player1']} - ${roundWins['player2']}',
              ),
              backgroundColor: const Color(0xFF1E293B),
              duration: const Duration(seconds: 3),
            ),
          );
        }
      }),
    );
  }

  // ── Emit move ─────────────────────────────────────────────────────────────
  void _onConnect4ColTap(int col) {
    if (_gameId == null) return;
    GameSocketService.instance.emitMove(
      gameId: _gameId!,
      r: null,
      c: col,
    );
  }

  void _onGomokuCellTap(int row, int col) {
    if (_gameId == null) return;
    GameSocketService.instance.emitMove(
      gameId: _gameId!,
      r: row,
      c: col,
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  int get _mySymbol {
    final g = _game;
    if (g == null) return 1;
    final p1 = g['player1'];
    if (p1 is Map && p1['id']?.toString() == '${widget.currentUserId}') {
      return p1['symbol'] ?? 1;
    }
    final p2 = g['player2'];
    if (p2 is Map && p2['id']?.toString() == '${widget.currentUserId}') {
      return p2['symbol'] ?? 2;
    }
    return 1;
  }

  int get _currentPlayerSymbol {
    return _game?['currentPlayer'] ?? 1;
  }

  bool get _myTurn => _currentPlayerSymbol == _mySymbol;

  String get _turnLabel {
    if (_phase == 'over') return _gameOverLabel;
    if (_myTurn) return "C'est à votre tour";
    return "Tour de l'adversaire…";
  }

  String get _gameOverLabel {
    final data = _gameOverData;
    if (data == null) return 'Partie terminée';
    final winnerId = data['winnerId'];
    if (winnerId == null || winnerId == 'draw') return 'Match nul !';
    if (winnerId.toString() == '${widget.currentUserId}') return 'Victoire !';
    return 'Défaite…';
  }

  // Web design variables mapped to Flutter colors
  Color get _primaryColor => widget.isDarkMode ? const Color(0xFF38BDF8) : const Color(0xFF1877F2);
  Color get _primaryLightColor => widget.isDarkMode ? const Color(0x1F38BDF8) : const Color(0x1A1877F2);
  Color get _cardBgColor => widget.isDarkMode ? const Color(0xFF151F32) : const Color(0xFFFFFFFF);
  Color get _borderColor => widget.isDarkMode ? const Color(0xFF1E293B) : const Color(0xFFEBEDF0);
  Color get _textPrimaryColor => widget.isDarkMode ? const Color(0xFFF8FAFC) : const Color(0xFF1C1E21);
  Color get _textSecondaryColor => widget.isDarkMode ? const Color(0xFF94A3B8) : const Color(0xFF606770);

  Map<String, dynamic>? get _opponent {
    final g = _game;
    if (g == null) return null;
    final p1 = g['player1'];
    if (p1 is Map && p1['id']?.toString() == '${widget.currentUserId}') {
      return g['player2'] is Map ? Map<String, dynamic>.from(g['player2']) : null;
    }
    return p1 is Map ? Map<String, dynamic>.from(p1) : null;
  }

  Map<String, dynamic>? get _me {
    final g = _game;
    if (g == null) return null;
    final p1 = g['player1'];
    if (p1 is Map && p1['id']?.toString() == '${widget.currentUserId}') {
      return Map<String, dynamic>.from(p1);
    }
    return g['player2'] is Map ? Map<String, dynamic>.from(g['player2']) : null;
  }

  List<List<int>> get _board {
    final raw = _game?['board'];
    if (raw is List) {
      return raw
          .map<List<int>>((row) => (row as List).map<int>((c) => (c ?? 0) as int).toList())
          .toList();
    }
    // Default empty board
    if (widget.gameType == 'connect4') {
      return List.generate(6, (_) => List.generate(7, (_) => 0));
    }
    return List.generate(15, (_) => List.generate(15, (_) => 0));
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final isDark = widget.isDarkMode;
    final bg = isDark ? const Color(0xFF0B0F19) : const Color(0xFFF4F6FA);

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: _phase == 'creating'
            ? _buildLoading()
            : _phase == 'error'
                ? _buildError()
                : _buildGameUI(isDark),
      ),
    );
  }

  Widget _buildLoading() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: Color(0xFF6F63FF)),
          SizedBox(height: 16),
          Text(
            'Création de la partie…',
            style: TextStyle(color: Colors.white60),
          ),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 56),
            const SizedBox(height: 16),
            Text(
              _errorMsg ?? 'Erreur inconnue',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 15),
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton.icon(
                  onPressed: widget.onBackToLobby,
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Retour'),
                  style: TextButton.styleFrom(foregroundColor: Colors.white70),
                ),
                const SizedBox(width: 16),
                ElevatedButton.icon(
                  onPressed: _createGame,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Réessayer'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6F63FF),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGameUI(bool isDark) {
    return Column(
      children: [
        // ── active-game-header ──────────────────────────────────────────
        _buildActiveGameHeader(isDark),

        const SizedBox(height: 12),

        // ── game-scoreboard ──────────────────────────────────────────────
        _buildGameScoreboard(isDark),

        const SizedBox(height: 12),

        // ── game-turn-status-bar ─────────────────────────────────────────
        _buildGameTurnStatusBar(),

        const SizedBox(height: 12),

        // ── Board area ────────────────────────────────────────────────────
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Center(child: _buildBoardWidget()),
          ),
        ),

        // ── Action buttons when game over ─────────────────────────────────
        if (_phase == 'over') _buildGameOverActions(),

        const SizedBox(height: 12),
      ],
    );
  }

  Widget _buildActiveGameHeader(bool isDark) {
    final gameTitle = widget.gameType == 'connect4' ? 'Puissance 4' : 'Gomoku';
    final entryModeText = widget.entryMode == 'paid' ? '${widget.betAmount.toStringAsFixed(2)} Tokens' : 'Mode Gratuit';

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: _cardBgColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _borderColor, width: 1),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 6,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        children: [
          // Leave / Back button
          GestureDetector(
            onTap: widget.onBackToLobby,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: isDark ? Colors.white.withOpacity(0.05) : Colors.black.withOpacity(0.04),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.arrow_back, color: _textPrimaryColor, size: 20),
            ),
          ),
          const SizedBox(width: 12),

          // Title & Mode Subtitle
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  gameTitle,
                  style: TextStyle(
                    fontFamily: 'Outfit',
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    color: _textPrimaryColor,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  entryModeText,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: _textSecondaryColor,
                  ),
                ),
              ],
            ),
          ),

          // Forfeit Button (Abandonner)
          if (_phase == 'playing')
            TextButton(
              onPressed: _forfeitGame,
              style: TextButton.styleFrom(
                foregroundColor: Colors.redAccent,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: Colors.redAccent, width: 1),
                ),
              ),
              child: const Text(
                'Abandonner',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, fontFamily: 'Outfit'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildGameScoreboard(bool isDark) {
    final me = _me;
    final opp = _opponent;

    final mySymbol = _mySymbol;
    final oppSymbol = mySymbol == 1 ? 2 : 1;

    final myWins = _game?['roundWins']?['player${mySymbol == 1 ? 1 : 2}'] ?? 0;
    final oppWins = _game?['roundWins']?['player${mySymbol == 1 ? 2 : 1}'] ?? 0;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      decoration: BoxDecoration(
        color: _cardBgColor,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: _borderColor, width: 1),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          // Player 1 (Me)
          Expanded(
            child: _buildScoreboardPlayerCard(
              name: me?['name'] ?? 'Vous',
              avatar: me?['avatar'],
              symbol: mySymbol,
              isActive: _myTurn && _phase == 'playing',
              wins: myWins,
              isDark: isDark,
              isP1: true,
            ),
          ),

          // VS circle
          Container(
            width: 38,
            height: 38,
            margin: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: isDark ? Colors.white.withOpacity(0.05) : Colors.black.withOpacity(0.04),
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: const Text(
              'VS',
              style: TextStyle(
                fontFamily: 'Outfit',
                fontWeight: FontWeight.w900,
                fontSize: 14,
                color: Colors.grey,
              ),
            ),
          ),

          // Player 2 (Opponent)
          Expanded(
            child: _buildScoreboardPlayerCard(
              name: opp?['name'] ?? 'Adversaire',
              avatar: opp?['avatar'],
              symbol: oppSymbol,
              isActive: !_myTurn && _phase == 'playing',
              wins: oppWins,
              isDark: isDark,
              isP1: false,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScoreboardPlayerCard({
    required String name,
    String? avatar,
    required int symbol,
    required bool isActive,
    required int wins,
    required bool isDark,
    required bool isP1,
  }) {
    // Player colors mapping to Web:
    // P1 (Me): blue, P2 (Opponent): pink
    final playerColor = isP1 ? _primaryColor : const Color(0xFFEC4899);
    final score = wins.toString();

    // Symbol Badge details
    final String symbolLabel = widget.gameType == 'connect4'
        ? (symbol == 1 ? 'Rouge' : 'Jaune')
        : (symbol == 1 ? 'Noir (X)' : 'Blanc (O)');
        
    final Color symbolBadgeBg = isP1
        ? _primaryLightColor
        : const Color(0xFFEC4899).withOpacity(0.1);
    
    final Color symbolBadgeText = isP1
        ? _primaryColor
        : const Color(0xFFEC4899);

    return Row(
      textDirection: isP1 ? TextDirection.ltr : TextDirection.rtl,
      children: [
        // Avatar stack (shows pulsing green ring on turn active)
        Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            if (isActive)
              AnimatedBuilder(
                animation: _turnRingAnimation,
                builder: (context, child) {
                  return Transform.scale(
                    scale: _turnRingAnimation.value,
                    child: Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFF10B981).withOpacity(0.4), width: 2.5),
                      ),
                    ),
                  );
                },
              ),
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: playerColor, width: 2),
                image: avatar != null && avatar.isNotEmpty
                    ? DecorationImage(image: NetworkImage(avatar), fit: BoxFit.cover)
                    : null,
              ),
              alignment: Alignment.center,
              child: avatar == null || avatar.isEmpty
                  ? Text(
                      name.substring(0, 1).toUpperCase(),
                      style: TextStyle(
                        color: playerColor,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    )
                  : null,
            ),
          ],
        ),
        const SizedBox(width: 10),

        // Meta Column
        Expanded(
          child: Column(
            crossAxisAlignment: isP1 ? CrossAxisAlignment.start : CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                name,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: _textPrimaryColor,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Niveau 1',
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w600,
                  color: _textSecondaryColor,
                ),
              ),
              const SizedBox(height: 2),
              // Symbol badge (.player-symbol-badge)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                decoration: BoxDecoration(
                  color: symbolBadgeBg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  symbolLabel,
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: symbolBadgeText,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),

        // Score Badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF1B273F) : const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: _borderColor, width: 1),
          ),
          child: Text(
            score,
            style: TextStyle(
              fontFamily: 'Outfit',
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: playerColor,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildGameTurnStatusBar() {
    // Replicates web .game-turn-status-bar
    final label = _turnLabel;
    final isWin = _phase == 'over' && _gameOverData?['winnerId']?.toString() == '${widget.currentUserId}';
    final isDraw = _phase == 'over' && (_gameOverData?['winnerId'] == null || _gameOverData?['winnerId'] == 'draw');

    Color bg;
    Color text;
    Color border;

    if (_phase == 'over') {
      if (isWin) {
        bg = const Color(0x1F10B981); // rgba(16, 185, 129, 0.1)
        text = const Color(0xFF10B981);
        border = const Color(0x3310B981);
      } else if (isDraw) {
        bg = const Color(0x1F64748B); // rgba(100, 116, 139, 0.1)
        text = const Color(0xFF64748B);
        border = const Color(0x3364748B);
      } else {
        bg = const Color(0x1FEF4444); // red
        text = const Color(0xFFEF4444);
        border = const Color(0x33EF4444);
      }
    } else {
      // Normal playing turn
      bg = _primaryLightColor;
      text = _primaryColor;
      border = _primaryColor.withOpacity(0.15);
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: border, width: 1),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            style: TextStyle(
              color: text,
              fontWeight: FontWeight.w700,
              fontSize: 13.5,
              fontFamily: 'Outfit',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBoardWidget() {
    final board = _board;
    final isOver = _phase == 'over';

    if (widget.gameType == 'connect4') {
      return Connect4Board(
        board: board,
        currentPlayerSymbol: _currentPlayerSymbol,
        mySymbol: _mySymbol,
        myTurn: _myTurn && !isOver,
        gameOver: isOver,
        winningStones: _winningStones,
        lastMove: _lastMove,
        onColumnTap: _onConnect4ColTap,
        isDarkMode: widget.isDarkMode,
      );
    } else if (widget.gameType == 'gomoku') {
      return GomokuBoard(
        board: board,
        currentPlayerSymbol: _currentPlayerSymbol,
        mySymbol: _mySymbol,
        myTurn: _myTurn && !isOver,
        gameOver: isOver,
        winningStones: _winningStones,
        lastMove: _lastMove,
        onCellTap: _onGomokuCellTap,
        isDarkMode: widget.isDarkMode,
      );
    }

    return Center(
      child: Text(
        'Tableau pour ${widget.gameType} à venir.',
        style: const TextStyle(color: Colors.white54),
      ),
    );
  }

  Widget _buildGameOverActions() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: widget.onBackToLobby,
              icon: const Icon(Icons.home_outlined),
              label: const Text('Lobby'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _textPrimaryColor,
                side: BorderSide(color: _borderColor),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: _createGame,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Rejouer'),
              style: ElevatedButton.styleFrom(
                backgroundColor: _primaryColor,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
