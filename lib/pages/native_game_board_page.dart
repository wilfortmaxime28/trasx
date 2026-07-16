import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/game_socket_service.dart';
import '../widgets/connect4_board.dart';
import '../widgets/gomoku_board.dart';

/// Shown after the user picks a game type in the lobby.
/// Handles:
///  1. Creating the game via REST  → gets gameId
///  2. Connecting to Socket.IO and joining the room
///  3. Rendering the correct native board widget
///  4. Emitting moves and reacting to game-state-updated / game-over
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

class _NativeGameBoardPageState extends State<NativeGameBoardPage> {
  // ── State ────────────────────────────────────────────────────────────────
  String _phase = 'creating'; // creating | playing | over | error
  String? _errorMsg;
  String? _gameId;

  Map<String, dynamic>? _game;    // full game object from server
  Map<String, dynamic>? _lastMove;
  List<Map<String, dynamic>>? _winningStones;
  Map<String, dynamic>? _gameOverData;

  final List<StreamSubscription> _subs = [];

  // ── Init ─────────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    _createGame();
  }

  @override
  void dispose() {
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
    if (_myTurn) return 'Votre tour';
    return 'Tour de l\'adversaire…';
  }

  String get _gameOverLabel {
    final data = _gameOverData;
    if (data == null) return 'Partie terminée';
    final winnerId = data['winnerId'];
    if (winnerId == null || winnerId == 'draw') return 'Match nul !';
    if (winnerId.toString() == '${widget.currentUserId}') return '🏆 Victoire !';
    return '😔 Défaite…';
  }

  Color get _turnLabelColor {
    if (_phase == 'over') {
      final winnerId = _gameOverData?['winnerId'];
      if (winnerId == null || winnerId == 'draw') return Colors.orange;
      if (winnerId.toString() == '${widget.currentUserId}') return Colors.greenAccent;
      return Colors.redAccent;
    }
    return _myTurn ? Colors.greenAccent : Colors.white54;
  }

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
    final surfaceColor = isDark ? const Color(0xFF151F32) : Colors.white;

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: _phase == 'creating'
            ? _buildLoading()
            : _phase == 'error'
                ? _buildError()
                : _buildGameUI(surfaceColor, isDark),
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

  Widget _buildGameUI(Color surfaceColor, bool isDark) {
    return Column(
      children: [
        // ── Top Bar ──────────────────────────────────────────────────────
        _buildTopBar(surfaceColor, isDark),

        // ── Players Row ──────────────────────────────────────────────────
        _buildPlayersRow(isDark),

        // ── Status chip ──────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 300),
            child: Container(
              key: ValueKey(_turnLabel),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              decoration: BoxDecoration(
                color: _turnLabelColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: _turnLabelColor.withOpacity(0.3)),
              ),
              child: Text(
                _turnLabel,
                style: TextStyle(
                  color: _turnLabelColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ),
        ),

        // ── Board ─────────────────────────────────────────────────────────
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Center(child: _buildBoard()),
          ),
        ),

        // ── Action buttons when game over ─────────────────────────────────
        if (_phase == 'over') _buildGameOverActions(),

        const SizedBox(height: 12),
      ],
    );
  }

  Widget _buildTopBar(Color surfaceColor, bool isDark) {
    final gameTitle = _gameTitleMap[widget.gameType] ?? 'Jeu';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: surfaceColor,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: widget.onBackToLobby,
            icon: const Icon(Icons.arrow_back_ios_new_rounded),
            color: isDark ? Colors.white : Colors.black87,
            iconSize: 20,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
          const SizedBox(width: 12),
          Text(
            gameTitle,
            style: TextStyle(
              fontFamily: 'Outfit',
              fontWeight: FontWeight.w800,
              fontSize: 18,
              color: isDark ? Colors.white : Colors.black87,
            ),
          ),
          const Spacer(),
          // Round badge
          if ((_game?['rounds'] ?? 1) > 1) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFF6F63FF).withOpacity(0.15),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                'Manche ${_game?['currentRound'] ?? 1}/${_game?['rounds'] ?? 1}',
                style: const TextStyle(
                  color: Color(0xFF8B7FFF),
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPlayersRow(bool isDark) {
    final me = _me;
    final opp = _opponent;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          _buildPlayerCard(
            name: me?['name'] ?? 'Vous',
            avatar: me?['avatar'],
            symbol: _mySymbol,
            isActive: _myTurn && _phase == 'playing',
            wins: (_game?['roundWins']?['player${_mySymbol == 1 ? 1 : 2}'] ?? 0),
            isDark: isDark,
          ),
          const Expanded(
            child: Center(
              child: Text(
                'VS',
                style: TextStyle(
                  fontFamily: 'Outfit',
                  fontWeight: FontWeight.w900,
                  fontSize: 16,
                  color: Colors.white38,
                ),
              ),
            ),
          ),
          _buildPlayerCard(
            name: opp?['name'] ?? 'Adversaire',
            avatar: opp?['avatar'],
            symbol: _mySymbol == 1 ? 2 : 1,
            isActive: !_myTurn && _phase == 'playing',
            wins: (_game?['roundWins']?['player${_mySymbol == 1 ? 2 : 1}'] ?? 0),
            isDark: isDark,
            isRight: true,
          ),
        ],
      ),
    );
  }

  Widget _buildPlayerCard({
    required String name,
    String? avatar,
    required int symbol,
    required bool isActive,
    required int wins,
    required bool isDark,
    bool isRight = false,
  }) {
    final symbolColor = symbol == 1
        ? const Color(0xFFEF4444)
        : widget.gameType == 'gomoku'
            ? const Color(0xFFF5F5DC)
            : const Color(0xFFFACC15);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: isActive
            ? symbolColor.withOpacity(0.12)
            : (isDark ? const Color(0xFF1A2540) : Colors.white),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isActive ? symbolColor.withOpacity(0.5) : Colors.transparent,
          width: 1.5,
        ),
      ),
      child: Column(
        children: [
          // Avatar
          CircleAvatar(
            radius: 20,
            backgroundColor: symbolColor.withOpacity(0.2),
            backgroundImage: avatar != null && avatar.isNotEmpty
                ? NetworkImage(avatar)
                : null,
            child: avatar == null || avatar.isEmpty
                ? Text(
                    name.substring(0, 1).toUpperCase(),
                    style: TextStyle(
                      color: symbolColor,
                      fontWeight: FontWeight.bold,
                    ),
                  )
                : null,
          ),
          const SizedBox(height: 4),
          Text(
            name.length > 10 ? '${name.substring(0, 9)}…' : name,
            style: TextStyle(
              fontSize: 11,
              fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
              color: isDark ? Colors.white70 : Colors.black87,
            ),
          ),
          if ((_game?['rounds'] ?? 1) > 1) ...[
            const SizedBox(height: 2),
            Row(
              children: List.generate(
                _game?['rounds'] ?? 1,
                (i) => Container(
                  width: 6,
                  height: 6,
                  margin: const EdgeInsets.only(right: 2),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: i < wins
                        ? symbolColor
                        : Colors.white12,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBoard() {
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
      );
    }

    // Fallback text for unsupported boards (ludo, chess, tablefootball)
    return Center(
      child: Text(
        'Tableau pour ${widget.gameType} à venir.',
        style: const TextStyle(color: Colors.white54),
      ),
    );
  }

  Widget _buildGameOverActions() {
    final label = _gameOverLabel;
    final isWin = _gameOverData?['winnerId']?.toString() ==
        '${widget.currentUserId}';
    final isDraw = _gameOverData?['winnerId'] == null ||
        _gameOverData?['winnerId'] == 'draw';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(
              fontFamily: 'Outfit',
              fontSize: 22,
              fontWeight: FontWeight.w900,
              color: isDraw
                  ? Colors.orange
                  : isWin
                      ? Colors.greenAccent
                      : Colors.redAccent,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: widget.onBackToLobby,
                  icon: const Icon(Icons.home_outlined),
                  label: const Text('Accueil'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white70,
                    side: const BorderSide(color: Colors.white24),
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
                    backgroundColor: const Color(0xFF6F63FF),
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
        ],
      ),
    );
  }

  static const Map<String, String> _gameTitleMap = {
    'connect4': 'Puissance 4',
    'gomoku': 'Gomoku',
    'ludo': 'Ludo',
    'tablefootball': 'Baby-foot',
    'echecs': 'Échecs',
  };
}
