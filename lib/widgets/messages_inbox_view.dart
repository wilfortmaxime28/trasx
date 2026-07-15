import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart' hide Config;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:video_player/video_player.dart';
import 'package:audioplayers/audioplayers.dart';

import '../pages/private_call_page.dart';
import '../services/private_call_session.dart';
import '../services/network_quality_service.dart';
import '../services/video_cache_manager.dart';

class _MessagesViewCache {
  static const Duration inboxTtl = Duration(days: 30);
  static const Duration conversationTtl = Duration(days: 30);

  static List<Map<String, dynamic>>? _generalConversations;
  static List<Map<String, dynamic>>? _requestConversations;
  static DateTime? _inboxFetchedAt;
  static final Map<int, List<Map<String, dynamic>>> _conversationMessages = {};
  static final Map<int, DateTime> _conversationFetchedAt = {};

  static bool get hasInbox =>
      _generalConversations != null && _requestConversations != null;

  static bool get isInboxFresh =>
      _inboxFetchedAt != null &&
      DateTime.now().difference(_inboxFetchedAt!) < inboxTtl;

  static bool isConversationFresh(int contactId) {
    final fetchedAt = _conversationFetchedAt[contactId];
    return fetchedAt != null &&
        DateTime.now().difference(fetchedAt) < conversationTtl;
  }

  static List<Map<String, dynamic>>? readGeneral() {
    final source = _generalConversations;
    if (source == null) return null;
    return _cloneList(source);
  }

  static List<Map<String, dynamic>>? readRequests() {
    final source = _requestConversations;
    if (source == null) return null;
    return _cloneList(source);
  }

  static List<Map<String, dynamic>>? readConversation(int contactId) {
    final source = _conversationMessages[contactId];
    if (source == null) return null;
    return _cloneList(source);
  }

  static void saveInbox(
    List<Map<String, dynamic>> general,
    List<Map<String, dynamic>> requests,
  ) {
    restoreInbox(general, requests);
  }

  static void restoreInbox(
    List<Map<String, dynamic>> general,
    List<Map<String, dynamic>> requests, {
    DateTime? fetchedAt,
  }) {
    _generalConversations = _cloneList(general);
    _requestConversations = _cloneList(requests);
    _inboxFetchedAt = fetchedAt ?? DateTime.now();
  }

  static void saveConversation(
    int contactId,
    List<Map<String, dynamic>> messages,
  ) {
    restoreConversation(contactId, messages);
  }

  static void restoreConversation(
    int contactId,
    List<Map<String, dynamic>> messages, {
    DateTime? fetchedAt,
  }) {
    _conversationMessages[contactId] = _cloneList(messages);
    _conversationFetchedAt[contactId] = fetchedAt ?? DateTime.now();
  }

  static List<Map<String, dynamic>> _cloneList(
    List<Map<String, dynamic>> source,
  ) {
    return source
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }
}

Widget _buildMessageMediaLoader({
  required double width,
  required double height,
  required bool isMine,
  BorderRadius? borderRadius,
}) {
  final resolvedRadius = borderRadius ?? BorderRadius.circular(18);
  return Container(
    width: width,
    height: height,
    decoration: BoxDecoration(
      borderRadius: resolvedRadius,
      gradient: LinearGradient(
        colors: isMine
            ? [
                Colors.white.withValues(alpha: 0.16),
                Colors.white.withValues(alpha: 0.08),
              ]
            : [const Color(0xFF111827), const Color(0xFF1F2937)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
    child: Stack(
      children: [
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: resolvedRadius,
              border: Border.all(
                color: isMine
                    ? Colors.white.withValues(alpha: 0.14)
                    : Colors.white.withValues(alpha: 0.06),
              ),
            ),
          ),
        ),
        const Center(
          child: CupertinoActivityIndicator(color: Colors.white, radius: 13),
        ),
      ],
    ),
  );
}

class MessagesInboxView extends StatefulWidget {
  final int currentUserId;
  final String currentUsername;
  final String currentDisplayName;
  final String currentAvatarUrl;
  final bool isDarkMode;
  final io.Socket? socket;
  final ValueChanged<bool>? onConversationStateChanged;
  final ValueChanged<Uri>? onOpenShareLink;
  final ValueChanged<int>? onUnreadCountChanged;

  const MessagesInboxView({
    super.key,
    required this.currentUserId,
    required this.currentUsername,
    required this.currentDisplayName,
    required this.currentAvatarUrl,
    required this.isDarkMode,
    this.socket,
    this.onConversationStateChanged,
    this.onOpenShareLink,
    this.onUnreadCountChanged,
  });

  @override
  State<MessagesInboxView> createState() => _MessagesInboxViewState();
}

class _MessagesInboxViewState extends State<MessagesInboxView>
    with SingleTickerProviderStateMixin {
  static const Color _tiktokPink = Color(0xFFFE2C55);
  static const Color _tiktokCyan = Color(0xFF25F4EE);
  static const Color _bubblePurpleStart = Color(0xFF6F63FF);
  static const Color _bubblePurpleEnd = Color(0xFF9D52FF);
  static const List<String> _quickReactions = ['❤️', '😂', '👍', '💫', '🔥'];
  static const Map<String, String> _gameLabels = {
    'domino': 'Domino',
    'puissance4': 'Puissance 4',
    'connect4': 'Puissance 4',
    'gomoku': 'Gomoku',
    'ludo': 'Ludo',
    'tablefootball': 'Football Table',
    'chess': 'Echecs',
    'echec': 'Echecs',
    'echecsmat': 'Echecs',
    'morpion': 'Morpion',
  };
  static const Map<String, String> _footballTeams = {
    'FR': 'France',
    'BR': 'Bresil',
    'AR': 'Argentine',
    'DE': 'Allemagne',
    'ES': 'Espagne',
    'IT': 'Italie',
    'PT': 'Portugal',
    'GB': 'Angleterre',
    'MA': 'Maroc',
    'SN': 'Senegal',
  };
  static const int _goodNetworkMessagePrefetchWindow = 6;
  static const int _averageNetworkMessagePrefetchWindow = 4;
  static const int _weakNetworkMessagePrefetchWindow = 2;

  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _composerController = TextEditingController();
  final ScrollController _messagesScrollController = ScrollController();
  final FocusNode _searchFocusNode = FocusNode();
  final ImagePicker _mediaPicker = ImagePicker();
  final Set<String> _prefetchedMessageMedia = <String>{};
  final Map<String, String> _localAttachmentPathsByUrl = <String, String>{};
  late final AnimationController _typingAnimationController;

  List<Map<String, dynamic>> _generalConversations = [];
  List<Map<String, dynamic>> _requestConversations = [];
  List<Map<String, dynamic>> _messages = [];

  bool _isLoadingInbox = true;
  bool _isLoadingConversation = false;
  bool _isSendingMessage = false;
  bool _isUploadingAttachment = false;
  bool _partnerTyping = false;

  String? _inboxError;
  String? _conversationError;
  String _activeTab = 'general';

  Map<String, dynamic>? _selectedConversation;
  Map<String, dynamic>? _pendingAttachment;
  Map<String, dynamic>? _replyingToMessage;
  File? _pendingAttachmentFile;
  int _attachmentUploadToken = 0;

  Timer? _typingDebounceTimer;
  Timer? _gameInviteTicker;
  Timer? _incomingCallAlertTimer;
  Timer? _partnerTypingSoundTimer;
  final AudioPlayer _typingPlayer = AudioPlayer();
  final AudioPlayer _alertPlayer = AudioPlayer();
  final AudioPlayer _incomingCallPlayer = AudioPlayer();
  bool _typingStateSent = false;
  bool _incomingCallDialogVisible = false;
  bool _isCallPageOpen = false;
  String? _activeCallRoomId;

  @override
  void initState() {
    super.initState();
    NetworkQualityService().initialize();
    _typingPlayer.setSource(AssetSource('sounds/typing.wav'));
    _alertPlayer.setSource(AssetSource('sounds/finished.wav'));
    _incomingCallPlayer.setSource(AssetSource('sounds/ringtone.wav'));
    _typingAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _composerController.addListener(_handleComposerChanged);
    _attachSocketListeners();
    _gameInviteTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _selectedConversation == null) return;
      if (_messages.any(_messageHasLiveGameInvite)) {
        setState(() {});
      }
    });
    _bootstrapInbox();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.onConversationStateChanged?.call(false);
      _notifyUnreadCount();
    });
  }

  @override
  void didUpdateWidget(covariant MessagesInboxView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.socket != widget.socket) {
      oldWidget.socket?.off('chat-message-received', _handleIncomingMessage);
      oldWidget.socket?.off('chat-message-status', _handleMessageStatus);
      oldWidget.socket?.off('chat-typing-status', _handleTypingStatus);
      oldWidget.socket?.off('presence-updated', _handlePresenceUpdated);
      oldWidget.socket?.off(
        'message-request-updated',
        _handleMessageRequestUpdate,
      );
      oldWidget.socket?.off('chat-message-deleted', _handleMessageDeleted);
      oldWidget.socket?.off(
        'game-invitation-updated',
        _handleGameInvitationUpdated,
      );
      oldWidget.socket?.off(
        'chat-block-status-updated',
        _handleBlockStatusUpdated,
      );
      oldWidget.socket?.off('chat-action-error', _handleChatActionError);
      oldWidget.socket?.off('call-incoming', _handleIncomingCall);
      oldWidget.socket?.off('call-response-received', _handleCallResponse);
      oldWidget.socket?.off('call-ended', _handleCallEnded);
      _attachSocketListeners();
      if (_selectedConversation != null && _conversationError != null) {
        _fetchConversationHistory(
          _selectedConversation!['id'] as int,
          forceRefresh: true,
          silent: _messages.isNotEmpty,
        );
      }
    }
  }

  @override
  void dispose() {
    widget.onConversationStateChanged?.call(false);
    _detachSocketListeners();
    _typingDebounceTimer?.cancel();
    _gameInviteTicker?.cancel();
    _incomingCallAlertTimer?.cancel();
    _partnerTypingSoundTimer?.cancel();
    _typingPlayer.dispose();
    _alertPlayer.dispose();
    _incomingCallPlayer.dispose();
    _typingAnimationController.dispose();
    _searchController.dispose();
    _searchFocusNode.dispose();
    _composerController.removeListener(_handleComposerChanged);
    _composerController.dispose();
    _messagesScrollController.dispose();
    super.dispose();
  }

  void _attachSocketListeners() {
    widget.socket?.on('chat-message-received', _handleIncomingMessage);
    widget.socket?.on('chat-message-status', _handleMessageStatus);
    widget.socket?.on('chat-typing-status', _handleTypingStatus);
    widget.socket?.on('presence-updated', _handlePresenceUpdated);
    widget.socket?.on('message-request-updated', _handleMessageRequestUpdate);
    widget.socket?.on('chat-message-deleted', _handleMessageDeleted);
    widget.socket?.on('game-invitation-updated', _handleGameInvitationUpdated);
    widget.socket?.on('chat-block-status-updated', _handleBlockStatusUpdated);
    widget.socket?.on('chat-action-error', _handleChatActionError);
    widget.socket?.on('call-incoming', _handleIncomingCall);
    widget.socket?.on('call-response-received', _handleCallResponse);
    widget.socket?.on('call-ended', _handleCallEnded);
  }

  void _detachSocketListeners() {
    widget.socket?.off('chat-message-received', _handleIncomingMessage);
    widget.socket?.off('chat-message-status', _handleMessageStatus);
    widget.socket?.off('chat-typing-status', _handleTypingStatus);
    widget.socket?.off('presence-updated', _handlePresenceUpdated);
    widget.socket?.off('message-request-updated', _handleMessageRequestUpdate);
    widget.socket?.off('chat-message-deleted', _handleMessageDeleted);
    widget.socket?.off('game-invitation-updated', _handleGameInvitationUpdated);
    widget.socket?.off('chat-block-status-updated', _handleBlockStatusUpdated);
    widget.socket?.off('chat-action-error', _handleChatActionError);
    widget.socket?.off('call-incoming', _handleIncomingCall);
    widget.socket?.off('call-response-received', _handleCallResponse);
    widget.socket?.off('call-ended', _handleCallEnded);
  }

  void _hydrateInboxFromCache() {
    final cachedGeneral = _MessagesViewCache.readGeneral();
    final cachedRequests = _MessagesViewCache.readRequests();
    if (cachedGeneral == null || cachedRequests == null) return;

    _generalConversations = _normalizeConversationList(cachedGeneral);
    _requestConversations = _normalizeConversationList(cachedRequests);
    _isLoadingInbox = false;
    _inboxError = null;
  }

  void _cacheInboxState() {
    _MessagesViewCache.saveInbox(_generalConversations, _requestConversations);
    _persistInboxCache();
  }

  void _cacheConversationState(int contactId) {
    _MessagesViewCache.saveConversation(contactId, _messages);
    _persistConversationCache(contactId, _messages);
  }

  Future<void> _bootstrapInbox() async {
    _hydrateInboxFromCache();
    if (!_MessagesViewCache.hasInbox) {
      await _hydrateInboxFromDisk();
    }
    await _fetchInbox(
      forceRefresh: true,
      silent: _MessagesViewCache.hasInbox,
    );
  }

  String get _inboxGeneralCacheKey =>
      'messages_inbox_general_${widget.currentUserId}';
  String get _inboxRequestsCacheKey =>
      'messages_inbox_requests_${widget.currentUserId}';
  String get _inboxTimestampCacheKey =>
      'messages_inbox_ts_${widget.currentUserId}';

  String _threadCacheKey(int contactId) =>
      'messages_thread_${widget.currentUserId}_$contactId';
  String _threadTimestampCacheKey(int contactId) =>
      'messages_thread_ts_${widget.currentUserId}_$contactId';

  Future<void> _hydrateInboxFromDisk() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final general = _decodeCacheList(prefs.getString(_inboxGeneralCacheKey));
      final requests = _decodeCacheList(
        prefs.getString(_inboxRequestsCacheKey),
      );
      if (general == null || requests == null) return;
      final normalizedGeneral = _normalizeConversationList(general);
      final normalizedRequests = _normalizeConversationList(requests);

      final timestamp = prefs.getInt(_inboxTimestampCacheKey);
      _MessagesViewCache.restoreInbox(
        normalizedGeneral,
        normalizedRequests,
        fetchedAt: timestamp == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(timestamp),
      );

      if (!mounted) return;
      setState(() {
        _generalConversations = normalizedGeneral;
        _requestConversations = normalizedRequests;
        _isLoadingInbox = false;
        _inboxError = null;
      });
    } catch (_) {}
  }

  Future<List<Map<String, dynamic>>?> _hydrateConversationFromDisk(
    int contactId, {
    bool forceReadDisk = false,
  }) async {
    if (!forceReadDisk) {
      final cached = _MessagesViewCache.readConversation(contactId);
      if (cached != null) return cached;
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final messages = _decodeCacheList(
        prefs.getString(_threadCacheKey(contactId)),
      );
      if (messages == null) return null;
      final timestamp = prefs.getInt(_threadTimestampCacheKey(contactId));
      _MessagesViewCache.restoreConversation(
        contactId,
        messages,
        fetchedAt: timestamp == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(timestamp),
      );
      return messages;
    } catch (_) {
      return null;
    }
  }

  Future<void> _persistInboxCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _inboxGeneralCacheKey,
        jsonEncode(_generalConversations),
      );
      await prefs.setString(
        _inboxRequestsCacheKey,
        jsonEncode(_requestConversations),
      );
      await prefs.setInt(
        _inboxTimestampCacheKey,
        DateTime.now().millisecondsSinceEpoch,
      );
    } catch (_) {}
  }

  Future<void> _persistConversationCache(
    int contactId,
    List<Map<String, dynamic>> messages,
  ) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_threadCacheKey(contactId), jsonEncode(messages));
      await prefs.setInt(
        _threadTimestampCacheKey(contactId),
        DateTime.now().millisecondsSinceEpoch,
      );
    } catch (_) {}
  }

  List<Map<String, dynamic>>? _decodeCacheList(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return null;
      return decoded
          .whereType<Map>()
          .map<Map<String, dynamic>>(
            (item) => item.map((key, value) => MapEntry(key.toString(), value)),
          )
          .toList();
    } catch (_) {
      return null;
    }
  }

  Future<void> _ensureSocketConnected({
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final socket = widget.socket;
    if (socket == null) {
      throw Exception('Messagerie temps reel indisponible.');
    }

    if (socket.connected) return;

    final completer = Completer<void>();
    late void Function(dynamic) handleConnect;
    late void Function(dynamic) handleError;
    Timer? timer;

    void cleanup() {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleError);
      timer?.cancel();
    }

    handleConnect = (_) {
      cleanup();
      if (!completer.isCompleted) {
        completer.complete();
      }
    };

    handleError = (dynamic error) {
      cleanup();
      if (!completer.isCompleted) {
        completer.completeError(Exception('Connexion messagerie impossible.'));
      }
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleError);
    socket.connect();

    timer = Timer(timeout, () {
      cleanup();
      if (!completer.isCompleted) {
        completer.completeError(Exception('Connexion messagerie trop lente.'));
      }
    });

    return completer.future;
  }

  Future<dynamic> _emitSocketAck(
    String event,
    Map<String, dynamic> payload, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final socket = widget.socket;
    if (socket == null) {
      throw Exception('Messagerie temps reel indisponible.');
    }

    await _ensureSocketConnected(timeout: timeout);

    final completer = Completer<dynamic>();
    late Timer timer;
    timer = Timer(timeout, () {
      if (!completer.isCompleted) {
        completer.completeError(
          Exception('Le serveur de messagerie ne repond pas.'),
        );
      }
    });

    socket.emitWithAck(
      event,
      payload,
      ack: (dynamic response) {
        timer.cancel();
        if (!completer.isCompleted) {
          completer.complete(response);
        }
      },
    );

    return completer.future;
  }

  Future<Map<String, dynamic>> _fetchInboxViaSocket() async {
    final dynamic response = await _emitSocketAck('chat-inbox-fetch', {});
    if (response is! Map) {
      throw Exception('Reponse temps reel invalide.');
    }

    final payload = Map<String, dynamic>.from(response);
    if (payload['success'] != true) {
      throw Exception(
        _asString(
          payload['error'],
          fallback: 'Impossible de charger les conversations.',
        ),
      );
    }

    return payload;
  }

  Future<Map<String, dynamic>> _fetchInboxViaHttp() async {
    final response = await http
        .get(
          Uri.parse('https://trasx.com/api/messages/inbox'),
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': '${widget.currentUserId}',
          },
        )
        .timeout(const Duration(seconds: 10));

    final dynamic payload = jsonDecode(response.body);
    if (response.statusCode != 200 || payload['success'] != true) {
      throw Exception(
        payload['error'] ?? 'Impossible de charger les conversations.',
      );
    }

    return Map<String, dynamic>.from(payload);
  }

  Future<List<Map<String, dynamic>>> _fetchConversationHistoryViaSocket(
    int contactId,
  ) async {
    final dynamic response = await _emitSocketAck('chat-history-fetch', {
      'contactId': contactId,
    });
    if (response is! Map) {
      throw Exception('Reponse temps reel invalide.');
    }

    final payload = Map<String, dynamic>.from(response);
    if (payload['success'] != true) {
      throw Exception(
        _asString(
          payload['error'],
          fallback: 'Impossible de charger cette conversation.',
        ),
      );
    }

    final rawMessages = payload['messages'];
    if (rawMessages is! List) return [];

    return rawMessages
        .map<Map<String, dynamic>>((item) => _normalizeMessage(item))
        .toList();
  }

  Future<List<Map<String, dynamic>>> _fetchConversationHistoryViaHttp(
    int contactId,
  ) async {
    final response = await http
        .get(
          Uri.parse('https://trasx.com/api/messages/$contactId'),
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': '${widget.currentUserId}',
          },
        )
        .timeout(const Duration(seconds: 10));

    if (response.statusCode != 200) {
      final dynamic payload = jsonDecode(response.body);
      throw Exception(
        payload is Map
            ? (payload['error'] ?? 'Impossible de charger cette conversation.')
            : 'Impossible de charger cette conversation.',
      );
    }

    final dynamic payload = jsonDecode(response.body);
    final rawMessages = payload is List
        ? payload
        : (payload['messages'] as List<dynamic>? ?? []);

    return rawMessages
        .map<Map<String, dynamic>>((item) => _normalizeMessage(item))
        .toList();
  }

  Future<void> _fetchInbox({
    bool forceRefresh = false,
    bool silent = false,
  }) async {
    if (!forceRefresh &&
        _MessagesViewCache.hasInbox &&
        _MessagesViewCache.isInboxFresh) {
      return;
    }

    if (!silent || !_MessagesViewCache.hasInbox) {
      setState(() {
        _isLoadingInbox = true;
        _inboxError = null;
      });
    } else if (mounted) {
      setState(() {
        _inboxError = null;
      });
    }

    try {
      Map<String, dynamic> payload;
      try {
        payload = await _fetchInboxViaSocket();
      } catch (socketError) {
        debugPrint('Messages inbox socket fetch failed: $socketError');
        payload = await _fetchInboxViaHttp();
      }

      final general = _normalizeConversationList(
        payload['sections']?['general'],
      );
      final requests = _normalizeConversationList(
        payload['sections']?['requests'],
      );

      if (!mounted) return;
      setState(() {
        _generalConversations = general;
        _requestConversations = requests;
        _isLoadingInbox = false;
        _inboxError = null;
      });
      _cacheInboxState();
    } catch (error) {
      if (!mounted) return;
      final hasCachedData =
          _generalConversations.isNotEmpty || _requestConversations.isNotEmpty;
      setState(() {
        _isLoadingInbox = false;
        _inboxError = hasCachedData && silent
            ? null
            : error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  List<Map<String, dynamic>> _normalizeConversationList(dynamic rawList) {
    if (rawList is! List) return [];
    return rawList
        .map<Map<String, dynamic>>((item) => _normalizeConversation(item))
        .toList();
  }

  Map<String, dynamic> _normalizeConversation(dynamic raw) {
    final map = raw is Map ? raw : <String, dynamic>{};
    final unreadCount =
        _asInt(map['unread_count']) +
        ((map['isUnread'] == true && _asInt(map['unread_count']) == 0) ? 1 : 0);
    // Preserve last_message so _openConversation can show it instantly before
    // the network fetch completes.
    final rawLastMessage = map['last_message'];
    final lastMessage = rawLastMessage is Map
        ? _normalizeMessage(rawLastMessage)
        : null;
    return {
      'id': _asInt(map['id'] ?? map['contactId']),
      'name': _asString(
        map['name'] ?? map['contactName'],
        fallback: 'Conversation',
      ),
      'username': _asString(map['username'] ?? map['contactUsername']),
      'avatar': _asString(map['avatar'] ?? map['contactAvatar']),
      'preview': _asString(
        map['preview'],
        fallback: 'Commencer une conversation',
      ),
      'time_text': _asString(map['time_text'] ?? map['timeText']),
      'category': _asString(map['category'], fallback: 'general'),
      'request_status': _asString(
        map['request_status'] ?? map['requestStatus'],
      ),
      'can_manage_request':
          map['can_manage_request'] == true || map['canManageRequest'] == true,
      'is_following': map['is_following'] == true || map['isFollowing'] == true,
      'is_followed_by':
          map['is_followed_by'] == true || map['isFollowedBy'] == true,
      'is_mutual': map['is_mutual'] == true || map['isMutual'] == true,
      'is_online': map['is_online'] == true || map['isOnline'] == true,
      'has_blocked_user':
          map['has_blocked_user'] == true || map['hasBlockedUser'] == true,
      'is_blocked_by_user':
          map['is_blocked_by_user'] == true || map['isBlockedByUser'] == true,
      'can_chat': map['can_chat'] != false && map['canChat'] != false,
      'presence_text': _formatPresenceText(
        _asString(
          map['presence_text'] ?? map['presenceText'],
          fallback: 'Offline',
        ),
      ),
      'unread_count': unreadCount,
      'is_unread': unreadCount > 0,
      if (lastMessage != null) 'last_message': lastMessage,
    };
  }

  Map<String, dynamic> _normalizeMessage(dynamic raw) {
    final map = raw is Map ? raw : <String, dynamic>{};
    return _attachLocalAttachmentIfAvailable({
      'id': _asInt(map['id'] ?? map['messageId']),
      'sender_id': _asInt(map['sender_id'] ?? map['senderId']),
      'receiver_id': _asInt(map['receiver_id'] ?? map['receiverId']),
      'content': _asString(map['content']),
      'attachment_url': _asString(
        map['attachment_url'] ?? map['attachmentUrl'],
      ),
      'attachment_type': _asString(
        map['attachment_type'] ?? map['attachmentType'],
      ),
      'attachment_name': _asString(
        map['attachment_name'] ?? map['attachmentName'],
      ),
      'attachment_thumbnail_url': _asString(
        map['attachment_thumbnail_url'] ??
            map['attachmentThumbnailUrl'] ??
            map['thumbnail_url'] ??
            map['thumbnailUrl'],
      ),
      'attachment_size': _asInt(
        map['attachment_size'] ?? map['attachmentSize'],
      ),
      'voice_duration_seconds': _asInt(
        map['voice_duration_seconds'] ?? map['voiceDurationSeconds'],
      ),
      'parent_id': _asInt(map['parent_id']),
      'parent_content': _asString(map['parent_content']),
      'parent_sender_username': _asString(map['parent_sender_username']),
      'parent_attachment_type': _asString(map['parent_attachment_type']),
      'status_id': _asInt(map['status_id']),
      'status_media_url': _asString(map['status_media_url']),
      'status_media_type': _asString(map['status_media_type']),
      'status_caption': _asString(map['status_caption']),
      'status_bg_color': _asString(map['status_bg_color']),
      'status_author_username': _asString(map['status_author_username']),
      'delivered_at': _asString(map['delivered_at']),
      'read_at': _asString(map['read_at']),
      'deleted_by_sender': _asInt(map['deleted_by_sender']),
      'deleted_by_receiver': _asInt(map['deleted_by_receiver']),
      'deleted_for_everyone': _asInt(map['deleted_for_everyone']),
      'created_at': _asString(
        map['created_at'],
        fallback: DateTime.now().toIso8601String(),
      ),
      'sender_name': _asString(map['sender_name']),
      'sender_avatar': _asString(map['sender_avatar']),
      'sender_username': _asString(map['sender_username']),
      'local_attachment_path': _asString(
        map['local_attachment_path'] ?? map['localAttachmentPath'],
      ),
    });
  }

  String _attachmentUrlKey(String url) {
    final rawUrl = _asString(url);
    if (rawUrl.isEmpty) return '';
    final resolvedUrl = _resolveUrl(rawUrl);
    return resolvedUrl.isNotEmpty ? resolvedUrl : rawUrl;
  }

  void _rememberLocalAttachment({
    required String attachmentUrl,
    required String filePath,
  }) {
    final key = _attachmentUrlKey(attachmentUrl);
    if (key.isEmpty || filePath.trim().isEmpty) return;
    _localAttachmentPathsByUrl[key] = filePath;
  }

  Map<String, dynamic> _attachLocalAttachmentIfAvailable(
    Map<String, dynamic> message,
  ) {
    final existingPath = _asString(
      message['local_attachment_path'] ?? message['localAttachmentPath'],
    );
    if (existingPath.isNotEmpty) return message;

    final attachmentUrl = _asString(
      message['attachment_url'] ?? message['attachmentUrl'],
    );
    final key = _attachmentUrlKey(attachmentUrl);
    if (key.isEmpty) return message;

    final localPath = _localAttachmentPathsByUrl[key];
    if (localPath == null || localPath.isEmpty) return message;
    return {...message, 'local_attachment_path': localPath};
  }

  void _clearPendingAttachmentState({bool invalidateUpload = false}) {
    if (invalidateUpload) {
      _attachmentUploadToken++;
      _isUploadingAttachment = false;
    }
    _pendingAttachment = null;
    _pendingAttachmentFile = null;
  }

  String _inferAttachmentType(String filePath, String formFieldName) {
    if (formFieldName == 'audio') return 'audio';
    final mediaType = _inferAttachmentMediaType(filePath, formFieldName);
    switch (mediaType?.type) {
      case 'image':
        return 'image';
      case 'video':
        return 'video';
      case 'audio':
        return 'audio';
      default:
        return 'file';
    }
  }

  String _extractFileName(String filePath) {
    final normalizedPath = filePath.trim().replaceAll('\\', '/');
    if (normalizedPath.isEmpty) return '';
    final segments = normalizedPath.split('/');
    return segments.isEmpty ? normalizedPath : segments.last;
  }

  int _safeAttachmentSize(String filePath) {
    try {
      final file = File(filePath);
      if (!file.existsSync()) return 0;
      return file.lengthSync();
    } catch (_) {
      return 0;
    }
  }

  File? _localAttachmentFileFromMessage(Map<String, dynamic> message) {
    final localPath = _asString(
      message['local_attachment_path'] ?? message['localAttachmentPath'],
    );
    if (localPath.isEmpty) return null;
    return File(localPath);
  }

  Future<void> _openConversation(Map<String, dynamic> conversation) async {
    final contactId = conversation['id'] as int;

    // Mark as read immediately so badges clear instantly in UI and server
    _markConversationRead(contactId);

    // Read from memory cache immediately (non-blocking)
    final cachedMessages = _MessagesViewCache.readConversation(contactId);

    // If no memory cache, try to seed with the last known message from the
    // conversation object so the user sees content instantly rather than a
    // blank spinner while the network fetch runs.
    final rawLastMessage = conversation['last_message'];
    final seedMessage = rawLastMessage is Map<String, dynamic>
        ? rawLastMessage
        : null;
    final List<Map<String, dynamic>> initialMessages;
    if (cachedMessages != null && cachedMessages.isNotEmpty) {
      initialMessages = cachedMessages;
    } else if (seedMessage != null) {
      initialMessages = [seedMessage];
    } else {
      initialMessages = [];
    }

    // Open conversation UI instantly — never show a spinner if we have any data
    setState(() {
      _selectedConversation = Map<String, dynamic>.from(conversation);
      _messages = initialMessages;
      _isLoadingConversation = initialMessages.isEmpty;
      _conversationError = null;
      _partnerTyping = false;
      _replyingToMessage = null;
    });
    _stopTypingAnimation();
    widget.onConversationStateChanged?.call(true);

    if (initialMessages.isNotEmpty) {
      _scrollMessagesToBottom();
      _scheduleConversationMediaWarmup(initialMessages);
    }

    // Hydrate from disk in background (non-blocking) when we have few messages
    if (initialMessages.length <= 1) {
      _hydrateConversationFromDisk(contactId, forceReadDisk: true).then((diskMessages) {
        if (diskMessages != null && diskMessages.isNotEmpty && mounted) {
          if (_selectedConversation != null &&
              _selectedConversation!['id'] == contactId) {
            setState(() {
              _messages = diskMessages;
              _isLoadingConversation = false;
            });
            _scrollMessagesToBottom();
            _scheduleConversationMediaWarmup(diskMessages);
          }
        }
      });
    }

    // Fetch fresh messages from network in background (non-blocking)
    unawaited(_fetchConversationHistory(
      contactId,
      forceRefresh: true,
      silent: initialMessages.isNotEmpty,
    ));
  }

  void _closeConversation() {
    _sendTypingState(false);
    widget.onConversationStateChanged?.call(false);
    _stopPartnerTypingSound(playFinishedSound: false);
    setState(() {
      _selectedConversation = null;
      _messages = [];
      _clearPendingAttachmentState(invalidateUpload: true);
      _replyingToMessage = null;
      _partnerTyping = false;
    });
    _stopTypingAnimation();
  }

  Future<void> _fetchConversationHistory(
    int contactId, {
    bool forceRefresh = false,
    bool silent = false,
  }) async {
    if (!forceRefresh &&
        _MessagesViewCache.isConversationFresh(contactId) &&
        _MessagesViewCache.readConversation(contactId) != null) {
      return;
    }

    if (!silent) {
      if (!mounted) return;
      setState(() {
        _isLoadingConversation = true;
        _conversationError = null;
      });
    }

    try {
      List<Map<String, dynamic>> history;
      try {
        history = await _fetchConversationHistoryViaSocket(contactId);
      } catch (socketError) {
        debugPrint('Conversation socket fetch failed: $socketError');
        history = await _fetchConversationHistoryViaHttp(contactId);
      }

      if (!mounted) return;
      setState(() {
        _messages = history;
        _isLoadingConversation = false;
        _conversationError = null;
      });
      _cacheConversationState(contactId);
      _scheduleConversationMediaWarmup(history);
      _scrollMessagesToBottom();
    } catch (error) {
      if (!mounted) return;
      final hasCachedMessages = _messages.isNotEmpty;
      setState(() {
        _isLoadingConversation = false;
        _conversationError = hasCachedMessages && silent
            ? null
            : error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  int get _messagePrefetchWindow {
    switch (NetworkQualityService().currentQuality) {
      case NetworkQuality.good:
        return _goodNetworkMessagePrefetchWindow;
      case NetworkQuality.average:
        return _averageNetworkMessagePrefetchWindow;
      case NetworkQuality.weak:
        return _weakNetworkMessagePrefetchWindow;
      case NetworkQuality.offline:
        return 0;
    }
  }

  bool _messageHasWarmableMedia(Map<String, dynamic> message) {
    final attachmentType = _asString(message['attachment_type']);
    if (attachmentType != 'video') return false;
    return _messageVideoThumbnailUrl(message).isNotEmpty;
  }

  void _scheduleConversationMediaWarmup(Iterable<Map<String, dynamic>> source) {
    final limit = _messagePrefetchWindow;
    if (limit <= 0) return;

    final candidates = source
        .where(_messageHasWarmableMedia)
        .toList(growable: false)
        .reversed
        .take(limit)
        .toList(growable: false);

    if (candidates.isEmpty) return;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      for (final message in candidates) {
        unawaited(_warmupMessageMedia(message));
      }
    });
  }

  Future<void> _warmupMessageMedia(Map<String, dynamic> message) async {
    if (!mounted) return;

    final attachmentType = _asString(message['attachment_type']);
    final thumbnailUrl = _messageVideoThumbnailUrl(message);
    if (attachmentType != 'video' || thumbnailUrl.isEmpty) return;

    final mediaKey = 'thumb|$thumbnailUrl';
    if (!_prefetchedMessageMedia.add(mediaKey)) {
      return;
    }

    try {
      await precacheImage(CachedNetworkImageProvider(thumbnailUrl), context);
    } catch (_) {
      _prefetchedMessageMedia.remove(mediaKey);
    }
  }

  void _handleIncomingMessage(dynamic data) {
    if (data == null) return;
    final message = _normalizeMessage(data);
    final conversation = _normalizeConversation(data['conversation']);
    final partnerId = conversation['id'] as int;
    final incoming =
        _asString(data['messageStatus']) == 'incoming' ||
        message['sender_id'] != widget.currentUserId;

    if (incoming) {
      unawaited(HapticFeedback.vibrate());
      unawaited(SystemSound.play(SystemSoundType.alert));
    }
    final previewText = _asString(
      conversation['preview'],
      fallback: _buildConversationPreview(message),
    );
    final mergedConversation = {
      ...conversation,
      'preview': previewText,
      'time_text': _formatConversationTime(message['created_at'] as String),
      // Keep the latest message so _openConversation can display it instantly
      'last_message': message,
    };
    final cachedThread = _MessagesViewCache.readConversation(partnerId);
    if (cachedThread != null) {
      if (!cachedThread.any((item) => item['id'] == message['id'])) {
        final updated = [...cachedThread, message];
        _MessagesViewCache.saveConversation(partnerId, updated);
        _persistConversationCache(partnerId, updated);
      }
    } else {
      _MessagesViewCache.saveConversation(partnerId, [message]);
      _persistConversationCache(partnerId, [message]);
      unawaited(_hydrateConversationFromDisk(partnerId).then((diskMessages) {
        if (diskMessages != null && diskMessages.isNotEmpty) {
          final currentCached = _MessagesViewCache.readConversation(partnerId) ?? [];
          final merged = [...diskMessages];
          for (final msg in currentCached) {
            if (!merged.any((item) => item['id'] == msg['id'])) {
              merged.add(msg);
            }
          }
          _MessagesViewCache.saveConversation(partnerId, merged);
          _persistConversationCache(partnerId, merged);
        }
      }));
    }

    if (_selectedConversation != null &&
        (_selectedConversation!['id'] as int) == partnerId) {
      if (!_messages.any((item) => item['id'] == message['id'])) {
        setState(() {
          _messages = [..._messages, message];
          _selectedConversation = {
            ..._selectedConversation!,
            ...mergedConversation,
            'unread_count': 0,
            'is_unread': false,
          };
        });
        _cacheConversationState(partnerId);
        _scheduleConversationMediaWarmup([message]);
        _scrollMessagesToBottom();
      }
      _upsertConversation(mergedConversation, incrementUnread: 0);
      if (incoming) {
        _markConversationRead(partnerId);
      }
      return;
    }

    _upsertConversation(mergedConversation, incrementUnread: 0);
  }

  void _handleMessageStatus(dynamic data) {
    if (data == null || _messages.isEmpty) return;
    final ids = <int>{};
    if (data['messageId'] != null) {
      ids.add(_asInt(data['messageId']));
    }
    if (data['messageIds'] is List) {
      for (final dynamic id in data['messageIds']) {
        ids.add(_asInt(id));
      }
    }
    if (ids.isEmpty) return;

    final status = _asString(data['status']);
    final deliveredAt = _asString(
      data['delivered_at'],
      fallback: DateTime.now().toIso8601String(),
    );
    final readAt = DateTime.now().toIso8601String();

    var changed = false;
    final updatedMessages = _messages.map<Map<String, dynamic>>((message) {
      if (!ids.contains(message['id'])) return message;
      changed = true;
      return {
        ...message,
        'delivered_at': status == 'delivered' || status == 'read'
            ? (message['delivered_at'] as String).isNotEmpty
                  ? message['delivered_at']
                  : deliveredAt
            : message['delivered_at'],
        'read_at': status == 'read' ? readAt : message['read_at'],
      };
    }).toList();

    if (changed && mounted) {
      setState(() {
        _messages = updatedMessages;
      });
      if (_selectedConversation != null) {
        _cacheConversationState(_selectedConversation!['id'] as int);
      }
    }
  }

  void _handleTypingStatus(dynamic data) {
    if (_selectedConversation == null || data == null) return;
    final senderId = _asInt(data['senderId']);
    if (senderId != (_selectedConversation!['id'] as int)) return;
    final nextTyping = data['isTyping'] == true;
    if (nextTyping == _partnerTyping) return;
    if (nextTyping) {
      _startTypingAnimation();
      _scrollMessagesToBottom();
      _startPartnerTypingSound();
    } else {
      _stopTypingAnimation();
      _stopPartnerTypingSound(playFinishedSound: true);
    }
    if (!mounted) return;
    setState(() {
      _partnerTyping = nextTyping;
    });
  }

  void _handlePresenceUpdated(dynamic data) {
    if (data == null) return;
    final userId = _asInt(data['userId']);
    if (userId <= 0) return;

    final isOnline = data['isOnline'] == true;
    final presenceText = _formatPresenceText(_asString(data['presenceText']));

    bool changed = false;
    List<Map<String, dynamic>> updateList(List<Map<String, dynamic>> source) {
      return source.map((item) {
        if (item['id'] != userId) return item;
        changed = true;
        return {...item, 'is_online': isOnline, 'presence_text': presenceText};
      }).toList();
    }

    final updatedGeneral = updateList(_generalConversations);
    final updatedRequests = updateList(_requestConversations);
    Map<String, dynamic>? updatedSelected = _selectedConversation;
    bool shouldStopTyping = false;

    if (_selectedConversation != null &&
        _selectedConversation!['id'] == userId) {
      changed = true;
      updatedSelected = {
        ..._selectedConversation!,
        'is_online': isOnline,
        'presence_text': presenceText,
      };
      shouldStopTyping = !isOnline && _partnerTyping;
    }

    if (!changed || !mounted) return;

    setState(() {
      _generalConversations = updatedGeneral;
      _requestConversations = updatedRequests;
      _selectedConversation = updatedSelected;
      if (shouldStopTyping) {
        _partnerTyping = false;
      }
    });

    if (shouldStopTyping) {
      _stopTypingAnimation();
    }
    _cacheInboxState();
  }

  void _handleMessageRequestUpdate(dynamic _) {
    _fetchInbox(
      forceRefresh: true,
      silent:
          _generalConversations.isNotEmpty || _requestConversations.isNotEmpty,
    );
  }

  bool get _hasBlockedSelectedUser =>
      _selectedConversation?['has_blocked_user'] == true;

  bool get _isBlockedBySelectedUser =>
      _selectedConversation?['is_blocked_by_user'] == true;

  bool get _canChatWithSelectedUser =>
      _selectedConversation != null &&
      !_hasBlockedSelectedUser &&
      !_isBlockedBySelectedUser &&
      _selectedConversation?['can_chat'] != false;

  void _showSnackBar(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _updateConversationRelationship(
    int contactId, {
    required bool hasBlockedUser,
    required bool isBlockedByUser,
    bool? canChat,
  }) {
    final resolvedCanChat = canChat ?? !(hasBlockedUser || isBlockedByUser);
    var selectedChanged = false;

    List<Map<String, dynamic>> patchList(List<Map<String, dynamic>> source) {
      return source.map((item) {
        if (item['id'] != contactId) return item;
        selectedChanged = true;
        return {
          ...item,
          'has_blocked_user': hasBlockedUser,
          'is_blocked_by_user': isBlockedByUser,
          'can_chat': resolvedCanChat,
        };
      }).toList();
    }

    final updatedGeneral = patchList(_generalConversations);
    final updatedRequests = patchList(_requestConversations);
    Map<String, dynamic>? updatedSelected = _selectedConversation;

    if (_selectedConversation != null &&
        _selectedConversation!['id'] == contactId) {
      selectedChanged = true;
      updatedSelected = {
        ..._selectedConversation!,
        'has_blocked_user': hasBlockedUser,
        'is_blocked_by_user': isBlockedByUser,
        'can_chat': resolvedCanChat,
      };
    }

    if (!selectedChanged || !mounted) return;

    if (!resolvedCanChat) {
      _sendTypingState(false);
      _stopTypingAnimation();
    }

    setState(() {
      _generalConversations = updatedGeneral;
      _requestConversations = updatedRequests;
      _selectedConversation = updatedSelected;
      if (!resolvedCanChat) {
        _partnerTyping = false;
        _clearPendingAttachmentState(invalidateUpload: true);
        _replyingToMessage = null;
      }
    });
    _cacheInboxState();
  }

  List<Map<String, dynamic>>? _applyMessageDeletion(
    List<Map<String, dynamic>> source,
    int messageId,
    String deleteType,
  ) {
    var changed = false;

    if (deleteType == 'everyone') {
      final updated = source.map((message) {
        if (message['id'] != messageId) return message;
        changed = true;
        return {
          ...message,
          'content': '',
          'attachment_url': '',
          'attachment_type': '',
          'attachment_name': '',
          'local_attachment_path': '',
          'attachment_size': 0,
          'voice_duration_seconds': 0,
          'status_id': 0,
          'status_media_url': '',
          'status_media_type': '',
          'status_caption': '',
          'status_bg_color': '',
          'status_author_username': '',
          'deleted_for_everyone': 1,
        };
      }).toList();
      return changed ? updated : null;
    }

    final updated = source.where((message) {
      final shouldKeep = message['id'] != messageId;
      if (!shouldKeep) {
        changed = true;
      }
      return shouldKeep;
    }).toList();
    return changed ? updated : null;
  }

  void _refreshSelectedConversationPreview() {
    if (_selectedConversation == null) return;
    final lastMessage = _messages.isNotEmpty ? _messages.last : null;
    final updatedConversation = {
      ..._selectedConversation!,
      'preview': lastMessage != null
          ? _buildConversationPreview(lastMessage)
          : 'Commencer une conversation',
      'time_text': lastMessage != null
          ? _formatConversationTime(_asString(lastMessage['created_at']))
          : '',
    };

    if (mounted) {
      setState(() {
        _selectedConversation = updatedConversation;
      });
    }
    _upsertConversation(updatedConversation, incrementUnread: 0);
  }

  void _handleMessageDeleted(dynamic data) {
    if (data == null || _selectedConversation == null) {
      _fetchInbox(forceRefresh: true, silent: true);
      return;
    }

    final messageId = _asInt(data['messageId']);
    final deleteType = _asString(data['deleteType']);
    if (messageId <= 0 || deleteType.isEmpty) return;

    final updatedMessages = _applyMessageDeletion(
      _messages,
      messageId,
      deleteType,
    );
    if (updatedMessages == null) {
      _fetchInbox(forceRefresh: true, silent: true);
      return;
    }

    if (!mounted) return;
    setState(() {
      _messages = updatedMessages;
      if (_replyingToMessage?['id'] == messageId) {
        _replyingToMessage = null;
      }
    });
    _cacheConversationState(_selectedConversation!['id'] as int);
    _refreshSelectedConversationPreview();
    _fetchInbox(forceRefresh: true, silent: true);
  }

  void _handleGameInvitationUpdated(dynamic data) {
    if (data == null) return;
    final messageId = _asInt(data['messageId']);
    final content = _asString(data['content']);
    if (messageId <= 0 || content.isEmpty) return;

    var updatedSelected = false;
    final nextMessages = _messages.map((message) {
      if (message['id'] != messageId) return message;
      updatedSelected = true;
      return {...message, 'content': content};
    }).toList();

    if (updatedSelected && mounted) {
      setState(() {
        _messages = nextMessages;
      });
      if (_selectedConversation != null) {
        _cacheConversationState(_selectedConversation!['id'] as int);
        _refreshSelectedConversationPreview();
      }
    }

    _fetchInbox(forceRefresh: true, silent: true);
  }

  void _handleBlockStatusUpdated(dynamic data) {
    if (data == null) return;
    final contactId = _asInt(data['contactId']);
    if (contactId <= 0) return;
    _updateConversationRelationship(
      contactId,
      hasBlockedUser: data['hasBlockedUser'] == true,
      isBlockedByUser: data['isBlockedByUser'] == true,
      canChat: data['canChat'] == true,
    );
  }

  void _handleChatActionError(dynamic data) {
    if (data == null) return;
    final error = _asString(data['error']);
    if (error.isEmpty) return;
    _showSnackBar(error);
  }

  Future<void> _handleIncomingCall(dynamic data) async {
    if (!mounted || data == null || _incomingCallDialogVisible) return;
    final callerId = _asInt(data['callerId']);
    final callerName = _asString(data['callerName'], fallback: 'Utilisateur');
    final callerAvatar = _asString(data['callerAvatar']);
    final roomId = _asString(data['roomId']);
    final isVideo = data['isVideo'] == true;
    if (callerId <= 0 || roomId.isEmpty) return;

    if (_isCallPageOpen) {
      try {
        await _emitSocketAck('call-response', {
          'callerId': callerId,
          'roomId': roomId,
          'status': 'busy',
        });
      } catch (_) {}
      return;
    }

    _incomingCallDialogVisible = true;
    _startIncomingCallAlert();

    if (!mounted) {
      _stopIncomingCallAlert();
      _incomingCallDialogVisible = false;
      return;
    }

    var responseStatus = 'declined';
    await showCupertinoDialog<void>(
      context: context,
      builder: (dialogContext) {
        return CupertinoAlertDialog(
          title: Text(isVideo ? 'Appel video' : 'Appel audio'),
          content: Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('$callerName essaie de vous joindre.'),
          ),
          actions: [
            CupertinoDialogAction(
              onPressed: () {
                responseStatus = 'declined';
                Navigator.of(dialogContext).pop();
              },
              child: const Text('Refuser'),
            ),
            CupertinoDialogAction(
              isDefaultAction: true,
              onPressed: () {
                responseStatus = 'accepted';
                Navigator.of(dialogContext).pop();
              },
              child: const Text('Repondre'),
            ),
          ],
        );
      },
    );
    _stopIncomingCallAlert();

    try {
      await _emitSocketAck('call-response', {
        'callerId': callerId,
        'roomId': roomId,
        'status': responseStatus,
      });
      if (mounted && responseStatus == 'accepted') {
        _stopIncomingCallAlert();
        _incomingCallDialogVisible = false;
        await _openCallPage(
          roomId: roomId,
          isVideo: isVideo,
          isCaller: false,
          partnerId: callerId,
          partnerName: callerName,
          partnerAvatar: callerAvatar,
        );
      }
    } catch (error) {
      if (mounted) {
        _showSnackBar(error.toString().replaceFirst('Exception: ', ''));
      }
    }
    _stopIncomingCallAlert();
    _incomingCallDialogVisible = false;
  }

  void _startIncomingCallAlert() {
    _incomingCallAlertTimer?.cancel();
    unawaited(_playIncomingCallAlert());
    _incomingCallAlertTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (!_incomingCallDialogVisible || !mounted) {
        _stopIncomingCallAlert();
        return;
      }
      unawaited(_playIncomingCallAlert());
    });
  }

  void _stopIncomingCallAlert() {
    _incomingCallAlertTimer?.cancel();
    _incomingCallAlertTimer = null;
    try {
      _incomingCallPlayer.stop();
    } catch (_) {}
  }

  Future<void> _playIncomingCallAlert() async {
    try {
      await _incomingCallPlayer.seek(Duration.zero);
      await _incomingCallPlayer.resume();
    } catch (_) {}
  }

  void _handleCallResponse(dynamic data) {
    if (!mounted || data == null) return;
    final roomId = _asString(data['roomId']);
    if (_isCallPageOpen && roomId.isNotEmpty && roomId == _activeCallRoomId) {
      return;
    }
    final status = _asString(data['status']);
    if (status == 'accepted') {
      _showSnackBar('Appel accepte.');
      return;
    }
    if (status == 'declined') {
      _showSnackBar('Appel refuse.');
      return;
    }
    if (status == 'missed') {
      _showSnackBar('Aucune reponse.');
      return;
    }
    if (status == 'busy') {
      _showSnackBar('Utilisateur deja en appel.');
      return;
    }
    if (status.isNotEmpty) {
      _showSnackBar('Statut appel: $status');
    }
  }

  void _handleCallEnded(dynamic data) {
    if (!mounted || data == null) return;
    final roomId = _asString(data['roomId']);
    if (_isCallPageOpen && roomId.isNotEmpty && roomId == _activeCallRoomId) {
      return;
    }
    _showSnackBar('Appel termine.');
  }

  void _setReplyingToMessage(Map<String, dynamic> message) {
    setState(() {
      _replyingToMessage = {
        'id': message['id'],
        'sender_username': _asString(
          message['sender_username'],
          fallback: message['sender_id'] == widget.currentUserId
              ? widget.currentUsername
              : _asString(
                  _selectedConversation?['username'],
                  fallback: _asString(_selectedConversation?['name']),
                ),
        ),
        'content': _replyPreviewTextFromMessage(message),
      };
    });
  }

  void _clearReplyingToMessage() {
    if (_replyingToMessage == null) return;
    setState(() {
      _replyingToMessage = null;
    });
  }

  String _replyPreviewTextFromMessage(Map<String, dynamic> message) {
    final structuredContent = _parseStructuredContent(message['content']);
    if (_asInt(message['deleted_for_everyone']) == 1) {
      return 'Ce message a ete supprime.';
    }
    if (_isSharedContent(structuredContent)) {
      return _buildConversationPreview(message);
    }
    if (_isGameInvitationContent(structuredContent)) {
      return _buildGameInvitationPreviewText(structuredContent!);
    }
    final content = _asString(message['content']);
    if (content.isNotEmpty) return content;
    final attachmentType = _asString(message['attachment_type']);
    if (attachmentType == 'image') return 'Image';
    if (attachmentType == 'video') return 'Video';
    if (attachmentType == 'audio') return 'Note vocale';
    if (attachmentType.isNotEmpty) return 'Piece jointe';
    return 'Message';
  }

  Future<void> _openMessageActions(
    Map<String, dynamic> message,
    bool isMine,
  ) async {
    final textPrimary = widget.isDarkMode
        ? Colors.white
        : const Color(0xFF111827);
    final textSecondary = widget.isDarkMode
        ? Colors.white70
        : const Color(0xFF6B7280);
    final isDeleted = _asInt(message['deleted_for_everyone']) == 1;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: widget.isDarkMode
          ? const Color(0xFF121317)
          : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) {
        Widget actionTile({
          required IconData icon,
          required String label,
          required VoidCallback onTap,
          Color? accent,
        }) {
          return ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 20),
            leading: Icon(icon, color: accent ?? textPrimary, size: 21),
            title: Text(
              label,
              style: TextStyle(
                color: accent ?? textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
            onTap: () {
              Navigator.of(sheetContext).pop();
              onTap();
            },
          );
        }

        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(0, 12, 0, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: textSecondary.withValues(alpha: 0.34),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                const SizedBox(height: 16),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: widget.isDarkMode
                          ? Colors.white.withValues(alpha: 0.05)
                          : const Color(0xFFF6F7FA),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Text(
                      _replyPreviewTextFromMessage(message),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: textSecondary,
                        fontSize: 13,
                        height: 1.35,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                if (!isDeleted)
                  actionTile(
                    icon: CupertinoIcons.reply,
                    label: 'Repondre',
                    onTap: () => _setReplyingToMessage(message),
                  ),
                actionTile(
                  icon: CupertinoIcons.delete,
                  label: 'Supprimer pour moi',
                  onTap: () => _deleteMessage(message['id'] as int, 'me'),
                ),
                if (isMine && !isDeleted)
                  actionTile(
                    icon: CupertinoIcons.delete_solid,
                    label: 'Supprimer pour tous',
                    accent: _tiktokPink,
                    onTap: () =>
                        _deleteMessage(message['id'] as int, 'everyone'),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _deleteMessage(int messageId, String deleteType) {
    if (messageId <= 0) return;
    widget.socket?.emit('chat-message-delete', {
      'messageId': messageId,
      'deleteType': deleteType,
    });
  }

  Future<void> _openConversationOptions() async {
    final conversation = _selectedConversation;
    if (conversation == null) return;

    final shouldBlock = !(_selectedConversation?['has_blocked_user'] == true);
    final label = shouldBlock ? 'Bloquer cet utilisateur' : 'Debloquer';
    final textPrimary = widget.isDarkMode
        ? Colors.white
        : const Color(0xFF111827);

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: widget.isDarkMode
          ? const Color(0xFF121317)
          : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(0, 12, 0, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey.withValues(alpha: 0.32),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                const SizedBox(height: 18),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                  leading: Icon(
                    shouldBlock
                        ? CupertinoIcons.hand_raised_fill
                        : CupertinoIcons.check_mark_circled_solid,
                    color: shouldBlock ? _tiktokPink : const Color(0xFF22C55E),
                  ),
                  title: Text(
                    label,
                    style: TextStyle(
                      color: textPrimary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    _toggleBlockForSelectedConversation(shouldBlock);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _toggleBlockForSelectedConversation(bool blocked) async {
    final conversation = _selectedConversation;
    if (conversation == null) return;

    try {
      final dynamic response = await _emitSocketAck('chat-block-toggle', {
        'contactId': conversation['id'],
        'blocked': blocked,
      });
      if (response is! Map || response['success'] != true) {
        throw Exception(
          _asString(
            response is Map ? response['error'] : null,
            fallback: 'Impossible de mettre a jour le blocage.',
          ),
        );
      }
      final relationship =
          _asMap(response['relationship']) ?? const <String, dynamic>{};
      _updateConversationRelationship(
        conversation['id'] as int,
        hasBlockedUser: relationship['hasBlockedUser'] == true,
        isBlockedByUser: relationship['isBlockedByUser'] == true,
        canChat: relationship['canChat'] == true,
      );
      _showSnackBar(blocked ? 'Utilisateur bloque.' : 'Utilisateur debloque.');
    } catch (error) {
      _showSnackBar(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _startCall({required bool isVideo}) async {
    final conversation = _selectedConversation;
    if (conversation == null || _isCallPageOpen) return;

    try {
      final dynamic response = await _emitSocketAck('call-invite', {
        'receiverId': conversation['id'],
        'isVideo': isVideo,
      }, timeout: const Duration(seconds: 12));

      if (response is! Map || response['success'] != true) {
        throw Exception(
          _asString(
            response is Map ? response['error'] : null,
            fallback: 'Impossible de lancer cet appel.',
          ),
        );
      }

      final roomId = _asString(response['roomId']);
      if (roomId.isEmpty) {
        throw Exception('Session d appel introuvable.');
      }

      await _openCallPage(
        roomId: roomId,
        isVideo: isVideo,
        isCaller: true,
        partnerId: conversation['id'] as int,
        partnerName: _asString(conversation['name'], fallback: 'Utilisateur'),
        partnerAvatar: _asString(conversation['avatar']),
      );
    } catch (error) {
      _showSnackBar(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _openCallPage({
    required String roomId,
    required bool isVideo,
    required bool isCaller,
    required int partnerId,
    required String partnerName,
    required String partnerAvatar,
  }) async {
    if (!mounted || _isCallPageOpen) return;
    final socket = widget.socket;
    if (socket == null) {
      _showSnackBar('Messagerie temps reel indisponible.');
      return;
    }

    _isCallPageOpen = true;
    _activeCallRoomId = roomId;

    final session = PrivateCallSession(
      socket: socket,
      roomId: roomId,
      currentUserId: widget.currentUserId,
      remoteUserId: partnerId,
      remoteName: partnerName,
      remoteAvatarUrl: partnerAvatar,
      isVideo: isVideo,
      role: isCaller ? PrivateCallRole.caller : PrivateCallRole.callee,
    );

    try {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          fullscreenDialog: true,
          builder: (_) => PrivateCallPage(session: session),
        ),
      );
    } finally {
      _isCallPageOpen = false;
      _activeCallRoomId = null;
    }
  }

  Future<void> _openGameInviteComposer() async {
    if (_selectedConversation == null || !_canChatWithSelectedUser) return;

    var selectedGame = 'domino';
    var priceType = 'free';
    var durationSeconds = 60;
    var selectedTeam = 'FR';
    final amountController = TextEditingController(text: '1');
    final textPrimary = widget.isDarkMode
        ? Colors.white
        : const Color(0xFF111827);
    final textSecondary = widget.isDarkMode
        ? Colors.white70
        : const Color(0xFF6B7280);

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: widget.isDarkMode
          ? const Color(0xFF121317)
          : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  20,
                  14,
                  20,
                  20 + MediaQuery.of(sheetContext).viewInsets.bottom,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Container(
                        width: 48,
                        height: 4,
                        decoration: BoxDecoration(
                          color: textSecondary.withValues(alpha: 0.32),
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Inviter a jouer',
                      style: TextStyle(
                        color: textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: selectedGame,
                      items: const [
                        DropdownMenuItem(
                          value: 'domino',
                          child: Text('Domino'),
                        ),
                        DropdownMenuItem(
                          value: 'puissance4',
                          child: Text('Puissance 4'),
                        ),
                        DropdownMenuItem(
                          value: 'gomoku',
                          child: Text('Gomoku'),
                        ),
                        DropdownMenuItem(value: 'ludo', child: Text('Ludo')),
                        DropdownMenuItem(
                          value: 'tablefootball',
                          child: Text('Football Table'),
                        ),
                        DropdownMenuItem(value: 'chess', child: Text('Echecs')),
                      ],
                      onChanged: (value) {
                        if (value == null) return;
                        setModalState(() {
                          selectedGame = value;
                        });
                      },
                      decoration: const InputDecoration(
                        labelText: 'Jeu',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: ChoiceChip(
                            label: const Text('Gratuit'),
                            selected: priceType == 'free',
                            onSelected: (_) {
                              setModalState(() {
                                priceType = 'free';
                              });
                            },
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: ChoiceChip(
                            label: const Text('Payant'),
                            selected: priceType == 'paid',
                            onSelected: (_) {
                              setModalState(() {
                                priceType = 'paid';
                              });
                            },
                          ),
                        ),
                      ],
                    ),
                    if (priceType == 'paid') ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: amountController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'Montant (\$)',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Text(
                      'Duree',
                      style: TextStyle(
                        color: textPrimary,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [60, 300, 900].map((value) {
                        final selected = durationSeconds == value;
                        final label = value == 60
                            ? '1 min'
                            : value == 300
                            ? '5 min'
                            : '15 min';
                        return ChoiceChip(
                          label: Text(label),
                          selected: selected,
                          onSelected: (_) {
                            setModalState(() {
                              durationSeconds = value;
                            });
                          },
                        );
                      }).toList(),
                    ),
                    if (selectedGame == 'tablefootball') ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: selectedTeam,
                        items: _footballTeams.entries.map((entry) {
                          return DropdownMenuItem(
                            value: entry.key,
                            child: Text(entry.value),
                          );
                        }).toList(),
                        onChanged: (value) {
                          if (value == null) return;
                          setModalState(() {
                            selectedTeam = value;
                          });
                        },
                        decoration: const InputDecoration(
                          labelText: 'Votre equipe',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () {
                          final amount =
                              double.tryParse(
                                amountController.text.trim().replaceAll(
                                  ',',
                                  '.',
                                ),
                              ) ??
                              0;
                          if (priceType == 'paid' && amount <= 0) {
                            _showSnackBar('Entrez un montant valide.');
                            return;
                          }
                          Navigator.of(sheetContext).pop();
                          _sendGameInvitation(
                            game: selectedGame,
                            priceType: priceType,
                            priceAmount: priceType == 'paid' ? amount : 0,
                            durationSeconds: durationSeconds,
                            team: selectedTeam,
                          );
                        },
                        style: FilledButton.styleFrom(
                          backgroundColor: _tiktokPink,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        child: const Text('Envoyer l invitation'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );

    amountController.dispose();
  }

  void _sendGameInvitation({
    required String game,
    required String priceType,
    required num priceAmount,
    required int durationSeconds,
    required String team,
  }) {
    if (_selectedConversation == null) return;
    final inviteId =
        'game_${DateTime.now().millisecondsSinceEpoch}_${widget.currentUserId}';
    final expiresAt = DateTime.now()
        .add(Duration(seconds: durationSeconds))
        .toUtc()
        .toIso8601String();
    final invitationPayload = {
      'type': 'game_invitation',
      'game': game,
      'priceType': priceType,
      'priceAmount': priceAmount,
      'status': 'pending',
      'expiresAt': expiresAt,
      'inviteId': inviteId,
      'durationSeconds': durationSeconds,
      'team1': team,
    };

    widget.socket?.emit('chat-message', {
      'receiverId': _selectedConversation!['id'],
      'content': jsonEncode(invitationPayload),
    });
    widget.socket?.emit('game-invitation-notify', {
      'recipientId': _selectedConversation!['id'],
      'game': game,
      'priceType': priceType,
      'priceAmount': priceAmount,
      'expiresAt': expiresAt,
      'inviteId': inviteId,
    });
    _showSnackBar('Invitation de jeu envoyee.');
  }

  Future<void> _handleGameInvitationAction(
    Map<String, dynamic> message,
    String action,
  ) async {
    final structuredContent = _parseStructuredContent(message['content']);
    if (!_isGameInvitationContent(structuredContent)) return;

    String? team;
    if (action == 'accept' &&
        _asString(structuredContent?['game']).toLowerCase() ==
            'tablefootball') {
      team = await _pickFootballTeam();
      if (team == null) return;
    }

    widget.socket?.emit('game-invitation-action', {
      'messageId': message['id'],
      'action': action,
      ...?(team == null ? null : {'team': team}),
    });
  }

  Future<String?> _pickFootballTeam() async {
    return showModalBottomSheet<String>(
      context: context,
      backgroundColor: widget.isDarkMode
          ? const Color(0xFF121317)
          : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.withValues(alpha: 0.32),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              const SizedBox(height: 14),
              ..._footballTeams.entries.map((entry) {
                return ListTile(
                  title: Text(entry.value),
                  onTap: () => Navigator.of(sheetContext).pop(entry.key),
                );
              }),
              const SizedBox(height: 10),
            ],
          ),
        );
      },
    );
  }

  void _openAcceptedGameInvite(Map<String, dynamic> structuredContent) {
    final gameLabel = _gameLabel(_asString(structuredContent['game']));
    _showSnackBar(
      'La partie $gameLabel est prete. L ouverture de la salle Flutter reste a finaliser.',
    );
  }

  void _upsertConversation(
    Map<String, dynamic> conversation, {
    int incrementUnread = 0,
  }) {
    final normalized = _normalizeConversation(conversation);
    final targetCategory = normalized['category'] == 'requests'
        ? 'requests'
        : 'general';
    List<Map<String, dynamic>> source = targetCategory == 'requests'
        ? List<Map<String, dynamic>>.from(_requestConversations)
        : List<Map<String, dynamic>>.from(_generalConversations);
    List<Map<String, dynamic>> other = targetCategory == 'requests'
        ? List<Map<String, dynamic>>.from(_generalConversations)
        : List<Map<String, dynamic>>.from(_requestConversations);

    other.removeWhere((item) => item['id'] == normalized['id']);
    final existingIndex = source.indexWhere(
      (item) => item['id'] == normalized['id'],
    );
    final existing = existingIndex >= 0 ? source.removeAt(existingIndex) : null;
    final unreadCount =
        (existing?['unread_count'] as int? ?? 0) + incrementUnread;
    final updated = {
      ...?existing,
      ...normalized,
      'unread_count': incrementUnread > 0
          ? unreadCount
          : (normalized['unread_count'] as int? ??
                existing?['unread_count'] ??
                0),
      'is_unread': incrementUnread > 0
          ? true
          : ((normalized['unread_count'] as int? ??
                    existing?['unread_count'] ??
                    0) >
                0),
    };
    source.insert(0, updated);

    if (!mounted) return;
    setState(() {
      if (targetCategory == 'requests') {
        _requestConversations = source;
        _generalConversations = other;
      } else {
        _generalConversations = source;
        _requestConversations = other;
      }
    });
    _cacheInboxState();
  }

  void _markConversationRead(int partnerId) {
    // 1. Clear badge locally right away for instant UI feedback
    if (!mounted) return;
    setState(() {
      _generalConversations = _generalConversations.map((item) {
        if (item['id'] != partnerId) return item;
        return {...item, 'unread_count': 0, 'is_unread': false};
      }).toList();
      _requestConversations = _requestConversations.map((item) {
        if (item['id'] != partnerId) return item;
        return {...item, 'unread_count': 0, 'is_unread': false};
      }).toList();
      if (_selectedConversation != null &&
          _selectedConversation!['id'] == partnerId) {
        _selectedConversation = {
          ..._selectedConversation!,
          'unread_count': 0,
          'is_unread': false,
        };
      }
    });
    _cacheInboxState();

    // 2. Notify server via socket (preferred, fast path)
    widget.socket?.emitWithAck(
      'chat-mark-read',
      {'partnerId': partnerId},
      ack: (dynamic ackData) {
        // Socket succeeded — nothing more to do
        final success = ackData is Map && ackData['success'] == true;
        if (!success) {
          // Socket ack reported failure; fall back to HTTP
          unawaited(_markConversationReadViaHttp(partnerId));
        }
      },
    );
  }

  /// HTTP fallback for mark-read — used when the socket ack fails or the
  /// socket is offline, to ensure the server DB is always kept in sync.
  Future<void> _markConversationReadViaHttp(int partnerId) async {
    try {
      await http.post(
        Uri.parse('https://trasx.com/api/messages/$partnerId/read'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 8));
    } catch (_) {
      // Best-effort; ignore network errors for mark-read
    }
  }

  void _handleComposerChanged() {
    final hasText = _composerController.text.trim().isNotEmpty;
    if (!hasText) {
      _sendTypingState(false);
      return;
    }

    _sendTypingState(true);
    _typingDebounceTimer?.cancel();
    _typingDebounceTimer = Timer(const Duration(milliseconds: 1200), () {
      _sendTypingState(false);
    });
  }

  void _sendTypingState(bool isTyping) {
    if (_selectedConversation == null) return;
    if (_typingStateSent == isTyping) return;
    _typingStateSent = isTyping;
    widget.socket?.emit('chat-typing', {
      'receiverId': _selectedConversation!['id'],
      'isTyping': isTyping,
    });
  }

  Future<void> _openCameraAttachmentSheet() async {
    await _openMediaSourceSheet(
      title: 'Envoyer depuis la camera',
      source: ImageSource.camera,
    );
  }

  Future<void> _openGalleryAttachmentSheet() async {
    await _openMediaSourceSheet(
      title: 'Choisir un media',
      source: ImageSource.gallery,
    );
  }

  Future<void> _openMediaSourceSheet({
    required String title,
    required ImageSource source,
  }) async {
    if (_isUploadingAttachment || _isSendingMessage) return;

    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: widget.isDarkMode
          ? const Color(0xFF121317)
          : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        final textPrimary = widget.isDarkMode
            ? Colors.white
            : const Color(0xFF121212);
        final textSecondary = widget.isDarkMode
            ? Colors.white70
            : const Color(0xFF5F5F67);

        Widget actionTile({
          required IconData icon,
          required String label,
          required String value,
          required Color accent,
        }) {
          return ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 20),
            leading: Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, color: accent, size: 20),
            ),
            title: Text(
              label,
              style: TextStyle(color: textPrimary, fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              value == 'image' ? 'Photo ou image' : 'Clip video ou capture',
              style: TextStyle(color: textSecondary, fontSize: 12),
            ),
            trailing: Icon(
              CupertinoIcons.chevron_right,
              color: textSecondary,
              size: 16,
            ),
            onTap: () => Navigator.of(sheetContext).pop(value),
          );
        }

        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(0, 12, 0, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: textSecondary.withValues(alpha: 0.35),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 10),
                  child: Text(
                    title,
                    style: TextStyle(
                      color: textPrimary,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                actionTile(
                  icon: CupertinoIcons.photo_fill,
                  label: 'Image',
                  value: 'image',
                  accent: _tiktokPink,
                ),
                actionTile(
                  icon: CupertinoIcons.videocam_fill,
                  label: 'Video',
                  value: 'video',
                  accent: _tiktokCyan,
                ),
              ],
            ),
          ),
        );
      },
    );

    if (!mounted || choice == null) return;
    if (choice == 'image') {
      await _pickImageFromSource(source);
    } else if (choice == 'video') {
      await _pickVideoFromSource(source);
    }
  }

  Future<void> _pickImageFromSource(ImageSource source) async {
    try {
      final XFile? file = await _mediaPicker.pickImage(
        source: source,
        imageQuality: 88,
        preferredCameraDevice: CameraDevice.rear,
      );
      if (file == null) return;

      await _uploadAttachmentFile(
        filePath: file.path,
        formFieldName: 'file',
        localPreviewFile: File(file.path),
      );
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _pickVideoFromSource(ImageSource source) async {
    try {
      final XFile? file = await _mediaPicker.pickVideo(
        source: source,
        maxDuration: const Duration(minutes: 5),
        preferredCameraDevice: CameraDevice.rear,
      );
      if (file == null || !mounted) return;

      setState(() {
        _pendingAttachment = {
          'attachmentType': 'video',
          'attachmentName': _attachmentDisplayLabel(
            attachmentType: 'video',
            originalName: file.name,
          ),
          'attachmentThumbnailUrl': '',
          'attachmentSize': _safeAttachmentSize(file.path),
          'voiceDurationSeconds': 0,
          'localAttachmentPath': file.path,
        };
      });

      unawaited(
        _uploadAttachmentFile(filePath: file.path, formFieldName: 'file'),
      );
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _uploadAttachmentFile({
    required String filePath,
    required String formFieldName,
    File? localPreviewFile,
    int? voiceDurationSeconds,
  }) async {
    if (_isUploadingAttachment || _isSendingMessage) return;

    final provisionalType = _inferAttachmentType(filePath, formFieldName);
    final localFile = localPreviewFile ?? File(filePath);
    final uploadToken = ++_attachmentUploadToken;

    try {
      if (!mounted) return;
      setState(() {
        _isUploadingAttachment = true;
        _pendingAttachment = {
          'attachmentType': provisionalType,
          'attachmentName': _attachmentDisplayLabel(
            attachmentType: provisionalType,
            originalName: _extractFileName(filePath),
            voiceDurationSeconds: voiceDurationSeconds,
          ),
          'attachmentThumbnailUrl': _asString(
            _pendingAttachment?['attachmentThumbnailUrl'],
          ),
          'attachmentSize': _safeAttachmentSize(filePath),
          'voiceDurationSeconds': voiceDurationSeconds,
          'localAttachmentPath': filePath,
        };
        _pendingAttachmentFile = provisionalType == 'image' ? localFile : null;
      });

      final request = http.MultipartRequest(
        'POST',
        Uri.parse('https://trasx.com/api/messages/upload-media'),
      );
      request.headers['x-user-id'] = '${widget.currentUserId}';
      final contentType = _inferAttachmentMediaType(filePath, formFieldName);
      request.files.add(
        await http.MultipartFile.fromPath(
          formFieldName,
          filePath,
          contentType: contentType,
        ),
      );

      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);
      if (!mounted) return;

      final body = jsonDecode(response.body);
      if (response.statusCode != 200) {
        throw Exception(
          body['error'] ?? 'Impossible de televerser ce fichier.',
        );
      }

      final attachmentUrl = _asString(body['attachmentUrl']);
      final attachmentType = _asString(body['attachmentType']);
      final attachmentThumbnailUrl = _asString(
        body['attachmentThumbnailUrl'] ?? body['attachment_thumbnail_url'],
      );
      if (attachmentUrl.isNotEmpty) {
        _rememberLocalAttachment(
          attachmentUrl: attachmentUrl,
          filePath: filePath,
        );
      }
      if (!mounted || uploadToken != _attachmentUploadToken) return;

      setState(() {
        _pendingAttachment = {
          'attachmentUrl': attachmentUrl,
          'attachmentType': attachmentType.isNotEmpty
              ? attachmentType
              : provisionalType,
          'attachmentName': _attachmentDisplayLabel(
            attachmentType: attachmentType.isNotEmpty
                ? attachmentType
                : provisionalType,
            originalName: _asString(
              body['attachmentName'],
              fallback: _extractFileName(filePath),
            ),
            voiceDurationSeconds: voiceDurationSeconds,
          ),
          'attachmentThumbnailUrl': attachmentThumbnailUrl,
          'attachmentSize':
              body['attachmentSize'] ?? _safeAttachmentSize(filePath),
          'voiceDurationSeconds': voiceDurationSeconds,
          'localAttachmentPath': filePath,
        };
        _pendingAttachmentFile =
            (attachmentType.isNotEmpty ? attachmentType : provisionalType) ==
                'image'
            ? localFile
            : null;
        _isUploadingAttachment = false;
      });
    } catch (error) {
      if (!mounted || uploadToken != _attachmentUploadToken) return;
      setState(() {
        _isUploadingAttachment = false;
        _clearPendingAttachmentState();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  Future<void> _openEmojiPicker() async {
    if (_isUploadingAttachment || _isSendingMessage) return;
    if (!mounted) return;

    final surface = widget.isDarkMode ? const Color(0xFF111318) : Colors.white;
    final secondary = widget.isDarkMode
        ? Colors.white70
        : const Color(0xFF6B7280);

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: widget.isDarkMode
          ? const Color(0xFF121317)
          : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          top: false,
          child: SizedBox(
            height: math.min(
              MediaQuery.of(sheetContext).size.height * 0.52,
              420,
            ),
            child: Column(
              children: [
                const SizedBox(height: 10),
                Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: secondary.withValues(alpha: 0.26),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                const SizedBox(height: 8),
                Expanded(
                  child: EmojiPicker(
                    textEditingController: _composerController,
                    onEmojiSelected: (_, emoji) {
                      if (emoji.emoji.isEmpty) return;
                      Navigator.of(sheetContext).pop();
                    },
                    config: Config(
                      height: double.infinity,
                      checkPlatformCompatibility: true,
                      emojiViewConfig: EmojiViewConfig(
                        columns: 8,
                        emojiSizeMax: 28,
                        backgroundColor: surface,
                        buttonMode: widget.isDarkMode
                            ? ButtonMode.MATERIAL
                            : ButtonMode.CUPERTINO,
                      ),
                      categoryViewConfig: CategoryViewConfig(
                        backgroundColor: surface,
                        indicatorColor: _tiktokPink,
                        iconColor: secondary,
                        iconColorSelected: _tiktokPink,
                        backspaceColor: _tiktokPink,
                      ),
                      bottomActionBarConfig: const BottomActionBarConfig(
                        enabled: false,
                      ),
                      searchViewConfig: SearchViewConfig(
                        backgroundColor: surface,
                        buttonIconColor: secondary,
                        hintText: 'Rechercher un emoji',
                        hintTextStyle: TextStyle(color: secondary),
                        inputTextStyle: TextStyle(
                          color: widget.isDarkMode
                              ? Colors.white
                              : const Color(0xFF121212),
                        ),
                      ),
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

  Future<void> _openVoiceRecorderSheet() async {
    if (_isUploadingAttachment || _isSendingMessage) return;

    final recorder = AudioRecorder();
    Timer? recordTimer;
    var isRecording = false;
    var durationSeconds = 0;

    try {
      final result = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (sheetContext) {
          final textPrimary = widget.isDarkMode
              ? Colors.white
              : const Color(0xFF121212);
          final textSecondary = widget.isDarkMode
              ? Colors.white70
              : const Color(0xFF5F5F67);

          return StatefulBuilder(
            builder: (context, setModalState) {
              Future<void> toggleRecording() async {
                try {
                  if (isRecording) {
                    recordTimer?.cancel();
                    final recordedPath = await recorder.stop();
                    setModalState(() {
                      isRecording = false;
                    });
                    if (!sheetContext.mounted || recordedPath == null) return;
                    Navigator.of(sheetContext).pop({
                      'path': recordedPath,
                      'durationSeconds': durationSeconds,
                    });
                    return;
                  }

                  final hasPermission = await recorder.hasPermission();
                  if (!hasPermission) {
                    throw Exception(
                      'Autorisez le micro pour envoyer une note vocale.',
                    );
                  }

                  final tempDir = await getTemporaryDirectory();
                  final path =
                      '${tempDir.path}/message_voice_${DateTime.now().millisecondsSinceEpoch}.m4a';

                  await recorder.start(
                    const RecordConfig(encoder: AudioEncoder.aacLc),
                    path: path,
                  );

                  durationSeconds = 0;
                  setModalState(() {
                    isRecording = true;
                  });

                  recordTimer?.cancel();
                  recordTimer = Timer.periodic(const Duration(seconds: 1), (_) {
                    if (!sheetContext.mounted) return;
                    setModalState(() {
                      durationSeconds++;
                    });
                  });
                } catch (error) {
                  if (!mounted) return;
                  ScaffoldMessenger.of(this.context).showSnackBar(
                    SnackBar(
                      content: Text(
                        error.toString().replaceFirst('Exception: ', ''),
                      ),
                    ),
                  );
                }
              }

              return SafeArea(
                top: false,
                child: Container(
                  decoration: BoxDecoration(
                    color: widget.isDarkMode
                        ? const Color(0xFF111318)
                        : Colors.white,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(28),
                    ),
                  ),
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 48,
                        height: 4,
                        decoration: BoxDecoration(
                          color: textSecondary.withValues(alpha: 0.3),
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Container(
                        width: 84,
                        height: 84,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [_bubblePurpleStart, _bubblePurpleEnd],
                          ),
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: _bubblePurpleEnd.withValues(alpha: 0.28),
                              blurRadius: 28,
                              offset: const Offset(0, 12),
                            ),
                          ],
                        ),
                        child: Icon(
                          isRecording
                              ? CupertinoIcons.stop_fill
                              : CupertinoIcons.mic_fill,
                          color: Colors.white,
                          size: 34,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        isRecording ? 'Enregistrement en cours' : 'Note vocale',
                        style: TextStyle(
                          color: textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        isRecording
                            ? _formatDuration(durationSeconds)
                            : 'Touchez pour commencer puis touchez encore pour valider.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: textSecondary,
                          fontSize: isRecording ? 16 : 12.5,
                          fontWeight: isRecording
                              ? FontWeight.w700
                              : FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => Navigator.of(sheetContext).pop(),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: textPrimary,
                                side: BorderSide(
                                  color: widget.isDarkMode
                                      ? Colors.white24
                                      : Colors.black12,
                                ),
                                padding: const EdgeInsets.symmetric(
                                  vertical: 14,
                                ),
                              ),
                              child: const Text('Annuler'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton(
                              onPressed: toggleRecording,
                              style: FilledButton.styleFrom(
                                backgroundColor: _tiktokPink,
                                padding: const EdgeInsets.symmetric(
                                  vertical: 14,
                                ),
                              ),
                              child: Text(
                                isRecording ? 'Terminer' : 'Enregistrer',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      );

      if (!mounted || result == null) return;
      final recordedPath = _asString(result['path']);
      if (recordedPath.isEmpty) return;

      await _uploadAttachmentFile(
        filePath: recordedPath,
        formFieldName: 'audio',
        voiceDurationSeconds: _asInt(result['durationSeconds']),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    } finally {
      recordTimer?.cancel();
      if (isRecording) {
        try {
          final unfinishedPath = await recorder.stop();
          if (unfinishedPath != null) {
            final file = File(unfinishedPath);
            if (file.existsSync()) {
              file.deleteSync();
            }
          }
        } catch (_) {}
      }
      try {
        await recorder.dispose();
      } catch (_) {}
    }
  }

  Future<void> _sendMessage() async {
    if (_selectedConversation == null || widget.socket == null) return;
    if (_isUploadingAttachment) {
      _showSnackBar('Patientez pendant la preparation du media.');
      return;
    }
    if (!_canChatWithSelectedUser) {
      _showSnackBar(
        _hasBlockedSelectedUser
            ? 'Debloquez cet utilisateur pour envoyer un message.'
            : 'Cet utilisateur vous a bloque.',
      );
      return;
    }
    final content = _composerController.text.trim();
    if (content.isEmpty && _pendingAttachment == null) return;

    setState(() {
      _isSendingMessage = true;
    });

    widget.socket!.emit('chat-message', {
      'receiverId': _selectedConversation!['id'],
      'content': content,
      'attachmentUrl': _pendingAttachment?['attachmentUrl'],
      'attachmentType': _pendingAttachment?['attachmentType'],
      'attachmentName': _pendingAttachment?['attachmentName'],
      'attachmentThumbnailUrl': _pendingAttachment?['attachmentThumbnailUrl'],
      'attachmentSize': _pendingAttachment?['attachmentSize'],
      'voiceDurationSeconds': _pendingAttachment?['voiceDurationSeconds'],
      'parentId': _replyingToMessage?['id'],
    });

    final preview = _pendingAttachment != null && content.isEmpty
        ? _previewFromAttachment(_pendingAttachment!)
        : _buildConversationPreview({
            'content': content,
            'attachment_type': _pendingAttachment?['attachmentType'],
            'voice_duration_seconds':
                _pendingAttachment?['voiceDurationSeconds'],
            'status_id': 0,
          });

    if (!mounted) return;
    setState(() {
      _selectedConversation = {
        ..._selectedConversation!,
        'preview': preview,
        'time_text': _formatConversationTime(DateTime.now().toIso8601String()),
      };
      _isSendingMessage = false;
      _clearPendingAttachmentState();
      _replyingToMessage = null;
    });
    _upsertConversation(_selectedConversation!, incrementUnread: 0);

    _composerController.clear();
    _sendTypingState(false);
  }

  Future<void> _updateMessageRequestStatus(String action) async {
    if (_selectedConversation == null) return;
    final partnerId = _selectedConversation!['id'] as int;

    try {
      final response = await http
          .post(
            Uri.parse(
              'https://trasx.com/api/message-requests/$partnerId/$action',
            ),
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': '${widget.currentUserId}',
            },
          )
          .timeout(const Duration(seconds: 10));

      final dynamic payload = jsonDecode(response.body);
      if (response.statusCode != 200 || payload['success'] != true) {
        throw Exception(
          payload['error'] ?? 'Impossible de traiter cette demande.',
        );
      }

      if (!mounted) return;
      setState(() {
        _selectedConversation = {
          ..._selectedConversation!,
          'request_status': action == 'accept' ? 'accepted' : 'declined',
          'can_manage_request': false,
          'category': action == 'accept' ? 'general' : 'requests',
        };
      });
      await _fetchInbox(forceRefresh: true, silent: false);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  void _scrollMessagesToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_messagesScrollController.hasClients) return;
      _messagesScrollController.animateTo(
        0.0,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  void _startTypingAnimation() {
    if (!_typingAnimationController.isAnimating) {
      _typingAnimationController.repeat();
    }
  }

  void _stopTypingAnimation() {
    _typingAnimationController.stop();
    _typingAnimationController.reset();
  }

  void _startPartnerTypingSound() {
    _partnerTypingSoundTimer?.cancel();
    
    // Play the first click sound immediately
    unawaited(_typingPlayer.seek(Duration.zero).then((_) => _typingPlayer.resume()));
    
    // Play clicking sound at intervals to mimic active typing
    _partnerTypingSoundTimer = Timer.periodic(
      const Duration(milliseconds: 380),
      (timer) {
        unawaited(_typingPlayer.seek(Duration.zero).then((_) => _typingPlayer.resume()));
      },
    );
  }

  void _stopPartnerTypingSound({bool playFinishedSound = false}) {
    _partnerTypingSoundTimer?.cancel();
    _partnerTypingSoundTimer = null;
    
    if (playFinishedSound) {
      // Play our synthesized double beep sound when typing finishes
      unawaited(_alertPlayer.seek(Duration.zero).then((_) => _alertPlayer.resume()));
    }
  }

  void _notifyUnreadCount() {
    widget.onUnreadCountChanged?.call(_generalUnreadCount);
  }

  @override
  void setState(VoidCallback fn) {
    if (!mounted) return;
    super.setState(fn);
    _notifyUnreadCount();
  }

  List<Map<String, dynamic>> get _activeList {
    final source = _activeTab == 'requests'
        ? _requestConversations
        : _generalConversations;
    final query = _searchController.text.trim().toLowerCase();
    if (query.isEmpty) return source;
    return source.where((conversation) {
      final text = [
        conversation['name'],
        conversation['username'],
        conversation['preview'],
        conversation['presence_text'],
      ].join(' ').toLowerCase();
      return text.contains(query);
    }).toList();
  }

  List<Map<String, dynamic>> get _activeNowContacts {
    return _generalConversations
        .where((item) => item['is_online'] == true)
        .take(10)
        .toList();
  }

  int get _generalUnreadCount => _generalConversations.fold<int>(
    0,
    (sum, item) => sum + _asInt(item['unread_count']),
  );
  int get _requestCount => _requestConversations.length;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 280),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (Widget child, Animation<double> animation) {
        final isConversation = child.key.toString().contains('conversation');
        if (isConversation) {
          final slideIn = Tween<Offset>(
            begin: const Offset(1.0, 0.0),
            end: Offset.zero,
          ).animate(animation);

          return SlideTransition(
            position: slideIn,
            child: child,
          );
        } else {
          return FadeTransition(
            opacity: animation,
            child: child,
          );
        }
      },
      child: _selectedConversation == null
          ? _buildInboxShell()
          : _buildConversationShell(),
    );
  }

  Widget _buildAmbientBackground() {
    return IgnorePointer(
      child: Stack(
        children: [
          Positioned(
            top: -120,
            right: -60,
            child: Container(
              width: 380,
              height: 380,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    _tiktokPink.withValues(
                      alpha: widget.isDarkMode ? 0.08 : 0.05,
                    ),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            top: 160,
            left: -120,
            child: Container(
              width: 320,
              height: 320,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    _tiktokCyan.withValues(
                      alpha: widget.isDarkMode ? 0.06 : 0.04,
                    ),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInboxShell() {
    final surface = widget.isDarkMode
        ? const Color(0xFF090909)
        : const Color(0xFFFAFAFA);
    final textPrimary = widget.isDarkMode
        ? Colors.white
        : const Color(0xFF111111);
    final textSecondary = widget.isDarkMode
        ? Colors.white70
        : const Color(0xFF5D5D66);

    if (_isLoadingInbox) {
      return const SafeArea(
        child: Center(child: CircularProgressIndicator(color: _tiktokPink)),
      );
    }

    if (_inboxError != null) {
      return SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  CupertinoIcons.exclamationmark_bubble,
                  color: textSecondary,
                  size: 44,
                ),
                const SizedBox(height: 14),
                Text(
                  _inboxError!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: textSecondary, fontSize: 14),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () =>
                      _fetchInbox(forceRefresh: true, silent: false),
                  style: FilledButton.styleFrom(backgroundColor: _tiktokPink),
                  child: const Text('Recharger'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      key: const ValueKey('messages-inbox'),
      color: surface,
      child: Stack(
        children: [
          _buildAmbientBackground(),
          SafeArea(
            top: true,
            bottom: false,
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                  decoration: BoxDecoration(
                    color: widget.isDarkMode
                        ? const Color(0xFF090909).withValues(alpha: 0.97)
                        : Colors.white.withValues(alpha: 0.97),
                    border: Border(
                      bottom: BorderSide(
                        color: widget.isDarkMode
                            ? Colors.white.withValues(alpha: 0.05)
                            : Colors.black.withValues(alpha: 0.06),
                      ),
                    ),
                  ),
                  child: Column(
                    children: [
                      _buildInboxHero(textPrimary, textSecondary),
                      const SizedBox(height: 14),
                      _buildSearchField(textPrimary, textSecondary),
                      const SizedBox(height: 14),
                      _buildSegments(textPrimary, textSecondary),
                    ],
                  ),
                ),
                Expanded(
                  child: RefreshIndicator(
                    color: _tiktokPink,
                    onRefresh: () =>
                        _fetchInbox(forceRefresh: true, silent: false),
                    child: CustomScrollView(
                      physics: const BouncingScrollPhysics(
                        parent: AlwaysScrollableScrollPhysics(),
                      ),
                      slivers: [
                        SliverToBoxAdapter(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                _buildInboxQuickActions(
                                  textPrimary,
                                  textSecondary,
                                ),
                                const SizedBox(height: 8),
                              ],
                            ),
                          ),
                        ),
                        if (_activeList.isEmpty)
                          SliverFillRemaining(
                            hasScrollBody: false,
                            child: Center(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 24,
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      CupertinoIcons.chat_bubble_2,
                                      color: textSecondary,
                                      size: 42,
                                    ),
                                    const SizedBox(height: 14),
                                    Text(
                                      _activeTab == 'requests'
                                          ? 'Aucune demande de message pour le moment.'
                                          : 'Aucune conversation pour le moment.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: textSecondary,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          )
                        else
                          SliverPadding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                            sliver: SliverList.separated(
                              itemCount: _activeList.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(height: 4),
                              itemBuilder: (context, index) =>
                                  _buildConversationTile(
                                    _activeList[index],
                                    textPrimary,
                                    textSecondary,
                                  ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInboxHero(Color textPrimary, Color textSecondary) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: widget.isDarkMode
                  ? Colors.white.withValues(alpha: 0.05)
                  : Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(
                    alpha: widget.isDarkMode ? 0.18 : 0.04,
                  ),
                  blurRadius: 14,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: IconButton(
              onPressed: () {},
              icon: Icon(
                CupertinoIcons.person_badge_plus,
                color: textPrimary,
                size: 20,
              ),
            ),
          ),
          Expanded(
            child: Center(
              child: Text(
                'Messages',
                style: TextStyle(
                  color: textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: widget.isDarkMode
                  ? Colors.white.withValues(alpha: 0.05)
                  : Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(
                    alpha: widget.isDarkMode ? 0.18 : 0.04,
                  ),
                  blurRadius: 14,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: IconButton(
              onPressed: () => _searchFocusNode.requestFocus(),
              icon: Icon(CupertinoIcons.search, color: textPrimary, size: 20),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchField(Color textPrimary, Color textSecondary) {
    final fill = widget.isDarkMode ? const Color(0xFF141414) : Colors.white;
    return Container(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: widget.isDarkMode
              ? Colors.white.withValues(alpha: 0.06)
              : Colors.black.withValues(alpha: 0.06),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: widget.isDarkMode ? 0.14 : 0.03,
            ),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: TextField(
        focusNode: _searchFocusNode,
        controller: _searchController,
        onChanged: (_) => setState(() {}),
        style: TextStyle(color: textPrimary, fontSize: 14),
        decoration: InputDecoration(
          hintText: 'Rechercher une conversation',
          hintStyle: TextStyle(color: textSecondary, fontSize: 14),
          prefixIcon: Icon(
            CupertinoIcons.search,
            color: textSecondary,
            size: 18,
          ),
          suffixIcon: _searchController.text.isNotEmpty
              ? IconButton(
                  onPressed: () {
                    _searchController.clear();
                    setState(() {});
                  },
                  icon: Icon(
                    CupertinoIcons.clear_thick_circled,
                    color: textSecondary,
                    size: 18,
                  ),
                )
              : null,
          contentPadding: const EdgeInsets.symmetric(vertical: 14),
          border: InputBorder.none,
        ),
      ),
    );
  }

  Widget _buildStoryCarousel(Color textPrimary, Color textSecondary) {
    final contacts = _activeNowContacts;
    return SizedBox(
      height: 112,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: contacts.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (context, index) => _buildActiveContactChip(
          contacts[index],
          textPrimary,
          textSecondary,
        ),
      ),
    );
  }

  Widget _buildInboxQuickActions(Color textPrimary, Color textSecondary) {
    return Column(
      children: [
        _buildInboxQuickActionTile(
          title: 'Nouveaux followers',
          subtitle: _requestCount > 0
              ? '$_requestCount demande${_requestCount > 1 ? 's' : ''} de message a verifier'
              : 'Restez a jour avec les nouvelles demandes',
          badge: _requestCount,
          backgroundColor: const Color(0xFF27B8FF),
          icon: CupertinoIcons.person_2_fill,
          textPrimary: textPrimary,
          textSecondary: textSecondary,
          onTap: () => setState(() => _activeTab = 'requests'),
        ),
        const SizedBox(height: 8),
        _buildInboxQuickActionTile(
          title: 'Activite',
          subtitle: _generalUnreadCount > 0
              ? '$_generalUnreadCount nouveau${_generalUnreadCount > 1 ? 'x' : ''} message${_generalUnreadCount > 1 ? 's' : ''} ou partage${_generalUnreadCount > 1 ? 's' : ''}'
              : 'Vos messages, partages et activites recentes',
          badge: _generalUnreadCount,
          backgroundColor: _tiktokPink,
          icon: CupertinoIcons.heart_fill,
          textPrimary: textPrimary,
          textSecondary: textSecondary,
          onTap: () => setState(() => _activeTab = 'general'),
        ),
      ],
    );
  }

  Widget _buildInboxQuickActionTile({
    required String title,
    required String subtitle,
    required int badge,
    required Color backgroundColor,
    required IconData icon,
    required Color textPrimary,
    required Color textSecondary,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: backgroundColor,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: Colors.white, size: 28),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: textSecondary,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              if (badge > 0) ...[
                Container(
                  constraints: const BoxConstraints(minWidth: 28),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                  decoration: const BoxDecoration(
                    color: _tiktokPink,
                    borderRadius: BorderRadius.all(Radius.circular(999)),
                  ),
                  child: Text(
                    badge > 99 ? '99+' : '$badge',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Icon(
                CupertinoIcons.chevron_right,
                color: textSecondary.withValues(alpha: 0.45),
                size: 16,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSegments(Color textPrimary, Color textSecondary) {
    return Row(
      children: [
        _buildSegmentButton(
          id: 'general',
          label: 'Messages',
          count: _generalUnreadCount,
          textPrimary: textPrimary,
          textSecondary: textSecondary,
        ),
        const SizedBox(width: 10),
        _buildSegmentButton(
          id: 'requests',
          label: 'Demandes',
          count: _requestCount,
          textPrimary: textPrimary,
          textSecondary: textSecondary,
        ),
      ],
    );
  }

  Widget _buildSegmentButton({
    required String id,
    required String label,
    required int count,
    required Color textPrimary,
    required Color textSecondary,
  }) {
    final selected = _activeTab == id;
    return GestureDetector(
      onTap: () => setState(() => _activeTab = id),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected
              ? _tiktokPink.withValues(alpha: widget.isDarkMode ? 0.16 : 0.12)
              : (widget.isDarkMode
                    ? Colors.white.withValues(alpha: 0.04)
                    : Colors.black.withValues(alpha: 0.03)),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected
                ? _tiktokPink.withValues(alpha: 0.45)
                : (widget.isDarkMode
                      ? Colors.white.withValues(alpha: 0.05)
                      : Colors.black.withValues(alpha: 0.05)),
          ),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: _tiktokPink.withValues(alpha: 0.16),
                    blurRadius: 16,
                    offset: const Offset(0, 8),
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                color: selected ? textPrimary : textSecondary,
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
              ),
            ),
            if (count > 0) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: selected
                      ? _tiktokPink
                      : (widget.isDarkMode ? Colors.white12 : Colors.black12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$count',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildActiveContactChip(
    Map<String, dynamic> contact,
    Color textPrimary,
    Color textSecondary,
  ) {
    return GestureDetector(
      onTap: () => _openConversation(contact),
      child: SizedBox(
        width: 82,
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                _buildAvatar(
                  contact['avatar'] as String,
                  contact['name'] as String,
                  radius: 29,
                  showOnline: false,
                  online: true,
                ),
                Positioned(
                  right: 4,
                  bottom: -1,
                  child: Container(
                    width: 23,
                    height: 23,
                    decoration: BoxDecoration(
                      color: _tiktokPink,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: widget.isDarkMode
                            ? const Color(0xFF090909)
                            : const Color(0xFFFAFAFA),
                        width: 2,
                      ),
                    ),
                    child: const Icon(
                      CupertinoIcons.chat_bubble_fill,
                      color: Colors.white,
                      size: 12,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              contact['name'] as String,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: textPrimary,
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'Actif',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(color: textSecondary, fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConversationTile(
    Map<String, dynamic> conversation,
    Color textPrimary,
    Color textSecondary,
  ) {
    final isUnread = conversation['is_unread'] == true;
    final unreadCount = conversation['unread_count'] as int? ?? 0;

    return GestureDetector(
      onTap: () => _openConversation(conversation),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          color: isUnread
              ? (widget.isDarkMode
                    ? Colors.white.withValues(alpha: 0.03)
                    : Colors.white)
              : Colors.transparent,
          boxShadow: isUnread
              ? [
                  BoxShadow(
                    color: Colors.black.withValues(
                      alpha: widget.isDarkMode ? 0.12 : 0.03,
                    ),
                    blurRadius: 14,
                    offset: const Offset(0, 6),
                  ),
                ]
              : null,
        ),
        child: Row(
          children: [
            _buildAvatar(
              conversation['avatar'] as String,
              conversation['name'] as String,
              radius: 28,
              showOnline: true,
              online: conversation['is_online'] == true,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          conversation['name'] as String,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: textPrimary,
                            fontSize: 15,
                            fontWeight: isUnread
                                ? FontWeight.w900
                                : FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        conversation['time_text'] as String,
                        style: TextStyle(color: textSecondary, fontSize: 11),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      if ((conversation['request_status'] as String) ==
                          'pending') ...[
                        _buildMiniTag('Demande', _tiktokPink),
                        const SizedBox(width: 6),
                      ] else if (conversation['is_mutual'] == true) ...[
                        _buildMiniTag('Mutuel', _tiktokCyan),
                        const SizedBox(width: 6),
                      ],
                      Expanded(
                        child: Text(
                          conversation['preview'] as String,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: isUnread ? textPrimary : textSecondary,
                            fontSize: 13,
                            fontWeight: isUnread
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    conversation['presence_text'] as String,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: textSecondary, fontSize: 11),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            if (unreadCount > 0)
              Container(
                constraints: const BoxConstraints(minWidth: 22),
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
                decoration: const BoxDecoration(
                  color: _tiktokPink,
                  borderRadius: BorderRadius.all(Radius.circular(999)),
                ),
                child: Text(
                  unreadCount > 99 ? '99+' : '$unreadCount',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              )
            else
              Icon(
                CupertinoIcons.chevron_right,
                color: textSecondary.withValues(alpha: 0.7),
                size: 16,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildConversationShell() {
    final surface = widget.isDarkMode ? const Color(0xFF080808) : Colors.white;
    final textPrimary = widget.isDarkMode
        ? Colors.white
        : const Color(0xFF121212);
    final textSecondary = widget.isDarkMode
        ? Colors.white70
        : const Color(0xFF5F5F67);
    final conversation = _selectedConversation!;
    final username = _asString(conversation['username']);
    final presenceText = _asString(conversation['presence_text']);
    final isOnline = conversation['is_online'] == true;
    final canLaunchRealtimeActions = _canChatWithSelectedUser && isOnline;

    return Container(
      key: ValueKey('conversation-${conversation['id']}'),
      color: surface,
      child: Stack(
        children: [
          _buildAmbientBackground(),
          SafeArea(
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(8, 10, 10, 10),
                  decoration: BoxDecoration(
                    color: widget.isDarkMode
                        ? const Color(0xFF080808).withValues(alpha: 0.98)
                        : Colors.white.withValues(alpha: 0.98),
                    border: Border(
                      bottom: BorderSide(
                        color: widget.isDarkMode
                            ? Colors.white.withValues(alpha: 0.05)
                            : Colors.black.withValues(alpha: 0.06),
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      IconButton(
                        onPressed: _closeConversation,
                        icon: Icon(CupertinoIcons.back, color: textPrimary),
                      ),
                      _buildAvatar(
                        conversation['avatar'] as String,
                        conversation['name'] as String,
                        radius: 20,
                        showOnline: false,
                        online: conversation['is_online'] == true,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              conversation['name'] as String,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: textPrimary,
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            if (_partnerTyping ||
                                isOnline ||
                                username.isNotEmpty ||
                                presenceText.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              _buildConversationHeaderStatus(
                                username: username,
                                presenceText: presenceText,
                                isOnline: isOnline,
                                textSecondary: textSecondary,
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _buildHeaderActionButton(
                            icon: Icons.call_rounded,
                            color: textPrimary,
                            onPressed: canLaunchRealtimeActions
                                ? () => _startCall(isVideo: false)
                                : null,
                          ),
                          _buildHeaderActionButton(
                            icon: Icons.videocam_rounded,
                            color: textPrimary,
                            onPressed: canLaunchRealtimeActions
                                ? () => _startCall(isVideo: true)
                                : null,
                          ),
                          _buildHeaderActionButton(
                            icon: Icons.sports_esports_rounded,
                            color: textPrimary,
                            onPressed: canLaunchRealtimeActions
                                ? _openGameInviteComposer
                                : null,
                          ),
                          _buildHeaderActionButton(
                            icon: CupertinoIcons.ellipsis,
                            color: textPrimary,
                            onPressed: _openConversationOptions,
                            useCupertino: true,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (!_canChatWithSelectedUser)
                  _buildBlockedConversationBanner(textPrimary, textSecondary),
                if ((conversation['request_status'] as String) == 'pending')
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: _tiktokPink.withValues(alpha: 0.11),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: const Text(
                            'Demande de message',
                            style: TextStyle(
                              color: _tiktokPink,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (conversation['can_manage_request'] == true)
                  _buildRequestBanner(textPrimary, textSecondary),
                Expanded(
                  child: _isLoadingConversation
                      ? const Center(
                          child: CircularProgressIndicator(color: _tiktokPink),
                        )
                      : _conversationError != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  CupertinoIcons.exclamationmark_triangle,
                                  color: textSecondary,
                                  size: 40,
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  _conversationError!,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: textSecondary,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 16),
                                FilledButton(
                                  onPressed: () => _fetchConversationHistory(
                                    conversation['id'] as int,
                                    forceRefresh: true,
                                    silent: false,
                                  ),
                                  style: FilledButton.styleFrom(
                                    backgroundColor: _tiktokPink,
                                  ),
                                  child: const Text('Recharger'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : _buildMessagesList(textPrimary, textSecondary),
                ),
                if (_replyingToMessage != null)
                  _buildReplyBanner(textPrimary, textSecondary),
                if (_pendingAttachment != null)
                  _buildAttachmentPreview(textPrimary, textSecondary),
                _canChatWithSelectedUser
                    ? _buildComposer(textPrimary, textSecondary)
                    : _buildBlockedComposer(textPrimary, textSecondary),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConversationHeaderStatus({
    required String username,
    required String presenceText,
    required bool isOnline,
    required Color textSecondary,
  }) {
    if (_partnerTyping) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              color: _tiktokCyan,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: const Text(
              'En train d’ecrire',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: _tiktokCyan,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 6),
          _buildTypingDots(color: _tiktokCyan, dotSize: 4.4, compact: true),
        ],
      );
    }

    final secondaryText = username.isNotEmpty ? '@$username' : '';
    final primaryText = isOnline
        ? 'En ligne'
        : (presenceText.isNotEmpty ? presenceText : secondaryText);

    return Row(
      children: [
        if (isOnline) ...[
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              color: const Color(0xFF22C55E),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: 6),
        ],
        Expanded(
          child: RichText(
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            text: TextSpan(
              children: [
                TextSpan(
                  text: primaryText,
                  style: TextStyle(
                    color: isOnline ? const Color(0xFF22C55E) : textSecondary,
                    fontSize: 11.5,
                    fontWeight: isOnline ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
                if (secondaryText.isNotEmpty && isOnline)
                  TextSpan(
                    text: '  •  $secondaryText',
                    style: TextStyle(
                      color: textSecondary,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildHeaderActionButton({
    required IconData icon,
    required Color color,
    required VoidCallback? onPressed,
    bool useCupertino = false,
  }) {
    final disabled = onPressed == null;
    return Opacity(
      opacity: disabled ? 0.38 : 1,
      child: IconButton(
        onPressed: onPressed,
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints.tightFor(width: 32, height: 32),
        visualDensity: const VisualDensity(horizontal: -2, vertical: -2),
        splashRadius: 16,
        icon: useCupertino
            ? Icon(icon, color: color, size: 18)
            : Icon(icon, color: color, size: 20),
      ),
    );
  }

  Widget _buildBlockedConversationBanner(
    Color textPrimary,
    Color textSecondary,
  ) {
    final hasBlockedUser = _hasBlockedSelectedUser;
    final title = hasBlockedUser
        ? 'Vous avez bloque cet utilisateur'
        : 'Conversation indisponible';
    final subtitle = hasBlockedUser
        ? 'Debloquez-le pour renvoyer des messages, des appels ou des invitations.'
        : 'Cet utilisateur vous a bloque. Vous ne pouvez plus interagir avec cette conversation.';

    return Container(
      margin: const EdgeInsets.fromLTRB(14, 10, 14, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: widget.isDarkMode
            ? const Color(0xFF131317)
            : const Color(0xFFFFF7F8),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _tiktokPink.withValues(alpha: 0.18)),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: _tiktokPink.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(
              CupertinoIcons.hand_raised_fill,
              color: _tiktokPink,
              size: 18,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: textPrimary,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: textSecondary,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          if (hasBlockedUser)
            TextButton(
              onPressed: () => _toggleBlockForSelectedConversation(false),
              child: const Text('Debloquer'),
            ),
        ],
      ),
    );
  }

  Widget _buildReplyBanner(Color textPrimary, Color textSecondary) {
    final reply = _replyingToMessage;
    if (reply == null) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      decoration: BoxDecoration(
        color: widget.isDarkMode ? const Color(0xFF121214) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _bubblePurpleStart.withValues(alpha: 0.18)),
      ),
      child: Row(
        children: [
          Container(
            width: 3,
            height: 36,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [_bubblePurpleStart, _bubblePurpleEnd],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '@${_asString(reply['sender_username'], fallback: 'message')}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _bubblePurpleStart,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _asString(reply['content'], fallback: 'Message'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _clearReplyingToMessage,
            icon: Icon(
              CupertinoIcons.xmark_circle_fill,
              color: textPrimary.withValues(alpha: 0.58),
              size: 20,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBlockedComposer(Color textPrimary, Color textSecondary) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
      decoration: BoxDecoration(
        color: widget.isDarkMode
            ? const Color(0xFF090C10).withValues(alpha: 0.98)
            : Colors.white.withValues(alpha: 0.98),
        border: Border(
          top: BorderSide(
            color: widget.isDarkMode
                ? Colors.white.withValues(alpha: 0.05)
                : Colors.black.withValues(alpha: 0.05),
          ),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _hasBlockedSelectedUser
                  ? 'Debloquez cet utilisateur pour reprendre la conversation.'
                  : 'Cette conversation est bloquee.',
              style: TextStyle(
                color: textSecondary,
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          if (_hasBlockedSelectedUser)
            FilledButton(
              onPressed: () => _toggleBlockForSelectedConversation(false),
              style: FilledButton.styleFrom(backgroundColor: _tiktokPink),
              child: const Text('Debloquer'),
            ),
        ],
      ),
    );
  }

  Widget _buildTypingBubble(Color textSecondary) {
    final conversation = _selectedConversation;
    final bubbleColor = widget.isDarkMode
        ? const Color(0xFF171717)
        : const Color(0xFFF4F5F7);

    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: bubbleColor,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(22),
            topRight: Radius.circular(22),
            bottomLeft: Radius.circular(8),
            bottomRight: Radius.circular(22),
          ),
          border: Border.all(
            color: widget.isDarkMode
                ? Colors.white.withValues(alpha: 0.05)
                : Colors.black.withValues(alpha: 0.04),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (conversation != null) ...[
              _buildAvatar(
                _asString(conversation['avatar']),
                _asString(conversation['name'], fallback: 'U'),
                radius: 12,
                showOnline: false,
                online: false,
              ),
              const SizedBox(width: 8),
            ],
            _buildTypingDots(
              color: widget.isDarkMode ? Colors.white70 : textSecondary,
              dotSize: 6,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTypingDots({
    required Color color,
    required double dotSize,
    bool compact = false,
  }) {
    final spacing = compact ? 1.8 : 2.4;

    return AnimatedBuilder(
      animation: _typingAnimationController,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (index) {
            final wave = math.sin(
              ((_typingAnimationController.value + (index * 0.14)) *
                  math.pi *
                  2),
            );
            final opacity = 0.28 + ((wave + 1) / 2) * 0.72;
            final scale = 0.84 + ((wave + 1) / 2) * 0.26;

            return Opacity(
              opacity: opacity.clamp(0.0, 1.0).toDouble(),
              child: Transform.scale(
                scale: scale,
                child: Container(
                  width: dotSize,
                  height: dotSize,
                  margin: EdgeInsets.symmetric(horizontal: spacing / 2),
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
            );
          }),
        );
      },
    );
  }

  Widget _buildRequestBanner(Color textPrimary, Color textSecondary) {
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 12, 14, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        color: widget.isDarkMode ? const Color(0xFF131313) : Colors.white,
        border: Border.all(color: _tiktokPink.withValues(alpha: 0.22)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: widget.isDarkMode ? 0.16 : 0.05,
            ),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Demande de message',
            style: TextStyle(
              color: textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Acceptez pour faire passer cette conversation dans vos messages principaux.',
            style: TextStyle(
              color: textSecondary,
              fontSize: 12.5,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _updateMessageRequestStatus('decline'),
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(
                      color: widget.isDarkMode
                          ? Colors.white24
                          : Colors.black12,
                    ),
                    foregroundColor: textPrimary,
                  ),
                  child: const Text('Refuser'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  onPressed: () => _updateMessageRequestStatus('accept'),
                  style: FilledButton.styleFrom(backgroundColor: _tiktokPink),
                  child: const Text('Accepter'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMessagesList(Color textPrimary, Color textSecondary) {
    if (_messages.isEmpty) {
      if (_partnerTyping) {
        return ListView(
          controller: _messagesScrollController,
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 18),
          children: [_buildTypingBubble(textSecondary)],
        );
      }
      return Center(
        child: Text(
          'Aucun message pour le moment.',
          style: TextStyle(color: textSecondary, fontSize: 13),
        ),
      );
    }

    return ListView.builder(
      key: PageStorageKey<String>(
        'thread-${_selectedConversation?['id'] ?? 0}',
      ),
      reverse: true,
      controller: _messagesScrollController,
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 18),
      itemCount: _messages.length + (_partnerTyping ? 1 : 0),
      itemBuilder: (context, index) {
        if (_partnerTyping && index == 0) {
          return _buildTypingBubble(textSecondary);
        }
        final messageIndex = _partnerTyping
            ? (_messages.length - index)
            : (_messages.length - 1 - index);
        final message = _messages[messageIndex];
        final isMine = message['sender_id'] == widget.currentUserId;
        final showSeparator = _shouldShowThreadSeparator(messageIndex);
        return Column(
          children: [
            if (showSeparator)
              _buildThreadSeparator(
                message['created_at'] as String,
                textSecondary,
              ),
            _buildMessageBubble(message, isMine, textPrimary, textSecondary),
          ],
        );
      },
    );
  }

  Widget _buildMessageBubble(
    Map<String, dynamic> message,
    bool isMine,
    Color textPrimary,
    Color textSecondary,
  ) {
    final bubbleColor = isMine
        ? null
        : (widget.isDarkMode ? const Color(0xFF171717) : Colors.white);
    final bubbleGradient = isMine
        ? const LinearGradient(
            colors: [_bubblePurpleStart, _bubblePurpleEnd],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          )
        : null;
    final attachmentType = message['attachment_type'] as String;
    final attachmentUrl = message['attachment_url'] as String;
    final structuredContent = _parseStructuredContent(message['content']);
    final isSharedContent = _isSharedContent(structuredContent);
    final isGameInvitation = _isGameInvitationContent(structuredContent);
    final isDeleted = _asInt(message['deleted_for_everyone']) == 1;
    final isStructuredCard = isSharedContent || isGameInvitation;
    final hasText =
        (message['content'] as String).trim().isNotEmpty &&
        !isSharedContent &&
        !isGameInvitation &&
        !isDeleted;

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _openMessageActions(message, isMine),
        child: Container(
          margin: const EdgeInsets.only(bottom: 14),
          constraints: BoxConstraints(
            maxWidth:
                MediaQuery.of(context).size.width *
                (isStructuredCard ? 0.82 : 0.74),
          ),
          child: Column(
            crossAxisAlignment: isMine
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              Container(
                padding: isStructuredCard
                    ? EdgeInsets.zero
                    : EdgeInsets.all(attachmentType == 'image' ? 6 : 12),
                decoration: isStructuredCard
                    ? null
                    : BoxDecoration(
                        color: bubbleColor,
                        gradient: bubbleGradient,
                        borderRadius: BorderRadius.only(
                          topLeft: const Radius.circular(22),
                          topRight: const Radius.circular(22),
                          bottomLeft: Radius.circular(isMine ? 22 : 8),
                          bottomRight: Radius.circular(isMine ? 8 : 22),
                        ),
                        border: isMine
                            ? null
                            : Border.all(
                                color: widget.isDarkMode
                                    ? Colors.white.withValues(alpha: 0.05)
                                    : Colors.black.withValues(alpha: 0.04),
                              ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(
                              alpha: widget.isDarkMode ? 0.05 : 0.02,
                            ),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (isDeleted)
                      _buildDeletedMessageBubble(isMine, textSecondary)
                    else ...[
                      if (_asString(message['parent_content']).isNotEmpty ||
                          _asString(
                            message['parent_sender_username'],
                          ).isNotEmpty)
                        Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: isMine
                                ? Colors.white.withValues(alpha: 0.16)
                                : Colors.black.withValues(alpha: 0.05),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            '@${_asString(message['parent_sender_username'], fallback: 'reply')}  ${_asString(message['parent_content'], fallback: 'Message repondu')}',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: isMine ? Colors.white70 : textSecondary,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      if (_asInt(message['status_id']) > 0)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: _buildStatusReplyCard(
                            message,
                            isMine,
                            textPrimary,
                            textSecondary,
                          ),
                        ),
                      if (isSharedContent)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (_extractShareNote(structuredContent).isNotEmpty)
                              Container(
                                margin: const EdgeInsets.only(bottom: 8),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 10,
                                ),
                                decoration: BoxDecoration(
                                  color: isMine
                                      ? Colors.white.withValues(alpha: 0.16)
                                      : Colors.black.withValues(alpha: 0.05),
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                child: Text(
                                  _extractShareNote(structuredContent),
                                  style: TextStyle(
                                    color: isMine ? Colors.white : textPrimary,
                                    fontSize: 13.5,
                                    height: 1.3,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            _buildSharedContentCard(
                              structuredContent!,
                              isMine,
                              textPrimary,
                              textSecondary,
                            ),
                          ],
                        )
                      else if (isGameInvitation)
                        _buildGameInvitationCard(
                          message: message,
                          structuredContent: structuredContent!,
                          isMine: isMine,
                          textPrimary: textPrimary,
                          textSecondary: textSecondary,
                        )
                      else ...[
                        if (attachmentUrl.isNotEmpty)
                          _buildMessageAttachmentBody(
                            message: message,
                            attachmentType: attachmentType,
                            attachmentUrl: attachmentUrl,
                            isMine: isMine,
                            textPrimary: textPrimary,
                            textSecondary: textSecondary,
                          ),
                        if (hasText) ...[
                          if (attachmentUrl.isNotEmpty)
                            const SizedBox(height: 8),
                          Text(
                            message['content'] as String,
                            style: TextStyle(
                              color: isMine ? Colors.white : textPrimary,
                              fontSize: 14,
                              height: 1.35,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ],
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 5),
              Text(
                '${_formatMessageTimestamp(message['created_at'] as String)}${isMine ? _formatDeliveryStatus(message) : ''}',
                textAlign: isMine ? TextAlign.right : TextAlign.left,
                style: TextStyle(color: textSecondary, fontSize: 10.5),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDeletedMessageBubble(bool isMine, Color textSecondary) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
      child: Text(
        'Ce message a ete supprime.',
        style: TextStyle(
          color: isMine ? Colors.white70 : textSecondary,
          fontSize: 13,
          fontStyle: FontStyle.italic,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  Widget _buildMessageAttachmentBody({
    required Map<String, dynamic> message,
    required String attachmentType,
    required String attachmentUrl,
    required bool isMine,
    required Color textPrimary,
    required Color textSecondary,
  }) {
    final localFile = _localAttachmentFileFromMessage(message);

    if (attachmentType == 'image') {
      return _MessageImageAttachmentCard(
        key: ValueKey<String>('image-${_asInt(message['id'])}'),
        imageUrl: _resolveUrl(attachmentUrl),
        initialFile: localFile,
        isMine: isMine,
        onOpenViewer: (file) =>
            _openImagePreview(_resolveUrl(attachmentUrl), localFile: file),
      );
    }

    if (attachmentType == 'video') {
      return _buildVideoAttachmentCard(
        messageId: _asInt(message['id']),
        url: attachmentUrl,
        thumbnailUrl: _messageVideoThumbnailUrl(message),
        title: _asString(message['attachment_name'], fallback: 'Video'),
        localFile: localFile,
        isMine: isMine,
        textPrimary: textPrimary,
        textSecondary: textSecondary,
      );
    }

    if (attachmentType == 'audio') {
      return _buildAudioAttachmentCard(
        messageId: _asInt(message['id']),
        url: attachmentUrl,
        title: _asString(message['attachment_name'], fallback: 'Note vocale'),
        durationSeconds: _asInt(message['voice_duration_seconds']),
        localFile: localFile,
        isMine: isMine,
        textPrimary: textPrimary,
        textSecondary: textSecondary,
      );
    }

    return _buildFileAttachmentCard(
      title: _asString(message['attachment_name'], fallback: 'Piece jointe'),
      isMine: isMine,
      textPrimary: textPrimary,
      textSecondary: textSecondary,
    );
  }

  Widget _buildVideoAttachmentCard({
    required int messageId,
    required String url,
    required String thumbnailUrl,
    required String title,
    File? localFile,
    required bool isMine,
    required Color textPrimary,
    required Color textSecondary,
  }) {
    return _MessageVideoAttachmentCard(
      key: ValueKey<String>('video-$messageId'),
      mediaUrl: _resolveUrl(url),
      thumbnailUrl: thumbnailUrl,
      title: _attachmentDisplayLabel(
        attachmentType: 'video',
        originalName: title,
      ),
      initialFile: localFile,
      isMine: isMine,
      onOpenViewer: (file) => _openVideoPreview(
        mediaUrl: _resolveUrl(url),
        title: _attachmentDisplayLabel(
          attachmentType: 'video',
          originalName: title,
        ),
        thumbnailUrl: thumbnailUrl,
        localFile: file,
      ),
    );
  }

  String _messageVideoThumbnailUrl(Map<String, dynamic> message) {
    final rawThumbnail = _asString(
      message['attachment_thumbnail_url'] ??
          message['attachmentThumbnailUrl'] ??
          message['thumbnail_url'] ??
          message['thumbnailUrl'],
    );
    return rawThumbnail.isEmpty ? '' : _resolveUrl(rawThumbnail);
  }

  Widget _buildAudioAttachmentCard({
    required int messageId,
    required String url,
    required String title,
    required int durationSeconds,
    File? localFile,
    required bool isMine,
    required Color textPrimary,
    required Color textSecondary,
  }) {
    return _MessageAudioAttachmentCard(
      key: ValueKey<String>('audio-$messageId'),
      mediaUrl: _resolveUrl(url),
      title: _attachmentDisplayLabel(
        attachmentType: 'audio',
        originalName: title,
        durationSeconds: durationSeconds,
      ),
      initialLocalFile: localFile,
      durationSeconds: durationSeconds,
      isMine: isMine,
      textPrimary: textPrimary,
      textSecondary: textSecondary,
    );
  }

  Widget _buildFileAttachmentCard({
    required String title,
    required bool isMine,
    required Color textPrimary,
    required Color textSecondary,
  }) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isMine
            ? Colors.white.withValues(alpha: 0.14)
            : Colors.black.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            CupertinoIcons.doc_fill,
            color: isMine ? Colors.white : textPrimary,
            size: 18,
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: isMine ? Colors.white : textPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            'Fichier',
            style: TextStyle(
              color: isMine ? Colors.white70 : textSecondary,
              fontSize: 10.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAttachmentPreview(Color textPrimary, Color textSecondary) {
    final attachmentType =
        _pendingAttachment?['attachmentType']?.toString() ?? '';
    final attachmentName = _attachmentDisplayLabel(
      attachmentType: attachmentType,
      originalName: _pendingAttachment?['attachmentName']?.toString(),
      voiceDurationSeconds: _asInt(_pendingAttachment?['voiceDurationSeconds']),
    );
    final attachmentThumbnailUrl = _asString(
      _pendingAttachment?['attachmentThumbnailUrl'],
    );
    final voiceDurationSeconds = _asInt(
      _pendingAttachment?['voiceDurationSeconds'],
    );

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: widget.isDarkMode ? const Color(0xFF121212) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: widget.isDarkMode
              ? Colors.white.withValues(alpha: 0.05)
              : Colors.black.withValues(alpha: 0.05),
        ),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: _pendingAttachmentFile != null && attachmentType == 'image'
                ? Image.file(
                    _pendingAttachmentFile!,
                    width: 54,
                    height: 54,
                    fit: BoxFit.cover,
                  )
                : attachmentType == 'video' && attachmentThumbnailUrl.isNotEmpty
                ? Stack(
                    fit: StackFit.expand,
                    children: [
                      CachedNetworkImage(
                        imageUrl: _resolveUrl(attachmentThumbnailUrl),
                        width: 54,
                        height: 54,
                        fit: BoxFit.cover,
                        placeholder: (_, _) => _buildMessageMediaLoader(
                          width: 54,
                          height: 54,
                          isMine: false,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        errorWidget: (_, _, _) => Container(
                          color: widget.isDarkMode
                              ? Colors.white10
                              : Colors.black12,
                        ),
                      ),
                      Container(
                        color: Colors.black.withValues(alpha: 0.14),
                        alignment: Alignment.center,
                        child: Container(
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.42),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            CupertinoIcons.play_fill,
                            color: Colors.white,
                            size: 12,
                          ),
                        ),
                      ),
                    ],
                  )
                : Container(
                    width: 54,
                    height: 54,
                    color: widget.isDarkMode ? Colors.white10 : Colors.black12,
                    child: Icon(
                      attachmentType == 'image'
                          ? CupertinoIcons.photo
                          : attachmentType == 'video'
                          ? CupertinoIcons.videocam_fill
                          : attachmentType == 'audio'
                          ? CupertinoIcons.waveform
                          : CupertinoIcons.doc_fill,
                      color: textPrimary,
                    ),
                  ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _isUploadingAttachment
                      ? 'Preparation du media'
                      : 'Pret a envoyer',
                  style: TextStyle(
                    color: textPrimary,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  attachmentName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: textSecondary, fontSize: 11.5),
                ),
                if (attachmentType == 'audio' && voiceDurationSeconds > 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Duree : ${_formatDuration(voiceDurationSeconds)}',
                    style: TextStyle(
                      color: textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
          IconButton(
            onPressed: () {
              setState(() {
                _clearPendingAttachmentState(
                  invalidateUpload: _isUploadingAttachment,
                );
              });
            },
            icon: Icon(CupertinoIcons.xmark_circle_fill, color: textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildComposer(Color textPrimary, Color textSecondary) {
    final hasDraft =
        _composerController.text.trim().isNotEmpty ||
        _pendingAttachment != null;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
      decoration: BoxDecoration(
        color: widget.isDarkMode
            ? const Color(0xFF090C10).withValues(alpha: 0.98)
            : Colors.white.withValues(alpha: 0.98),
        border: Border(
          top: BorderSide(
            color: widget.isDarkMode
                ? Colors.white.withValues(alpha: 0.05)
                : Colors.black.withValues(alpha: 0.05),
          ),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: widget.isDarkMode ? 0.18 : 0.05,
            ),
            blurRadius: 18,
            offset: const Offset(0, -6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: _quickReactions.map((reaction) {
                return Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: GestureDetector(
                    onTap: (_isSendingMessage || _isUploadingAttachment)
                        ? null
                        : () => _handleQuickReaction(reaction),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: widget.isDarkMode
                            ? Colors.white.withValues(alpha: 0.06)
                            : const Color(0xFFF4F4F6),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        reaction,
                        style: const TextStyle(fontSize: 16),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: widget.isDarkMode
                      ? Colors.white.withValues(alpha: 0.05)
                      : const Color(0xFFF2F2F4),
                  shape: BoxShape.circle,
                ),
                child: IconButton(
                  onPressed: _isUploadingAttachment || _isSendingMessage
                      ? null
                      : _openCameraAttachmentSheet,
                  icon: _isUploadingAttachment
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: _tiktokPink,
                          ),
                        )
                      : Icon(
                          CupertinoIcons.camera_fill,
                          color: textPrimary,
                          size: 20,
                        ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: widget.isDarkMode
                        ? const Color(0xFF131313)
                        : const Color(0xFFF0F1F4),
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(
                      color: widget.isDarkMode
                          ? Colors.white.withValues(alpha: 0.04)
                          : Colors.black.withValues(alpha: 0.03),
                      width: 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _composerController,
                          minLines: 1,
                          maxLines: 4,
                          textInputAction: TextInputAction.send,
                          onSubmitted: (_) => _sendMessage(),
                          style: TextStyle(color: textPrimary, fontSize: 14),
                          decoration: InputDecoration(
                            hintText: 'Message...',
                            hintStyle: TextStyle(
                              color: textSecondary,
                              fontSize: 14,
                            ),
                            border: InputBorder.none,
                          ),
                        ),
                      ),
                      if (hasDraft)
                        GestureDetector(
                          onTap: (_isSendingMessage || _isUploadingAttachment)
                              ? null
                              : _sendMessage,
                          child: Container(
                            width: 38,
                            height: 38,
                            decoration: const BoxDecoration(
                              gradient: LinearGradient(
                                colors: [_bubblePurpleStart, _bubblePurpleEnd],
                              ),
                              shape: BoxShape.circle,
                            ),
                            child: Center(
                              child: _isSendingMessage
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(
                                      CupertinoIcons.paperplane_fill,
                                      color: Colors.white,
                                      size: 18,
                                    ),
                            ),
                          ),
                        )
                      else
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _buildComposerActionButton(
                              icon: CupertinoIcons.photo_on_rectangle,
                              color: textPrimary,
                              onTap: _openGalleryAttachmentSheet,
                            ),
                            _buildComposerActionButton(
                              icon: CupertinoIcons.smiley,
                              color: textPrimary,
                              onTap: _openEmojiPicker,
                            ),
                            _buildComposerActionButton(
                              icon: CupertinoIcons.mic_fill,
                              color: textPrimary,
                              onTap: _openVoiceRecorderSheet,
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildComposerActionButton({
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    return IconButton(
      onPressed: (_isSendingMessage || _isUploadingAttachment) ? null : onTap,
      splashRadius: 18,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      constraints: const BoxConstraints(),
      icon: Icon(icon, color: color, size: 20),
    );
  }

  void _handleQuickReaction(String reaction) {
    _composerController.text = reaction;
    _composerController.selection = TextSelection.fromPosition(
      TextPosition(offset: _composerController.text.length),
    );
    _sendMessage();
  }

  Widget _buildAvatar(
    String avatarUrl,
    String displayName, {
    required double radius,
    required bool showOnline,
    required bool online,
  }) {
    final initial = displayName.trim().isNotEmpty
        ? displayName.trim()[0].toUpperCase()
        : 'U';
    final hasAvatar = avatarUrl.isNotEmpty;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          padding: EdgeInsets.all(online ? 2.0 : 0.0),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: online
                ? const LinearGradient(
                    colors: [_tiktokCyan, _tiktokPink],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : null,
          ),
          child: CircleAvatar(
            radius: radius,
            backgroundColor: widget.isDarkMode
                ? const Color(0xFF0B0B0B)
                : Colors.white,
            child: ClipOval(
              child: hasAvatar
                  ? CachedNetworkImage(
                      imageUrl: _resolveUrl(avatarUrl),
                      width: radius * 2,
                      height: radius * 2,
                      fit: BoxFit.cover,
                      errorWidget: (_, _, _) =>
                          _buildAvatarFallback(initial, radius),
                    )
                  : _buildAvatarFallback(initial, radius),
            ),
          ),
        ),
        if (showOnline)
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: 13,
              height: 13,
              decoration: BoxDecoration(
                color: online ? _tiktokCyan : Colors.grey,
                shape: BoxShape.circle,
                border: Border.all(
                  color: widget.isDarkMode
                      ? const Color(0xFF090909)
                      : Colors.white,
                  width: 2,
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildAvatarFallback(String initial, double radius) {
    return Container(
      width: radius * 2,
      height: radius * 2,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFF77737)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        initial,
        style: TextStyle(
          color: Colors.white,
          fontSize: radius * 0.85,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }

  Widget _buildMiniTag(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Map<String, dynamic>? _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) {
      return value.map((key, val) => MapEntry(key.toString(), val));
    }
    return null;
  }

  Map<String, dynamic>? _parseStructuredContent(dynamic value) {
    final content = _asString(value);
    if (content.startsWith('{') && content.endsWith('}')) {
      try {
        final decoded = jsonDecode(content);
        final structured = _asMap(decoded);
        if (structured != null) return structured;
      } catch (_) {}
    }
    return _inferLegacySharedContent(content);
  }

  bool _isSharedContent(Map<String, dynamic>? structuredContent) {
    final type = _asString(structuredContent?['type']);
    return type == 'shared_post' || type == 'shared_reel';
  }

  bool _isGameInvitationContent(Map<String, dynamic>? structuredContent) {
    return _asString(structuredContent?['type']) == 'game_invitation';
  }

  bool _messageHasLiveGameInvite(Map<String, dynamic> message) {
    final structuredContent = _parseStructuredContent(message['content']);
    if (!_isGameInvitationContent(structuredContent)) return false;
    final status = _asString(structuredContent?['status'], fallback: 'pending');
    return status == 'pending' && !_isGameInvitationExpired(structuredContent!);
  }

  DateTime? _parseGameInvitationExpiry(Map<String, dynamic> structuredContent) {
    final raw = _asString(structuredContent['expiresAt']);
    if (raw.isEmpty) return null;
    return DateTime.tryParse(raw)?.toLocal();
  }

  bool _isGameInvitationExpired(Map<String, dynamic> structuredContent) {
    final expiry = _parseGameInvitationExpiry(structuredContent);
    return expiry != null && !expiry.isAfter(DateTime.now());
  }

  String _gameLabel(String rawKey) {
    final key = rawKey.trim().toLowerCase();
    return _gameLabels[key] ?? (key.isEmpty ? 'Jeu' : rawKey);
  }

  String _buildGameInvitationPreviewText(
    Map<String, dynamic> structuredContent,
  ) {
    final label = _gameLabel(_asString(structuredContent['game']));
    final status = _asString(structuredContent['status'], fallback: 'pending');
    final expired =
        status == 'pending' && _isGameInvitationExpired(structuredContent);

    if (status == 'accepted') return 'Invitation jeu acceptee : $label';
    if (status == 'declined') return 'Invitation jeu refusee : $label';
    if (status == 'error') return 'Invitation jeu en erreur : $label';
    if (expired) return 'Invitation jeu expiree : $label';
    return 'Invitation jeu : $label';
  }

  double _gameInvitationProgress(Map<String, dynamic> structuredContent) {
    final durationSeconds = _asInt(structuredContent['durationSeconds']);
    if (durationSeconds <= 0) return 0;
    final expiry = _parseGameInvitationExpiry(structuredContent);
    if (expiry == null) return 0;
    final timeLeft = expiry.difference(DateTime.now()).inMilliseconds;
    if (timeLeft <= 0) return 0;
    return (timeLeft / (durationSeconds * 1000)).clamp(0.0, 1.0);
  }

  String _formatGameInvitationPrice(Map<String, dynamic> structuredContent) {
    final priceType = _asString(
      structuredContent['priceType'],
      fallback: 'free',
    );
    if (priceType != 'paid') return 'Gratuit';
    final rawAmount = structuredContent['priceAmount'];
    final parsedAmount = rawAmount is num
        ? rawAmount.toDouble()
        : double.tryParse(_asString(rawAmount).replaceAll(',', '.')) ?? 0;
    if (parsedAmount == parsedAmount.roundToDouble()) {
      return 'Payant (${parsedAmount.toStringAsFixed(0)} \$)';
    }
    return 'Payant (${parsedAmount.toStringAsFixed(2)} \$)';
  }

  String _extractShareNote(Map<String, dynamic>? structuredContent) {
    if (structuredContent == null) return '';
    return _asString(
      structuredContent['note'] ??
          structuredContent['message'] ??
          structuredContent['text'],
    );
  }

  Map<String, dynamic>? _inferLegacySharedContent(String content) {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return null;

    final urlMatch = RegExp(
      r'((?:https?:\/\/|trasx:\/\/)[^\s]+)',
    ).firstMatch(trimmed);
    if (urlMatch == null) return null;

    final rawUrl = urlMatch.group(0) ?? '';
    final uri = _coerceUri(rawUrl);
    if (uri == null) return null;

    final note = trimmed.replaceFirst(rawUrl, '').trim();
    final postId = _extractPostIdFromUri(uri);
    if (postId > 0) {
      return {
        'type': 'shared_post',
        'shareUrl': rawUrl,
        'appUrl': 'https://trasx.com/?shared_post=$postId#post-$postId',
        if (note.isNotEmpty) 'note': note,
        'post': {'id': postId},
      };
    }

    final reelId = _extractReelIdFromUri(uri);
    if (reelId > 0) {
      return {
        'type': 'shared_reel',
        'shareUrl': rawUrl,
        'appUrl':
            'https://trasx.com/?view=shorts&shared_reel=$reelId#reel-$reelId',
        if (note.isNotEmpty) 'note': note,
        'reel': {'id': reelId},
      };
    }

    return null;
  }

  Uri? _coerceUri(String rawValue) {
    final candidate = rawValue.trim();
    if (candidate.isEmpty) return null;
    final parsed = Uri.tryParse(candidate);
    if (parsed == null) return null;
    if (parsed.hasScheme) return parsed;

    final normalized = candidate.startsWith('/')
        ? 'https://trasx.com$candidate'
        : 'https://trasx.com/$candidate';
    return Uri.tryParse(normalized);
  }

  int _extractPostIdFromUri(Uri uri) {
    final queryPostId = int.tryParse(uri.queryParameters['shared_post'] ?? '');
    if (queryPostId != null && queryPostId > 0) return queryPostId;

    final fragmentPostMatch = RegExp(r'post-(\d+)').firstMatch(uri.fragment);
    final fragmentPostId = int.tryParse(fragmentPostMatch?.group(1) ?? '');
    if (fragmentPostId != null && fragmentPostId > 0) return fragmentPostId;

    final segments = uri.pathSegments;
    final postIndex = segments.indexOf('post');
    if (postIndex >= 0 && postIndex + 1 < segments.length) {
      final postId = int.tryParse(segments[postIndex + 1]);
      if (postId != null && postId > 0) return postId;
    }

    if (uri.host == 'post') {
      final postId = int.tryParse(
        segments.isNotEmpty
            ? segments.first
            : (uri.queryParameters['id'] ?? ''),
      );
      if (postId != null && postId > 0) return postId;
    }

    return 0;
  }

  int _extractReelIdFromUri(Uri uri) {
    final queryReelId = int.tryParse(uri.queryParameters['shared_reel'] ?? '');
    if (queryReelId != null && queryReelId > 0) return queryReelId;

    final fragmentReelMatch = RegExp(r'reel-(\d+)').firstMatch(uri.fragment);
    final fragmentReelId = int.tryParse(fragmentReelMatch?.group(1) ?? '');
    if (fragmentReelId != null && fragmentReelId > 0) return fragmentReelId;

    final segments = uri.pathSegments;
    final shortsIndex = segments.indexOf('shorts');
    if (shortsIndex >= 0 && shortsIndex + 1 < segments.length) {
      final reelId = int.tryParse(segments[shortsIndex + 1]);
      if (reelId != null && reelId > 0) return reelId;
    }

    if (uri.host == 'shorts' || uri.host == 'reel') {
      final reelId = int.tryParse(
        segments.isNotEmpty
            ? segments.first
            : (uri.queryParameters['id'] ?? ''),
      );
      if (reelId != null && reelId > 0) return reelId;
    }

    return 0;
  }

  Uri? _extractSharedContentUri(Map<String, dynamic> structuredContent) {
    final appUri = _coerceUri(_asString(structuredContent['appUrl']));
    if (appUri != null) return appUri;

    final shareUri = _coerceUri(_asString(structuredContent['shareUrl']));
    if (shareUri != null) return shareUri;

    final type = _asString(structuredContent['type']);
    if (type == 'shared_post') {
      final post = _asMap(structuredContent['post']) ?? <String, dynamic>{};
      final postId = _asInt(post['id']);
      if (postId > 0) {
        return Uri.tryParse(
          'https://trasx.com/?shared_post=$postId#post-$postId',
        );
      }
    }

    if (type == 'shared_reel') {
      final reel = _asMap(structuredContent['reel']) ?? <String, dynamic>{};
      final reelId = _asInt(reel['id']);
      if (reelId > 0) {
        return Uri.tryParse(
          'https://trasx.com/?view=shorts&shared_reel=$reelId#reel-$reelId',
        );
      }
    }

    return null;
  }

  void _handleSharedContentTap(Map<String, dynamic> structuredContent) {
    final targetUri = _extractSharedContentUri(structuredContent);
    if (targetUri == null) return;
    widget.onOpenShareLink?.call(targetUri);
  }

  String _formatPresenceText(String rawValue) {
    final raw = rawValue.trim();
    if (raw.isEmpty) return 'Hors ligne';
    final lower = raw.toLowerCase();
    if (lower == 'online now') return 'En ligne';
    if (lower == 'offline') return 'Hors ligne';
    if (lower == 'last seen just now') return 'Actif a l’instant';

    final minutesMatch = RegExp(r'^last seen (\d+)m ago$').firstMatch(lower);
    if (minutesMatch != null) {
      return 'Actif il y a ${minutesMatch.group(1)} min';
    }

    final hoursMatch = RegExp(r'^last seen (\d+)h ago$').firstMatch(lower);
    if (hoursMatch != null) {
      return 'Actif il y a ${hoursMatch.group(1)} h';
    }

    final daysMatch = RegExp(r'^last seen (\d+)d ago$').firstMatch(lower);
    if (daysMatch != null) {
      return 'Actif il y a ${daysMatch.group(1)} j';
    }

    if (lower.startsWith('last seen ')) {
      return 'Actif ${raw.substring(10)}';
    }

    return raw;
  }

  Widget _buildStatusReplyCard(
    Map<String, dynamic> message,
    bool isMine,
    Color textPrimary,
    Color textSecondary,
  ) {
    final mediaType = _asString(message['status_media_type']);
    final caption = _asString(
      message['status_caption'],
      fallback: 'Statut partage',
    );
    final mediaUrl = _resolveUrl(_asString(message['status_media_url']));
    final accent = isMine ? Colors.white : const Color(0xFF24D39A);

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isMine
            ? Colors.white.withValues(alpha: 0.14)
            : Colors.black.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: accent.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Reponse au statut de @${_asString(message['status_author_username'], fallback: 'user')}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: accent,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  caption,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: isMine ? Colors.white : textSecondary,
                    fontSize: 11.5,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
          if (mediaUrl.isNotEmpty) ...[
            const SizedBox(width: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                width: 42,
                height: 42,
                child: mediaType.startsWith('image/')
                    ? CachedNetworkImage(
                        imageUrl: mediaUrl,
                        fit: BoxFit.cover,
                        errorWidget: (_, _, _) => Container(
                          color: Colors.black12,
                          alignment: Alignment.center,
                          child: Icon(
                            CupertinoIcons.photo,
                            color: isMine ? Colors.white70 : textPrimary,
                            size: 18,
                          ),
                        ),
                      )
                    : Container(
                        color: widget.isDarkMode
                            ? Colors.white10
                            : Colors.black12,
                        alignment: Alignment.center,
                        child: Icon(
                          CupertinoIcons.play_fill,
                          color: isMine ? Colors.white70 : textPrimary,
                          size: 18,
                        ),
                      ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildGameInvitationCard({
    required Map<String, dynamic> message,
    required Map<String, dynamic> structuredContent,
    required bool isMine,
    required Color textPrimary,
    required Color textSecondary,
  }) {
    final status = _asString(structuredContent['status'], fallback: 'pending');
    final expired =
        status == 'pending' && _isGameInvitationExpired(structuredContent);
    final isPending = status == 'pending' && !expired;
    final isAccepted = status == 'accepted';
    final isDeclined = status == 'declined';
    final isError = status == 'error';
    final canRespond = !isMine && isPending;
    final progress = _gameInvitationProgress(structuredContent);
    final gameLabel = _gameLabel(_asString(structuredContent['game']));
    final priceLabel = _formatGameInvitationPrice(structuredContent);

    String statusText;
    Color statusColor;
    if (isAccepted) {
      statusText = 'Partie acceptee';
      statusColor = const Color(0xFF10B981);
    } else if (isDeclined) {
      statusText = 'Invitation refusee';
      statusColor = const Color(0xFFEF4444);
    } else if (expired) {
      statusText = 'Invitation expiree';
      statusColor = textSecondary;
    } else if (isError) {
      statusText = _asString(
        structuredContent['error'],
        fallback: 'Une erreur est survenue.',
      );
      statusColor = const Color(0xFFF59E0B);
    } else {
      statusText = 'En attente de reponse...';
      statusColor = textSecondary;
    }

    return Container(
      width: 286,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: widget.isDarkMode ? const Color(0xFF111318) : Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: isMine
              ? Colors.white.withValues(alpha: 0.12)
              : Colors.black.withValues(alpha: 0.06),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: widget.isDarkMode ? 0.22 : 0.06,
            ),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [_tiktokPink, _bubblePurpleEnd],
                  ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.sports_esports_rounded,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      gameLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: textPrimary,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      priceLabel,
                      style: TextStyle(
                        color: priceLabel == 'Gratuit'
                            ? const Color(0xFF10B981)
                            : _tiktokPink,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: widget.isDarkMode
                  ? Colors.white.withValues(alpha: 0.04)
                  : const Color(0xFFF6F7FA),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              'Salut ! Je te propose une partie. Tu es partant ?',
              style: TextStyle(
                color: textPrimary,
                fontSize: 12.5,
                height: 1.4,
                fontStyle: FontStyle.italic,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            statusText,
            style: TextStyle(
              color: statusColor,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (isPending) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 6,
                backgroundColor: widget.isDarkMode
                    ? Colors.white12
                    : Colors.black12,
                valueColor: AlwaysStoppedAnimation<Color>(
                  progress < 0.25
                      ? const Color(0xFFEF4444)
                      : progress < 0.5
                      ? const Color(0xFFF59E0B)
                      : const Color(0xFF10B981),
                ),
              ),
            ),
          ],
          if (canRespond) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: () =>
                        _handleGameInvitationAction(message, 'accept'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF10B981),
                    ),
                    child: const Text('Accepter'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () =>
                        _handleGameInvitationAction(message, 'decline'),
                    child: const Text('Refuser'),
                  ),
                ),
              ],
            ),
          ],
          if (isAccepted && _asInt(structuredContent['gameId']) > 0) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => _openAcceptedGameInvite(structuredContent),
                style: FilledButton.styleFrom(
                  backgroundColor: _bubblePurpleStart,
                ),
                child: const Text('Jeu pret'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildSharedContentCard(
    Map<String, dynamic> structuredContent,
    bool isMine,
    Color textPrimary,
    Color textSecondary,
  ) {
    final type = _asString(structuredContent['type']);
    final card = type == 'shared_reel'
        ? _buildSharedReelCard(
            structuredContent,
            isMine,
            textPrimary,
            textSecondary,
          )
        : _buildSharedPostCard(
            structuredContent,
            isMine,
            textPrimary,
            textSecondary,
          );

    if (_extractSharedContentUri(structuredContent) == null) {
      return card;
    }

    return GestureDetector(
      onTap: () => _handleSharedContentTap(structuredContent),
      child: card,
    );
  }

  Widget _buildSharedPostCard(
    Map<String, dynamic> structuredContent,
    bool isMine,
    Color textPrimary,
    Color textSecondary,
  ) {
    final post = _asMap(structuredContent['post']) ?? <String, dynamic>{};
    final snapshot = _asMap(post['snapshot']) ?? <String, dynamic>{};
    final authorName = _asString(post['authorName'], fallback: 'Publication');
    final authorUsername = _asString(post['authorUsername']);
    final authorAvatar = _asString(post['authorAvatar']);
    final excerpt = _asString(
      post['excerpt'] ?? post['content'],
      fallback: 'Voir la publication partagee.',
    );
    final mediaType = _asString(post['mediaType']);
    final previewImageUrl = _asString(
      post['previewImageUrl'] ??
          post['thumbnailUrl'] ??
          post['imageUrl'] ??
          post['bgImageUrl'],
    );
    final previewVideoUrl = _asString(
      post['previewVideoUrl'] ?? post['videoUrl'] ?? post['imageUrl'],
    );
    final resolvedMediaType = mediaType.isNotEmpty
        ? mediaType
        : (_looksLikeVideoUrl(previewVideoUrl) ? 'video' : 'image');
    final likeCount = _asString(snapshot['likeCount'], fallback: '0');
    final commentCount = _asString(snapshot['commentCount'], fallback: '0');
    final shareCount = _asString(snapshot['shareCount'], fallback: '0');

    return Container(
      width: 236,
      decoration: BoxDecoration(
        color: widget.isDarkMode ? const Color(0xFF0F1114) : Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: isMine
              ? Colors.white.withValues(alpha: 0.18)
              : Colors.black.withValues(alpha: 0.06),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: widget.isDarkMode ? 0.22 : 0.07,
            ),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: widget.isDarkMode
                    ? [const Color(0xFF14171C), const Color(0xFF0F1114)]
                    : [const Color(0xFFFFF8FA), const Color(0xFFFFFFFF)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(24),
                topRight: Radius.circular(24),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: _tiktokPink.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: const [
                          Icon(
                            CupertinoIcons.arrowshape_turn_up_right_fill,
                            color: _tiktokPink,
                            size: 11,
                          ),
                          SizedBox(width: 5),
                          Text(
                            'Post partage',
                            style: TextStyle(
                              color: _tiktokPink,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    _buildAvatar(
                      authorAvatar,
                      authorName,
                      radius: 15,
                      showOnline: false,
                      online: false,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            authorName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: textPrimary,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          if (authorUsername.isNotEmpty)
                            Text(
                              '@$authorUsername',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: textSecondary,
                                fontSize: 10.5,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (previewImageUrl.isNotEmpty ||
              previewVideoUrl.isNotEmpty ||
              resolvedMediaType.isNotEmpty)
            _buildSharedMediaPreview(
              mediaType: resolvedMediaType,
              imageUrl: previewImageUrl,
              videoUrl: previewVideoUrl,
              height: 168,
              borderRadius: BorderRadius.zero,
              showPlayBadge: resolvedMediaType == 'video',
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Text(
              excerpt,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: textPrimary,
                fontSize: 12.5,
                height: 1.35,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: Row(
              children: [
                _buildSharedStatPill(
                  CupertinoIcons.heart_fill,
                  likeCount,
                  textPrimary,
                  textSecondary,
                ),
                const SizedBox(width: 8),
                _buildSharedStatPill(
                  CupertinoIcons.chat_bubble_fill,
                  commentCount,
                  textPrimary,
                  textSecondary,
                ),
                const SizedBox(width: 8),
                _buildSharedStatPill(
                  CupertinoIcons.arrowshape_turn_up_right_fill,
                  shareCount,
                  textPrimary,
                  textSecondary,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            child: Text(
              'Voir la publication',
              style: TextStyle(
                color: textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSharedReelCard(
    Map<String, dynamic> structuredContent,
    bool isMine,
    Color textPrimary,
    Color textSecondary,
  ) {
    final reel = _asMap(structuredContent['reel']) ?? <String, dynamic>{};
    final snapshot = _asMap(reel['snapshot']) ?? <String, dynamic>{};
    final authorName = _asString(reel['authorName'], fallback: 'Short');
    final authorUsername = _asString(reel['authorUsername']);
    final authorAvatar = _asString(reel['authorAvatar']);
    final caption = _asString(
      reel['caption'],
      fallback: 'Voir le short partage.',
    );
    final previewImageUrl = _asString(reel['previewImageUrl']);
    final previewVideoUrl = _asString(reel['previewVideoUrl']);
    final mediaType = _asString(reel['mediaType'], fallback: 'video');
    final likeCount = _asString(snapshot['likeCount'], fallback: '0');
    final commentCount = _asString(snapshot['commentCount'], fallback: '0');
    final shareCount = _asString(snapshot['shareCount'], fallback: '0');

    return Container(
      width: 220,
      height: 320,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFF0D0D0F),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(
          color: isMine
              ? Colors.white.withValues(alpha: 0.14)
              : Colors.white.withValues(alpha: 0.08),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.28),
            blurRadius: 28,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          _buildSharedMediaPreview(
            mediaType: mediaType,
            imageUrl: previewImageUrl,
            videoUrl: previewVideoUrl,
            height: 320,
            borderRadius: BorderRadius.circular(26),
            showPlayBadge: true,
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Colors.black.withValues(alpha: 0.08),
                  Colors.black.withValues(alpha: 0.12),
                  Colors.black.withValues(alpha: 0.82),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: const [0.0, 0.42, 1.0],
              ),
            ),
          ),
          Positioned(
            top: 12,
            left: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.34),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: Colors.white12),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: const [
                  Icon(
                    CupertinoIcons.arrowshape_turn_up_right_fill,
                    color: Colors.white,
                    size: 11,
                  ),
                  SizedBox(width: 5),
                  Text(
                    'Short partage',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            right: 12,
            bottom: 18,
            child: Column(
              children: [
                _buildVerticalStatBadge(CupertinoIcons.heart_fill, likeCount),
                const SizedBox(height: 8),
                _buildVerticalStatBadge(
                  CupertinoIcons.chat_bubble_fill,
                  commentCount,
                ),
                const SizedBox(height: 8),
                _buildVerticalStatBadge(
                  CupertinoIcons.arrowshape_turn_up_right_fill,
                  shareCount,
                ),
              ],
            ),
          ),
          Positioned(
            left: 14,
            right: 62,
            bottom: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _buildAvatar(
                      authorAvatar,
                      authorName,
                      radius: 15,
                      showOnline: false,
                      online: false,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            authorName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          if (authorUsername.isNotEmpty)
                            Text(
                              '@$authorUsername',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 10.5,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  caption,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12.5,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSharedMediaPreview({
    required String mediaType,
    required String imageUrl,
    required String videoUrl,
    required double height,
    required BorderRadius borderRadius,
    bool showPlayBadge = false,
  }) {
    final resolvedImageUrl = _resolveUrl(imageUrl);
    final resolvedVideoUrl = _resolveUrl(videoUrl);
    final imageLooksSafe = imageUrl.isNotEmpty && !_looksLikeVideoUrl(imageUrl);
    final isVideo = mediaType == 'video' || _looksLikeVideoUrl(videoUrl);

    return ClipRRect(
      borderRadius: borderRadius,
      child: SizedBox(
        height: height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (imageLooksSafe)
              CachedNetworkImage(
                imageUrl: resolvedImageUrl,
                fit: BoxFit.cover,
                errorWidget: (_, _, _) => _buildSharedMediaFallback(isVideo),
              )
            else
              _buildSharedMediaFallback(isVideo),
            if (showPlayBadge && (isVideo || resolvedVideoUrl.isNotEmpty))
              Center(
                child: Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.42),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white24),
                  ),
                  child: const Icon(
                    CupertinoIcons.play_fill,
                    color: Colors.white,
                    size: 24,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSharedMediaFallback(bool isVideo) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isVideo
              ? const [Color(0xFF111111), Color(0xFF242424)]
              : const [Color(0xFF18212D), Color(0xFF25354A)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      alignment: Alignment.center,
      child: Icon(
        isVideo
            ? CupertinoIcons.play_rectangle_fill
            : CupertinoIcons.photo_fill,
        color: Colors.white70,
        size: 34,
      ),
    );
  }

  Widget _buildSharedStatPill(
    IconData icon,
    String value,
    Color textPrimary,
    Color textSecondary,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: widget.isDarkMode
            ? Colors.white.withValues(alpha: 0.04)
            : const Color(0xFFF4F4F6),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: textSecondary),
          const SizedBox(width: 5),
          Text(
            value,
            style: TextStyle(
              color: textPrimary,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVerticalStatBadge(IconData icon, String value) {
    return Container(
      width: 40,
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.28),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        children: [
          Icon(icon, color: Colors.white, size: 14),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 9.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }

  bool _shouldShowThreadSeparator(int index) {
    if (index <= 0 || index >= _messages.length) return true;

    try {
      final current = DateTime.parse(
        _messages[index]['created_at'] as String,
      ).toLocal();
      final previous = DateTime.parse(
        _messages[index - 1]['created_at'] as String,
      ).toLocal();

      final dayChanged =
          current.year != previous.year ||
          current.month != previous.month ||
          current.day != previous.day;

      if (dayChanged) return true;
      return current.difference(previous).inMinutes >= 90;
    } catch (_) {
      return false;
    }
  }

  Widget _buildThreadSeparator(String iso, Color textSecondary) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 10, 0, 14),
      child: Center(
        child: Text(
          _formatThreadSeparator(iso),
          style: TextStyle(
            color: textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }

  String _formatThreadSeparator(String iso) {
    try {
      final date = DateTime.parse(iso).toLocal();
      final now = DateTime.now();
      final time =
          '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
      final sameDay =
          date.year == now.year &&
          date.month == now.month &&
          date.day == now.day;

      if (sameDay) {
        return 'Aujourd’hui $time';
      }

      final yesterday = now.subtract(const Duration(days: 1));
      final isYesterday =
          date.year == yesterday.year &&
          date.month == yesterday.month &&
          date.day == yesterday.day;
      if (isYesterday) {
        return 'Hier $time';
      }

      if (now.difference(date).inDays < 7) {
        const weekdays = [
          'lundi',
          'mardi',
          'mercredi',
          'jeudi',
          'vendredi',
          'samedi',
          'dimanche',
        ];
        return '${weekdays[(date.weekday - 1).clamp(0, 6)]} $time';
      }

      const months = [
        'janv.',
        'fevr.',
        'mars',
        'avr.',
        'mai',
        'juin',
        'juil.',
        'aout',
        'sept.',
        'oct.',
        'nov.',
        'dec.',
      ];
      return '${date.day} ${months[(date.month - 1).clamp(0, 11)]} $time';
    } catch (_) {
      return '';
    }
  }

  String _previewFromAttachment(Map<String, dynamic> attachment) {
    final type = _asString(attachment['attachmentType']);
    if (type == 'image') return 'Image envoyee';
    if (type == 'video') return 'Video envoyee';
    if (type == 'audio') {
      final duration = _asInt(
        attachment['voiceDurationSeconds'] ??
            attachment['voice_duration_seconds'],
      );
      return duration > 0
          ? 'Note vocale · ${_formatDuration(duration)}'
          : 'Note vocale envoyee';
    }
    return 'Piece jointe envoyee';
  }

  String _buildConversationPreview(Map<String, dynamic> message) {
    if (_asInt(message['deleted_for_everyone']) == 1) {
      return 'Ce message a ete supprime.';
    }

    final content = _asString(message['content']);
    final structuredContent = _parseStructuredContent(content);

    if (structuredContent != null) {
      final type = _asString(structuredContent['type']);
      if (type == 'game_invitation') {
        return _buildGameInvitationPreviewText(structuredContent);
      }
      if (type == 'shared_post') {
        final post = _asMap(structuredContent['post']) ?? <String, dynamic>{};
        final excerpt = _asString(post['excerpt']);
        final authorName = _asString(
          post['authorName'] ?? post['authorUsername'],
        );
        if (excerpt.isNotEmpty) {
          return 'Post partage : ${excerpt.length > 80 ? '${excerpt.substring(0, 77)}...' : excerpt}';
        }
        if (authorName.isNotEmpty) {
          return 'Post partage de $authorName';
        }
        return 'Post partage';
      }
      if (type == 'shared_reel') {
        final reel = _asMap(structuredContent['reel']) ?? <String, dynamic>{};
        final caption = _asString(reel['caption'] ?? reel['excerpt']);
        final authorName = _asString(
          reel['authorName'] ?? reel['authorUsername'],
        );
        if (caption.isNotEmpty) {
          return 'Short partage : ${caption.length > 80 ? '${caption.substring(0, 77)}...' : caption}';
        }
        if (authorName.isNotEmpty) {
          return 'Short partage de $authorName';
        }
        return 'Short partage';
      }
    }

    final statusPreview = _buildStatusPreviewText(message);
    if (statusPreview.isNotEmpty) return statusPreview;
    if (content.isNotEmpty) return content;
    return _previewFromAttachment({
      'attachmentType': message['attachment_type'],
      'voice_duration_seconds': message['voice_duration_seconds'],
    });
  }

  String _buildStatusPreviewText(Map<String, dynamic> message) {
    final statusId = _asInt(message['status_id']);
    if (statusId == 0) return '';

    final content = _asString(message['content']);
    final statusCaption = _asString(message['status_caption']);
    final hasAlphaNumeric = RegExp(r'[A-Za-z0-9À-ÖØ-öø-ÿ]').hasMatch(content);

    if (content.isNotEmpty) {
      final excerpt = content.length > 80
          ? '${content.substring(0, 77)}...'
          : content;
      return hasAlphaNumeric
          ? 'Reponse au statut : $excerpt'
          : 'Reaction au statut : $excerpt';
    }

    if (statusCaption.isNotEmpty) {
      final excerpt = statusCaption.length > 72
          ? '${statusCaption.substring(0, 69)}...'
          : statusCaption;
      return 'Statut : $excerpt';
    }

    return 'Reponse a un statut';
  }

  String _formatConversationTime(String iso) {
    try {
      final date = DateTime.parse(iso).toLocal();
      final now = DateTime.now();
      final isToday =
          date.year == now.year &&
          date.month == now.month &&
          date.day == now.day;
      if (isToday) {
        final hour = date.hour.toString().padLeft(2, '0');
        final minute = date.minute.toString().padLeft(2, '0');
        return '$hour:$minute';
      }
      if (now.difference(date).inDays < 7) {
        const weekdays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        return weekdays[(date.weekday - 1).clamp(0, 6)];
      }
      return '${date.day}/${date.month}';
    } catch (_) {
      return '';
    }
  }

  String _formatMessageTimestamp(String iso) {
    try {
      final date = DateTime.parse(iso).toLocal();
      final now = DateTime.now();
      final hour = date.hour.toString().padLeft(2, '0');
      final minute = date.minute.toString().padLeft(2, '0');
      final time = '$hour:$minute';
      final isToday =
          date.year == now.year &&
          date.month == now.month &&
          date.day == now.day;
      if (isToday) {
        return 'Aujourd’hui $time';
      }

      final yesterday = now.subtract(const Duration(days: 1));
      final isYesterday =
          date.year == yesterday.year &&
          date.month == yesterday.month &&
          date.day == yesterday.day;
      if (isYesterday) {
        return 'Hier $time';
      }

      return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')} $time';
    } catch (_) {
      return '';
    }
  }

  String _formatStatusTimestamp(String iso) {
    try {
      final date = DateTime.parse(iso).toLocal();
      final now = DateTime.now();
      final hour = date.hour.toString().padLeft(2, '0');
      final minute = date.minute.toString().padLeft(2, '0');
      final time = '$hour:$minute';
      final isToday =
          date.year == now.year &&
          date.month == now.month &&
          date.day == now.day;
      if (isToday) return time;
      return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')} $time';
    } catch (_) {
      return '';
    }
  }

  String _formatDuration(int totalSeconds) {
    final safeSeconds = totalSeconds < 0 ? 0 : totalSeconds;
    final minutes = (safeSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (safeSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  MediaType? _inferAttachmentMediaType(String filePath, String formFieldName) {
    final inferredMime = lookupMimeType(filePath);
    final fallbackMime = formFieldName == 'audio'
        ? 'audio/mp4'
        : _fallbackMimeFromExtension(filePath);
    final selectedMime = (inferredMime == null || inferredMime.isEmpty)
        ? fallbackMime
        : inferredMime;
    final segments = selectedMime.split('/');
    if (segments.length != 2) return null;
    return MediaType(segments.first, segments.last);
  }

  String _fallbackMimeFromExtension(String filePath) {
    final lower = filePath.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.heic')) return 'image/heic';
    if (lower.endsWith('.heif')) return 'image/heif';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.m4v')) return 'video/x-m4v';
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.mkv')) return 'video/x-matroska';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    if (lower.endsWith('.aac')) return 'audio/aac';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.opus')) return 'audio/opus';
    return 'application/octet-stream';
  }

  String _attachmentDisplayLabel({
    required String attachmentType,
    String? originalName,
    int durationSeconds = 0,
    int? voiceDurationSeconds,
  }) {
    final normalizedType = attachmentType.trim().toLowerCase();
    final effectiveDuration = voiceDurationSeconds ?? durationSeconds;
    if (normalizedType == 'image') return 'Image';
    if (normalizedType == 'video') return 'Video';
    if (normalizedType == 'audio') {
      return effectiveDuration > 0
          ? 'Note vocale · ${_formatDuration(effectiveDuration)}'
          : 'Note vocale';
    }

    final sanitized = _sanitizeAttachmentName(originalName);
    return sanitized.isNotEmpty ? sanitized : 'Piece jointe';
  }

  String _sanitizeAttachmentName(String? rawName) {
    final trimmed = _asString(rawName);
    if (trimmed.isEmpty) return '';
    final segments = trimmed.split('/');
    final lastSegment = segments.isNotEmpty ? segments.last : trimmed;
    return lastSegment.length > 48
        ? '${lastSegment.substring(0, 45)}...'
        : lastSegment;
  }

  String _formatDeliveryStatus(Map<String, dynamic> message) {
    final readAt = _asString(message['read_at']);
    final deliveredAt = _asString(message['delivered_at']);
    if (readAt.isNotEmpty) {
      final readTime = _formatStatusTimestamp(readAt);
      return readTime.isNotEmpty ? '  ·  Lu $readTime' : '  ·  Lu';
    }
    if (deliveredAt.isNotEmpty) {
      final deliveredTime = _formatStatusTimestamp(deliveredAt);
      return deliveredTime.isNotEmpty
          ? '  ·  Livre $deliveredTime'
          : '  ·  Livre';
    }
    return '  ·  Envoye';
  }

  void _openImagePreview(String imageUrl, {File? localFile}) {
    showDialog<void>(
      context: context,
      builder: (context) {
        return Dialog(
          backgroundColor: Colors.transparent,
          insetPadding: const EdgeInsets.all(16),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: localFile != null
                ? Image.file(localFile, fit: BoxFit.contain)
                : CachedNetworkImage(
                    imageUrl: imageUrl,
                    fit: BoxFit.contain,
                    errorWidget: (_, _, _) => Container(
                      color: Colors.black,
                      padding: const EdgeInsets.all(24),
                      child: const Icon(
                        CupertinoIcons.photo,
                        color: Colors.white70,
                        size: 42,
                      ),
                    ),
                  ),
          ),
        );
      },
    );
  }

  Future<void> _openVideoPreview({
    required String mediaUrl,
    required String title,
    required String thumbnailUrl,
    File? localFile,
  }) async {
    await Navigator.of(context).push(
      PageRouteBuilder<void>(
        opaque: false,
        pageBuilder: (context, animation, secondaryAnimation) {
          return FadeTransition(
            opacity: CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
            ),
            child: _MessageVideoViewerPage(
              mediaUrl: mediaUrl,
              title: title,
              thumbnailUrl: thumbnailUrl,
              localFile: localFile,
            ),
          );
        },
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          final curved = CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          );
          return FadeTransition(
            opacity: curved,
            child: ScaleTransition(
              scale: Tween<double>(begin: 0.985, end: 1).animate(curved),
              child: child,
            ),
          );
        },
      ),
    );
  }

  String _resolveUrl(String value) {
    if (value.isEmpty) return value;
    return value.startsWith('http') ? value : 'https://trasx.com$value';
  }

  bool _looksLikeVideoUrl(String value) {
    final lower = value.toLowerCase();
    return lower.contains('.mp4') ||
        lower.contains('.mov') ||
        lower.contains('.webm') ||
        lower.contains('.m3u8');
  }

  int _asInt(dynamic value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  String _asString(dynamic value, {String fallback = ''}) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty ? fallback : text;
  }
}

Widget _buildMessageMediaActionButton({
  required VoidCallback? onTap,
  required IconData icon,
  bool isLoading = false,
  double? progress,
  double size = 34,
}) {
  final normalizedProgress = progress?.clamp(0.0, 1.0).toDouble();

  return GestureDetector(
    onTap: onTap,
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.44),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Center(
        child: isLoading
            ? SizedBox(
                width: size - 10,
                height: size - 10,
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  value: normalizedProgress,
                  backgroundColor: Colors.white.withValues(alpha: 0.14),
                  valueColor: const AlwaysStoppedAnimation<Color>(
                    Color(0xFFFE2C55),
                  ),
                ),
              )
            : Icon(icon, color: Colors.white, size: size * 0.46),
      ),
    ),
  );
}

class _MessageImageAttachmentCard extends StatefulWidget {
  final String imageUrl;
  final File? initialFile;
  final bool isMine;
  final ValueChanged<File> onOpenViewer;

  const _MessageImageAttachmentCard({
    super.key,
    required this.imageUrl,
    this.initialFile,
    required this.isMine,
    required this.onOpenViewer,
  });

  @override
  State<_MessageImageAttachmentCard> createState() =>
      _MessageImageAttachmentCardState();
}

class _MessageImageAttachmentCardState
    extends State<_MessageImageAttachmentCard> {
  StreamSubscription<FileResponse>? _loadSubscription;
  File? _file;
  double? _progress;

  bool _isLoading = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _seedInitialFile();
    if (_file == null) {
      unawaited(_restoreCachedImage());
    }
  }

  @override
  void didUpdateWidget(covariant _MessageImageAttachmentCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imageUrl != widget.imageUrl ||
        oldWidget.initialFile?.path != widget.initialFile?.path) {
      _loadSubscription?.cancel();
      _file = null;
      _progress = null;
      _isLoading = false;
      _hasError = false;
      _seedInitialFile();
      if (_file == null) {
        unawaited(_restoreCachedImage());
      }
    }
  }

  @override
  void dispose() {
    _loadSubscription?.cancel();
    super.dispose();
  }

  void _seedInitialFile() {
    final initialFile = widget.initialFile;
    if (initialFile == null || !initialFile.existsSync()) return;
    _file = initialFile;
    _progress = 1;
  }

  Future<void> _restoreCachedImage() async {
    final cachedFile = await DefaultCacheManager().getFileFromCache(
      widget.imageUrl,
    );
    if (!mounted || cachedFile == null) return;
    setState(() {
      _file = cachedFile.file;
      _progress = 1;
    });
  }

  Future<void> _handleActionTap() async {
    if (_file != null) {
      widget.onOpenViewer(_file!);
      return;
    }
    if (_isLoading) return;

    setState(() {
      _isLoading = true;
      _hasError = false;
      _progress = 0;
    });

    await _loadSubscription?.cancel();
    _loadSubscription = DefaultCacheManager()
        .getFileStream(widget.imageUrl, withProgress: true)
        .listen(
          (response) {
            if (!mounted) return;
            if (response is DownloadProgress) {
              setState(() {
                _progress = response.progress ?? _progress;
              });
              return;
            }
            if (response is FileInfo) {
              setState(() {
                _file = response.file;
                _progress = 1;
                _isLoading = false;
              });
            }
          },
          onError: (_) {
            if (!mounted) return;
            setState(() {
              _hasError = true;
              _isLoading = false;
            });
          },
        );
  }

  Widget _buildLoadSurface({required String label, String? subtitle}) {
    return Container(
      width: 220,
      height: 220,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(
          colors: widget.isMine
              ? [
                  Colors.white.withValues(alpha: 0.16),
                  Colors.white.withValues(alpha: 0.08),
                ]
              : [const Color(0xFF111827), const Color(0xFF1F2937)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: widget.isMine
                      ? Colors.white.withValues(alpha: 0.14)
                      : Colors.white.withValues(alpha: 0.06),
                ),
              ),
            ),
          ),
          Positioned(
            top: 12,
            right: 12,
            child: _buildMessageMediaActionButton(
              onTap: _handleActionTap,
              icon: _hasError
                  ? CupertinoIcons.arrow_clockwise
                  : CupertinoIcons.arrow_down,
              isLoading: _isLoading,
              progress: _progress,
            ),
          ),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 50,
                  height: 50,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.26),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    CupertinoIcons.photo_fill,
                    color: Colors.white,
                    size: 22,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_file != null) {
      return GestureDetector(
        onTap: () => widget.onOpenViewer(_file!),
        child: SizedBox(
          width: 220,
          height: 220,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.file(_file!, fit: BoxFit.cover),
          ),
        ),
      );
    }

    final subtitle = _hasError
        ? 'Touchez l icone pour reessayer'
        : (_isLoading
              ? '${((_progress ?? 0) * 100).round()}%'
              : 'Touchez l icone pour charger');

    return _buildLoadSurface(
      label: _hasError
          ? 'Impossible de charger'
          : (_isLoading ? 'Chargement image' : 'Image legere'),
      subtitle: subtitle,
    );
  }
}

class _MessageVideoAttachmentCard extends StatefulWidget {
  final String mediaUrl;
  final String thumbnailUrl;
  final String title;
  final File? initialFile;
  final bool isMine;
  final ValueChanged<File> onOpenViewer;

  const _MessageVideoAttachmentCard({
    super.key,
    required this.mediaUrl,
    required this.thumbnailUrl,
    required this.title,
    this.initialFile,
    required this.isMine,
    required this.onOpenViewer,
  });

  @override
  State<_MessageVideoAttachmentCard> createState() =>
      _MessageVideoAttachmentCardState();
}

class _MessageVideoAttachmentCardState
    extends State<_MessageVideoAttachmentCard> {
  StreamSubscription<FileResponse>? _loadSubscription;
  File? _file;
  double? _progress;

  bool _isLoading = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _seedInitialFile();
    if (_file == null) {
      unawaited(_restoreCachedVideo());
    }
  }

  @override
  void didUpdateWidget(covariant _MessageVideoAttachmentCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mediaUrl != widget.mediaUrl ||
        oldWidget.initialFile?.path != widget.initialFile?.path) {
      _loadSubscription?.cancel();
      _file = null;
      _progress = null;
      _isLoading = false;
      _hasError = false;
      _seedInitialFile();
      if (_file == null) {
        unawaited(_restoreCachedVideo());
      }
    }
  }

  @override
  void dispose() {
    _loadSubscription?.cancel();
    super.dispose();
  }

  void _seedInitialFile() {
    final initialFile = widget.initialFile;
    if (initialFile == null || !initialFile.existsSync()) return;
    _file = initialFile;
    _progress = 1;
  }

  Future<void> _restoreCachedVideo() async {
    final cachedFile = await VideoCacheManager.getCachedFile(widget.mediaUrl);
    if (!mounted || cachedFile == null) return;
    setState(() {
      _file = cachedFile;
      _progress = 1;
    });
  }

  Future<void> _handleActionTap() async {
    if (_file != null) {
      widget.onOpenViewer(_file!);
      return;
    }
    if (_isLoading) return;

    setState(() {
      _isLoading = true;
      _hasError = false;
      _progress = 0;
    });

    await _loadSubscription?.cancel();
    _loadSubscription = VideoCacheManager.instance
        .getFileStream(widget.mediaUrl, withProgress: true)
        .listen(
          (response) {
            if (!mounted) return;
            if (response is DownloadProgress) {
              setState(() {
                _progress = response.progress ?? _progress;
              });
              return;
            }
            if (response is FileInfo) {
              setState(() {
                _file = response.file;
                _progress = 1;
                _isLoading = false;
              });
            }
          },
          onError: (_) {
            if (!mounted) return;
            setState(() {
              _hasError = true;
              _isLoading = false;
            });
          },
        );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _file != null ? () => widget.onOpenViewer(_file!) : null,
      child: SizedBox(
        width: 220,
        height: 156,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: Stack(
            children: [
              Positioned.fill(
                child: widget.thumbnailUrl.isNotEmpty
                    ? CachedNetworkImage(
                        imageUrl: widget.thumbnailUrl,
                        width: 220,
                        height: 156,
                        fit: BoxFit.cover,
                        fadeInDuration: const Duration(milliseconds: 160),
                        placeholder: (_, _) =>
                            _MessageVideoThumbnailPlaceholder(
                              isMine: widget.isMine,
                            ),
                        errorWidget: (_, _, _) =>
                            _MessageVideoThumbnailPlaceholder(
                              isMine: widget.isMine,
                            ),
                      )
                    : _MessageVideoThumbnailPlaceholder(isMine: widget.isMine),
              ),
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.black.withValues(alpha: 0.08),
                        Colors.black.withValues(alpha: 0.16),
                        Colors.black.withValues(alpha: 0.76),
                      ],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      stops: const [0.0, 0.46, 1.0],
                    ),
                  ),
                ),
              ),
              if (_file != null)
                Center(
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.34),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      CupertinoIcons.play_fill,
                      color: Colors.white,
                      size: 28,
                    ),
                  ),
                ),
              if (_file == null || _isLoading || _hasError)
                Positioned(
                  top: 12,
                  right: 12,
                  child: _buildMessageMediaActionButton(
                    onTap: _handleActionTap,
                    icon: _hasError
                        ? CupertinoIcons.arrow_clockwise
                        : CupertinoIcons.arrow_down,
                    isLoading: _isLoading,
                    progress: _progress,
                    size: 36,
                  ),
                ),
              Positioned(
                left: 14,
                right: 14,
                bottom: 14,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _file != null
                          ? 'Touchez pour ouvrir'
                          : (_isLoading
                                ? 'Telechargement ${(((_progress ?? 0) * 100).round())}%'
                                : (_hasError
                                      ? 'Touchez l icone pour reessayer'
                                      : 'Touchez l icone pour charger')),
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageVideoThumbnailPlaceholder extends StatelessWidget {
  final bool isMine;

  const _MessageVideoThumbnailPlaceholder({required this.isMine});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 220,
      height: 156,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isMine
              ? [
                  Colors.white.withValues(alpha: 0.16),
                  Colors.white.withValues(alpha: 0.08),
                ]
              : [const Color(0xFF111827), const Color(0xFF1F2937)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                border: Border.all(
                  color: isMine
                      ? Colors.white.withValues(alpha: 0.14)
                      : Colors.white.withValues(alpha: 0.06),
                ),
              ),
            ),
          ),
          const Center(
            child: Icon(
              CupertinoIcons.video_camera_solid,
              color: Colors.white70,
              size: 28,
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageAudioAttachmentCard extends StatefulWidget {
  final String mediaUrl;
  final String title;
  final int durationSeconds;
  final File? initialLocalFile;
  final bool isMine;
  final Color textPrimary;
  final Color textSecondary;

  const _MessageAudioAttachmentCard({
    super.key,
    required this.mediaUrl,
    required this.title,
    required this.durationSeconds,
    this.initialLocalFile,
    required this.isMine,
    required this.textPrimary,
    required this.textSecondary,
  });

  @override
  State<_MessageAudioAttachmentCard> createState() =>
      _MessageAudioAttachmentCardState();
}

class _MessageAudioAttachmentCardState
    extends State<_MessageAudioAttachmentCard> {
  VideoPlayerController? _controller;
  StreamSubscription<FileResponse>? _downloadSubscription;
  File? _localFile;
  double? _downloadProgress;

  bool _isLoading = false;
  bool _isPreparing = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _seedInitialFile();
    if (_localFile == null) {
      unawaited(_restoreCachedAudio());
    }
  }

  @override
  void didUpdateWidget(covariant _MessageAudioAttachmentCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mediaUrl != widget.mediaUrl ||
        oldWidget.initialLocalFile?.path != widget.initialLocalFile?.path) {
      _downloadSubscription?.cancel();
      _controller?.dispose();
      _controller = null;
      _localFile = null;
      _downloadProgress = null;
      _isLoading = false;
      _isPreparing = false;
      _hasError = false;
      _seedInitialFile();
      if (_localFile == null) {
        unawaited(_restoreCachedAudio());
      }
    }
  }

  @override
  void dispose() {
    _downloadSubscription?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  void _seedInitialFile() {
    final initialFile = widget.initialLocalFile;
    if (initialFile == null || !initialFile.existsSync()) return;
    _localFile = initialFile;
    _downloadProgress = 1;
  }

  Future<void> _restoreCachedAudio() async {
    final cachedFile = await VideoCacheManager.getCachedFile(widget.mediaUrl);
    if (!mounted || cachedFile == null) return;
    setState(() {
      _localFile = cachedFile;
      _downloadProgress = 1;
    });
  }

  Future<File?> _ensureLocalFile() async {
    final existingFile = _localFile;
    if (existingFile != null && await existingFile.exists()) {
      return existingFile;
    }
    if (_isLoading) return null;

    setState(() {
      _isLoading = true;
      _hasError = false;
      _downloadProgress = null;
    });

    final completer = Completer<File>();
    await _downloadSubscription?.cancel();
    _downloadSubscription = VideoCacheManager.instance
        .getFileStream(widget.mediaUrl, withProgress: true)
        .listen(
          (response) {
            if (!mounted) return;
            if (response is DownloadProgress) {
              setState(() {
                _downloadProgress = response.progress ?? _downloadProgress;
              });
              return;
            }
            if (response is FileInfo && !completer.isCompleted) {
              completer.complete(response.file);
            }
          },
          onError: (Object error, StackTrace stackTrace) {
            if (!completer.isCompleted) {
              completer.completeError(error, stackTrace);
            }
          },
        );

    try {
      final file = await completer.future;
      if (!mounted) return null;
      setState(() {
        _localFile = file;
        _downloadProgress = 1;
        _isLoading = false;
      });
      return file;
    } catch (_) {
      if (!mounted) return null;
      setState(() {
        _hasError = true;
        _isLoading = false;
        _downloadProgress = null;
      });
      return null;
    } finally {
      await _downloadSubscription?.cancel();
      _downloadSubscription = null;
    }
  }

  Future<void> _ensureController({required bool autoPlay}) async {
    if (_isPreparing) return;
    final existing = _controller;
    if (existing != null && existing.value.isInitialized) {
      if (autoPlay) {
        await _togglePlayback();
      }
      return;
    }

    final file = await _ensureLocalFile();
    if (file == null) return;

    _isPreparing = true;
    _hasError = false;

    try {
      final controller = VideoPlayerController.file(file);
      _controller = controller;
      await controller.initialize();
      await controller.setLooping(false);

      if (!mounted) {
        controller.dispose();
        return;
      }

      setState(() {});

      if (autoPlay) {
        await controller.play();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
      });
    } finally {
      _isPreparing = false;
    }
  }

  bool _isCompleted(VideoPlayerValue value) {
    return value.duration.inMilliseconds > 0 &&
        value.position >= value.duration - const Duration(milliseconds: 250);
  }

  Future<void> _togglePlayback() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      await _ensureController(autoPlay: true);
      return;
    }

    if (controller.value.isPlaying) {
      await controller.pause();
      return;
    }

    if (_isCompleted(controller.value)) {
      await controller.seekTo(Duration.zero);
    }
    await controller.play();
  }

  String _formatDuration(Duration duration) {
    final totalSeconds = duration.inSeconds;
    final minutes = (totalSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (totalSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller != null) {
      return ValueListenableBuilder<VideoPlayerValue>(
        valueListenable: controller,
        builder: (context, value, _) => _buildAudioCard(value: value),
      );
    }
    return _buildAudioCard();
  }

  Widget _buildAudioCard({VideoPlayerValue? value}) {
    final safeValue = value;
    final isPlaying = safeValue?.isPlaying == true;
    final duration =
        safeValue?.duration.inMilliseconds != null &&
            (safeValue?.duration.inMilliseconds ?? 0) > 0
        ? safeValue!.duration
        : Duration(seconds: widget.durationSeconds);
    final position = safeValue == null
        ? Duration.zero
        : (safeValue.position > duration ? duration : safeValue.position);
    final progress = duration.inMilliseconds <= 0
        ? 0.0
        : (position.inMilliseconds / duration.inMilliseconds).clamp(0.0, 1.0);
    final isBusy = _isLoading || (_isPreparing && _controller == null);
    final isReady =
        _localFile != null || (_controller?.value.isInitialized ?? false);

    return Container(
      constraints: const BoxConstraints(minWidth: 156, maxWidth: 194),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: widget.isMine
            ? Colors.white.withValues(alpha: 0.14)
            : Colors.black.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildMessageMediaActionButton(
            onTap: _togglePlayback,
            icon: !isReady
                ? (_hasError
                      ? CupertinoIcons.arrow_clockwise
                      : CupertinoIcons.arrow_down)
                : (isPlaying
                      ? CupertinoIcons.pause_fill
                      : CupertinoIcons.play_fill),
            isLoading: isBusy,
            progress: _downloadProgress,
            size: 30,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: widget.isMine ? Colors.white : widget.textPrimary,
                    fontSize: 11.2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    minHeight: 2.5,
                    value: progress,
                    backgroundColor: widget.isMine
                        ? Colors.white.withValues(alpha: 0.14)
                        : Colors.black.withValues(alpha: 0.08),
                    valueColor: AlwaysStoppedAnimation<Color>(
                      widget.isMine ? Colors.white : const Color(0xFF6F63FF),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _hasError
                      ? 'Impossible de lire la note vocale'
                      : isBusy
                      ? 'Chargement ${(((_downloadProgress ?? 0) * 100).round())}%'
                      : '${_formatDuration(position)} / ${_formatDuration(duration)}',
                  style: TextStyle(
                    color: widget.isMine
                        ? Colors.white70
                        : widget.textSecondary,
                    fontSize: 10,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageVideoViewerPage extends StatefulWidget {
  final String mediaUrl;
  final String title;
  final String thumbnailUrl;
  final File? localFile;

  const _MessageVideoViewerPage({
    required this.mediaUrl,
    required this.title,
    required this.thumbnailUrl,
    this.localFile,
  });

  @override
  State<_MessageVideoViewerPage> createState() =>
      _MessageVideoViewerPageState();
}

class _MessageVideoViewerPageState extends State<_MessageVideoViewerPage> {
  VideoPlayerController? _controller;
  StreamSubscription<FileResponse>? _downloadSubscription;

  bool _isPreparing = false;
  bool _hasError = false;
  double? _downloadProgress;

  @override
  void initState() {
    super.initState();
    _initializeController();
  }

  @override
  void dispose() {
    _downloadSubscription?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _initializeController() async {
    if (_isPreparing) return;
    final previousController = _controller;
    if (previousController != null) {
      _controller = null;
      await previousController.dispose();
    }

    setState(() {
      _isPreparing = true;
      _hasError = false;
      _downloadProgress = null;
    });

    try {
      File file;
      if (widget.localFile != null && await widget.localFile!.exists()) {
        file = widget.localFile!;
      } else {
        final cachedFile = await VideoCacheManager.getCachedFile(
          widget.mediaUrl,
        );
        if (cachedFile != null) {
          file = cachedFile;
        } else {
          final completer = Completer<File>();
          await _downloadSubscription?.cancel();
          _downloadSubscription = VideoCacheManager.instance
              .getFileStream(widget.mediaUrl, withProgress: true)
              .listen(
                (response) {
                  if (!mounted) return;
                  if (response is DownloadProgress) {
                    setState(() {
                      _downloadProgress =
                          response.progress ?? _downloadProgress;
                    });
                    return;
                  }
                  if (response is FileInfo && !completer.isCompleted) {
                    completer.complete(response.file);
                  }
                },
                onError: (Object error, StackTrace stackTrace) {
                  if (!completer.isCompleted) {
                    completer.completeError(error, stackTrace);
                  }
                },
              );
          file = await completer.future;
          await _downloadSubscription?.cancel();
          _downloadSubscription = null;
        }
      }
      if (!mounted) return;

      final controller = VideoPlayerController.file(file);
      _controller = controller;
      await controller.initialize();
      await controller.setLooping(false);
      await controller.setVolume(1);
      await controller.play();

      if (!mounted) {
        controller.dispose();
        return;
      }

      setState(() {
        _hasError = false;
        _downloadProgress = 1;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
        _downloadProgress = null;
      });
    } finally {
      if (mounted) {
        setState(() {
          _isPreparing = false;
        });
      } else {
        _isPreparing = false;
      }
    }
  }

  Future<void> _togglePlayback() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;

    if (controller.value.isPlaying) {
      await controller.pause();
      return;
    }

    if (_isCompleted(controller.value)) {
      await controller.seekTo(Duration.zero);
    }
    await controller.play();
  }

  bool _isCompleted(VideoPlayerValue value) {
    return value.duration.inMilliseconds > 0 &&
        value.position >= value.duration - const Duration(milliseconds: 250);
  }

  String _formatDuration(Duration duration) {
    final totalSeconds = duration.inSeconds;
    final minutes = (totalSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (totalSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  Widget _buildLoadingOverlay() {
    final progress = _downloadProgress?.clamp(0.0, 1.0).toDouble();
    final hasProgress = progress != null;
    final isFinishing = hasProgress && progress >= 0.999;

    return Positioned(
      left: 18,
      right: 18,
      bottom: 28,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.52),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              isFinishing ? 'Ouverture de la video' : 'Chargement de la video',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                minHeight: 4,
                value: progress,
                backgroundColor: Colors.white.withValues(alpha: 0.14),
                valueColor: const AlwaysStoppedAnimation<Color>(
                  Color(0xFFFE2C55),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              hasProgress ? '${(progress * 100).round()}%' : 'Preparation...',
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final hasVideo = controller != null && controller.value.isInitialized;

    return Scaffold(
      backgroundColor: Colors.black.withValues(alpha: 0.96),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: Container(
                color: Colors.black,
                alignment: Alignment.center,
                child: hasVideo
                    ? GestureDetector(
                        onTap: _togglePlayback,
                        child: AspectRatio(
                          aspectRatio: controller.value.aspectRatio == 0
                              ? 9 / 16
                              : controller.value.aspectRatio,
                          child: VideoPlayer(controller),
                        ),
                      )
                    : (widget.thumbnailUrl.isNotEmpty
                          ? CachedNetworkImage(
                              imageUrl: widget.thumbnailUrl,
                              fit: BoxFit.contain,
                              placeholder: (_, _) => _buildMessageMediaLoader(
                                width: double.infinity,
                                height: double.infinity,
                                isMine: false,
                                borderRadius: BorderRadius.zero,
                              ),
                              errorWidget: (_, _, _) =>
                                  _buildMessageMediaLoader(
                                    width: double.infinity,
                                    height: double.infinity,
                                    isMine: false,
                                    borderRadius: BorderRadius.zero,
                                  ),
                            )
                          : _buildMessageMediaLoader(
                              width: double.infinity,
                              height: double.infinity,
                              isMine: false,
                              borderRadius: BorderRadius.zero,
                            )),
              ),
            ),
            if (!hasVideo && !_hasError && _isPreparing) _buildLoadingOverlay(),
            Positioned(
              top: 8,
              left: 8,
              right: 8,
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(CupertinoIcons.back, color: Colors.white),
                  ),
                  Expanded(
                    child: Text(
                      widget.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (_hasError)
              const Center(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 24),
                  child: Text(
                    'Impossible de charger cette video.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              )
            else if (hasVideo)
              Positioned(
                left: 18,
                right: 18,
                bottom: 24,
                child: ValueListenableBuilder<VideoPlayerValue>(
                  valueListenable: controller,
                  builder: (context, value, _) {
                    final duration = value.duration;
                    final position = value.position > duration
                        ? duration
                        : value.position;

                    return Container(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.48),
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.08),
                        ),
                      ),
                      child: Row(
                        children: [
                          IconButton(
                            onPressed: _togglePlayback,
                            icon: Icon(
                              value.isPlaying
                                  ? CupertinoIcons.pause_fill
                                  : CupertinoIcons.play_fill,
                              color: Colors.white,
                            ),
                          ),
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(999),
                              child: VideoProgressIndicator(
                                controller,
                                allowScrubbing: true,
                                padding: EdgeInsets.zero,
                                colors: const VideoProgressColors(
                                  playedColor: Color(0xFFFE2C55),
                                  bufferedColor: Color(0x66FFFFFF),
                                  backgroundColor: Color(0x33FFFFFF),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text(
                            '${_formatDuration(position)} / ${_formatDuration(duration)}',
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
