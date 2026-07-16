import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Singleton Socket.IO service dedicated to live game rooms.
///
/// Usage:
///   final svc = GameSocketService.instance;
///   await svc.connect(userId: 42);
///   svc.joinRoom(gameId: 'abc-123');
///   svc.onGameStateUpdated.listen((data) { ... });
///   svc.emitMove(gameId: 'abc-123', r: null, c: 3); // connect4 column
///   svc.dispose();
class GameSocketService {
  GameSocketService._();
  static final GameSocketService instance = GameSocketService._();

  io.Socket? _socket;
  String? _currentGameId;

  // ── Event stream controllers ───────────────────────────────────────────────
  final _stateController = StreamController<Map<String, dynamic>>.broadcast();
  final _gameOverController = StreamController<Map<String, dynamic>>.broadcast();
  final _roundOverController = StreamController<Map<String, dynamic>>.broadcast();
  final _startedController = StreamController<Map<String, dynamic>>.broadcast();
  final _connectionController = StreamController<bool>.broadcast();

  Stream<Map<String, dynamic>> get onGameStateUpdated => _stateController.stream;
  Stream<Map<String, dynamic>> get onGameOver => _gameOverController.stream;
  Stream<Map<String, dynamic>> get onRoundOver => _roundOverController.stream;
  Stream<Map<String, dynamic>> get onGameStarted => _startedController.stream;
  Stream<bool> get onConnectionChanged => _connectionController.stream;

  bool get isConnected => _socket?.connected ?? false;

  // ── Connect ────────────────────────────────────────────────────────────────
  Future<void> connect({required int userId}) async {
    if (_socket != null && _socket!.connected) return;

    _socket?.dispose();
    _socket = io.io(
      'https://trasx.com:443',
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .setAuth({'userId': userId})
          .setQuery({'userId': userId})
          .setExtraHeaders({'x-user-id': '$userId'})
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionAttempts(10)
          .setReconnectionDelay(2000)
          .build(),
    );

    _socket!.connect();

    _socket!.onConnect((_) {
      debugPrint('[GameSocket] Connected');
      _connectionController.add(true);
      // Re-join game room after reconnect
      if (_currentGameId != null) {
        _joinRoomInternal(_currentGameId!);
      }
    });

    _socket!.onDisconnect((_) {
      debugPrint('[GameSocket] Disconnected');
      _connectionController.add(false);
    });

    _socket!.onConnectError((err) {
      debugPrint('[GameSocket] Connect error: $err');
      _connectionController.add(false);
    });

    _registerEventHandlers();
  }

  // ── Register game event listeners ─────────────────────────────────────────
  void _registerEventHandlers() {
    _socket!.on('game-state-updated', (data) {
      debugPrint('[GameSocket] game-state-updated received');
      if (data is Map) {
        _stateController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('game-started', (data) {
      debugPrint('[GameSocket] game-started received');
      if (data is Map) {
        _startedController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('game-over', (data) {
      debugPrint('[GameSocket] game-over received');
      if (data is Map) {
        _gameOverController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('game-round-over', (data) {
      debugPrint('[GameSocket] game-round-over received');
      if (data is Map) {
        _roundOverController.add(Map<String, dynamic>.from(data));
      }
    });
  }

  // ── Join game room ─────────────────────────────────────────────────────────
  void joinRoom(String gameId) {
    _currentGameId = gameId;
    if (_socket?.connected ?? false) {
      _joinRoomInternal(gameId);
    }
    // If not yet connected, onConnect will call _joinRoomInternal once ready
  }

  void _joinRoomInternal(String gameId) {
    _socket!.emit('game-room-join', {'gameId': gameId});
    debugPrint('[GameSocket] Joined room: game:$gameId');
  }

  // ── Leave game room ────────────────────────────────────────────────────────
  void leaveRoom() {
    _currentGameId = null;
  }

  // ── Emit a move ───────────────────────────────────────────────────────────
  /// [gameId] — the active game id
  /// [r]      — row (required for gomoku; null for connect4)
  /// [c]      — column (always required)
  /// Extra fields for chess / ludo are passed via [extra]
  void emitMove({
    required String gameId,
    int? r,
    required int c,
    Map<String, dynamic>? extra,
  }) {
    final payload = <String, dynamic>{
      'gameId': gameId,
      'c': c,
      if (r != null) 'r': r,
      ...(extra ?? {}),
    };
    _socket!.emit('game-move', payload);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  void dispose() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _currentGameId = null;
    _stateController.close();
    _gameOverController.close();
    _roundOverController.close();
    _startedController.close();
    _connectionController.close();
  }
}
