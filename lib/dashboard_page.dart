import 'dart:io';
import 'dart:ui';
import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/gestures.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:video_player/video_player.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:image_picker/image_picker.dart';
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';
import 'package:http_parser/http_parser.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:app_links/app_links.dart';
import 'models/post_model.dart';
import 'services/feed_cache_service.dart';
import 'widgets/feed_skeleton.dart';
import 'onboarding_page.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  static bool pauseAllVideos = false;
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  
  // Theme state
  bool _isDarkMode = true;

  // Session State
  int _userId = 0;
  String _username = 'Utilisateur';
  String _displayName = '';
  String _userEmail = 'user@trasx.com';
  String _avatarUrl = '';

  // API Data State — typed Post model
  List<Post> _feedPosts = [];
  List<dynamic> _userPosts = [];
  List<dynamic> _userReels = [];
  bool _isLoadingFeed = false;
  bool _isLoadingProfile = false;
  bool _profileCached = false;

  // Status (Stories) State
  List<dynamic> _statusGroups = [];
  Timer? _statusPollingTimer;

  // Pagination & Infinite Scroll
  final ScrollController _feedScrollController = ScrollController();
  bool _isLoadingMoreFeed = false;
  bool _hasMoreFeed = true;
  bool _isPaginating = false;         // verrou anti-double appel
  String? _nextCursor;                // curseur backend
  Set<int> _seenPostIds = {};         // IDs déjà envoyés au backend
  bool _isRefreshing = false;

  // Feed error state
  bool _hasFeedError = false;
  String? _feedErrorMessage;
  Object? _paginationError;

  // Nouvelles publications non insérées (afficher bouton discret)
  List<Post> _pendingNewPosts = [];

  // Connectivity
  bool _isOffline = false;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  // Real-time Socket.IO
  IO.Socket? _socket;

  // Stats State
  int _followersCount = 0;
  int _followingCount = 0;
  int _likesCount = 0;

  // Hashtag & Profile view states
  Map<String, bool> _hashtagPaidStatus = {};
  int? _profileViewUserId;
  String _profileAvatarUrl = '';
  String _profileUsername = '';
  String _profileDisplayName = '';
  int _profileFollowersCount = 0;
  int _profileFollowingCount = 0;
  int _profileLikesCount = 0;
  List<dynamic> _profilePosts = [];
  List<dynamic> _profileReels = [];
  List<Post> _bookmarkedPosts = [];
  bool _isLoadingBookmarks = false;
  late AppLinks _appLinks;
  StreamSubscription<Uri>? _linkSubscription;

  // Navigation State
  int _activeViewIndex = 0; 

  static const List<Color> instagramGradient = [
    Color(0xFF833AB4), // Purple
    Color(0xFFC13584), // Magenta
    Color(0xFFE1306C), // Pink
    Color(0xFFFD1D1D), // Red
    Color(0xFFF77737), // Orange-Red
    Color(0xFFFCAF45), // Orange-Yellow
  ];

  // Preset avatar choices (DiceBear avatars)
  static const List<String> presetAvatars = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Mimi',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Jack',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Zoey',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Sophie',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Oscar',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Mia',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam',
  ];

  @override
  void initState() {
    super.initState();
    _loadUserData();
    _feedScrollController.addListener(_onFeedScroll);
    _initDeepLinks();
    // Poll statuses every 30 seconds
    _statusPollingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_userId > 0) _fetchStatuses();
    });
    // Listen to connectivity changes
    _connectivitySub = Connectivity().onConnectivityChanged.listen(
      (results) {
        final wasOffline = _isOffline;
        final nowOffline = results.every(
          (r) => r == ConnectivityResult.none,
        );
        if (mounted) {
          setState(() => _isOffline = nowOffline);
        }
        // Auto-retry when back online
        if (wasOffline && !nowOffline && _userId > 0) {
          _fetchHomeFeed();
        }
      },
    );
    // Initial connectivity check
    Connectivity().checkConnectivity().then((results) {
      if (mounted) {
        setState(() {
          _isOffline = results.every((r) => r == ConnectivityResult.none);
        });
      }
    });
  }

  @override
  void dispose() {
    _linkSubscription?.cancel();
    _statusPollingTimer?.cancel();
    _feedScrollController.dispose();
    _connectivitySub?.cancel();
    _socket?.disconnect();
    _socket?.dispose();
    super.dispose();
  }

  void _onFeedScroll() {
    if (_feedScrollController.position.pixels >= _feedScrollController.position.maxScrollExtent - 300) {
      _fetchMoreHomeFeed();
    }
  }

  Future<void> _loadUserData() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _username = prefs.getString('user_name') ?? 'Utilisateur';
      _userId = prefs.getInt('user_id') ?? 0;
      _userEmail = '${_username.toLowerCase().replaceAll(' ', '')}@trasx.com';
    });

    if (_userId > 0) {
      _fetchUserProfileAndPosts();
      _fetchHomeFeed();
      _fetchStatuses();
      _fetchHashtagsInfo();
      _initSocket();
    }
  }

  // ── Statuses (Stories) ──────────────────────────────────────────────────────
  Future<void> _fetchStatuses() async {
    if (_userId <= 0) return;
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/feed/statuses'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$_userId',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['groups'] != null) {
          if (mounted) {
            setState(() {
              _statusGroups = data['groups'] as List<dynamic>;
            });
          }
        }
      }
    } catch (e) {
      debugPrint('Error fetching statuses: $e');
    }
  }

  Future<void> _postMediaStatus({
    required String statusType, // 'text', 'image', 'video', 'voice'
    String? text,
    String? bgColor,
    String? mediaPath,
  }) async {
    if (_userId <= 0) return;
    try {
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('https://trasx.com/api/feed/statuses/create'),
      )
        ..headers['x-user-id'] = '$_userId'
        ..fields['status_type'] = statusType;

      if (text != null && text.trim().isNotEmpty) {
        request.fields['caption'] = text.trim();
      }
      if (bgColor != null && bgColor.isNotEmpty) {
        request.fields['bg_color'] = bgColor;
      }

      if (mediaPath != null && mediaPath.isNotEmpty) {
        String cleanPath = mediaPath;
        if (cleanPath.startsWith('file://')) {
          cleanPath = cleanPath.replaceFirst('file://', '');
        }
        String mimeType = 'image/jpeg';
        final ext = cleanPath.split('.').last.toLowerCase();

        if (statusType == 'video') {
          mimeType = 'video/mp4';
        } else if (statusType == 'voice') {
          mimeType = 'audio/m4a';
        } else if (ext == 'png') {
          mimeType = 'image/png';
        } else if (ext == 'gif') {
          mimeType = 'image/gif';
        } else if (ext == 'webp') {
          mimeType = 'image/webp';
        } else if (ext == 'mp4' || ext == 'mov') {
          mimeType = 'video/mp4';
        } else if (ext == 'mp3' || ext == 'aac' || ext == 'm4a') {
          mimeType = 'audio/mpeg';
        }

        final parts = mimeType.split('/');
        request.files.add(
          await http.MultipartFile.fromPath(
            'status_media',
            cleanPath,
            contentType: MediaType(parts[0], parts[1]),
          ),
        );
      }

      final streamed = await request.send();
      final resp = await http.Response.fromStream(streamed);
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        if (data['success'] == true) {
          await _fetchStatuses();
        }
      } else {
        debugPrint('Failed to post status: ${resp.body}');
      }
    } catch (e) {
      debugPrint('Error posting status: $e');
    }
  }

  // ── Feed fetch: cache-first + network refresh ────────────────────────────────
  Future<void> _fetchHomeFeed({bool isRefresh = false}) async {
    if (_userId <= 0) return;
    if (_isRefreshing) return; // prevent duplicate refresh

    // 1. Show cached posts immediately if available
    if (!isRefresh && _feedPosts.isEmpty) {
      final cached = await FeedCacheService.readPosts();
      if (cached != null && cached.isNotEmpty && mounted) {
        setState(() {
          _feedPosts = cached;
          _isLoadingFeed = false;
        });
      } else if (mounted) {
        setState(() => _isLoadingFeed = true);
      }
    } else if (mounted) {
      setState(() => _isRefreshing = isRefresh);
    }

    // 2. Build seen IDs string for backend deduplication
    _seenPostIds = _feedPosts.map((p) => p.id).toSet();
    final seenParam = _seenPostIds.take(50).join(',');

    try {
      final uri = Uri.parse(
        'https://trasx.com/api/feed/posts?limit=20'
        '${seenParam.isNotEmpty ? '&seen=$seenParam' : ''}',
      );
      final response = await http
          .get(uri, headers: {
            'Content-Type': 'application/json',
            'x-user-id': '$_userId',
          })
          .timeout(const Duration(seconds: 12));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        if (data['success'] == true) {
          final incoming = (data['posts'] as List<dynamic>? ?? [])
              .map((e) => Post.fromJson(e as Map<String, dynamic>))
              .toList();
          final cursorVal = data['nextCursor'] as String?;
          final hasMore = data['hasMore'] ?? true;

          if (mounted) {
            setState(() {
              if (isRefresh) {
                // Merge: new posts in front, keep older ones
                _feedPosts = Post.merge(_feedPosts, incoming);
              } else {
                _feedPosts = incoming.isNotEmpty ? incoming : _feedPosts;
              }
              _nextCursor = cursorVal;
              _hasMoreFeed = hasMore == true || hasMore == 1;
              _hasFeedError = false;
              _feedErrorMessage = null;
              _isLoadingFeed = false;
              _isRefreshing = false;
            });
          }

          // 3. Update cache in background
          FeedCacheService.writePosts(_feedPosts, nextCursor: _nextCursor);
        }
      } else if (response.statusCode >= 500) {
        if (mounted && _feedPosts.isEmpty) {
          setState(() {
            _hasFeedError = true;
            _feedErrorMessage = 'Erreur serveur (${response.statusCode}). Réessayez.';
            _isLoadingFeed = false;
            _isRefreshing = false;
          });
        }
      }
    } on TimeoutException {
      if (mounted && _feedPosts.isEmpty) {
        setState(() {
          _hasFeedError = true;
          _feedErrorMessage = 'Délai dépassé. Vérifiez votre connexion.';
          _isLoadingFeed = false;
          _isRefreshing = false;
        });
      } else if (mounted) {
        setState(() { _isLoadingFeed = false; _isRefreshing = false; });
      }
    } catch (e) {
      debugPrint('Error fetching home feed: $e');
      if (mounted) {
        setState(() {
          if (_feedPosts.isEmpty) {
            _hasFeedError = true;
            _feedErrorMessage = 'Impossible de charger le fil. Vérifiez votre connexion.';
          }
          _isLoadingFeed = false;
          _isRefreshing = false;
        });
      }
    }
  }

  // ── Pagination (scroll infini, cursor-based) ──────────────────────────────────
  Future<void> _fetchMoreHomeFeed() async {
    if (_userId <= 0 || _isLoadingMoreFeed || _isPaginating || !_hasMoreFeed) return;

    setState(() {
      _isLoadingMoreFeed = true;
      _isPaginating = true;
      _paginationError = null;
    });

    try {
      // Build seen IDs (all posts already displayed)
      final allSeenIds = _feedPosts.map((p) => p.id).toSet();
      final seenParam = allSeenIds.take(100).join(',');

      final cursorParam = _nextCursor != null ? '&cursor=${Uri.encodeComponent(_nextCursor!)}' : '';
      final uri = Uri.parse(
        'https://trasx.com/api/feed/posts?limit=20$cursorParam'
        '${seenParam.isNotEmpty ? '&seen=$seenParam' : ''}',
      );
      final response = await http
          .get(uri, headers: {
            'Content-Type': 'application/json',
            'x-user-id': '$_userId',
          })
          .timeout(const Duration(seconds: 12));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        if (data['success'] == true) {
          final newPosts = (data['posts'] as List<dynamic>? ?? [])
              .map((e) => Post.fromJson(e as Map<String, dynamic>))
              .toList();
          final cursorVal = data['nextCursor'] as String?;
          final hasMore = data['hasMore'];

          if (mounted) {
            setState(() {
              if (newPosts.isEmpty ||
                  hasMore == false ||
                  hasMore == 0 ||
                  hasMore == 'false') {
                _hasMoreFeed = false;
              } else {
                _feedPosts = Post.appendPage(_feedPosts, newPosts);
                _nextCursor = cursorVal;
              }
            });
          }
        }
      }
    } on TimeoutException {
      if (mounted) {
        setState(() => _paginationError = 'Délai dépassé');
      }
    } catch (e) {
      debugPrint('Error fetching more feed: $e');
      if (mounted) {
        setState(() => _paginationError = e);
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingMoreFeed = false;
          _isPaginating = false;
        });
      }
    }
  }

  // Met à jour un post unique dans la liste locale (like/bookmark optimiste)
  void _updateLocalPost(Post updated) {
    if (!mounted) return;
    setState(() {
      final idx = _feedPosts.indexWhere((p) => p.id == updated.id);
      if (idx != -1) _feedPosts[idx] = updated;

      // Update bookmarks list in real-time
      final bIdx = _bookmarkedPosts.indexWhere((p) => p.id == updated.id);
      if (updated.isBookmarked) {
        if (bIdx == -1) {
          _bookmarkedPosts.insert(0, updated);
        } else {
          _bookmarkedPosts[bIdx] = updated;
        }
      } else {
        if (bIdx != -1) {
          _bookmarkedPosts.removeAt(bIdx);
        }
      }

      // Update profile posts list in real-time
      final pIdx = _profilePosts.indexWhere((p) => p['id'] == updated.id);
      if (pIdx != -1) {
        final map = Map<String, dynamic>.from(_profilePosts[pIdx]);
        map['is_liked'] = updated.isLiked ? 1 : 0;
        map['likes_count'] = updated.likesCount;
        map['is_bookmarked'] = updated.isBookmarked ? 1 : 0;
        _profilePosts[pIdx] = map;
      }
    });
    FeedCacheService.updatePost(updated);
  }

  void _updatePostLikeState(int postId, bool isLiked, int count) {
    if (!mounted) return;
    setState(() {
      final idx = _feedPosts.indexWhere((p) => p.id == postId);
      if (idx != -1) {
        final current = _feedPosts[idx];
        final updated = Post(
          id: current.id,
          authorId: current.authorId,
          authorUsername: current.authorUsername,
          authorDisplayName: current.authorDisplayName,
          authorAvatar: current.authorAvatar,
          content: current.content,
          imageUrl: current.imageUrl,
          thumbnailUrl: current.thumbnailUrl,
          isTrade: current.isTrade,
          likesCount: count,
          commentsCount: current.commentsCount,
          sharesCount: current.sharesCount,
          isLiked: isLiked,
          isBookmarked: current.isBookmarked,
          isAuthorFollowing: current.isAuthorFollowing,
          createdAt: current.createdAt,
        );
        _feedPosts[idx] = updated;
        FeedCacheService.updatePost(updated);
      }
    });
  }

  void _updatePostLikesCount(int postId, int count) {
    if (!mounted) return;
    setState(() {
      final idx = _feedPosts.indexWhere((p) => p.id == postId);
      if (idx != -1) {
        final current = _feedPosts[idx];
        final updated = Post(
          id: current.id,
          authorId: current.authorId,
          authorUsername: current.authorUsername,
          authorDisplayName: current.authorDisplayName,
          authorAvatar: current.authorAvatar,
          content: current.content,
          imageUrl: current.imageUrl,
          thumbnailUrl: current.thumbnailUrl,
          isTrade: current.isTrade,
          likesCount: count,
          commentsCount: current.commentsCount,
          sharesCount: current.sharesCount,
          isLiked: current.isLiked,
          isBookmarked: current.isBookmarked,
          isAuthorFollowing: current.isAuthorFollowing,
          createdAt: current.createdAt,
        );
        _feedPosts[idx] = updated;
        FeedCacheService.updatePost(updated);
      }
    });
  }

  // ── Real-time Socket.IO Connection ──────────────────────────────────────────
  void _initSocket() {
    if (_userId <= 0) return;
    _socket?.disconnect();
    _socket?.dispose();

    try {
      _socket = IO.io('https://trasx.com', IO.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'userId': _userId})
        .setQuery({'userId': _userId})
        .enableAutoConnect()
        .build());

      _socket!.connect();

      _socket!.onConnect((_) {
        debugPrint('Socket.IO: Connected successfully to server');
        _socket!.emit('join', 'user:$_userId');
      });

      _socket!.on('status-created', (data) {
        debugPrint('Socket.IO: Received status-created: $data');
        _handleRealtimeStatusCreated(data);
      });

      _socket!.on('post-liked', (data) {
        debugPrint('Socket.IO: Received post-liked: $data');
        if (data != null && data['postId'] != null && data['likes_count'] != null) {
          final int? pId = int.tryParse('${data['postId']}');
          final int? count = int.tryParse('${data['likes_count']}');
          if (pId != null && count != null) {
            _updatePostLikesCount(pId, count);
          }
        }
      });

      _socket!.on('like-response', (data) {
        debugPrint('Socket.IO: Received like-response: $data');
        if (data != null && data['postId'] != null && data['liked'] != null && data['count'] != null) {
          final int? pId = int.tryParse('${data['postId']}');
          final bool liked = data['liked'] == true;
          final int? count = int.tryParse('${data['count']}');
          if (pId != null && count != null) {
            _updatePostLikeState(pId, liked, count);
          }
        }
      });

      _socket!.onDisconnect((_) {
        debugPrint('Socket.IO: Disconnected from server');
      });

      _socket!.onConnectError((err) {
        debugPrint('Socket.IO Connection Error: $err');
      });
    } catch (e) {
      debugPrint('Error initializing Socket.IO: $e');
    }
  }

  void _handleRealtimeStatusCreated(dynamic data) {
    if (data == null || !mounted) return;
    try {
      final userId = data['user_id'] as int?;
      final newStatus = data['status'];
      if (userId == null || newStatus == null) return;

      setState(() {
        final idx = _statusGroups.indexWhere((g) => (g['user_id'] as num?)?.toInt() == userId);
        final bool isStatusBoosted = newStatus['is_boosted'] == 1 || newStatus['is_boosted'] == true || newStatus['is_boosted'] == '1';

        if (idx != -1) {
          final group = Map<String, dynamic>.from(_statusGroups[idx]);
          final List<dynamic> statuses = List.from(group['statuses'] ?? []);

          // Deduplicate by ID
          statuses.removeWhere((s) => s['id'] == newStatus['id']);
          statuses.add(newStatus);

          group['statuses'] = statuses;
          if (isStatusBoosted) {
            group['is_boosted'] = true;
          }
          _statusGroups[idx] = group;
        } else {
          final newGroup = {
            'user_id': userId,
            'user_name': data['user_name'] ?? data['username'] ?? 'Utilisateur',
            'username': data['username'] ?? 'user',
            'avatar': data['avatar'],
            'is_boosted': isStatusBoosted,
            'statuses': [newStatus],
          };
          _statusGroups.add(newGroup);
        }

        // Sort status groups : own first, then boosted, then others by newest status
        _statusGroups.sort((a, b) {
          final aId = (a['user_id'] as num?)?.toInt() ?? 0;
          final bId = (b['user_id'] as num?)?.toInt() ?? 0;
          final aIsOwn = aId == _userId;
          final bIsOwn = bId == _userId;
          if (aIsOwn) return -1;
          if (bIsOwn) return 1;

          final bool aBoosted = a['is_boosted'] == true;
          final bool bBoosted = b['is_boosted'] == true;
          if (aBoosted && !bBoosted) return -1;
          if (!aBoosted && bBoosted) return 1;

          final aStatuses = a['statuses'] as List<dynamic>? ?? [];
          final bStatuses = b['statuses'] as List<dynamic>? ?? [];
          final aLatest = aStatuses.isEmpty ? 0 : DateTime.tryParse(aStatuses.last['created_at'] ?? '')?.millisecondsSinceEpoch ?? 0;
          final bLatest = bStatuses.isEmpty ? 0 : DateTime.tryParse(bStatuses.last['created_at'] ?? '')?.millisecondsSinceEpoch ?? 0;
          return bLatest - aLatest;
        });
      });
    } catch (e) {
      debugPrint('Error parsing real-time status-created: $e');
    }
  }

  Future<void> _fetchHashtagsInfo() async {
    if (_userId <= 0) return;
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/hashtags'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$_userId',
        },
      );
      if (response.statusCode == 200) {
        final List<dynamic> tags = jsonDecode(response.body);
        final Map<String, bool> temp = {};
        for (var t in tags) {
          if (t['name'] != null) {
            final name = (t['name'] as String).toLowerCase();
            final isPaid = t['is_paid'] == 1 || t['is_paid'] == true || t['is_paid'] == 'true';
            temp[name] = isPaid;
          }
        }
        if (mounted) {
          setState(() {
            _hashtagPaidStatus = temp;
          });
        }
      }
    } catch (e) {
      debugPrint('Error fetching hashtags info: $e');
    }
  }

  Future<void> _fetchBookmarkedPosts() async {
    if (_userId <= 0) return;
    setState(() {
      _isLoadingBookmarks = true;
    });

    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/posts/bookmarks'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$_userId',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['posts'] != null) {
          final List<dynamic> postsJson = data['posts'];
          final List<Post> parsed = postsJson.map((e) => Post.fromJson(e as Map<String, dynamic>)).toList();
          setState(() {
            _bookmarkedPosts = parsed;
          });
        }
      }
    } catch (e) {
      debugPrint('Error fetching bookmarked posts: $e');
    }

    setState(() {
      _isLoadingBookmarks = false;
    });
  }

  void _initDeepLinks() {
    _appLinks = AppLinks();

    // Listen to incoming links (when app is in background or foreground)
    _linkSubscription = _appLinks.uriLinkStream.listen((uri) {
      _handleDeepLink(uri);
    }, onError: (err) {
      debugPrint('Deep Link error: $err');
    });

    // Check initial link (when app is cold started)
    _appLinks.getInitialLink().then((uri) {
      if (uri != null) {
        _handleDeepLink(uri);
      }
    }).catchError((err) {
      debugPrint('Initial Deep Link error: $err');
    });
  }

  void _handleDeepLink(Uri uri) {
    debugPrint('Received Deep Link: $uri');
    final path = uri.path;

    int? postId;
    if (path.startsWith('/post/')) {
      final segments = uri.pathSegments;
      if (segments.length >= 2) {
        postId = int.tryParse(segments[1]);
      }
    } else if (uri.host == 'post') {
      final segments = uri.pathSegments;
      if (segments.isNotEmpty) {
        postId = int.tryParse(segments[0]);
      } else {
        postId = int.tryParse(uri.queryParameters['id'] ?? '');
      }
    }

    if (postId != null && postId > 0) {
      _openPostDetailPage(postId);
    }
  }

  void _openPostDetailPage(int postId) {
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => PostDetailPage(
          postId: postId,
          currentUserId: _userId,
          currentUsername: _username,
          currentDisplayName: _displayName,
          currentUserAvatar: _avatarUrl,
          socket: _socket,
          isDarkMode: _isDarkMode,
          onUserProfileTap: _navigateToUserProfile,
        ),
      ),
    );
  }

  bool _isHashtagPaid(String tag) {
    final cleanTag = tag.replaceAll('#', '').trim().toLowerCase();
    if (_hashtagPaidStatus.containsKey(cleanTag)) {
      return _hashtagPaidStatus[cleanTag]!;
    }
    // Fallback heuristic: contains 'trade' or 'p2p'
    return cleanTag.contains('trade') || cleanTag.contains('p2p');
  }

  void _navigateToUserProfile(int targetUserId) {
    if (targetUserId <= 0) return;
    setState(() {
      _profileViewUserId = targetUserId;
      _activeViewIndex = 3; // Switch to profile page
    });
    _fetchUserProfileAndPosts(targetUserId: targetUserId);
  }

  Future<void> _fetchUserProfileAndPosts({int? targetUserId}) async {
    final int fetchId = targetUserId ?? _userId;
    if (fetchId <= 0) return;

    final bool isOwn = fetchId == _userId;

    if (isOwn && !_profileCached) {
      setState(() {
        _isLoadingProfile = true;
      });
    } else if (!isOwn) {
      setState(() {
        _isLoadingProfile = true;
      });
    }

    try {
      final headers = {
        'Content-Type': 'application/json',
        'x-user-id': '$_userId',
      };

      // 1. Fetch user details (Avatar/Profile photo/Display Name/Stats)
      final userResponse = await http.get(
        Uri.parse('https://trasx.com/api/users/$fetchId'),
        headers: headers,
      );
      if (userResponse.statusCode == 200) {
        final userData = jsonDecode(userResponse.body);
        if (mounted) {
          setState(() {
            _profileAvatarUrl = userData['avatar'] ?? '';
            _profileUsername = userData['username'] ?? '';
            _profileDisplayName = userData['display_name'] ?? '';
            _profileFollowersCount = userData['followersCount'] ?? 0;
            _profileFollowingCount = userData['followingCount'] ?? 0;
            _profileLikesCount = userData['likesCount'] ?? 0;

            if (isOwn) {
              _avatarUrl = _profileAvatarUrl;
              _userEmail = userData['email'] ?? _userEmail;
              _username = _profileUsername;
              _displayName = _profileDisplayName;
              _followersCount = _profileFollowersCount;
              _followingCount = _profileFollowingCount;
              _likesCount = _profileLikesCount;
              _profileCached = true;
            }
          });
        }
      }

      // 2. Fetch User Feed Posts
      final postsResponse = await http.get(
        Uri.parse('https://trasx.com/api/users/$fetchId/posts'),
        headers: headers,
      );
      if (postsResponse.statusCode == 200) {
        final postsData = jsonDecode(postsResponse.body);
        if (postsData['success'] == true && mounted) {
          setState(() {
            _profilePosts = postsData['posts'] ?? [];
            if (isOwn) {
              _userPosts = _profilePosts;
            }
          });
        }
      }

      // 3. Fetch User Shorts/Reels
      final reelsResponse = await http.get(
        Uri.parse('https://trasx.com/api/users/$fetchId/reels'),
        headers: headers,
      );
      if (reelsResponse.statusCode == 200) {
        final reelsData = jsonDecode(reelsResponse.body);
        if (reelsData['success'] == true && mounted) {
          setState(() {
            _profileReels = reelsData['reels'] ?? [];
            if (isOwn) {
              _userReels = _profileReels;
            }
          });
        }
      }
    } catch (e) {
      debugPrint('Error fetching user profile and posts: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingProfile = false;
        });
      }
    }
  }

  Future<void> _updateDisplayName(String newName) async {
    if (_userId <= 0) return;
    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/api/user/update-display-name'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$_userId',
        },
        body: jsonEncode({'display_name': newName}),
      );
      
      final data = jsonDecode(response.body);
      if (!mounted) return;
      if (response.statusCode == 200 && data['success'] == true) {
        setState(() {
          _displayName = data['displayName'] ?? newName;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Nom mis à jour avec succès.')),
        );
        _fetchUserProfileAndPosts();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['error'] ?? 'Impossible de modifier le nom.')),
        );
      }
    } catch (e) {
      debugPrint('Error updating display name: $e');
    }
  }

  Future<void> _updateAvatar(String selectedUrl) async {
    if (_userId <= 0) return;
    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/api/user/update-avatar'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$_userId',
        },
        body: jsonEncode({'avatarUrl': selectedUrl}),
      );

      final data = jsonDecode(response.body);
      if (!mounted) return;
      if (response.statusCode == 200 && data['success'] == true) {
        setState(() {
          _avatarUrl = data['avatarUrl'] ?? selectedUrl;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Photo de profil mise à jour avec succès.')),
        );
        _fetchUserProfileAndPosts();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['error'] ?? 'Impossible de modifier la photo de profil.')),
        );
      }
    } catch (e) {
      debugPrint('Error updating avatar: $e');
    }
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('is_logged_in', false);
    await prefs.remove('user_name');
    await prefs.remove('user_id');

    if (!mounted) return;

    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (context) => const OnboardingPage(),
      ),
      (route) => false,
    );
  }

  void _switchView(int index) {
    setState(() {
      _activeViewIndex = index;
      _profileViewUserId = null; // Always reset when switching views via tabs/drawer
      if (index == 3) {
        _fetchUserProfileAndPosts(); // Load our own profile
      } else if (index == 5) {
        _fetchBookmarkedPosts(); // Load bookmarked posts
      }
    });
    // Close drawer if open
    if (_scaffoldKey.currentState?.isEndDrawerOpen ?? false) {
      Navigator.of(context).pop();
    }
  }

  // Helper to build User Avatar dynamically
  Widget _buildUserAvatar({double radius = 26, String? customUrl}) {
    final url = customUrl ?? _avatarUrl;
    final String initial = _username.isNotEmpty ? _username[0].toUpperCase() : 'U';
    final innerGapColor = _isDarkMode ? Colors.black : Colors.white;

    Widget avatarContent;
    if (url.isNotEmpty) {
      final fullUrl = url.startsWith('http') ? url : 'https://trasx.com$url';
      avatarContent = CachedNetworkImage(
        imageUrl: fullUrl,
        width: radius * 2,
        height: radius * 2,
        fit: BoxFit.cover,
        placeholder: (context, url) => Container(
          width: radius * 2,
          height: radius * 2,
          color: _isDarkMode ? Colors.white10 : Colors.black12,
        ),
        errorWidget: (context, url, error) => Container(
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: instagramGradient),
          ),
          child: Center(
            child: Text(
              initial,
              style: TextStyle(
                color: Colors.white,
                fontSize: radius * 0.8,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
      );
    } else {
      avatarContent = Container(
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: instagramGradient),
        ),
        child: Center(
          child: Text(
            initial,
            style: TextStyle(
              color: Colors.white,
              fontSize: radius * 0.8,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2.5), // Instagram outer gradient ring
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: instagramGradient,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(2.0), // Inner space (black/white liseré)
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: innerGapColor,
        ),
        child: SizedBox(
          width: radius * 2,
          height: radius * 2,
          child: ClipOval(
            child: avatarContent,
          ),
        ),
      ),
    );
  }

  // Dialog to change display name
  void _showEditDisplayNameDialog(Color textPrimaryColor, Color cardColor) {
    final controller = TextEditingController(text: _displayName.isNotEmpty ? _displayName : _username);
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: cardColor,
          title: Text('Modifier le nom', style: TextStyle(color: textPrimaryColor, fontSize: 18, fontWeight: FontWeight.bold)),
          content: TextField(
            controller: controller,
            style: TextStyle(color: textPrimaryColor),
            decoration: InputDecoration(
              hintText: 'Saisissez votre nouveau nom',
              hintStyle: const TextStyle(color: Colors.white30),
              enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: textPrimaryColor.withValues(alpha: 0.2))),
              focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFFC13584))),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Annuler', style: TextStyle(color: Colors.white54)),
            ),
            TextButton(
              onPressed: () {
                final newName = controller.text.trim();
                if (newName.isNotEmpty) {
                  _updateDisplayName(newName);
                }
                Navigator.of(context).pop();
              },
              child: const Text('Enregistrer', style: TextStyle(color: Color(0xFFC13584), fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  // BottomSheet to pick preset avatar
  void _showAvatarPicker(Color textPrimaryColor, Color cardColor) {
    showModalBottomSheet(
      context: context,
      backgroundColor: cardColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Choisir un avatar',
                  style: TextStyle(color: textPrimaryColor, fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  height: 100,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    itemCount: presetAvatars.length,
                    itemBuilder: (context, index) {
                      final url = presetAvatars[index];
                      return GestureDetector(
                        onTap: () {
                          _updateAvatar(url);
                          Navigator.of(context).pop();
                        },
                        child: Padding(
                          padding: const EdgeInsets.only(right: 14.0),
                          child: CircleAvatar(
                            radius: 36,
                            backgroundColor: Colors.white.withValues(alpha: 0.05),
                            child: ClipOval(
                              child: CachedNetworkImage(
                                imageUrl: url,
                                width: 72,
                                height: 72,
                                fit: BoxFit.cover,
                                placeholder: (context, url) => Container(
                                  width: 72,
                                  height: 72,
                                  color: Colors.white10,
                                ),
                                errorWidget: (context, url, error) => const Icon(
                                  Icons.error_outline_rounded,
                                  color: Colors.white30,
                                ),
                              ),
                            ),
                          ),
                        ),
                      );
                    },
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
    // Dynamic Theme Variables
    final bgColor = _isDarkMode ? Colors.black : Colors.white;
    final cardColor = _isDarkMode ? const Color(0xFF0F0F0F) : const Color(0xFFF9F9F9);
    final textPrimaryColor = _isDarkMode ? Colors.white : Colors.black;
    final textSecondaryColor = _isDarkMode ? Colors.white60 : Colors.black54;
    final borderColor = _isDarkMode ? Colors.white.withValues(alpha: 0.1) : Colors.black.withValues(alpha: 0.1);
    final bottomBarBgColor = _isDarkMode ? Colors.black.withValues(alpha: 0.8) : Colors.white.withValues(alpha: 0.9);
    final bottomBarBorderColor = _isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.black.withValues(alpha: 0.08);
    final drawerBgColor = _isDarkMode ? const Color(0xFF0C0C0C) : Colors.white;
    final drawerBorderColor = _isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.black.withValues(alpha: 0.08);

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: bgColor.withValues(alpha: 0.8),
        elevation: 0,
        leadingWidth: (_activeViewIndex == 3 && _profileViewUserId != null && _profileViewUserId != _userId) ? 48 : 40,
        leading: (_activeViewIndex == 3 && _profileViewUserId != null && _profileViewUserId != _userId)
            ? IconButton(
                icon: Icon(Icons.arrow_back_rounded, color: textPrimaryColor),
                onPressed: () {
                  setState(() {
                    _profileViewUserId = null;
                    _activeViewIndex = 0; // return to feed
                  });
                },
              )
            : Padding(
                padding: const EdgeInsets.only(left: 12.0),
                child: Image.asset(
                  'assets/logo.png',
                  color: textPrimaryColor,
                  colorBlendMode: BlendMode.srcIn,
                  errorBuilder: (context, error, stackTrace) => Icon(
                    Icons.bolt_rounded,
                    color: textPrimaryColor,
                    size: 26,
                  ),
                ),
              ),
        titleSpacing: 8.0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'TRA',
              style: TextStyle(
                color: textPrimaryColor,
                fontSize: 18,
                fontWeight: FontWeight.w900,
                letterSpacing: 1.0,
              ),
            ),
            ShaderMask(
              shaderCallback: (bounds) => const LinearGradient(
                colors: instagramGradient,
              ).createShader(bounds),
              child: const Text(
                'SX',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.0,
                ),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.search_rounded, color: textPrimaryColor, size: 24),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Recherche bientôt disponible !')),
              );
            },
          ),
          IconButton(
            icon: Icon(
              _isDarkMode ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
              color: textPrimaryColor,
              size: 24,
            ),
            onPressed: () {
              setState(() {
                _isDarkMode = !_isDarkMode;
              });
            },
          ),
          IconButton(
            icon: Icon(Icons.notifications_none_rounded, color: textPrimaryColor, size: 24),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Aucune nouvelle notification.')),
              );
            },
          ),
          IconButton(
            icon: Icon(Icons.menu_rounded, color: textPrimaryColor, size: 26),
            onPressed: () => _scaffoldKey.currentState?.openEndDrawer(),
          ),
        ],
      ),
      endDrawer: _buildDrawer(drawerBgColor, drawerBorderColor, textPrimaryColor, textSecondaryColor),
      body: _buildBackground(
        bgColor: bgColor,
        child: _buildBodyContent(bgColor, cardColor, textPrimaryColor, textSecondaryColor, borderColor),
      ),
      bottomNavigationBar: _buildBottomNavigationBar(bottomBarBgColor, bottomBarBorderColor, textPrimaryColor),
    );
  }

  // --- HAMBURGER DRAWER ---
  Widget _buildDrawer(Color drawerBgColor, Color drawerBorderColor, Color textPrimaryColor, Color textSecondaryColor) {
    return Drawer(
      backgroundColor: drawerBgColor,
      child: SafeArea(
        child: Column(
          children: [
            // Drawer User Profile Header
            Container(
              padding: const EdgeInsets.all(24.0),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: drawerBorderColor),
                ),
              ),
              child: Row(
                children: [
                  _buildUserAvatar(radius: 26),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _displayName.isNotEmpty ? _displayName : _username,
                          style: TextStyle(
                            color: textPrimaryColor,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _userEmail,
                          style: TextStyle(
                            color: textSecondaryColor,
                            fontSize: 12,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Drawer Items List
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                children: [
                  _buildDrawerTile('Accueil', Icons.home_rounded, 0, textPrimaryColor, textSecondaryColor),
                  _buildDrawerTile('Profil', Icons.person_rounded, 3, textPrimaryColor, textSecondaryColor),
                  _buildDrawerTile('Shorts', Icons.play_circle_outline_rounded, 1, textPrimaryColor, textSecondaryColor),
                  _buildDrawerTile('Trading P2P', Icons.swap_horizontal_circle_rounded, 4, textPrimaryColor, textSecondaryColor),
                  _buildDrawerTile('Signets', Icons.bookmark_rounded, 5, textPrimaryColor, textSecondaryColor),
                  _buildDrawerTile('Jeux de société', Icons.sports_esports_rounded, 6, textPrimaryColor, textSecondaryColor),
                  _buildDrawerTile('Événements', Icons.event_rounded, 7, textPrimaryColor, textSecondaryColor),
                  _buildDrawerTile('Paramètres', Icons.settings_rounded, 8, textPrimaryColor, textSecondaryColor),
                ],
              ),
            ),

            // Logout Button at the bottom
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: InkWell(
                onTap: _logout,
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                  decoration: BoxDecoration(
                    color: _isDarkMode ? const Color(0xFF161616) : const Color(0xFFFFF5F5),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.redAccent.withValues(alpha: 0.15)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.logout_rounded, color: Colors.redAccent, size: 20),
                      SizedBox(width: 10),
                      Text(
                        'Déconnexion',
                        style: TextStyle(
                          color: Colors.redAccent,
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDrawerTile(String title, IconData icon, int targetIndex, Color textPrimaryColor, Color textSecondaryColor) {
    final bool isSelected = _activeViewIndex == targetIndex;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.0),
      child: ListTile(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        leading: Icon(
          icon,
          color: isSelected ? textPrimaryColor : textSecondaryColor,
          size: 22,
        ),
        title: Text(
          title,
          style: TextStyle(
            color: isSelected ? textPrimaryColor : textSecondaryColor,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            fontSize: 14,
          ),
        ),
        selected: isSelected,
        selectedTileColor: textPrimaryColor.withValues(alpha: 0.06),
        onTap: () => _switchView(targetIndex),
      ),
    );
  }

  // --- CUSTOM BOTTOM NAVIGATION BAR ---
  Widget _buildBottomNavigationBar(Color bottomBarBgColor, Color bottomBarBorderColor, Color textPrimaryColor) {
    return Container(
      decoration: BoxDecoration(
        color: bottomBarBgColor,
        border: Border(
          top: BorderSide(color: bottomBarBorderColor, width: 0.5),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Container(
          height: 60,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildBottomTab(0, CupertinoIcons.house_fill, CupertinoIcons.house, 'Accueil', textPrimaryColor),
              _buildBottomTab(1, CupertinoIcons.play_circle_fill, CupertinoIcons.play_circle, 'Shorts', textPrimaryColor),
              _buildAddButton(),
              _buildBottomTab(2, CupertinoIcons.chat_bubble_2_fill, CupertinoIcons.chat_bubble_2, 'Messages', textPrimaryColor),
              _buildProfileBottomTab(3, 'Profil', textPrimaryColor),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBottomTab(int index, IconData activeIcon, IconData inactiveIcon, String label, Color textPrimaryColor) {
    final bool isSelected = _activeViewIndex == index;
    return GestureDetector(
      onTap: () => _switchView(index),
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 60,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isSelected ? activeIcon : inactiveIcon,
              color: isSelected ? textPrimaryColor : textPrimaryColor.withValues(alpha: 0.5),
              size: 24,
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? textPrimaryColor : textPrimaryColor.withValues(alpha: 0.5),
                fontSize: 9,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProfileBottomTab(int index, String label, Color textPrimaryColor) {
    final bool isSelected = _activeViewIndex == index;
    final url = _avatarUrl;
    final String initial = _username.isNotEmpty ? _username[0].toUpperCase() : 'U';

    Widget avatarContent;
    if (url.isNotEmpty) {
      final fullUrl = url.startsWith('http') ? url : 'https://trasx.com$url';
      avatarContent = CachedNetworkImage(
        imageUrl: fullUrl,
        width: 22,
        height: 22,
        fit: BoxFit.cover,
        placeholder: (context, url) => Container(
          width: 22,
          height: 22,
          color: Colors.white10,
        ),
        errorWidget: (context, url, error) => Container(
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: instagramGradient),
          ),
          child: Center(
            child: Text(
              initial,
              style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
            ),
          ),
        ),
      );
    } else {
      avatarContent = Container(
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: instagramGradient),
        ),
        child: Center(
          child: Text(
            initial,
            style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
          ),
        ),
      );
    }

    return GestureDetector(
      onTap: () => _switchView(index),
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 60,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(1.5),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: isSelected
                    ? const LinearGradient(
                        colors: instagramGradient,
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      )
                    : null,
                border: isSelected
                    ? null
                    : Border.all(color: textPrimaryColor.withValues(alpha: 0.3), width: 1.5),
              ),
              child: Container(
                padding: const EdgeInsets.all(1.0),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _isDarkMode ? Colors.black : Colors.white,
                ),
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: ClipOval(
                    child: avatarContent,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? textPrimaryColor : textPrimaryColor.withValues(alpha: 0.5),
                fontSize: 9,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAddButton() {
    return GestureDetector(
      onTap: () {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("Création de live ou de jeu de société bientôt disponible !"),
            backgroundColor: Color(0xFFC13584),
          ),
        );
      },
      child: Container(
        width: 46,
        height: 30,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
        ),
        child: Stack(
          children: [
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              right: 8,
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFFC13584),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            Positioned(
              right: 0,
              top: 0,
              bottom: 0,
              left: 8,
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFFF77737),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            Center(
              child: Container(
                width: 38,
                height: 30,
                decoration: BoxDecoration(
                  color: _isDarkMode ? Colors.white : Colors.black,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  Icons.add_rounded,
                  color: _isDarkMode ? Colors.black : Colors.white,
                  size: 20,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // --- BODY VIEW RENDERING ---
  Widget _buildBodyContent(Color bgColor, Color cardColor, Color textPrimaryColor, Color textSecondaryColor, Color borderColor) {
    switch (_activeViewIndex) {
      case 0:
        return _buildFeedView(cardColor, textPrimaryColor, textSecondaryColor, borderColor);
      case 1:
        return _buildShortsView(cardColor, textPrimaryColor, textSecondaryColor);
      case 2:
        return _buildMessagesView(textPrimaryColor, textSecondaryColor);
      case 3:
        return _buildProfileView(bgColor, cardColor, textPrimaryColor, textSecondaryColor, borderColor);
      case 4:
        return _buildP2PView(cardColor, textPrimaryColor, textSecondaryColor);
      case 5:
        return _buildBookmarksView(cardColor, textPrimaryColor, textSecondaryColor, borderColor);
      case 6:
        return _buildGamesView(cardColor, textPrimaryColor, textSecondaryColor);
      case 7:
        return _buildEventsView(cardColor, textPrimaryColor, textSecondaryColor);
      case 8:
        return _buildSettingsView(cardColor, textPrimaryColor, textSecondaryColor);
      default:
        return _buildFeedView(cardColor, textPrimaryColor, textSecondaryColor, borderColor);
    }
  }

  // 1. DYNAMIC HOME FEED VIEW (Accueil)
  Widget _buildFeedView(Color cardColor, Color textPrimaryColor, Color textSecondaryColor, Color borderColor) {
    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: () async {
            setState(() { _nextCursor = null; _hasMoreFeed = true; });
            await _fetchHomeFeed(isRefresh: true);
            await _fetchUserProfileAndPosts();
            await _fetchStatuses();
          },
          color: const Color(0xFFC13584),
          backgroundColor: cardColor,
          child: _buildFeedContent(cardColor, textPrimaryColor, textSecondaryColor, borderColor),
        ),

        // ── Offline banner ──────────────────────────────────────────────────
        if (_isOffline)
          Positioned(
            top: 0, left: 0, right: 0,
            child: Material(
              color: Colors.transparent,
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 14),
                color: const Color(0xFFFD1D1D).withAlpha(220),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: const [
                    Icon(Icons.wifi_off_rounded, color: Colors.white, size: 14),
                    SizedBox(width: 6),
                    Text(
                      'Hors ligne — données en cache',
                      style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ),
          ),

        // ── "Nouvelles publications" floating button ─────────────────────────
        if (_pendingNewPosts.isNotEmpty)
          Positioned(
            top: _isOffline ? 38 : 10,
            left: 0, right: 0,
            child: Center(
              child: GestureDetector(
                onTap: () {
                  setState(() {
                    _feedPosts = Post.merge(_feedPosts, _pendingNewPosts);
                    _pendingNewPosts = [];
                  });
                  _feedScrollController.animateTo(
                    0,
                    duration: const Duration(milliseconds: 400),
                    curve: Curves.easeOut,
                  );
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF833AB4), Color(0xFFC13584)],
                    ),
                    borderRadius: BorderRadius.circular(24),
                    boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 8, offset: Offset(0, 2))],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.arrow_upward_rounded, color: Colors.white, size: 14),
                      const SizedBox(width: 6),
                      Text(
                        '${_pendingNewPosts.length} nouvelle${_pendingNewPosts.length > 1 ? 's' : ''} publication${_pendingNewPosts.length > 1 ? 's' : ''}',
                        style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildFeedContent(Color cardColor, Color textPrimaryColor, Color textSecondaryColor, Color borderColor) {
    // Skeleton loading (initial only, no posts yet)
    if (_isLoadingFeed && _feedPosts.isEmpty) {
      return SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildStatusBar(
              textPrimaryColor: textPrimaryColor,
              textSecondaryColor: textSecondaryColor,
              cardColor: cardColor,
            ),
            FeedSkeleton(isDarkMode: _isDarkMode),
          ],
        ),
      );
    }

    // Error state with retry (initial load only)
    if (_hasFeedError && _feedPosts.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _buildStatusBar(
            textPrimaryColor: textPrimaryColor,
            textSecondaryColor: textSecondaryColor,
            cardColor: cardColor,
          ),
          SizedBox(
            height: 300,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.cloud_off_rounded, color: Colors.white30, size: 48),
                const SizedBox(height: 16),
                Text(
                  _feedErrorMessage ?? 'Une erreur est survenue.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: textSecondaryColor, fontSize: 13),
                ),
                const SizedBox(height: 20),
                ElevatedButton.icon(
                  onPressed: _fetchHomeFeed,
                  icon: const Icon(Icons.refresh_rounded, size: 16),
                  label: const Text('Réessayer'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFC13584),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return CustomScrollView(
      controller: _feedScrollController,
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        // ── Stories bar ────────────────────────────────────────────────────
        SliverToBoxAdapter(
          child: _buildStatusBar(
            textPrimaryColor: textPrimaryColor,
            textSecondaryColor: textSecondaryColor,
            cardColor: cardColor,
          ),
        ),

        // ── Feed posts ─────────────────────────────────────────────────────
        if (_feedPosts.isEmpty)
          SliverFillRemaining(
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.dynamic_feed_rounded, color: Colors.white24, size: 48),
                  const SizedBox(height: 12),
                  Text('Aucune publication disponible.', style: TextStyle(color: textSecondaryColor)),
                ],
              ),
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.only(bottom: 80.0),
            sliver: SliverList(
              delegate: SliverChildBuilderDelegate(
                (context, index) {
                  // Loading more spinner
                  if (index == _feedPosts.length) {
                    if (_paginationError != null) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Center(
                          child: TextButton.icon(
                            onPressed: _fetchMoreHomeFeed,
                            icon: const Icon(Icons.refresh_rounded, size: 16, color: Color(0xFFC13584)),
                            label: const Text('Réessayer', style: TextStyle(color: Color(0xFFC13584))),
                          ),
                        ),
                      );
                    }
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24.0),
                      child: Center(
                        child: SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            color: Color(0xFFC13584),
                            strokeWidth: 2.0,
                          ),
                        ),
                      ),
                    );
                  }

                  final post = _feedPosts[index];
                  return _buildFeedCard(
                    key: ValueKey(post.id),
                    post: post,
                    cardColor: cardColor,
                    textPrimaryColor: textPrimaryColor,
                    textSecondaryColor: textSecondaryColor,
                    borderColor: borderColor,
                  );
                },
                childCount: _feedPosts.length + (_isLoadingMoreFeed || _hasMoreFeed ? 1 : 0),
              ),
            ),
          ),
      ],
    );
  }

  // ── Status Bar (Stories Row) ──────────────────────────────────────────────
  Widget _buildStatusBar({
    required Color textPrimaryColor,
    required Color textSecondaryColor,
    required Color cardColor,
  }) {
    final bool hasSelfStatus = _statusGroups.isNotEmpty &&
        (_statusGroups[0]['user_id'] as num?)?.toInt() == _userId;

    final List<dynamic> groups = [
      {'_isSelf': true, 'has_status': hasSelfStatus},
      ..._statusGroups.where((g) => (g['user_id'] as num?)?.toInt() != _userId),
    ];

    return Container(
      height: 118,
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: _isDarkMode ? Colors.white12 : Colors.black12,
            width: 0.4,
          ),
        ),
      ),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        itemCount: groups.length,
        itemBuilder: (context, index) {
          final g = groups[index];
          final isSelf = g['_isSelf'] == true;

          if (isSelf) {
            return Padding(
              padding: const EdgeInsets.only(right: 14),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Stack(
                    alignment: Alignment.bottomRight,
                    children: [
                      GestureDetector(
                        onTap: () {
                          if (hasSelfStatus) {
                            _showStatusViewer(_statusGroups[0]);
                          } else {
                            _showAddStatusSheet();
                          }
                        },
                        child: _buildStatusRing(
                          avatarUrl: _avatarUrl,
                          username: _username,
                          hasUnviewedStatus: hasSelfStatus,
                          size: 60,
                          isDarkMode: _isDarkMode,
                          statusCount: hasSelfStatus ? ((_statusGroups[0]['statuses'] as List<dynamic>?)?.length ?? 1) : 0,
                        ),
                      ),
                      GestureDetector(
                        onTap: () => _showAddStatusSheet(),
                        child: Container(
                          width: 20,
                          height: 20,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: const Color(0xFFC13584),
                            border: Border.all(
                              color: _isDarkMode ? Colors.black : Colors.white,
                              width: 2,
                            ),
                          ),
                          child: const Icon(Icons.add, size: 13, color: Colors.white),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  SizedBox(
                    width: 62,
                    child: Text(
                      'Mon statut',
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: textPrimaryColor,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }

          // Other user status bubble
          final statusGroup = g as Map<String, dynamic>;
          final userName = statusGroup['user_name'] ?? statusGroup['username'] ?? '?';
          final avatarUrl = statusGroup['avatar'] as String?;
          final bool isBoosted = statusGroup['is_boosted'] == true;

          return GestureDetector(
            onTap: () => _showStatusViewer(statusGroup),
            child: Padding(
              padding: const EdgeInsets.only(right: 14),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildStatusRing(
                    avatarUrl: avatarUrl,
                    username: userName,
                    hasUnviewedStatus: true,
                    size: 60,
                    isDarkMode: _isDarkMode,
                    isBoosted: isBoosted,
                    statusCount: (statusGroup['statuses'] as List<dynamic>?)?.length ?? 1,
                  ),
                  const SizedBox(height: 5),
                  SizedBox(
                    width: 62,
                    child: Text(
                      userName,
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: isBoosted ? const Color(0xFFFFD700) : textSecondaryColor,
                        fontSize: 10.5,
                        fontWeight: isBoosted ? FontWeight.bold : FontWeight.normal,
                      ),
                    ),
                  ),
                  if (isBoosted) ...[
                    const SizedBox(height: 2),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFD700).withAlpha(30),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: const Color(0xFFFFD700), width: 0.5),
                      ),
                      child: const Text(
                        'BOOSTÉ',
                        style: TextStyle(
                          color: Color(0xFFFFD700),
                          fontSize: 7,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  // Gradient ring around avatar (Instagram-style / Premium Golden for Boosted)
  Widget _buildStatusRing({
    required String? avatarUrl,
    required String username,
    required bool hasUnviewedStatus,
    required double size,
    required bool isDarkMode,
    bool isBoosted = false,
    int statusCount = 1,
  }) {
    final String initial = username.isNotEmpty ? username[0].toUpperCase() : 'U';
    final innerGap = isDarkMode ? Colors.black : Colors.white;

    // Use gold gradient for boosted accounts, else the standard instagram gradient
    final List<Color> ringColors = isBoosted
        ? [const Color(0xFFFFD700), const Color(0xFFFFA500), const Color(0xFFFF8C00)]
        : instagramGradient;

    Widget avatarContent;
    if (avatarUrl != null && avatarUrl.isNotEmpty) {
      final fullUrl = avatarUrl.startsWith('http') ? avatarUrl : 'https://trasx.com$avatarUrl';
      avatarContent = CachedNetworkImage(
        imageUrl: fullUrl,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (_, __) => Container(color: Colors.white10),
        errorWidget: (_, __, ___) => Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: ringColors),
          ),
          child: Center(
            child: Text(initial, style: TextStyle(color: Colors.white, fontSize: size * 0.38, fontWeight: FontWeight.bold)),
          ),
        ),
      );
    } else {
      avatarContent = Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: ringColors),
        ),
        child: Center(
          child: Text(initial, style: TextStyle(color: Colors.white, fontSize: size * 0.38, fontWeight: FontWeight.bold)),
        ),
      );
    }

    final bool showRing = statusCount > 0 || isBoosted;

    return CustomPaint(
      painter: showRing
          ? _StatusRingPainter(
              statusCount: statusCount > 0 ? statusCount : 1,
              colors: ringColors,
              hasUnviewed: hasUnviewedStatus || isBoosted,
            )
          : null,
      child: Container(
        padding: const EdgeInsets.all(3.0),
        decoration: const BoxDecoration(shape: BoxShape.circle),
        child: Container(
          padding: const EdgeInsets.all(2.5),
          decoration: BoxDecoration(shape: BoxShape.circle, color: innerGap),
          child: SizedBox(
            width: size,
            height: size,
            child: ClipOval(child: avatarContent),
          ),
        ),
      ),
    );
  }

  // Show dialog to create a text status
  void _showAddStatusSheet() {
    final TextEditingController _textCtrl = TextEditingController();
    String _selectedBg = '#833AB4';
    final List<String> _bgOptions = [
      '#833AB4', '#C13584', '#E1306C', '#FD1D1D',
      '#F77737', '#FCAF45', '#1A1A2E', '#0F3460',
    ];

    // Media status variables
    String _currentType = 'text'; // 'text', 'image', 'video', 'voice'
    String? _mediaPath;
    bool _isRecording = false;
    int _recordDuration = 0;
    Timer? _recordTimer;
    final _audioRecorder = AudioRecorder();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black54,
      builder: (ctx) {
        return StatefulBuilder(builder: (ctx, setBS) {
          final double bottomPadding = MediaQuery.of(ctx).viewInsets.bottom + MediaQuery.of(ctx).padding.bottom;

          // Helper to pick image
          Future<void> _pickImage() async {
            try {
              final picker = ImagePicker();
              final picked = await picker.pickImage(source: ImageSource.gallery);
              if (picked != null) {
                setBS(() {
                  _currentType = 'image';
                  _mediaPath = picked.path;
                });
              }
            } catch (e) {
              debugPrint('Error picking image: $e');
            }
          }

          // Helper to pick video
          Future<void> _pickVideo() async {
            try {
              final picker = ImagePicker();
              final picked = await picker.pickVideo(source: ImageSource.gallery);
              if (picked != null) {
                setBS(() {
                  _currentType = 'video';
                  _mediaPath = picked.path;
                });
              }
            } catch (e) {
              debugPrint('Error picking video: $e');
            }
          }

          // Helper for recording voice notes (tap to start / tap to stop)
          Future<void> _toggleVoiceRecording() async {
            try {
              if (_isRecording) {
                // Stop recording
                final path = await _audioRecorder.stop();
                _recordTimer?.cancel();
                setBS(() {
                  _isRecording = false;
                  if (path != null) {
                    _currentType = 'voice';
                    _mediaPath = path;
                  }
                });
              } else {
                // Start recording
                if (await _audioRecorder.hasPermission()) {
                  final tempDir = await getTemporaryDirectory();
                  final filePath = '${tempDir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.m4a';

                  setBS(() {
                    _currentType = 'voice';
                    _isRecording = true;
                    _mediaPath = null;
                    _recordDuration = 0;
                  });

                  await _audioRecorder.start(
                    const RecordConfig(encoder: AudioEncoder.aacLc),
                    path: filePath,
                  );

                  _recordTimer = Timer.periodic(const Duration(seconds: 1), (t) {
                    setBS(() => _recordDuration++);
                  });
                }
              }
            } catch (e) {
              debugPrint('Error with voice recorder: $e');
              setBS(() {
                _isRecording = false;
              });
            }
          }

          return ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
              child: Container(
                height: MediaQuery.of(ctx).size.height * 0.82,
                decoration: BoxDecoration(
                  color: _isDarkMode ? const Color(0xED121212) : Colors.white.withAlpha(240),
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                  border: Border.all(color: _isDarkMode ? Colors.white12 : Colors.black12, width: 0.5),
                ),
                padding: EdgeInsets.only(bottom: bottomPadding + 16),
                child: Column(
                  children: [
                    // Premium Handle
                    Container(
                      width: 40, height: 4,
                      margin: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: _isDarkMode ? Colors.white24 : Colors.black26,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    // Title & Publish Header
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                      child: Row(
                        children: [
                          Text(
                            'Nouveau statut',
                            style: TextStyle(
                              color: _isDarkMode ? Colors.white : Colors.black,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 0.2,
                            ),
                          ),
                          const Spacer(),
                          GestureDetector(
                            onTap: () async {
                              if (_currentType == 'text' && _textCtrl.text.trim().isEmpty) return;

                              Navigator.pop(ctx);
                              await _postMediaStatus(
                                statusType: _currentType,
                                text: _textCtrl.text.isNotEmpty ? _textCtrl.text : null,
                                bgColor: _currentType == 'text' ? _selectedBg : null,
                                mediaPath: _mediaPath,
                              );

                              _audioRecorder.dispose();
                            },
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFFC13584),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: const Text(
                                'Publier',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Preview Area Card
                    Expanded(
                      child: Container(
                        margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(20),
                          gradient: _currentType == 'text'
                              ? LinearGradient(
                                  colors: [
                                    Color(int.parse(_selectedBg.replaceFirst('#', '0xFF'))),
                                    Color(int.parse(_selectedBg.replaceFirst('#', '0xFF'))).withAlpha(180)
                                  ],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                )
                              : null,
                          color: _currentType != 'text' ? Colors.black38 : null,
                          border: Border.all(color: _isDarkMode ? Colors.white10 : Colors.black.withAlpha(12), width: 0.8),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Builder(builder: (c) {
                              if (_isRecording) {
                                return Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    // Animated pulsing red record dot
                                    Container(
                                      width: 60,
                                      height: 60,
                                      decoration: const BoxDecoration(
                                        color: Colors.redAccent,
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(Icons.mic, color: Colors.white, size: 32),
                                    ),
                                    const SizedBox(height: 16),
                                    Text(
                                      'Enregistrement : ${_recordDuration}s',
                                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                                    ),
                                    const SizedBox(height: 8),
                                    const Text(
                                      'Réappuyez sur le micro pour arrêter',
                                      style: TextStyle(color: Colors.white54, fontSize: 12),
                                    ),
                                  ],
                                );
                              }

                              if (_currentType == 'image' && _mediaPath != null) {
                                return Image.file(File(_mediaPath!), fit: BoxFit.contain);
                              }

                              if (_currentType == 'video' && _mediaPath != null) {
                                return Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(16),
                                      decoration: BoxDecoration(
                                        color: Colors.white.withAlpha(20),
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(Icons.video_library_rounded, color: Colors.white, size: 36),
                                    ),
                                    const SizedBox(height: 16),
                                    const Text(
                                      'Vidéo sélectionnée',
                                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                                    ),
                                  ],
                                );
                              }

                              if (_currentType == 'voice' && _mediaPath != null) {
                                return Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(16),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFC13584).withAlpha(30),
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(Icons.audiotrack_rounded, color: Color(0xFFC13584), size: 40),
                                    ),
                                    const SizedBox(height: 16),
                                    const Text(
                                      'Note vocale prête',
                                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                                    ),
                                    const SizedBox(height: 6),
                                    const Text(
                                      'Tapez sur "Publier" pour l\'envoyer',
                                      style: TextStyle(color: Colors.white54, fontSize: 12),
                                    ),
                                  ],
                                );
                              }

                              return Text(
                                _textCtrl.text.isEmpty ? 'Écrivez votre message...' : _textCtrl.text,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                  shadows: [Shadow(blurRadius: 10, color: Colors.black45, offset: Offset(0, 2))],
                                ),
                              );
                            }),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Media Action selector bar
                    Container(
                      margin: const EdgeInsets.symmetric(horizontal: 20),
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      decoration: BoxDecoration(
                        color: _isDarkMode ? Colors.white.withAlpha(8) : Colors.black.withAlpha(6),
                        borderRadius: BorderRadius.circular(30),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          // Text option button
                          _buildMediaButton(
                            icon: Icons.text_fields_rounded,
                            isActive: _currentType == 'text',
                            onTap: () => setBS(() {
                              _currentType = 'text';
                              _mediaPath = null;
                            }),
                          ),
                          // Gallery Image Option
                          _buildMediaButton(
                            icon: Icons.image_rounded,
                            isActive: _currentType == 'image',
                            onTap: _pickImage,
                          ),
                          // Video Option
                          _buildMediaButton(
                            icon: Icons.videocam_rounded,
                            isActive: _currentType == 'video',
                            onTap: _pickVideo,
                          ),
                          // Voice Recording Option (Click once to start/stop, no gesture conflicts)
                          _buildMediaButton(
                            icon: _isRecording ? Icons.stop_circle_rounded : Icons.mic_rounded,
                            isActive: _currentType == 'voice',
                            iconColor: _isRecording ? Colors.redAccent : null,
                            onTap: () {
                              setBS(() {
                                _currentType = 'voice';
                              });
                              _toggleVoiceRecording();
                            },
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Color selector (visible only for text statuses)
                    if (_currentType == 'text')
                      SizedBox(
                        height: 40,
                        child: ListView.builder(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          itemCount: _bgOptions.length,
                          itemBuilder: (_, i) {
                            final hex = _bgOptions[i];
                            final selected = hex == _selectedBg;
                            return GestureDetector(
                              onTap: () => setBS(() => _selectedBg = hex),
                              child: Container(
                                width: 30, height: 30,
                                margin: const EdgeInsets.only(right: 10),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Color(int.parse(hex.replaceFirst('#', '0xFF'))),
                                  border: selected
                                      ? Border.all(color: Colors.white, width: 2.5)
                                      : null,
                                  boxShadow: selected
                                      ? [BoxShadow(color: Colors.white.withAlpha(80), blurRadius: 8)]
                                      : null,
                                ),
                              ),
                            );
                          },
                        ),
                      ),

                    // Caption text field (Conditional: hides on voice, visible for text/image/video)
                    if (_currentType != 'voice')
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: TextField(
                          controller: _textCtrl,
                          maxLines: 2,
                          onChanged: (_) => setBS(() {}),
                          style: TextStyle(
                            color: _isDarkMode ? Colors.white : Colors.black,
                            fontSize: 14,
                          ),
                          decoration: InputDecoration(
                            hintText: _currentType == 'text' ? 'Écrivez votre statut...' : 'Ajouter une légende...',
                            hintStyle: TextStyle(color: _isDarkMode ? Colors.white38 : Colors.black38, fontSize: 13),
                            filled: true,
                            fillColor: _isDarkMode ? Colors.white.withAlpha(12) : Colors.black.withAlpha(8),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(16),
                              borderSide: BorderSide.none,
                            ),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          );
        });
      },
    );
  }

  // Helper builder for media action buttons
  Widget _buildMediaButton({
    required IconData icon,
    required bool isActive,
    required VoidCallback onTap,
    Color? iconColor,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: isActive ? const Color(0xFFC13584) : Colors.transparent,
        ),
        child: Icon(
          icon,
          color: iconColor ?? (isActive ? Colors.white : (_isDarkMode ? Colors.white54 : Colors.black45)),
          size: 20,
        ),
      ),
    );
  }

  // Show a status group in fullscreen viewer
  void _showStatusViewer(Map<String, dynamic> group) {
    if (_statusGroups.isEmpty) return;

    final int initialIndex = _statusGroups.indexWhere((g) => g['user_id'] == group['user_id']);
    final int safeIndex = initialIndex == -1 ? 0 : initialIndex;

    // 1. Pause all feed videos
    setState(() {
      _DashboardPageState.pauseAllVideos = true;
    });

    // 2. Hide status/top bar
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

    // 3. Open full screen page
    Navigator.push(
      context,
      PageRouteBuilder(
        opaque: false,
        pageBuilder: (ctx, _, __) => Scaffold(
          backgroundColor: Colors.black,
          resizeToAvoidBottomInset: false,
          body: _StatusViewerSheet(
            allGroups: _statusGroups,
            initialGroupIndex: safeIndex,
            isDarkMode: _isDarkMode,
            currentUserId: _userId,
            socket: _socket,
          ),
        ),
      ),
    ).then((_) {
      // 4. Restore top bar and resume feed videos
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      setState(() {
        _DashboardPageState.pauseAllVideos = false;
      });
    });
  }

  // 2. SHORTS VIEW
  Widget _buildShortsView(Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: cardColor,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: textPrimaryColor.withValues(alpha: 0.1)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.play_circle_fill_rounded, color: Color(0xFFE1306C), size: 64),
              const SizedBox(height: 16),
              Text(
                'Shorts Vidéos',
                style: TextStyle(color: textPrimaryColor, fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                'Faites défiler des vidéos courtes de jeux de société et de défis lancés par les joueurs du monde entier.',
                textAlign: TextAlign.center,
                style: TextStyle(color: textSecondaryColor, fontSize: 13, height: 1.4),
              ),
              const SizedBox(height: 20),
              ElevatedButton.icon(
                onPressed: () {},
                icon: const Icon(Icons.arrow_downward_rounded, size: 16),
                label: const Text('Découvrir les vidéos'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _isDarkMode ? Colors.white : Colors.black,
                  foregroundColor: _isDarkMode ? Colors.black : Colors.white,
                ),
              )
            ],
          ),
        ),
      ),
    );
  }

  // 3. MESSAGES VIEW
  Widget _buildMessagesView(Color textPrimaryColor, Color textSecondaryColor) {
    return ListView(
      padding: const EdgeInsets.all(16.0),
      children: [
        _buildSectionHeader("Discussions récentes", textPrimaryColor),
        const SizedBox(height: 12),
        _buildMessageTile("Lucas_Pro", "Salut ! On commence la partie de Monopoly ?", "Il y a 5m", textPrimaryColor, textSecondaryColor),
        _buildMessageTile("Elena_P2P", "Le transfert de diamants a été validé sur la blockchain.", "Il y a 2h", textPrimaryColor, textSecondaryColor),
        _buildMessageTile("Support_TrasX", "Votre compte a été vérifié avec succès.", "Hier", textPrimaryColor, textSecondaryColor),
      ],
    );
  }

  // 4. NESTED SCROLLING PROFILE VIEW (TikTok Style)
  Widget _buildProfileView(Color bgColor, Color cardColor, Color textPrimaryColor, Color textSecondaryColor, Color borderColor) {
    final bool isOwnProfile = _profileViewUserId == null || _profileViewUserId == _userId;

    return DefaultTabController(
      length: 2,
      child: NestedScrollView(
        headerSliverBuilder: (BuildContext context, bool innerBoxIsScrolled) {
          return <Widget>[
            SliverToBoxAdapter(
              child: Column(
                children: [
                  Center(
                    child: Column(
                      children: [
                        // Avatar profile picture with Camera edit icon if own profile
                        isOwnProfile
                            ? GestureDetector(
                                onTap: () => _showAvatarPicker(textPrimaryColor, cardColor),
                                child: Stack(
                                  children: [
                                    _buildUserAvatar(radius: 42, customUrl: _profileAvatarUrl),
                                    Positioned(
                                      bottom: 0,
                                      right: 0,
                                      child: Container(
                                        padding: const EdgeInsets.all(5),
                                        decoration: const BoxDecoration(
                                          color: Color(0xFFC13584),
                                          shape: BoxShape.circle,
                                        ),
                                        child: const Icon(
                                          Icons.camera_alt_rounded,
                                          color: Colors.white,
                                          size: 14,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              )
                            : _buildUserAvatar(radius: 42, customUrl: _profileAvatarUrl),
                        const SizedBox(height: 12),
                        
                        // Username row with edit pencil icon if own profile
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              _profileDisplayName.isNotEmpty ? _profileDisplayName : _profileUsername,
                              style: TextStyle(color: textPrimaryColor, fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                            if (isOwnProfile) ...[
                              const SizedBox(width: 6),
                              GestureDetector(
                                onTap: () => _showEditDisplayNameDialog(textPrimaryColor, cardColor),
                                child: Icon(
                                  Icons.edit_rounded,
                                  color: textSecondaryColor.withValues(alpha: 0.8),
                                  size: 16,
                                ),
                              ),
                            ],
                          ],
                        ),
                        
                        // Small username handle below
                        if (_profileDisplayName.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            '@$_profileUsername',
                            style: TextStyle(color: textSecondaryColor, fontSize: 12),
                          ),
                        ],
                        
                        const SizedBox(height: 20),
                        
                        // Dynamic statistics row
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            _buildProfileStat("Abonnés", "$_profileFollowersCount", textPrimaryColor, textSecondaryColor),
                            _buildProfileStat("Suivi", "$_profileFollowingCount", textPrimaryColor, textSecondaryColor),
                            _buildProfileStat("J'aime", "$_profileLikesCount", textPrimaryColor, textSecondaryColor),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
            
            // Pinned TabBar (stays fixed at the top when scrolling)
            SliverPersistentHeader(
              pinned: true,
              delegate: _SliverAppBarDelegate(
                TabBar(
                  indicatorColor: const Color(0xFFC13584),
                  labelColor: textPrimaryColor,
                  unselectedLabelColor: textSecondaryColor,
                  dividerColor: Colors.transparent,
                  tabs: const [
                    Tab(icon: Icon(Icons.grid_on_rounded), text: 'Feed'),
                    Tab(icon: Icon(Icons.video_library_rounded), text: 'Shorts'),
                  ],
                ),
                bgColor,
              ),
            ),
          ];
        },
        body: _isLoadingProfile
            ? const Center(
                child: CircularProgressIndicator(color: Color(0xFFC13584)),
              )
            : TabBarView(
                children: [
                  // Tab 1: Feed Publications List with Pull-To-Refresh
                  RefreshIndicator(
                    onRefresh: () async {
                      await _fetchUserProfileAndPosts(targetUserId: _profileViewUserId);
                      await _fetchHomeFeed();
                    },
                    color: const Color(0xFFC13584),
                    backgroundColor: cardColor,
                    child: _profilePosts.isEmpty
                        ? SingleChildScrollView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            child: Container(
                              height: 300,
                              alignment: Alignment.center,
                              child: Text(
                                "Aucune publication feed.",
                                style: TextStyle(color: textSecondaryColor),
                              ),
                            ),
                          )
                        : ListView.builder(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.only(top: 8, bottom: 80),
                            itemCount: _profilePosts.length,
                            itemBuilder: (context, index) {
                              final postMap = _profilePosts[index];
                              final postObj = Post(
                                id: postMap['id'] ?? 0,
                                authorId: _profileViewUserId ?? _userId,
                                authorUsername: _profileUsername,
                                authorDisplayName: _profileDisplayName.isNotEmpty ? _profileDisplayName : _profileUsername,
                                authorAvatar: _profileAvatarUrl,
                                content: postMap['content'] ?? '',
                                imageUrl: postMap['imageUrl'] ?? postMap['image_url'],
                                thumbnailUrl: postMap['thumbnailUrl'] ?? postMap['thumbnail_url'],
                                isTrade: postMap['is_trade'] == 1 || postMap['is_trade'] == true,
                                likesCount: postMap['likes_count'] ?? 0,
                                commentsCount: postMap['comments_count'] ?? 0,
                                sharesCount: postMap['shares_count'] ?? 0,
                                isLiked: postMap['is_liked'] == 1 || postMap['is_liked'] == true,
                                isBookmarked: postMap['is_bookmarked'] == 1 || postMap['is_bookmarked'] == true,
                                isAuthorFollowing: isOwnProfile ? true : (_profileViewUserId != null), // Mock as following or similar
                                createdAt: postMap['created_at'],
                              );
                              return _buildFeedCard(
                                key: ValueKey(postObj.id),
                                post: postObj,
                                cardColor: cardColor,
                                textPrimaryColor: textPrimaryColor,
                                textSecondaryColor: textSecondaryColor,
                                borderColor: borderColor,
                              );
                            },
                          ),
                  ),

                  // Tab 2: Shorts/Reels Grid View with Pull-To-Refresh
                  RefreshIndicator(
                    onRefresh: () async {
                      await _fetchUserProfileAndPosts(targetUserId: _profileViewUserId);
                      await _fetchHomeFeed();
                    },
                    color: const Color(0xFFC13584),
                    backgroundColor: cardColor,
                    child: _profileReels.isEmpty
                        ? SingleChildScrollView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            child: Container(
                              height: 300,
                              alignment: Alignment.center,
                              child: Text(
                                "Aucune vidéo short.",
                                style: TextStyle(color: textSecondaryColor),
                              ),
                            ),
                          )
                        : GridView.builder(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.only(top: 8, bottom: 80),
                            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 3,
                              crossAxisSpacing: 8,
                              mainAxisSpacing: 8,
                              childAspectRatio: 0.75,
                            ),
                            itemCount: _profileReels.length,
                            itemBuilder: (context, index) {
                              final reel = _profileReels[index];
                              return _buildReelThumbnailCard(reel, cardColor, textPrimaryColor, textSecondaryColor, borderColor);
                            },
                          ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildReelThumbnailCard(dynamic reel, Color cardColor, Color textPrimaryColor, Color textSecondaryColor, Color borderColor) {
    final String? videoUrl = reel['video_url'];
    final String? thumbnailUrl = reel['thumbnail_url'] ?? reel['thumbnail'];
    final bool isVideo = reel['media_type'] == null || reel['media_type'] == 'video';
    final bool hasImagePreview = videoUrl != null && (videoUrl.contains('unsplash.com') || videoUrl.endsWith('.jpg') || videoUrl.endsWith('.png') || videoUrl.endsWith('.jpeg') || videoUrl.endsWith('.gif'));

    return Container(
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
        gradient: const LinearGradient(
          colors: [Color(0xFF161616), Colors.black],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (hasImagePreview)
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: CachedNetworkImage(
                imageUrl: videoUrl.startsWith('http') ? videoUrl : 'https://trasx.com$videoUrl',
                fit: BoxFit.cover,
                placeholder: (context, url) => Container(
                  color: Colors.white10,
                ),
                errorWidget: (context, url, error) => const Center(
                  child: Icon(Icons.play_arrow_rounded, color: Colors.white70, size: 32),
                ),
              ),
            )
          else if (isVideo && videoUrl != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: ReelThumbnail(
                videoUrl: videoUrl,
                thumbnailUrl: thumbnailUrl,
              ),
            )
          else if (isVideo)
            const Center(
              child: Icon(
                Icons.play_arrow_rounded,
                color: Colors.white70,
                size: 32,
              ),
            ),
          
          // Smooth Bottom Gradient Overlay
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              gradient: LinearGradient(
                colors: [Colors.transparent, Colors.black.withValues(alpha: 0.85)],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
          
          Positioned(
            bottom: 8,
            left: 8,
            right: 8,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  reel['caption'] ?? 'Sans titre',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.favorite_rounded, color: Color(0xFFE1306C), size: 10),
                    const SizedBox(width: 3),
                    Text(
                      "${reel['likes_count'] ?? 0}",
                      style: const TextStyle(color: Colors.white70, fontSize: 8),
                    ),
                    const Spacer(),
                    const Icon(Icons.play_arrow_rounded, color: Colors.white70, size: 10),
                    const SizedBox(width: 2),
                    Text(
                      "${reel['views_count'] ?? 0}",
                      style: const TextStyle(color: Colors.white70, fontSize: 8),
                    ),
                  ],
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  // 5. P2P VIEW
  Widget _buildP2PView(Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return ListView(
      padding: const EdgeInsets.all(16.0),
      children: [
        _buildSectionHeader("Trading P2P - Postes et Diamants", textPrimaryColor),
        const SizedBox(height: 12),
        _buildOfferCard("Vente Diamants", "100 💎 contre 10 USD", "Acheteur fiable uniquement", Colors.green, cardColor, textPrimaryColor, textSecondaryColor),
        _buildOfferCard("Achat Diamants", "250 💎 contre 23 USD", "Paiement rapide via Mobile Money", Colors.blue, cardColor, textPrimaryColor, textSecondaryColor),
      ],
    );
  }

  // 6. BOOKMARKS VIEW
  Widget _buildBookmarksView(Color cardColor, Color textPrimaryColor, Color textSecondaryColor, Color borderColor) {
    if (_isLoadingBookmarks && _bookmarkedPosts.isEmpty) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFFC13584)),
      );
    }

    if (_bookmarkedPosts.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          _buildSectionHeader("Vos Signets", textPrimaryColor),
          const SizedBox(height: 40),
          Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.bookmark_border_rounded, size: 64, color: textSecondaryColor.withValues(alpha: 0.4)),
                const SizedBox(height: 16),
                Text(
                  "Aucun signet enregistré",
                  style: TextStyle(color: textPrimaryColor, fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  "Les publications que vous enregistrez apparaîtront ici.",
                  style: TextStyle(color: textSecondaryColor, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16.0),
      itemCount: _bookmarkedPosts.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12.0),
            child: _buildSectionHeader("Vos Signets", textPrimaryColor),
          );
        }
        final post = _bookmarkedPosts[index - 1];
        return _buildFeedCard(
          post: post,
          cardColor: cardColor,
          textPrimaryColor: textPrimaryColor,
          textSecondaryColor: textSecondaryColor,
          borderColor: borderColor,
        );
      },
    );
  }

  // 7. GAMES VIEW
  Widget _buildGamesView(Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return ListView(
      padding: const EdgeInsets.all(16.0),
      children: [
        _buildSectionHeader("Jeux de société mondiaux", textPrimaryColor),
        const SizedBox(height: 12),
        _buildGameCard("Monopoly Classique", "Entrée : 10 diamants (Payant)", "4 joueurs en cours", true, cardColor, textPrimaryColor, textSecondaryColor),
        _buildGameCard("Échecs amical", "Entrée : Gratuit", "1 joueur en attente", false, cardColor, textPrimaryColor, textSecondaryColor),
        _buildGameCard("Ludo Pro", "Entrée : 5 diamants (Payant)", "Prêt à démarrer", true, cardColor, textPrimaryColor, textSecondaryColor),
      ],
    );
  }

  // 8. EVENTS VIEW
  Widget _buildEventsView(Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return ListView(
      padding: const EdgeInsets.all(16.0),
      children: [
        _buildSectionHeader("Lives & Événements Payants", textPrimaryColor),
        const SizedBox(height: 12),
        _buildEventCard("Live Coaching Poker", "Organisé par : Alex_Poker", "Prix ticket : 20 💎", "Démarre dans 2h", cardColor, textPrimaryColor, textSecondaryColor),
        _buildEventCard("Showmatch E-Sport Ludo", "Organisé par : TrasX_Official", "Entrée gratuite", "En direct", cardColor, textPrimaryColor, textSecondaryColor),
      ],
    );
  }

  // 9. SETTINGS VIEW
  Widget _buildSettingsView(Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return ListView(
      padding: const EdgeInsets.all(16.0),
      children: [
        _buildSectionHeader("Paramètres du compte", textPrimaryColor),
        const SizedBox(height: 12),
        _buildSettingsTile("Sécurité et Mot de passe", Icons.security_rounded, cardColor, textPrimaryColor),
        _buildSettingsTile("Gestion du Portefeuille (Wallet)", Icons.wallet_rounded, cardColor, textPrimaryColor),
        _buildSettingsTile("Langue et Préférences", Icons.language_rounded, cardColor, textPrimaryColor),
        _buildSettingsTile("Assistance client", Icons.help_outline_rounded, cardColor, textPrimaryColor),
      ],
    );
  }

  // --- REUSABLE WIDGETS ---
  Widget _buildSectionHeader(String title, Color textPrimaryColor) {
    return Text(
      title,
      style: TextStyle(color: textPrimaryColor, fontSize: 18, fontWeight: FontWeight.bold),
    );
  }

  Widget _buildFeedCard({
    Key? key,
    required Post post,
    required Color cardColor,
    required Color textPrimaryColor,
    required Color textSecondaryColor,
    required Color borderColor,
  }) {
    final bool isSelf = post.authorId == _userId || post.authorUsername == _username;
    final bool showFollowButton = !post.isAuthorFollowing && !isSelf;
    final String initial = post.authorUsername.isNotEmpty
        ? post.authorUsername[0].toUpperCase()
        : 'A';

    return FeedCard(
      key: key,
      postId: post.id,
      authorId: post.authorId,
      socket: _socket,
      isFollowing: post.isAuthorFollowing,
      showFollowButton: showFollowButton,
      currentUserId: _userId,
      currentUsername: _username,
      currentDisplayName: _displayName,
      currentUserAvatar: _avatarUrl,
      username: post.authorDisplayName,
      avatarInitial: initial,
      authorAvatarUrl: post.authorAvatar,
      postText: post.content,
      imageUrl: post.imageUrl,
      thumbnailUrl: post.thumbnailUrl,
      hashtag: post.isTrade ? '#TradingP2P' : '#TrasX',
      likes: post.likesCount,
      comments: post.commentsCount,
      initialIsLiked: post.isLiked,
      initialIsBookmarked: post.isBookmarked,
      cardColor: cardColor,
      textPrimaryColor: textPrimaryColor,
      textSecondaryColor: textSecondaryColor,
      borderColor: borderColor,
      isDarkMode: _isDarkMode,
      onAvatarTap: () {
        _navigateToUserProfile(post.authorId);
      },
      isHashtagPaid: _isHashtagPaid,
      onHashtagTap: _showHashtagModal,
      onUserProfileTap: _navigateToUserProfile,
      onPostUpdated: (updated) => _updateLocalPost(updated),
      createdAt: post.createdAt,
    );
  }

  Widget _buildMessageTile(String name, String preview, String time, Color textPrimaryColor, Color textSecondaryColor) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _isDarkMode ? const Color(0xFF0F0F0F) : const Color(0xFFF9F9F9),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _isDarkMode ? Colors.white.withValues(alpha: 0.05) : Colors.black.withValues(alpha: 0.05)),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: textPrimaryColor.withValues(alpha: 0.08),
          child: Text(name[0], style: TextStyle(color: textPrimaryColor, fontWeight: FontWeight.bold)),
        ),
        title: Text(name, style: TextStyle(color: textPrimaryColor, fontWeight: FontWeight.bold, fontSize: 14)),
        subtitle: Text(preview, style: TextStyle(color: textSecondaryColor, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: Text(time, style: TextStyle(color: textSecondaryColor.withValues(alpha: 0.5), fontSize: 10)),
      ),
    );
  }

  Widget _buildProfileStat(String label, String value, Color textPrimaryColor, Color textSecondaryColor) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: textPrimaryColor, fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(color: textSecondaryColor, fontSize: 12)),
      ],
    );
  }

  Widget _buildOfferCard(String title, String rates, String description, Color badgeColor, Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: textPrimaryColor.withValues(alpha: 0.08)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: badgeColor.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
                  child: Text(title, style: TextStyle(color: badgeColor, fontSize: 11, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(height: 8),
                Text(rates, style: TextStyle(color: textPrimaryColor, fontSize: 15, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(description, style: TextStyle(color: textSecondaryColor, fontSize: 12)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(backgroundColor: badgeColor, foregroundColor: Colors.white),
            child: const Text("Échanger"),
          )
        ],
      ),
    );
  }

  Widget _buildGameCard(String name, String fee, String players, bool isPaid, Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: textPrimaryColor.withValues(alpha: 0.08)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: textPrimaryColor.withValues(alpha: 0.04), borderRadius: BorderRadius.circular(12)),
            child: Icon(Icons.casino_rounded, color: isPaid ? const Color(0xFFE1306C) : textPrimaryColor, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: TextStyle(color: textPrimaryColor, fontWeight: FontWeight.bold, fontSize: 15)),
                const SizedBox(height: 4),
                Text(fee, style: TextStyle(color: isPaid ? const Color(0xFFF77737) : textSecondaryColor, fontSize: 12, fontWeight: isPaid ? FontWeight.bold : FontWeight.normal)),
                const SizedBox(height: 2),
                Text(players, style: TextStyle(color: textSecondaryColor.withValues(alpha: 0.6), fontSize: 11)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(
              backgroundColor: _isDarkMode ? Colors.white10 : Colors.black.withValues(alpha: 0.1),
              foregroundColor: textPrimaryColor,
            ),
            child: const Text("Jouer"),
          )
        ],
      ),
    );
  }

  Widget _buildEventCard(String title, String organizer, String price, String time, Color cardColor, Color textPrimaryColor, Color textSecondaryColor) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: textPrimaryColor.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: TextStyle(color: textPrimaryColor, fontWeight: FontWeight.bold, fontSize: 15)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFFE1306C).withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
                child: Text(price, style: const TextStyle(color: Color(0xFFE1306C), fontSize: 11, fontWeight: FontWeight.bold)),
              )
            ],
          ),
          const SizedBox(height: 6),
          Text(organizer, style: TextStyle(color: textSecondaryColor, fontSize: 12)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(time, style: const TextStyle(color: Color(0xFFFCAF45), fontSize: 12, fontWeight: FontWeight.bold)),
              ElevatedButton(
                onPressed: () {},
                style: ElevatedButton.styleFrom(
                  backgroundColor: _isDarkMode ? Colors.white : Colors.black,
                  foregroundColor: _isDarkMode ? Colors.black : Colors.white,
                ),
                child: const Text("Rejoindre"),
              )
            ],
          )
        ],
      ),
    );
  }

  Widget _buildSettingsTile(String title, IconData icon, Color cardColor, Color textPrimaryColor) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: textPrimaryColor.withValues(alpha: 0.06)),
      ),
      child: ListTile(
        leading: Icon(icon, color: textPrimaryColor.withValues(alpha: 0.8)),
        title: Text(title, style: TextStyle(color: textPrimaryColor, fontSize: 14)),
        trailing: Icon(Icons.chevron_right_rounded, color: textPrimaryColor.withValues(alpha: 0.3)),
        onTap: () {},
      ),
    );
  }

  // Dynamic Radial Glow background helper
  Widget _buildBackground({required Color bgColor, required Widget child}) {
    return Stack(
      children: [
        Container(color: bgColor),
        if (_isDarkMode) ...[
          // Top-left glow
          Positioned(
            left: -120,
            top: -120,
            child: Container(
              width: 360,
              height: 360,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFFC13584).withValues(alpha: 0.04),
              ),
            ),
          ),
          // Bottom-right glow
          Positioned(
            right: -120,
            bottom: -120,
            child: Container(
              width: 360,
              height: 360,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFFF77737).withValues(alpha: 0.03),
              ),
            ),
          ),
          Positioned.fill(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 95, sigmaY: 95),
              child: Container(color: Colors.transparent),
            ),
          ),
        ] else ...[
          // Soft warm background elements for Light Mode
          Positioned(
            left: -100,
            top: -100,
            child: Container(
              width: 320,
              height: 320,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFFC13584).withValues(alpha: 0.02),
              ),
            ),
          ),
        ],
        child,
      ],
    );
  }

  void _showHashtagModal(String hashtag) {
    final textPrimaryColor = _isDarkMode ? Colors.white : Colors.black;
    final textSecondaryColor = _isDarkMode ? Colors.white70 : Colors.black87;
    final cardColor = _isDarkMode ? const Color(0xFF0F0F0F) : const Color(0xFFF9F9F9);
    final borderColor = _isDarkMode ? Colors.white.withValues(alpha: 0.1) : Colors.black.withValues(alpha: 0.1);

    showDialog(
      context: context,
      builder: (context) {
        return HashtagModalDialog(
          hashtag: hashtag,
          socket: _socket,
          currentUserId: _userId,
          onUserProfileTap: _navigateToUserProfile,
          isDarkMode: _isDarkMode,
          textPrimaryColor: textPrimaryColor,
          textSecondaryColor: textSecondaryColor,
          cardColor: cardColor,
          borderColor: borderColor,
        );
      },
    );
  }
}

// Custom Sliver Delegate to pin the TabBar properly at the top of the NestedScrollView
class _SliverAppBarDelegate extends SliverPersistentHeaderDelegate {
  _SliverAppBarDelegate(this._tabBar, this._bgColor);

  final TabBar _tabBar;
  final Color _bgColor;

  @override
  double get minExtent => _tabBar.preferredSize.height;
  @override
  double get maxExtent => _tabBar.preferredSize.height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      color: _bgColor,
      child: _tabBar,
    );
  }

  @override
  bool shouldRebuild(_SliverAppBarDelegate oldDelegate) {
    return oldDelegate._bgColor != _bgColor;
  }
}

class ReelThumbnail extends StatefulWidget {
  final String videoUrl;
  final String? thumbnailUrl;
  const ReelThumbnail({super.key, required this.videoUrl, this.thumbnailUrl});

  @override
  State<ReelThumbnail> createState() => _ReelThumbnailState();
}

class _ReelThumbnailState extends State<ReelThumbnail> {
  VideoPlayerController? _controller;
  bool _isInitialized = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    if (widget.thumbnailUrl == null || widget.thumbnailUrl!.isEmpty) {
      _initializeVideo();
    }
  }

  void _initializeVideo() {
    final fullUrl = widget.videoUrl.startsWith('http')
        ? widget.videoUrl
        : 'https://trasx.com${widget.videoUrl.startsWith('/') ? widget.videoUrl : '/${widget.videoUrl}'}';
    _controller = VideoPlayerController.networkUrl(Uri.parse(fullUrl))
      ..initialize().then((_) {
        if (mounted) {
          setState(() {
            _isInitialized = true;
          });
        }
      }).catchError((_) {
        if (mounted) {
          setState(() {
            _hasError = true;
          });
        }
      });
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // If a static thumbnail is available, render it directly
    if (widget.thumbnailUrl != null && widget.thumbnailUrl!.isNotEmpty) {
      final fullThumbUrl = widget.thumbnailUrl!.startsWith('http')
          ? widget.thumbnailUrl!
          : 'https://trasx.com${widget.thumbnailUrl!.startsWith('/') ? widget.thumbnailUrl! : '/${widget.thumbnailUrl!}'}';
      return CachedNetworkImage(
        imageUrl: fullThumbUrl,
        fit: BoxFit.cover,
        placeholder: (_, __) => Container(color: Colors.white10),
        errorWidget: (_, __, ___) => const Center(
          child: Icon(Icons.play_arrow_rounded, color: Colors.white70, size: 32),
        ),
      );
    }

    if (_hasError) {
      return const Center(
        child: Icon(Icons.play_arrow_rounded, color: Colors.white70, size: 32),
      );
    }

    if (_controller == null || !_isInitialized) {
      return const Center(
        child: SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white30),
        ),
      );
    }
    return SizedBox.expand(
      child: FittedBox(
        fit: BoxFit.cover,
        child: SizedBox(
          width: _controller!.value.size.width,
          height: _controller!.value.size.height,
          child: VideoPlayer(_controller!),
        ),
      ),
    );
  }
}

class PostVideoPlayer extends StatefulWidget {
  final String videoUrl;
  const PostVideoPlayer({super.key, required this.videoUrl});

  @override
  State<PostVideoPlayer> createState() => _PostVideoPlayerState();
}

class _PostVideoPlayerState extends State<PostVideoPlayer> {
  late VideoPlayerController _controller;
  bool _isInitialized = false;
  double _visibleFraction = 0.0;
  bool _isPlaying = false;
  bool _isMuted = false; // Sound enabled by default (not muted)
  bool _showPlayPauseOverlay = false;

  @override
  void initState() {
    super.initState();
    final fullUrl = widget.videoUrl.startsWith('http')
        ? widget.videoUrl
        : 'https://trasx.com${widget.videoUrl.startsWith('/') ? widget.videoUrl : '/${widget.videoUrl}'}';
    _controller = VideoPlayerController.networkUrl(Uri.parse(fullUrl))
      ..setLooping(true)
      ..setVolume(_isMuted ? 0.0 : 1.0) // Enabled by default
      ..initialize().then((_) {
        if (mounted) {
          setState(() {
            _isInitialized = true;
            _isPlaying = _controller.value.isPlaying;
          });
          // Immediately play if the user already has this post in view!
          if (_visibleFraction > 0.5) {
            _controller.play();
            setState(() {
              _isPlaying = true;
            });
          }
        }
      });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _togglePlayPause() {
    if (!_isInitialized) return;
    setState(() {
      if (_controller.value.isPlaying) {
        _controller.pause();
        _isPlaying = false;
      } else {
        _controller.play();
        _isPlaying = true;
      }
      _showPlayPauseOverlay = true;
    });

    // Fade out overlay after 600ms
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() {
          _showPlayPauseOverlay = false;
        });
      }
    });
  }

  void _toggleMute() {
    if (!_isInitialized) return;
    setState(() {
      _isMuted = !_isMuted;
      _controller.setVolume(_isMuted ? 0.0 : 1.0);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_DashboardPageState.pauseAllVideos && _isPlaying && _isInitialized) {
      _controller.pause();
      _isPlaying = false;
    }

    return VisibilityDetector(
      key: Key(widget.videoUrl),
      onVisibilityChanged: (info) {
        _visibleFraction = info.visibleFraction;
        if (!mounted || !_isInitialized) return;
        if (_DashboardPageState.pauseAllVideos) {
          _controller.pause();
          setState(() {
            _isPlaying = false;
          });
          return;
        }
        if (_visibleFraction > 0.5) {
          _controller.play();
          setState(() {
            _isPlaying = true;
          });
        } else {
          _controller.pause();
          setState(() {
            _isPlaying = false;
          });
        }
      },
      child: !_isInitialized
          ? const Center(
              child: SizedBox(
                width: 30,
                height: 30,
                child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFC13584)),
              ),
            )
          : Stack(
              alignment: Alignment.center,
              children: [
                // 1. Interactive Video Tapper
                GestureDetector(
                  onTap: _togglePlayPause,
                  child: AspectRatio(
                    aspectRatio: _controller.value.aspectRatio,
                    child: VideoPlayer(_controller),
                  ),
                ),

                // 2. Play/Pause Overlay Animation (Instagram style)
                AnimatedOpacity(
                  opacity: _showPlayPauseOverlay ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 150),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: const BoxDecoration(
                      color: Colors.black54,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      _isPlaying ? CupertinoIcons.play_fill : CupertinoIcons.pause_fill,
                      color: Colors.white,
                      size: 32,
                    ),
                  ),
                ),

                // 3. Mute/Unmute Overlay Button (bottom right corner)
                Positioned(
                  bottom: 12,
                  right: 12,
                  child: GestureDetector(
                    onTap: _toggleMute,
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: const BoxDecoration(
                        color: Colors.black54,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        _isMuted ? CupertinoIcons.volume_mute : CupertinoIcons.volume_up,
                        color: Colors.white,
                        size: 16,
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class FeedCard extends StatefulWidget {
  final int postId;
  final int authorId;
  final IO.Socket? socket;
  final bool isFollowing;
  final bool showFollowButton;
  final int currentUserId;
  final String currentUsername;
  final String currentDisplayName;
  final String currentUserAvatar;

  final String username;
  final String avatarInitial;
  final String? authorAvatarUrl;
  final String postText;
  final String? imageUrl;
  final String? thumbnailUrl;
  final String hashtag;
  final int likes;
  final int comments;
  final Color cardColor;
  final Color textPrimaryColor;
  final Color textSecondaryColor;
  final Color borderColor;
  final bool isDarkMode;
  final VoidCallback onAvatarTap;
  final bool initialIsLiked;
  final bool initialIsBookmarked;
  final String? createdAt;
  // Callback when a post is updated (like/bookmark) to propagate to parent
  final void Function(Post updated)? onPostUpdated;

  final bool Function(String tag) isHashtagPaid;
  final void Function(String tag) onHashtagTap;
  final void Function(int userId) onUserProfileTap;

  const FeedCard({
    super.key,
    required this.postId,
    required this.authorId,
    this.socket,
    required this.isFollowing,
    required this.showFollowButton,
    required this.currentUserId,
    required this.currentUsername,
    required this.currentDisplayName,
    required this.currentUserAvatar,
    required this.username,
    required this.avatarInitial,
    this.authorAvatarUrl,
    required this.postText,
    this.imageUrl,
    this.thumbnailUrl,
    required this.hashtag,
    required this.likes,
    required this.comments,
    required this.cardColor,
    required this.textPrimaryColor,
    required this.textSecondaryColor,
    required this.borderColor,
    required this.isDarkMode,
    required this.onAvatarTap,
    required this.isHashtagPaid,
    required this.onHashtagTap,
    required this.onUserProfileTap,
    this.initialIsLiked = false,
    this.initialIsBookmarked = false,
    this.createdAt,
    this.onPostUpdated,
  });

  @override
  State<FeedCard> createState() => _FeedCardState();
}

class _FeedCardState extends State<FeedCard> {
  bool _isExpanded = false;
  bool _isLiked = false;
  bool _isBookmarked = false;
  late int _localCommentCount;
  late int _localLikesCount;
  bool _isFollowing = false;
  bool _isLikeInFlight = false; // prevent double-tap

  @override
  void initState() {
    super.initState();
    _localCommentCount = widget.comments;
    _localLikesCount = widget.likes;
    _isFollowing = widget.isFollowing;
    _isLiked = widget.initialIsLiked;
    _isBookmarked = widget.initialIsBookmarked;
    // NO polling timer — likes are optimistic + propagated via onPostUpdated
  }

  @override
  void didUpdateWidget(FeedCard old) {
    super.didUpdateWidget(old);
    // Sync if parent refreshed stats
    if (old.likes != widget.likes) _localLikesCount = widget.likes;
    if (old.comments != widget.comments) _localCommentCount = widget.comments;
    if (old.isFollowing != widget.isFollowing) _isFollowing = widget.isFollowing;
    if (old.initialIsLiked != widget.initialIsLiked) _isLiked = widget.initialIsLiked;
    if (old.initialIsBookmarked != widget.initialIsBookmarked) _isBookmarked = widget.initialIsBookmarked;
  }

  @override
  void dispose() {
    super.dispose();
  }

  String _formatNumber(int number) {
    if (number >= 1000000) {
      double value = number / 1000000.0;
      return '${value.toStringAsFixed(value % 1 == 0 ? 0 : 1)}M';
    } else if (number >= 1000) {
      double value = number / 1000.0;
      return '${value.toStringAsFixed(value % 1 == 0 ? 0 : 1)}k';
    }
    return number.toString();
  }

  /// Format createdAt string (ISO 8601) to human readable
  String _formatDate(String? raw) {
    if (raw == null || raw.isEmpty) return '';
    try {
      final dt = DateTime.parse(raw).toLocal();
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'À l\'instant';
      if (diff.inMinutes < 60) return 'il y a ${diff.inMinutes}min';
      if (diff.inHours < 24) return 'il y a ${diff.inHours}h';
      if (diff.inDays < 7) return 'il y a ${diff.inDays}j';
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return raw;
    }
  }

  Future<void> _toggleLike() async {
    if (_isLikeInFlight || widget.currentUserId <= 0) return;
    _isLikeInFlight = true;

    // 1. Optimistic UI update immediately
    setState(() {
      _isLiked = !_isLiked;
      _localLikesCount += _isLiked ? 1 : -1;
      if (_localLikesCount < 0) _localLikesCount = 0;
    });

    // 2. Notify parent so the cache and list get updated
    widget.onPostUpdated?.call(
      Post(
        id: widget.postId,
        authorId: widget.authorId,
        authorUsername: widget.username,
        authorDisplayName: widget.username,
        authorAvatar: widget.authorAvatarUrl,
        content: widget.postText,
        imageUrl: widget.imageUrl,
        thumbnailUrl: widget.thumbnailUrl,
        isTrade: widget.hashtag.contains('TradingP2P'),
        likesCount: _localLikesCount,
        commentsCount: _localCommentCount,
        sharesCount: 0,
        isLiked: _isLiked,
        isBookmarked: _isBookmarked,
        isAuthorFollowing: _isFollowing,
        createdAt: widget.createdAt,
      ),
    );

    // 3. Emit like event via Socket.IO
    try {
      if (widget.socket != null && widget.socket!.connected) {
        widget.socket!.emit('post-like', {
          'postId': widget.postId,
        });
      } else {
        debugPrint('Socket.IO offline, cannot sync like in real-time');
      }
    } catch (e) {
      debugPrint('Error emitting post-like: $e');
    } finally {
      _isLikeInFlight = false;
    }
  }

  Future<void> _toggleBookmark() async {
    final wasBookmarked = _isBookmarked;
    setState(() => _isBookmarked = !_isBookmarked);

    widget.onPostUpdated?.call(
      Post(
        id: widget.postId,
        authorId: widget.authorId,
        authorUsername: widget.username,
        authorDisplayName: widget.username,
        authorAvatar: widget.authorAvatarUrl,
        content: widget.postText,
        imageUrl: widget.imageUrl,
        thumbnailUrl: widget.thumbnailUrl,
        isTrade: widget.hashtag.contains('TradingP2P'),
        likesCount: _localLikesCount,
        commentsCount: _localCommentCount,
        sharesCount: 0,
        isLiked: _isLiked,
        isBookmarked: _isBookmarked,
        isAuthorFollowing: _isFollowing,
        createdAt: widget.createdAt,
      ),
    );

    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/api/posts/${widget.postId}/bookmark'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) {
        if (mounted) setState(() => _isBookmarked = wasBookmarked);
      }
    } catch (_) {
      if (mounted) setState(() => _isBookmarked = wasBookmarked);
    }
  }

  Future<void> _toggleFollow() async {
    setState(() {
      _isFollowing = true;
    });

    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/api/users/${widget.authorId}/follow'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          debugPrint('Successfully followed user ${widget.authorId}');
        } else {
          _tryAlternativeFollow();
        }
      } else {
        _tryAlternativeFollow();
      }
    } catch (e) {
      debugPrint('Error following user: $e');
      _tryAlternativeFollow();
    }
  }

  Future<void> _tryAlternativeFollow() async {
    try {
      await http.post(
        Uri.parse('https://trasx.com/api/follow'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
        body: jsonEncode({
          'followingId': widget.authorId,
          'followedId': widget.authorId,
          'user_id': widget.authorId,
        }),
      );
    } catch (e) {
      debugPrint('Error with alternative follow: $e');
    }
  }

  void _showCommentsBottomSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: widget.isDarkMode ? Colors.black : Colors.white, // Pure black/white background
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return CommentsBottomSheet(
          postId: widget.postId,
          currentUserId: widget.currentUserId,
          currentUsername: widget.currentUsername,
          currentDisplayName: widget.currentDisplayName,
          currentUserAvatar: widget.currentUserAvatar,
          textPrimaryColor: widget.textPrimaryColor,
          textSecondaryColor: widget.textSecondaryColor,
          isDarkMode: widget.isDarkMode,
          onUserProfileTap: widget.onUserProfileTap,
          socket: widget.socket,
          onCommentAdded: () {
            setState(() {
              _localCommentCount++;
            });
          },
        );
      },
    );
  }

  void _sharePost() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black54,
      builder: (context) {
        return ShareBottomSheet(
          postId: widget.postId,
          currentUserId: widget.currentUserId,
          socket: widget.socket,
          isDarkMode: widget.isDarkMode,
          postAuthorUsername: widget.username,
          textPrimaryColor: widget.textPrimaryColor,
          textSecondaryColor: widget.textSecondaryColor,
        );
      },
    );
  }

  List<InlineSpan> _buildTextSpansWithHashtags(String text, BuildContext context) {
    final List<InlineSpan> spans = [];
    final RegExp regex = RegExp(r'(#\w+)');
    final Iterable<RegExpMatch> matches = regex.allMatches(text);
    
    int start = 0;
    for (final match in matches) {
      if (match.start > start) {
        spans.add(TextSpan(text: text.substring(start, match.start)));
      }
      
      final hashtag = match.group(0)!;
      final isPaid = widget.isHashtagPaid(hashtag);
      final hashtagColor = isPaid ? const Color(0xFFFF2A54) : const Color(0xFF00B0FF);
      
      spans.add(
        TextSpan(
          text: hashtag,
          style: TextStyle(
            color: hashtagColor,
            fontStyle: FontStyle.italic,
            fontWeight: FontWeight.bold,
          ),
          recognizer: TapGestureRecognizer()
            ..onTap = () {
              widget.onHashtagTap(hashtag);
            },
        ),
      );
      start = match.end;
    }
    
    if (start < text.length) {
      spans.add(TextSpan(text: text.substring(start)));
    }
    
    return spans;
  }

  @override
  Widget build(BuildContext context) {
    // Resolve which image path to display as thumbnail (prefer webp thumbnail for videos)
    String? displayUrl;
    if (widget.thumbnailUrl != null && widget.thumbnailUrl!.isNotEmpty) {
      displayUrl = widget.thumbnailUrl;
    } else if (widget.imageUrl != null && widget.imageUrl!.isNotEmpty && !widget.imageUrl!.toLowerCase().endsWith('.mp4') && !widget.imageUrl!.toLowerCase().endsWith('.mov')) {
      displayUrl = widget.imageUrl;
    }

    final isVideo = widget.imageUrl != null && widget.imageUrl!.isNotEmpty && (widget.imageUrl!.toLowerCase().endsWith('.mp4') || widget.imageUrl!.toLowerCase().endsWith('.mov'));

    // Truncate caption if it's long and not expanded
    final bool isLongText = widget.postText.length > 80;
    final String displayText = (_isExpanded || !isLongText) 
        ? widget.postText 
        : '${widget.postText.substring(0, 80)}...';

    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      decoration: const BoxDecoration(
        color: Colors.transparent, // Direct on-page layout, no card container!
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. User Header (with horizontal padding for alignment)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
            child: Row(
              children: [
                GestureDetector(
                  onTap: widget.onAvatarTap,
                  child: _buildAvatar(),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.username,
                        style: TextStyle(color: widget.textPrimaryColor, fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        "Suggestions",
                        style: TextStyle(color: widget.textSecondaryColor, fontSize: 9),
                      ),
                    ],
                  ),
                ),
                if (widget.showFollowButton && !_isFollowing) ...[
                  ElevatedButton(
                    onPressed: _toggleFollow,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: widget.isDarkMode 
                          ? const Color(0xFF262626) 
                          : const Color(0xFFEFEFEF),
                      foregroundColor: widget.textPrimaryColor,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: const Text(
                      "Suivre",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                IconButton(
                  icon: Icon(Icons.more_vert_rounded, color: widget.textPrimaryColor, size: 20),
                  onPressed: () {},
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
          ),
          
          // 2. Media Content (100% full screen width edge-to-edge)
          if (isVideo)
            PostVideoPlayer(videoUrl: widget.imageUrl!)
          else if (displayUrl != null && displayUrl.isNotEmpty)
            CachedNetworkImage(
              imageUrl: displayUrl.startsWith('http') ? displayUrl : 'https://trasx.com${displayUrl.startsWith('/') ? displayUrl : '/$displayUrl'}',
              width: double.infinity,
              fit: BoxFit.fitWidth,
              placeholder: (context, url) => Container(
                width: double.infinity,
                height: 300,
                color: widget.isDarkMode ? const Color(0xFF121212) : const Color(0xFFFAFAFA),
              ),
              errorWidget: (context, url, error) => Container(
                color: Colors.red.withValues(alpha: 0.1),
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.broken_image_rounded, color: Colors.redAccent, size: 36),
                    const SizedBox(height: 8),
                    Text(
                      "Erreur de chargement de l'image\n($error)",
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.redAccent, fontSize: 10),
                    ),
                  ],
                ),
              ),
            )
          else
            // Gradient Box for text-only posts (edge-to-edge)
            Container(
              width: double.infinity,
              height: 240,
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0xFF833AB4), // Purple
                    Color(0xFFC13584), // Magenta
                    Color(0xFFE1306C), // Pink
                    Color(0xFFFD1D1D), // Red
                    Color(0xFFF77737), // Orange-Red
                    Color(0xFFFCAF45), // Orange-Yellow
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              alignment: Alignment.center,
              child: SingleChildScrollView(
                child: Text(
                  widget.postText,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    height: 1.4,
                  ),
                ),
              ),
            ),
          
          // 3. Actions & Caption Footer (with horizontal padding for clean align)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 10.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Horizontal actions row matching the Instagram screenshot exactly
                Row(
                  children: [
                    GestureDetector(
                      onTap: _toggleLike,
                      child: Row(
                        children: [
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 200),
                            transitionBuilder: (child, anim) => ScaleTransition(scale: anim, child: child),
                            child: Icon(
                              _isLiked ? CupertinoIcons.heart_fill : CupertinoIcons.heart,
                              key: ValueKey(_isLiked),
                              color: _isLiked ? const Color(0xFFE1306C) : widget.textPrimaryColor,
                              size: 24,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _formatNumber(_localLikesCount),
                            style: TextStyle(color: widget.textPrimaryColor, fontSize: 13, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 16),
                    
                    GestureDetector(
                      onTap: () => _showCommentsBottomSheet(context),
                      child: Row(
                        children: [
                          Icon(CupertinoIcons.chat_bubble, color: widget.textPrimaryColor, size: 22),
                          const SizedBox(width: 6),
                          Text(
                            _formatNumber(_localCommentCount),
                            style: TextStyle(color: widget.textPrimaryColor, fontSize: 13, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 16),
                    GestureDetector(
                      onTap: _sharePost,
                      child: Icon(CupertinoIcons.paperplane, color: widget.textPrimaryColor, size: 22),
                    ),
                    
                    const Spacer(),
                    GestureDetector(
                      onTap: _toggleBookmark,
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: Icon(
                          _isBookmarked ? CupertinoIcons.bookmark_fill : CupertinoIcons.bookmark,
                          key: ValueKey(_isBookmarked),
                          color: widget.textPrimaryColor,
                          size: 24,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                
                // Likes count displayed here, below the icons!
                Text(
                  "${_formatNumber(_localLikesCount)} J'aime",
                  style: TextStyle(color: widget.textPrimaryColor, fontWeight: FontWeight.bold, fontSize: 13),
                ),
                const SizedBox(height: 6),
                
                // Caption
                RichText(
                  text: TextSpan(
                    style: TextStyle(color: widget.textPrimaryColor, fontSize: 13, height: 1.4),
                    children: [
                      TextSpan(
                        text: "${widget.username} ",
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      if (displayUrl != null && displayUrl.isNotEmpty || isVideo)
                        ..._buildTextSpansWithHashtags(displayText, context),
                      if (widget.hashtag.isNotEmpty) ...[
                        const TextSpan(text: " "),
                        ..._buildTextSpansWithHashtags(widget.hashtag, context),
                      ],
                    ],
                  ),
                ),
                
                // "plus" / "moins" expansion toggle link
                if (isLongText && (displayUrl != null && displayUrl.isNotEmpty || isVideo)) ...[
                  const SizedBox(height: 2),
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _isExpanded = !_isExpanded;
                      });
                    },
                    child: Text(
                      _isExpanded ? "moins" : "plus",
                      style: TextStyle(color: widget.textSecondaryColor, fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
                
                const SizedBox(height: 6),
                GestureDetector(
                  onTap: () => _showCommentsBottomSheet(context),
                  child: Text(
                    _localCommentCount > 0
                        ? "Voir les $_localCommentCount commentaires"
                        : "Ajouter un commentaire...",
                    style: TextStyle(color: widget.textSecondaryColor, fontSize: 13, fontWeight: FontWeight.w500),
                  ),
                ),
                
                const SizedBox(height: 4),
                if (widget.createdAt != null && widget.createdAt!.isNotEmpty)
                  Text(
                    _formatDate(widget.createdAt),
                    style: TextStyle(color: widget.textSecondaryColor, fontSize: 10),
                  ),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildAvatar() {
    final String initial = widget.username.isNotEmpty ? widget.username[0].toUpperCase() : 'U';
    final url = widget.authorAvatarUrl;
    final innerGapColor = widget.isDarkMode ? Colors.black : Colors.white;

    Widget avatarContent;
    if (url != null && url.isNotEmpty) {
      final fullUrl = url.startsWith('http') ? url : 'https://trasx.com$url';
      avatarContent = CachedNetworkImage(
        imageUrl: fullUrl,
        width: 32,
        height: 32,
        fit: BoxFit.cover,
        placeholder: (context, url) => Container(
          width: 32,
          height: 32,
          color: Colors.white10,
        ),
        errorWidget: (context, url, error) => Container(
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)]),
          ),
          child: Center(
            child: Text(
              initial,
              style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
            ),
          ),
        ),
      );
    } else {
      avatarContent = Container(
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)]),
        ),
        child: Center(
          child: Text(
            initial,
            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2.0), // Instagram outer gradient ring
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [
            Color(0xFF833AB4), // Purple
            Color(0xFFC13584), // Magenta
            Color(0xFFE1306C), // Pink
            Color(0xFFF77737), // Orange
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(1.5), // Inner space (black/white liseré)
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: innerGapColor,
        ),
        child: SizedBox(
          width: 32,
          height: 32,
          child: ClipOval(
            child: avatarContent,
          ),
        ),
      ),
    );
  }
}

class ReplyThreadLine extends StatelessWidget {
  final Color color;
  const ReplyThreadLine({super.key, required this.color});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 26,
      height: 32, // align with avatar height
      child: CustomPaint(
        painter: _ThreadLinePainter(color: color),
      ),
    );
  }
}

class _ThreadLinePainter extends CustomPainter {
  final Color color;
  _ThreadLinePainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    final path = Path();
    // Start from top center (indentation), go down to middle, then turn right to the end of width
    path.moveTo(size.width / 2, 0);
    path.lineTo(size.width / 2, size.height / 2);
    path.lineTo(size.width, size.height / 2);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class CommentsBottomSheet extends StatefulWidget {
  final int postId;
  final int currentUserId;
  final String currentUsername;
  final String currentDisplayName;
  final String currentUserAvatar;
  final Color textPrimaryColor;
  final Color textSecondaryColor;
  final bool isDarkMode;
  final VoidCallback onCommentAdded;
  final void Function(int userId) onUserProfileTap;
  final IO.Socket? socket;

  const CommentsBottomSheet({
    super.key,
    required this.postId,
    required this.currentUserId,
    required this.currentUsername,
    required this.currentDisplayName,
    required this.currentUserAvatar,
    required this.textPrimaryColor,
    required this.textSecondaryColor,
    required this.isDarkMode,
    required this.onCommentAdded,
    required this.onUserProfileTap,
    this.socket,
  });

  @override
  State<CommentsBottomSheet> createState() => _CommentsBottomSheetState();
}

class _CommentsBottomSheetState extends State<CommentsBottomSheet> {
  final TextEditingController _commentController = TextEditingController();
  List<dynamic> _commentsList = [];
  bool _isLoading = false;
  Timer? _commentsPollingTimer;
  int? _replyToCommentId;
  String? _replyToUsername;
  final Set<int> _expandedCommentIds = {};

  @override
  void initState() {
    super.initState();
    _fetchComments();
    _commentsPollingTimer = Timer.periodic(const Duration(seconds: 4), (timer) {
      _pollComments();
    });

    if (widget.socket != null && widget.socket!.connected) {
      widget.socket!.emit('feed-posts-watch', {
        'postIds': [widget.postId]
      });
      widget.socket!.on('comment-liked', _onCommentLikedReceived);
      widget.socket!.on('comment-created', _onCommentCreatedReceived);
    }
  }

  @override
  void dispose() {
    if (widget.socket != null) {
      widget.socket!.off('comment-liked', _onCommentLikedReceived);
      widget.socket!.off('comment-created', _onCommentCreatedReceived);
      widget.socket!.emit('feed-posts-watch', {
        'postIds': []
      });
    }
    _commentsPollingTimer?.cancel();
    _commentController.dispose();
    super.dispose();
  }

  void _onCommentLikedReceived(dynamic data) {
    debugPrint('Socket: received comment-liked: $data');
    if (data == null || data['commentId'] == null || data['likes_count'] == null) return;
    final int? cId = int.tryParse('${data['commentId']}');
    final int? count = int.tryParse('${data['likes_count']}');
    if (cId != null && count != null) {
      if (mounted) {
        setState(() {
          final index = _commentsList.indexWhere((c) => c['id'] == cId);
          if (index != -1) {
            _commentsList[index]['likes_count'] = count;
          }
        });
      }
    }
  }

  void _onCommentCreatedReceived(dynamic data) {
    debugPrint('Socket: received comment-created: $data');
    if (data == null || data['id'] == null) return;
    final int? commentId = int.tryParse('${data['id']}');
    if (commentId == null) return;
    
    final bool exists = _commentsList.any((c) => c['id'] == commentId);
    if (exists) return;

    if (mounted) {
      setState(() {
        _commentsList.add(data);
      });
    }
  }

  String _formatCommentDate(String? createdAt) {
    if (createdAt == null || createdAt.isEmpty) return '';
    try {
      final DateTime dt = DateTime.parse(createdAt).toLocal();
      final Duration diff = DateTime.now().difference(dt);
      if (diff.inSeconds < 60) {
        return 'À l\'instant';
      } else if (diff.inMinutes < 60) {
        return '${diff.inMinutes}m';
      } else if (diff.inHours < 24) {
        return '${diff.inHours}h';
      } else if (diff.inDays < 7) {
        return '${diff.inDays}j';
      } else {
        return '${dt.day}/${dt.month}/${dt.year}';
      }
    } catch (e) {
      return '';
    }
  }

  List<Map<String, dynamic>> _buildFlattenedTree() {
    final List<Map<String, dynamic>> flatList = [];
    
    // Get all top-level comments (parent_id == null or 0)
    final topLevel = _commentsList.where((c) => c['parent_id'] == null || c['parent_id'] == 0).toList();
    
    for (var parent in topLevel) {
      flatList.add({
        'comment': parent,
        'isReply': false,
        'depth': 0,
      });
      
      final parentId = parent['id'];
      final replies = _commentsList.where((c) => c['parent_id'] == parentId).toList();
      for (var reply in replies) {
        flatList.add({
          'comment': reply,
          'isReply': true,
          'depth': 1,
        });
      }
    }
    
    return flatList;
  }

  Future<void> _fetchComments() async {
    if (widget.currentUserId <= 0) return;
    setState(() {
      _isLoading = true;
    });

    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/posts/${widget.postId}/comments'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          setState(() {
            _commentsList = data['comments'] ?? [];
          });
        }
      }
    } catch (e) {
      debugPrint('Error fetching comments: $e');
    }

    setState(() {
      _isLoading = false;
    });
  }

  Future<void> _pollComments() async {
    if (widget.currentUserId <= 0) return;
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/posts/${widget.postId}/comments'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['comments'] != null) {
          final List newComments = data['comments'];
          if (mounted) {
            setState(() {
              _commentsList = newComments;
            });
          }
        }
      }
    } catch (e) {
      debugPrint('Error polling comments in background: $e');
    }
  }

  Future<void> _postComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty) return;

    final int? parentId = _replyToCommentId;

    _commentController.clear();
    setState(() {
      _replyToCommentId = null;
      _replyToUsername = null;
    });
    FocusScope.of(context).unfocus();

    final newComment = {
      'id': DateTime.now().millisecondsSinceEpoch,
      'user_username': widget.currentUsername,
      'user_name': widget.currentDisplayName.isNotEmpty ? widget.currentDisplayName : widget.currentUsername,
      'user_avatar': widget.currentUserAvatar,
      'content': text,
      'parent_id': parentId,
      'created_at': DateTime.now().toIso8601String(),
      'likes_count': 0,
      'is_liked': 0,
    };

    setState(() {
      _commentsList.add(newComment);
    });
    widget.onCommentAdded();

    try {
      await http.post(
        Uri.parse('https://trasx.com/api/posts/${widget.postId}/comments'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
        body: jsonEncode({
          'content': text,
          'parentId': parentId,
        }),
      );
    } catch (e) {
      debugPrint('Error posting comment: $e');
    }
  }

  Widget _buildCommentLikeButton(Map<String, dynamic> comment) {
    final bool isLiked = comment['is_liked'] == 1 || comment['is_liked'] == true || comment['is_liked'] == 'true';
    final int likesCount = int.tryParse('${comment['likes_count']}') ?? 0;
    
    return Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        GestureDetector(
          onTap: () => _toggleCommentLike(comment),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
            child: Icon(
              isLiked ? CupertinoIcons.heart_fill : CupertinoIcons.heart,
              size: 14,
              color: isLiked ? const Color(0xFFFF2A54) : widget.textSecondaryColor,
            ),
          ),
        ),
        if (likesCount > 0)
          Text(
            '$likesCount',
            style: TextStyle(
              color: widget.textSecondaryColor,
              fontSize: 9,
            ),
          ),
      ],
    );
  }

  Future<void> _toggleCommentLike(Map<String, dynamic> comment) async {
    if (widget.currentUserId <= 0) return;
    
    final int commentId = comment['id'];
    final bool wasLiked = comment['is_liked'] == 1 || comment['is_liked'] == true || comment['is_liked'] == 'true';
    final int oldLikesCount = int.tryParse('${comment['likes_count']}') ?? 0;
    
    setState(() {
      comment['is_liked'] = wasLiked ? 0 : 1;
      comment['likes_count'] = wasLiked ? oldLikesCount - 1 : oldLikesCount + 1;
      if (comment['likes_count'] < 0) comment['likes_count'] = 0;
    });
    
    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/api/comments/$commentId/like'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );
      if (response.statusCode != 200) {
        setState(() {
          comment['is_liked'] = wasLiked ? 1 : 0;
          comment['likes_count'] = oldLikesCount;
        });
      }
    } catch (e) {
      debugPrint('Error liking comment: $e');
      setState(() {
        comment['is_liked'] = wasLiked ? 1 : 0;
        comment['likes_count'] = oldLikesCount;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final double keyboardHeight = MediaQuery.of(context).viewInsets.bottom;
    final flattenedComments = _buildFlattenedTree();
    
    return Container(
      height: MediaQuery.of(context).size.height * 0.7 + keyboardHeight,
      padding: EdgeInsets.only(bottom: keyboardHeight),
      child: Column(
        children: [
          // 1. Header handle (Diminished height to 3, width to 36 for premium styling)
          Container(
            width: 36,
            height: 3,
            margin: const EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(
              color: widget.textSecondaryColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(1.5),
            ),
          ),
          
          // 2. Title
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8.0),
            child: Text(
              "Commentaires (${_commentsList.length})",
              style: TextStyle(
                color: widget.textPrimaryColor,
                fontWeight: FontWeight.bold,
                fontSize: 15,
              ),
            ),
          ),
          
          Divider(height: 0.5, thickness: 0.3, color: widget.isDarkMode ? Colors.white10 : Colors.black12),
          
          // 3. Comments list
          Expanded(
            child: _isLoading && _commentsList.isEmpty
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFC13584)))
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: flattenedComments.length,
                    itemBuilder: (context, index) {
                      final item = flattenedComments[index];
                      final comment = item['comment'];
                      final bool isReply = item['isReply'];
                      
                      final authorName = comment['user_name'] ?? comment['user_username'] ?? 'Anonyme';
                      final content = comment['content'] ?? '';
                      final avatarUrl = comment['user_avatar'];
                      final dateStr = _formatCommentDate(comment['created_at']);
                      
                      final bool isLongText = content.length > 80;
                      final bool isExpanded = _expandedCommentIds.contains(comment['id']);
                      final String displayText = (isExpanded || !isLongText)
                          ? content
                          : '${content.substring(0, 80)}...';
                      
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6.0),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (isReply) ...[
                              ReplyThreadLine(color: widget.isDarkMode ? Colors.white12 : Colors.black12),
                              const SizedBox(width: 4),
                            ],
                            GestureDetector(
                              onTap: () {
                                final commUserId = int.tryParse('${comment['user_id']}') ?? 0;
                                if (commUserId > 0) {
                                  Navigator.pop(context); // close bottom sheet
                                  widget.onUserProfileTap(commUserId);
                                }
                              },
                              child: _buildCommentAvatar(authorName, avatarUrl, size: isReply ? 24 : 32),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    crossAxisAlignment: CrossAxisAlignment.baseline,
                                    textBaseline: TextBaseline.alphabetic,
                                    children: [
                                      Text(
                                        authorName,
                                        style: TextStyle(
                                          color: widget.textPrimaryColor,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        dateStr,
                                        style: TextStyle(
                                          color: widget.textSecondaryColor,
                                          fontSize: 10.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    displayText,
                                    style: TextStyle(
                                      color: widget.textPrimaryColor,
                                      fontSize: 13,
                                      height: 1.35,
                                    ),
                                  ),
                                  const SizedBox(height: 5),
                                  Row(
                                    children: [
                                      GestureDetector(
                                        onTap: () {
                                          setState(() {
                                            _replyToCommentId = comment['parent_id'] ?? comment['id'];
                                            _replyToUsername = authorName;
                                          });
                                        },
                                        child: Text(
                                          "Répondre",
                                          style: TextStyle(
                                            color: widget.textSecondaryColor,
                                            fontSize: 10.5,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                      if (isLongText) ...[
                                        const SizedBox(width: 12),
                                        GestureDetector(
                                          onTap: () {
                                            setState(() {
                                              if (isExpanded) {
                                                _expandedCommentIds.remove(comment['id']);
                                              } else {
                                                _expandedCommentIds.add(comment['id']);
                                              }
                                            });
                                          },
                                          child: Text(
                                            isExpanded ? "moins" : "plus",
                                            style: TextStyle(
                                              color: widget.textSecondaryColor,
                                              fontSize: 10.5,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            _buildCommentLikeButton(comment),
                          ],
                        ),
                      );
                    },
                  ),
          ),
          
          if (_replyToCommentId != null)
            Container(
              color: widget.isDarkMode ? Colors.white.withValues(alpha: 0.05) : Colors.black.withValues(alpha: 0.05),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Text(
                    "Réponse à @$_replyToUsername",
                    style: TextStyle(color: widget.textSecondaryColor, fontSize: 12),
                  ),
                  const Spacer(),
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _replyToCommentId = null;
                        _replyToUsername = null;
                      });
                    },
                    child: Icon(Icons.close, size: 16, color: widget.textSecondaryColor),
                  ),
                ],
              ),
            ),
          
          // Emojis quick insertion bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                '❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'
              ].map((emoji) {
                return GestureDetector(
                  onTap: () {
                    final text = _commentController.text;
                    final selection = _commentController.selection;
                    if (selection.isValid) {
                      final newText = text.replaceRange(selection.start, selection.end, emoji);
                      _commentController.value = TextEditingValue(
                        text: newText,
                        selection: TextSelection.collapsed(offset: selection.start + emoji.length),
                      );
                    } else {
                      _commentController.text = text + emoji;
                    }
                  },
                  child: Text(
                    emoji,
                    style: const TextStyle(fontSize: 22),
                  ),
                );
              }).toList(),
            ),
          ),
          
          Divider(height: 0.5, thickness: 0.3, color: widget.isDarkMode ? Colors.white10 : Colors.black12),
          
          // 4. Input text bar at bottom
          SafeArea(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(context); // close bottom sheet
                      widget.onUserProfileTap(widget.currentUserId);
                    },
                    child: _buildCommentAvatar(widget.currentUsername, widget.currentUserAvatar, size: 32),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _commentController,
                      style: TextStyle(color: widget.textPrimaryColor, fontSize: 13),
                      decoration: InputDecoration(
                        hintText: "Ajouter un commentaire...",
                        hintStyle: TextStyle(color: widget.textSecondaryColor, fontSize: 13),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(vertical: 8),
                      ),
                      onSubmitted: (_) => _postComment(),
                    ),
                  ),
                  TextButton(
                    onPressed: _postComment,
                    child: const Text(
                      "Publier",
                      style: TextStyle(
                        color: Color(0xFFC13584),
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCommentAvatar(String name, String? url, {double size = 32}) {
    final String initial = name.isNotEmpty ? name[0].toUpperCase() : 'U';
    
    Widget avatarContent;
    if (url != null && url.isNotEmpty) {
      final fullUrl = url.startsWith('http') ? url : 'https://trasx.com$url';
      avatarContent = CachedNetworkImage(
        imageUrl: fullUrl,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (context, url) => Container(color: Colors.white10),
        errorWidget: (context, url, error) => Container(
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)]),
          ),
          child: Center(
            child: Text(
              initial,
              style: TextStyle(color: Colors.white, fontSize: size * 0.38, fontWeight: FontWeight.bold),
            ),
          ),
        ),
      );
    } else {
      avatarContent = Container(
        width: size,
        height: size,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)]),
        ),
        child: Center(
          child: Text(
            initial,
            style: TextStyle(color: Colors.white, fontSize: size * 0.38, fontWeight: FontWeight.bold),
          ),
        ),
      );
    }

    final innerGapColor = widget.isDarkMode ? Colors.black : Colors.white;

    return Container(
      padding: const EdgeInsets.all(1.5), // Tiny Instagram ring
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(1.0),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: innerGapColor,
        ),
        child: SizedBox(
          width: size,
          height: size,
          child: ClipOval(
            child: avatarContent,
          ),
        ),
      ),
    );
  }
}

// ─── Status Viewer Sheet ────────────────────────────────────────────────────
class _StatusViewerSheet extends StatefulWidget {
  final List<dynamic> allGroups;
  final int initialGroupIndex;
  final bool isDarkMode;
  final int currentUserId;
  final IO.Socket? socket;

  const _StatusViewerSheet({
    required this.allGroups,
    required this.initialGroupIndex,
    required this.isDarkMode,
    required this.currentUserId,
    this.socket,
  });

  @override
  State<_StatusViewerSheet> createState() => _StatusViewerSheetState();
}

class _StatusViewerSheetState extends State<_StatusViewerSheet> with SingleTickerProviderStateMixin {
  late int _currentGroupIndex;
  late List<dynamic> _currentStatuses;
  int _currentIndex = 0;
  late AnimationController _progressController;
  VideoPlayerController? _videoController;
  final TextEditingController _commentController = TextEditingController();
  bool _isPopped = false;
  int? _previousStatusId;

  static const Duration _storyDuration = Duration(seconds: 5);

  // Status statistics state
  int _localViewsCount = 0;
  List<dynamic> _statusComments = [];
  List<dynamic> _statusViewers = [];

  @override
  void initState() {
    super.initState();
    _currentGroupIndex = widget.initialGroupIndex;
    _currentStatuses = widget.allGroups[_currentGroupIndex]['statuses'] ?? [];
    _progressController = AnimationController(vsync: this, duration: _storyDuration);
    _progressController.addStatusListener(_onProgressComplete);
    
    if (widget.socket != null && widget.socket!.connected) {
      widget.socket!.on('status-viewed', _onStatusViewedReceived);
      widget.socket!.on('status-comment-created', _onStatusCommentCreatedReceived);
      widget.socket!.on('status-comment-created-owner', _onStatusCommentCreatedReceived);
    }
    
    _initCurrentStatus();
  }

  @override
  void dispose() {
    if (widget.socket != null) {
      widget.socket!.off('status-viewed', _onStatusViewedReceived);
      widget.socket!.off('status-comment-created', _onStatusCommentCreatedReceived);
      widget.socket!.off('status-comment-created-owner', _onStatusCommentCreatedReceived);
      if (_previousStatusId != null) {
        widget.socket!.emit('leave', 'status:$_previousStatusId');
      }
    }
    _progressController.dispose();
    _videoController?.dispose();
    _commentController.dispose();
    super.dispose();
  }

  void _onStatusViewedReceived(dynamic data) {
    if (data == null) return;
    final int? viewStatusId = int.tryParse('${data['statusId']}');
    if (viewStatusId == null) return;

    if (_currentStatuses.isNotEmpty && _currentIndex < _currentStatuses.length) {
      final currentStatus = _currentStatuses[_currentIndex];
      if (currentStatus['id'] == viewStatusId) {
        _loadStatusStats();
      }
    }
  }

  void _onStatusCommentCreatedReceived(dynamic data) {
    if (data == null) return;
    int? commentStatusId;
    if (data['statusId'] != null) {
      commentStatusId = int.tryParse('${data['statusId']}');
    } else if (data['status_id'] != null) {
      commentStatusId = int.tryParse('${data['status_id']}');
    }
    if (commentStatusId == null) return;

    if (_currentStatuses.isNotEmpty && _currentIndex < _currentStatuses.length) {
      final currentStatus = _currentStatuses[_currentIndex];
      if (currentStatus['id'] == commentStatusId) {
        _loadStatusStats();
      }
    }
  }

  void _initCurrentStatus() {
    _videoController?.dispose();
    _videoController = null;
    _progressController.reset();

    if (_currentStatuses.isEmpty) {
      _nextGroupOrPop();
      return;
    }

    final status = _currentStatuses[_currentIndex];
    final mediaType = status['media_type'] ?? '';

    // Join status room
    if (widget.socket != null && widget.socket!.connected) {
      if (_previousStatusId != null) {
        widget.socket!.emit('leave', 'status:$_previousStatusId');
      }
      widget.socket!.emit('join', 'status:${status['id']}');
      _previousStatusId = status['id'];
    }

    if (mediaType.startsWith('video/') || mediaType.startsWith('audio/')) {
      final url = _resolveUrl(status['media_url'] ?? '');
      _videoController = VideoPlayerController.networkUrl(Uri.parse(url))
        ..initialize().then((_) {
          if (mounted) {
            setState(() {});
            _videoController!.play();
            _progressController.duration = _videoController!.value.duration;
            _progressController.forward();
            if (mediaType.startsWith('audio/')) {
              _videoController!.addListener(_onAudioPositionChanged);
            }
          }
        });
    } else {
      _progressController.duration = _storyDuration;
      _progressController.forward();
    }

    // Record view
    _recordView(status['id']);

    // Load views and comments
    _loadStatusStats();
  }

  Future<void> _loadStatusStats() async {
    if (_currentStatuses.isEmpty) return;
    final status = _currentStatuses[_currentIndex];
    final statusId = status['id'];
    if (statusId == null) return;

    try {
      // 1. Fetch comments
      final commentsResponse = await http.get(
        Uri.parse('https://trasx.com/status/comments/$statusId'),
        headers: {'x-user-id': '${widget.currentUserId}'},
      );
      if (commentsResponse.statusCode == 200) {
        final data = jsonDecode(commentsResponse.body);
        if (data['success'] == true && mounted) {
          setState(() {
            _statusComments = data['comments'] ?? [];
          });
        }
      }

      // 2. Fetch viewers
      final viewersResponse = await http.get(
        Uri.parse('https://trasx.com/status/viewers/$statusId'),
        headers: {'x-user-id': '${widget.currentUserId}'},
      );
      if (viewersResponse.statusCode == 200) {
        final data = jsonDecode(viewersResponse.body);
        if (data['success'] == true && mounted) {
          setState(() {
            _statusViewers = data['viewers'] ?? [];
            _localViewsCount = _statusViewers.length;
          });
        }
      }
    } catch (e) {
      debugPrint('Error loading status stats: $e');
    }
  }

  void _onProgressComplete(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      _next();
    }
  }

  void _onAudioPositionChanged() {
    if (mounted && _videoController != null) {
      setState(() {});
    }
  }

  void _nextGroupOrPop() {
    if (_currentGroupIndex < widget.allGroups.length - 1) {
      setState(() {
        _currentGroupIndex++;
        _currentIndex = 0;
        _currentStatuses = widget.allGroups[_currentGroupIndex]['statuses'] ?? [];
      });
      _initCurrentStatus();
    } else {
      if (!_isPopped && mounted) {
        _isPopped = true;
        Navigator.pop(context);
      }
    }
  }

  void _prevGroupOrPop() {
    if (_currentGroupIndex > 0) {
      setState(() {
        _currentGroupIndex--;
        _currentStatuses = widget.allGroups[_currentGroupIndex]['statuses'] ?? [];
        _currentIndex = _currentStatuses.length - 1;
      });
      _initCurrentStatus();
    }
  }

  void _next() {
    if (_currentIndex < _currentStatuses.length - 1) {
      setState(() {
        _currentIndex++;
      });
      _initCurrentStatus();
    } else {
      _nextGroupOrPop();
    }
  }

  void _prev() {
    if (_currentIndex > 0) {
      setState(() {
        _currentIndex--;
      });
      _initCurrentStatus();
    } else {
      _prevGroupOrPop();
    }
  }

  String _resolveUrl(String url) {
    if (url.startsWith('http')) return url;
    return 'https://trasx.com$url';
  }

  Future<void> _recordView(dynamic statusId) async {
    try {
      await http.post(
        Uri.parse('https://trasx.com/status/view/$statusId'),
        headers: {'x-user-id': '${widget.currentUserId}'},
      );
    } catch (_) {}
  }

  Future<bool> _submitCommentToAPI(String content) async {
    if (_currentStatuses.isEmpty) return false;
    final status = _currentStatuses[_currentIndex];
    final statusId = status['id'];
    if (statusId == null) return false;
    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/status/comment/$statusId'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
        body: jsonEncode({'content': content}),
      );
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<void> _postComment(String text) async {
    if (text.trim().isEmpty) return;
    final success = await _submitCommentToAPI(text);
    if (success) {
      _commentController.clear();
      FocusScope.of(context).unfocus();
      _loadStatusStats();
      // Resume story animation
      _progressController.forward();
      _videoController?.play();
    }
  }

  void _showViewersSheet() {
    _progressController.stop();
    _videoController?.pause();

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black45,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) {
        return ClipRRect(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
            child: Container(
              height: MediaQuery.of(context).size.height * 0.5,
              decoration: BoxDecoration(
                color: widget.isDarkMode ? const Color(0xE6121212) : Colors.white.withAlpha(235),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                border: Border.all(color: widget.isDarkMode ? Colors.white12 : Colors.black12, width: 0.5),
              ),
              child: SafeArea(
                child: Column(
                  children: [
                    // Premium Handle
                    Container(
                      width: 40, height: 4,
                      margin: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: widget.isDarkMode ? Colors.white24 : Colors.black26,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12.0),
                      child: Text(
                        'Spectateurs',
                        style: TextStyle(
                          color: widget.isDarkMode ? Colors.white : Colors.black,
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          letterSpacing: 0.3,
                        ),
                      ),
                    ),
                    Divider(color: widget.isDarkMode ? Colors.white10 : Colors.black12, height: 1),
                    Expanded(
                      child: _statusViewers.isEmpty
                          ? Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.remove_red_eye_outlined, color: widget.isDarkMode ? Colors.white30 : Colors.black26, size: 36),
                                  const SizedBox(height: 8),
                                  const Text('Aucune vue pour l\'instant', style: TextStyle(color: Colors.white54, fontSize: 13)),
                                ],
                              ),
                            )
                          : ListView.builder(
                              itemCount: _statusViewers.length,
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              itemBuilder: (context, index) {
                                final v = _statusViewers[index];
                                final name = v['user_name'] ?? v['username'] ?? '?';
                                final avatar = v['avatar'] as String?;
                                return ListTile(
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                                  leading: CircleAvatar(
                                    radius: 20,
                                    backgroundImage: avatar != null && avatar.isNotEmpty ? NetworkImage(_resolveUrl(avatar)) : null,
                                    child: (avatar == null || avatar.isEmpty) ? Text(name[0].toUpperCase()) : null,
                                  ),
                                  title: Text(
                                    name,
                                    style: TextStyle(
                                      color: widget.isDarkMode ? Colors.white : Colors.black,
                                      fontWeight: FontWeight.w600,
                                      fontSize: 14,
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    ).then((_) {
      _progressController.forward();
      _videoController?.play();
    });
  }

  void _showCommentsSheet() {
    _progressController.stop();
    _videoController?.pause();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black45,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) {
        final double bottomPadding = MediaQuery.of(ctx).viewInsets.bottom + MediaQuery.of(ctx).padding.bottom;
        return StatefulBuilder(builder: (ctx, setCommentState) {
          return ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
              child: Container(
                height: MediaQuery.of(ctx).size.height * 0.65,
                decoration: BoxDecoration(
                  color: widget.isDarkMode ? const Color(0xE6121212) : Colors.white.withAlpha(235),
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                  border: Border.all(color: widget.isDarkMode ? Colors.white12 : Colors.black12, width: 0.5),
                ),
                padding: EdgeInsets.only(bottom: bottomPadding),
                child: Column(
                  children: [
                    // Premium Handle
                    Container(
                      width: 40, height: 4,
                      margin: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: widget.isDarkMode ? Colors.white24 : Colors.black26,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8.0),
                      child: Text(
                        'Commentaires',
                        style: TextStyle(
                          color: widget.isDarkMode ? Colors.white : Colors.black,
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          letterSpacing: 0.3,
                        ),
                      ),
                    ),
                    Divider(color: widget.isDarkMode ? Colors.white10 : Colors.black12, height: 1),
                    Expanded(
                      child: _statusComments.isEmpty
                          ? Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.comment_outlined, color: widget.isDarkMode ? Colors.white30 : Colors.black26, size: 36),
                                  const SizedBox(height: 8),
                                  const Text('Aucun commentaire pour l\'instant', style: TextStyle(color: Colors.white54, fontSize: 13)),
                                ],
                              ),
                            )
                          : ListView.builder(
                              itemCount: _statusComments.length,
                              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                              itemBuilder: (context, index) {
                                final c = _statusComments[index];
                                final name = c['user_name'] ?? c['username'] ?? '?';
                                final avatar = c['avatar'] as String?;
                                final content = c['content'] ?? '';
                                return Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 6.0),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      CircleAvatar(
                                        radius: 16,
                                        backgroundImage: avatar != null && avatar.isNotEmpty ? NetworkImage(_resolveUrl(avatar)) : null,
                                        child: (avatar == null || avatar.isEmpty) ? Text(name[0].toUpperCase(), style: const TextStyle(fontSize: 10)) : null,
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                          decoration: BoxDecoration(
                                            color: widget.isDarkMode ? Colors.white.withAlpha(12) : Colors.black.withAlpha(12),
                                            borderRadius: const BorderRadius.only(
                                              topRight: Radius.circular(16),
                                              bottomLeft: Radius.circular(16),
                                              bottomRight: Radius.circular(16),
                                            ),
                                          ),
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                name,
                                                style: TextStyle(
                                                  color: widget.isDarkMode ? Colors.white : Colors.black,
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 12,
                                                ),
                                              ),
                                              const SizedBox(height: 4),
                                              Text(
                                                content,
                                                style: TextStyle(
                                                  color: widget.isDarkMode ? Colors.white70 : Colors.black87,
                                                  fontSize: 13,
                                                  height: 1.3,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                    ),
                    // Refined Chat-like Input Field
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                        border: Border(top: BorderSide(color: widget.isDarkMode ? Colors.white12 : Colors.black12, width: 0.5)),
                        color: widget.isDarkMode ? const Color(0xFF161616) : Colors.white,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Container(
                              height: 40,
                              decoration: BoxDecoration(
                                color: widget.isDarkMode ? Colors.white.withAlpha(12) : Colors.black.withAlpha(8),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              padding: const EdgeInsets.symmetric(horizontal: 16),
                              alignment: Alignment.centerLeft,
                              child: TextField(
                                controller: _commentController,
                                style: TextStyle(color: widget.isDarkMode ? Colors.white : Colors.black, fontSize: 14),
                                decoration: const InputDecoration(
                                  hintText: 'Ajouter un commentaire...',
                                  hintStyle: TextStyle(color: Colors.white54, fontSize: 13),
                                  border: InputBorder.none,
                                  isDense: true,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          GestureDetector(
                            onTap: () async {
                              final text = _commentController.text.trim();
                              if (text.isEmpty) return;

                              final success = await _submitCommentToAPI(text);
                              if (success) {
                                _commentController.clear();
                                await _loadStatusStats();
                                setCommentState(() {});
                              }
                            },
                            child: Container(
                              width: 36,
                              height: 36,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: Color(0xFFC13584),
                              ),
                              child: const Icon(Icons.send_rounded, color: Colors.white, size: 16),
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
        });
      },
    ).then((_) {
      _progressController.forward();
      _videoController?.play();
    });
  }

  Widget _buildBottomControls(dynamic status) {
    final bool isOwn = (status['user_id'] as num?)?.toInt() == widget.currentUserId;

    if (isOwn) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Viewers
          GestureDetector(
            onTap: _showViewersSheet,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.black54,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                children: [
                  const Icon(Icons.remove_red_eye_outlined, color: Colors.white, size: 16),
                  const SizedBox(width: 6),
                  Text(
                    '$_localViewsCount vue${_localViewsCount > 1 ? 's' : ''}',
                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
          ),
          // Comments
          GestureDetector(
            onTap: _showCommentsSheet,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.black54,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                children: [
                  const Icon(Icons.comment_outlined, color: Colors.white, size: 16),
                  const SizedBox(width: 6),
                  Text(
                    '${_statusComments.length} commentaire${_statusComments.length > 1 ? 's' : ''}',
                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    } else {
      // Reply input field for other users
      return Row(
        children: [
          Expanded(
            child: Container(
              height: 44,
              decoration: BoxDecoration(
                color: Colors.black54,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: Colors.white24, width: 0.8),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.centerLeft,
              child: TextField(
                controller: _commentController,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: const InputDecoration(
                  hintText: 'Répondre...',
                  hintStyle: TextStyle(color: Colors.white54, fontSize: 14),
                  border: InputBorder.none,
                  isDense: true,
                ),
                onTap: () {
                  _progressController.stop();
                  _videoController?.pause();
                },
                onSubmitted: (val) {
                  _postComment(val);
                },
              ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: () => _postComment(_commentController.text),
            child: Container(
              height: 44,
              width: 44,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0xFFC13584),
              ),
              child: const Icon(CupertinoIcons.paperplane_fill, color: Colors.white, size: 16),
            ),
          ),
        ],
      );
    }
  }

  void _pauseStory() {
    _progressController.stop();
    _videoController?.pause();
  }

  void _resumeStory() {
    _progressController.forward();
    _videoController?.play();
  }

  @override
  Widget build(BuildContext context) {
    if (_currentStatuses.isEmpty) {
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(child: CircularProgressIndicator(color: Color(0xFFC13584))),
      );
    }

    final status = _currentStatuses[_currentIndex];
    final mediaType = status['media_type'] ?? '';
    final mediaUrl = status['media_url'] ?? '';
    final caption = status['caption'] as String? ?? '';
    final bgColor = status['bg_color'] as String?;

    final group = widget.allGroups[_currentGroupIndex];
    final userName = group['user_name'] ?? group['username'] ?? '?';
    final avatarUrl = group['avatar'] as String?;
    final remainingText = status['remaining_text'] ?? '';

    return Stack(
      fit: StackFit.expand,
      children: [
        // ── Background / Media ────────────────────────────────────────
        _buildMediaBackground(mediaType, mediaUrl, bgColor, caption),

        // ── Tap zones (déclarées à l'arrière-plan du header/clavier) ──
        Positioned.fill(
          child: Row(
            children: [
              Expanded(
                child: GestureDetector(
                  onTap: _prev,
                  onLongPress: _pauseStory,
                  onLongPressUp: _resumeStory,
                  behavior: HitTestBehavior.translucent,
                ),
              ),
              Expanded(
                child: GestureDetector(
                  onTap: _next,
                  onLongPress: _pauseStory,
                  onLongPressUp: _resumeStory,
                  behavior: HitTestBehavior.translucent,
                ),
              ),
            ],
          ),
        ),

        // ── Progress bar ──────────────────────────────────────────────
        Positioned(
          top: 24, // pushed down slightly for fullscreen look
          left: 10,
          right: 10,
          child: Row(
            children: List.generate(_currentStatuses.length, (i) {
              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: i < _currentIndex
                        ? Container(height: 2, color: Colors.white)
                        : i == _currentIndex
                            ? AnimatedBuilder(
                                animation: _progressController,
                                builder: (_, __) => LinearProgressIndicator(
                                  value: _progressController.value,
                                  backgroundColor: Colors.white38,
                                  valueColor: const AlwaysStoppedAnimation(Colors.white),
                                  minHeight: 2,
                                ),
                              )
                            : Container(height: 2, color: Colors.white38),
                  ),
                ),
              );
            }),
          ),
        ),

        // ── Header: avatar + name + timer + close ──────────────────────
        Positioned(
          top: 36, // pushed down slightly for fullscreen look
          left: 12,
          right: 12,
          child: Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundImage: avatarUrl != null && avatarUrl.isNotEmpty
                    ? NetworkImage(_resolveUrl(avatarUrl)) as ImageProvider
                    : null,
                backgroundColor: const Color(0xFF833AB4),
                child: (avatarUrl == null || avatarUrl.isEmpty)
                    ? Text(userName[0].toUpperCase(), style: const TextStyle(color: Colors.white))
                    : null,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      userName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        shadows: [Shadow(blurRadius: 4, color: Colors.black45)],
                      ),
                    ),
                    if (remainingText.isNotEmpty)
                      Text(
                        'Expire dans $remainingText',
                        style: const TextStyle(color: Colors.white70, fontSize: 10),
                      ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () {
                  if (!_isPopped && mounted) {
                    _isPopped = true;
                    Navigator.pop(context);
                  }
                },
                child: const Icon(Icons.close, color: Colors.white, size: 22),
              ),
            ],
          ),
        ),

            // ── Caption overlay (if media) ─────────────────────────────────
            if (caption.isNotEmpty && mediaType != 'text')
              Positioned(
                bottom: MediaQuery.of(context).viewInsets.bottom + 80 + MediaQuery.of(context).padding.bottom,
                left: 20,
                right: 20,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: Colors.black45,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    caption,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      height: 1.4,
                    ),
                  ),
                ),
              ),

            // ── Bottom controls (Vues, Commentaires, Répondre) ─────────────
            Positioned(
              bottom: MediaQuery.of(context).viewInsets.bottom + MediaQuery.of(context).padding.bottom + 16,
              left: 16,
              right: 16,
              child: _buildBottomControls(status),
            ),
      ],
    );
  }

  Widget _buildMediaBackground(String mediaType, String mediaUrl, String? bgColor, String caption) {
    if (mediaType == 'text') {
      Color bg = const Color(0xFF833AB4);
      if (bgColor != null && bgColor.startsWith('#')) {
        try { bg = Color(int.parse(bgColor.replaceFirst('#', '0xFF'))); } catch (_) {}
      }
      return Container(
        color: bg,
        alignment: Alignment.center,
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Text(
            caption,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 26,
              fontWeight: FontWeight.bold,
              shadows: [Shadow(blurRadius: 8, color: Colors.black26)],
            ),
          ),
        ),
      );
    }

    if (mediaType.startsWith('audio/')) {
      final isPlaying = _videoController != null && _videoController!.value.isPlaying;
      final currentPos = _videoController?.value.position ?? Duration.zero;
      final totalDuration = _videoController?.value.duration ?? Duration.zero;

      String formatDuration(Duration duration) {
        String twoDigits(int n) => n.toString().padLeft(2, '0');
        final minutes = twoDigits(duration.inMinutes.remainder(60));
        final seconds = twoDigits(duration.inSeconds.remainder(60));
        return '$minutes:$seconds';
      }

      return Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topRight,
            end: Alignment.bottomLeft,
            colors: [
              Color(0xFF0F2027),
              Color(0xFF203A43),
              Color(0xFF2C5364),
            ],
          ),
        ),
        alignment: Alignment.center,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              alignment: Alignment.center,
              children: [
                Container(
                  width: 140,
                  height: 140,
                  decoration: BoxDecoration(
                    color: const Color(0xFFC13584).withOpacity(0.1),
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFC13584).withOpacity(0.3), width: 2),
                  ),
                ),
                Container(
                  width: 110,
                  height: 110,
                  decoration: BoxDecoration(
                    color: const Color(0xFFC13584).withOpacity(0.15),
                    shape: BoxShape.circle,
                  ),
                ),
                GestureDetector(
                  onTap: () {
                    if (_videoController != null) {
                      if (_videoController!.value.isPlaying) {
                        _videoController!.pause();
                        _progressController.stop();
                      } else {
                        _videoController!.play();
                        _progressController.forward();
                      }
                      setState(() {});
                    }
                  },
                  child: Container(
                    width: 80,
                    height: 80,
                    decoration: const BoxDecoration(
                      color: Color(0xFFC13584),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Color(0xFFC13584),
                          blurRadius: 15,
                          offset: Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Icon(
                      isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                      color: Colors.white,
                      size: 44,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 35),
            Container(
              height: 54, // Stricte hauteur fixe pour éviter le jiggling de toute la page
              padding: const EdgeInsets.symmetric(horizontal: 24),
              decoration: BoxDecoration(
                color: Colors.black26,
                borderRadius: BorderRadius.circular(30),
                border: Border.all(color: Colors.white10, width: 0.5),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  const Icon(Icons.mic_rounded, color: Color(0xFFC13584), size: 20),
                  const SizedBox(width: 12),
                  SizedBox(
                    height: 30, // Hauteur fixe pour le conteneur interne de waves
                    child: _AudioWaveformsWidget(isPlaying: isPlaying),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 15),
            SizedBox(
              height: 20, // Hauteur fixe pour le conteneur du texte de la durée
              child: Center(
                child: Text(
                  '${formatDuration(currentPos)} / ${formatDuration(totalDuration)}',
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.7),
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.2,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 30),
            if (caption.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32.0),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.06),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white.withOpacity(0.08), width: 0.8),
                  ),
                  child: Text(
                    caption,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      );
    }

    if (mediaType.startsWith('video/')) {
      if (_videoController != null && _videoController!.value.isInitialized) {
        return FittedBox(
          fit: BoxFit.cover,
          child: SizedBox(
            width: _videoController!.value.size.width,
            height: _videoController!.value.size.height,
            child: VideoPlayer(_videoController!),
          ),
        );
      }
      return const ColoredBox(
        color: Colors.black,
        child: Center(child: CircularProgressIndicator(color: Color(0xFFC13584))),
      );
    }

    // Image
    if (mediaUrl.isNotEmpty && mediaUrl != 'text') {
      final fullUrl = mediaUrl.startsWith('http') ? mediaUrl : 'https://trasx.com$mediaUrl';
      return CachedNetworkImage(
        imageUrl: fullUrl,
        fit: BoxFit.cover,
        placeholder: (_, __) => const ColoredBox(
          color: Colors.black,
          child: Center(child: CircularProgressIndicator(color: Color(0xFFC13584))),
        ),
        errorWidget: (_, __, ___) => const ColoredBox(
          color: Colors.black54,
          child: Icon(Icons.broken_image, color: Colors.white54, size: 60),
        ),
      );
    }

    return Container(color: Colors.black);
  }
}

class _StatusRingPainter extends CustomPainter {
  final int statusCount;
  final List<Color> colors;
  final bool hasUnviewed;

  _StatusRingPainter({
    required this.statusCount,
    required this.colors,
    required this.hasUnviewed,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (statusCount <= 0) return;

    final double strokeWidth = 3.0;
    final Rect rect = Rect.fromLTWH(
      strokeWidth / 2,
      strokeWidth / 2,
      size.width - strokeWidth,
      size.height - strokeWidth,
    );

    final Paint paint = Paint()
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    if (!hasUnviewed) {
      paint.color = Colors.grey.withAlpha(100);
      if (statusCount == 1) {
        canvas.drawOval(rect, paint);
      } else {
        final double spaceAngle = 6.0;
        final double arcLength = (360.0 / statusCount) - spaceAngle;
        for (int i = 0; i < statusCount; i++) {
          final double startAngle = (i * (360.0 / statusCount)) - 90.0;
          canvas.drawArc(rect, _radians(startAngle), _radians(arcLength), false, paint);
        }
      }
      return;
    }

    final SweepGradient gradient = SweepGradient(
      colors: colors,
      startAngle: 0.0,
      endAngle: 2 * pi,
    );
    paint.shader = gradient.createShader(rect);

    if (statusCount == 1) {
      canvas.drawOval(rect, paint);
    } else {
      final double spaceAngle = 6.0;
      final double arcLength = (360.0 / statusCount) - spaceAngle;
      for (int i = 0; i < statusCount; i++) {
        final double startAngle = (i * (360.0 / statusCount)) - 90.0;
        canvas.drawArc(rect, _radians(startAngle), _radians(arcLength), false, paint);
      }
    }
  }

  double _radians(double degrees) {
    return degrees * pi / 180.0;
  }

  @override
  bool shouldRepaint(covariant _StatusRingPainter oldDelegate) {
    return oldDelegate.statusCount != statusCount ||
        oldDelegate.hasUnviewed != hasUnviewed ||
        oldDelegate.colors != colors;
  }
}

class _AudioWaveformsWidget extends StatefulWidget {
  final bool isPlaying;

  const _AudioWaveformsWidget({required this.isPlaying});

  @override
  State<_AudioWaveformsWidget> createState() => _AudioWaveformsWidgetState();
}

class _AudioWaveformsWidgetState extends State<_AudioWaveformsWidget> with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  final List<double> _baseHeights = [
    8, 16, 12, 22, 10, 18, 28, 16, 11, 20, 16, 12, 24, 14, 10, 20, 26, 16, 12, 18, 8, 16, 12, 22, 10
  ];

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    if (widget.isPlaying) {
      _animationController.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant _AudioWaveformsWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isPlaying != oldWidget.isPlaying) {
      if (widget.isPlaying) {
        _animationController.repeat();
      } else {
        _animationController.stop();
      }
    }
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animationController,
      builder: (context, child) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: List.generate(_baseHeights.length, (index) {
            double factor = 1.0;
            if (widget.isPlaying) {
              final wave = sin((_animationController.value * 2 * pi) + (index * 0.8));
              factor = 0.3 + (wave.abs() * 0.7);
            }
            final height = _baseHeights[index] * factor;
            
            // Simuler la progression de lecture sur les barres
            final double progression = index / _baseHeights.length;
            // Pour l'instant on garde une couleur constante ou progressive
            final Color color = widget.isPlaying 
                ? const Color(0xFFC13584).withOpacity(0.5 + (1 - progression) * 0.5)
                : Colors.white38;

            return Container(
              width: 3.0,
              height: height,
              margin: const EdgeInsets.symmetric(horizontal: 1.2),
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(1.5),
              ),
            );
          }),
        );
      },
    );
  }
}

class HashtagModalDialog extends StatefulWidget {
  final String hashtag;
  final IO.Socket? socket;
  final int currentUserId;
  final void Function(int userId) onUserProfileTap;
  final bool isDarkMode;
  final Color textPrimaryColor;
  final Color textSecondaryColor;
  final Color cardColor;
  final Color borderColor;

  const HashtagModalDialog({
    super.key,
    required this.hashtag,
    this.socket,
    required this.currentUserId,
    required this.onUserProfileTap,
    required this.isDarkMode,
    required this.textPrimaryColor,
    required this.textSecondaryColor,
    required this.cardColor,
    required this.borderColor,
  });

  @override
  State<HashtagModalDialog> createState() => _HashtagModalDialogState();
}

class _HashtagModalDialogState extends State<HashtagModalDialog> {
  bool _isLoading = true;
  String? _errorMessage;
  
  // Hashtag Info
  String _name = '';
  int _creatorId = 0;
  bool _isPaid = false;
  double _price = 0.0;
  int _usageCount = 0;
  String _creatorUsername = '';
  String _creatorDisplayName = '';
  String _creatorAvatar = '';
  List<dynamic> _usedBy = [];

  @override
  void initState() {
    super.initState();
    _name = widget.hashtag.replaceAll('#', '');
    _fetchHashtagDetails();
    _setupSocketListener();
  }

  @override
  void dispose() {
    _cleanupSocketListener();
    super.dispose();
  }

  void _setupSocketListener() {
    if (widget.socket != null) {
      widget.socket!.on('post-created', _onPostCreated);
    }
  }

  void _cleanupSocketListener() {
    if (widget.socket != null) {
      widget.socket!.off('post-created', _onPostCreated);
    }
  }

  void _onPostCreated(dynamic data) {
    if (data == null || data['content'] == null) return;
    final String content = data['content'] as String;
    final String hashtagLower = _name.toLowerCase();

    // Regex to match hashtag usage
    final RegExp regex = RegExp('(^|[^a-z0-9_])#$hashtagLower([^a-z0-9_]|\$)', caseSensitive: false);
    if (regex.hasMatch(content)) {
      if (mounted) {
        setState(() {
          _usageCount += 1;
          
          final authorId = data['author_id'] ?? data['user_id'];
          if (authorId != null) {
            final authorUsername = data['author_username'] ?? data['username'] ?? 'User';
            final authorDisplayName = data['author_display_name'] ?? data['display_name'] ?? authorUsername;
            final authorAvatar = data['author_avatar'] ?? data['avatar'] ?? '';
            
            final userObj = {
              'id': authorId,
              'username': authorUsername,
              'first_name': authorDisplayName,
              'last_name': '',
              'avatar': authorAvatar,
            };

            // Check if user already in list
            bool exists = false;
            for (var u in _usedBy) {
              if (u['id'] == authorId) {
                exists = true;
                break;
              }
            }
            if (!exists) {
              _usedBy.insert(0, userObj);
            }
          }
        });
      }
    }
  }

  Future<void> _fetchHashtagDetails() async {
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/hashtags/check?name=${Uri.encodeComponent(_name)}'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (mounted) {
          setState(() {
            _isPaid = data['is_paid'] == 1 || data['is_paid'] == true || data['is_paid'] == 'true';
            _price = double.tryParse('${data['price']}') ?? 0.0;
            _usageCount = int.tryParse('${data['usage_count']}') ?? 0;
            _creatorId = int.tryParse('${data['creator_id']}') ?? 0;
            _creatorUsername = data['username'] ?? 'admin';
            _creatorDisplayName = data['first_name'] != null 
                ? '${data['first_name']} ${data['last_name'] ?? ""}'.trim()
                : _creatorUsername;
            _creatorAvatar = data['avatar'] ?? '';
            _usedBy = data['used_by'] ?? [];
            _isLoading = false;
          });
        }
      } else {
        if (mounted) {
          setState(() {
            _errorMessage = 'Impossible de charger les infos du hashtag';
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Erreur réseau : $e';
          _isLoading = false;
        });
      }
    }
  }

  Widget _buildAvatar(String? url, String name, double size) {
    final String initial = name.isNotEmpty ? name[0].toUpperCase() : 'U';
    Widget avatarContent;
    if (url != null && url.isNotEmpty) {
      final fullUrl = url.startsWith('http') ? url : 'https://trasx.com$url';
      avatarContent = CachedNetworkImage(
        imageUrl: fullUrl,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (_, __) => Container(color: Colors.white10),
        errorWidget: (_, __, ___) => Container(
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)]),
          ),
          child: Center(
            child: Text(
              initial,
              style: TextStyle(color: Colors.white, fontSize: size * 0.38, fontWeight: FontWeight.bold),
            ),
          ),
        ),
      );
    } else {
      avatarContent = Container(
        width: size,
        height: size,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)]),
        ),
        child: Center(
          child: Text(
            initial,
            style: TextStyle(color: Colors.white, fontSize: size * 0.38, fontWeight: FontWeight.bold),
          ),
        ),
      );
    }
    return ClipOval(child: avatarContent);
  }

  @override
  Widget build(BuildContext context) {
    final textStyle = TextStyle(color: widget.textPrimaryColor);
    final secondaryTextStyle = TextStyle(color: widget.textSecondaryColor);

    return Dialog(
      backgroundColor: widget.cardColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400, maxHeight: 500),
        child: _isLoading
            ? const SizedBox(
                height: 200,
                child: Center(child: CircularProgressIndicator(color: Color(0xFFC13584))),
              )
            : _errorMessage != null
                ? Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 40),
                        const SizedBox(height: 16),
                        Text(_errorMessage!, style: textStyle, textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () => Navigator.pop(context),
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFC13584)),
                          child: const Text('Fermer', style: TextStyle(color: Colors.white)),
                        )
                      ],
                    ),
                  )
                : Padding(
                    padding: const EdgeInsets.all(20.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Header: Title with hashtag status badge
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                '#$_name',
                                style: TextStyle(
                                  color: _isPaid ? const Color(0xFFFF2A54) : const Color(0xFF00B0FF),
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  fontStyle: FontStyle.italic,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _isPaid 
                                    ? const Color(0xFFFF2A54).withOpacity(0.15) 
                                    : const Color(0xFF00B0FF).withOpacity(0.15),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: _isPaid ? const Color(0xFFFF2A54) : const Color(0xFF00B0FF),
                                  width: 0.5,
                                ),
                              ),
                              child: Text(
                                _isPaid ? 'PAYANT' : 'GRATUIT',
                                style: TextStyle(
                                  color: _isPaid ? const Color(0xFFFF2A54) : const Color(0xFF00B0FF),
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            GestureDetector(
                              onTap: () => Navigator.pop(context),
                              child: Icon(Icons.close, color: widget.textSecondaryColor, size: 20),
                            ),
                          ],
                        ),
                        if (_isPaid) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Tarif de mention : ${_price.toStringAsFixed(2)}\$',
                            style: const TextStyle(color: Color(0xFFFFB300), fontSize: 12, fontWeight: FontWeight.bold),
                          ),
                        ],
                        const SizedBox(height: 16),
                        Divider(height: 0.5, thickness: 0.5, color: widget.borderColor),
                        const SizedBox(height: 16),
                        
                        // Creator Details
                        Text(
                          'Créateur :',
                          style: TextStyle(color: widget.textSecondaryColor, fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        GestureDetector(
                          onTap: () {
                            Navigator.pop(context);
                            widget.onUserProfileTap(_creatorId);
                          },
                          behavior: HitTestBehavior.opaque,
                          child: Row(
                            children: [
                              _buildAvatar(_creatorAvatar, _creatorUsername, 38),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _creatorDisplayName,
                                      style: textStyle.copyWith(fontWeight: FontWeight.bold, fontSize: 14),
                                    ),
                                    Text('@$_creatorUsername', style: secondaryTextStyle.copyWith(fontSize: 12)),
                                  ],
                                ),
                              ),
                              Icon(Icons.arrow_forward_ios_rounded, color: widget.textSecondaryColor.withOpacity(0.5), size: 14),
                            ],
                          ),
                        ),
                        
                        const SizedBox(height: 20),
                        
                        // Usage stats
                        Row(
                          children: [
                            Text('Utilisé ', style: textStyle),
                            Text(
                              '$_usageCount fois',
                              style: TextStyle(
                                color: widget.textPrimaryColor, 
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            if (_isPaid) ...[
                              const SizedBox(width: 6),
                              const Text('en temps réel ⚡', style: TextStyle(color: Color(0xFFFF2A54), fontSize: 11, fontWeight: FontWeight.bold)),
                            ],
                          ],
                        ),
                        
                        const SizedBox(height: 16),
                        Text(
                          'Utilisé par :',
                          style: TextStyle(color: widget.textSecondaryColor, fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        
                        // Users list
                        Expanded(
                          child: _usedBy.isEmpty
                              ? Center(
                                  child: Text(
                                    'Aucune utilisation enregistrée.',
                                    style: secondaryTextStyle.copyWith(fontSize: 12),
                                  ),
                                )
                              : ListView.builder(
                                  itemCount: _usedBy.length,
                                  itemBuilder: (context, index) {
                                    final user = _usedBy[index];
                                    final uId = int.tryParse('${user['id']}') ?? 0;
                                    final username = user['username'] ?? 'user';
                                    final displayName = user['first_name'] != null 
                                        ? '${user['first_name']} ${user['last_name'] ?? ""}'.trim()
                                        : username;
                                    final avatar = user['avatar'] ?? '';

                                    return Padding(
                                      padding: const EdgeInsets.symmetric(vertical: 6.0),
                                      child: GestureDetector(
                                        onTap: () {
                                          Navigator.pop(context);
                                          widget.onUserProfileTap(uId);
                                        },
                                        behavior: HitTestBehavior.opaque,
                                        child: Row(
                                          children: [
                                            _buildAvatar(avatar, username, 30),
                                            const SizedBox(width: 10),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    displayName,
                                                    style: textStyle.copyWith(fontWeight: FontWeight.bold, fontSize: 12.5),
                                                  ),
                                                  Text('@$username', style: secondaryTextStyle.copyWith(fontSize: 11)),
                                                ],
                                              ),
                                            ),
                                            Icon(Icons.arrow_forward_ios_rounded, color: widget.textSecondaryColor.withOpacity(0.3), size: 12),
                                          ],
                                        ),
                                      ),
                                    );
                                  },
                                ),
                        ),
                      ],
                    ),
                  ),
      ),
    );
  }
}

class PostDetailPage extends StatelessWidget {
  final int postId;
  final int currentUserId;
  final String currentUsername;
  final String currentDisplayName;
  final String currentUserAvatar;
  final IO.Socket? socket;
  final bool isDarkMode;
  final void Function(int userId) onUserProfileTap;

  const PostDetailPage({
    super.key,
    required this.postId,
    required this.currentUserId,
    required this.currentUsername,
    required this.currentDisplayName,
    required this.currentUserAvatar,
    this.socket,
    required this.isDarkMode,
    required this.onUserProfileTap,
  });

  @override
  Widget build(BuildContext context) {
    final cardColor = isDarkMode ? const Color(0xFF1E1E1E) : const Color(0xFFF5F5F5);
    final textPrimaryColor = isDarkMode ? Colors.white : Colors.black;
    final textSecondaryColor = isDarkMode ? Colors.white70 : Colors.black87;
    final borderColor = isDarkMode ? const Color(0xFF2E2E2E) : const Color(0xFFE2E2E2);

    return Scaffold(
      appBar: AppBar(
        title: const Text("Publication", style: TextStyle(fontFamily: 'Montserrat', fontWeight: FontWeight.bold)),
        backgroundColor: isDarkMode ? Colors.black : Colors.white,
        foregroundColor: textPrimaryColor,
        elevation: 0,
      ),
      backgroundColor: isDarkMode ? Colors.black : Colors.white,
      body: FutureBuilder<Post?>(
        future: _fetchSinglePost(postId, currentUserId),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: Color(0xFFC13584)));
          }
          if (snapshot.hasError || snapshot.data == null) {
            return Center(
              child: Text(
                "Publication introuvable",
                style: TextStyle(color: textPrimaryColor, fontSize: 16, fontFamily: 'Montserrat'),
              ),
            );
          }
          final post = snapshot.data!;
          return SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: FeedCard(
                postId: post.id,
                authorId: post.authorId,
                socket: socket,
                isFollowing: post.isAuthorFollowing,
                showFollowButton: !post.isAuthorFollowing && post.authorId != currentUserId,
                currentUserId: currentUserId,
                currentUsername: currentUsername,
                currentDisplayName: currentDisplayName,
                currentUserAvatar: currentUserAvatar,
                username: post.authorDisplayName,
                avatarInitial: post.authorUsername.isNotEmpty ? post.authorUsername[0].toUpperCase() : 'A',
                authorAvatarUrl: post.authorAvatar,
                postText: post.content,
                imageUrl: post.imageUrl,
                thumbnailUrl: post.thumbnailUrl,
                hashtag: post.isTrade ? '#TradingP2P' : '#TrasX',
                likes: post.likesCount,
                comments: post.commentsCount,
                initialIsLiked: post.isLiked,
                initialIsBookmarked: post.isBookmarked,
                cardColor: cardColor,
                textPrimaryColor: textPrimaryColor,
                textSecondaryColor: textSecondaryColor,
                borderColor: borderColor,
                isDarkMode: isDarkMode,
                onAvatarTap: () => onUserProfileTap(post.authorId),
                onPostUpdated: (updated) {
                  // Post updated callback
                },
                isHashtagPaid: (tag) => tag.toLowerCase().contains('trade'),
                onHashtagTap: (tag) {
                  // Hashtag tap
                },
                onUserProfileTap: onUserProfileTap,
              ),
            ),
          );
        },
      ),
    );
  }

  Future<Post?> _fetchSinglePost(int postId, int userId) async {
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/posts/$postId'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$userId',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['post'] != null) {
          return Post.fromJson(data['post']);
        }
      }
    } catch (e) {
      debugPrint('Error fetching single post: $e');
    }
    return null;
  }
}

class ShareBottomSheet extends StatefulWidget {
  final int postId;
  final int currentUserId;
  final IO.Socket? socket;
  final bool isDarkMode;
  final String postAuthorUsername;
  final Color textPrimaryColor;
  final Color textSecondaryColor;

  const ShareBottomSheet({
    super.key,
    required this.postId,
    required this.currentUserId,
    this.socket,
    required this.isDarkMode,
    required this.postAuthorUsername,
    required this.textPrimaryColor,
    required this.textSecondaryColor,
  });

  @override
  State<ShareBottomSheet> createState() => _ShareBottomSheetState();
}

class _ShareBottomSheetState extends State<ShareBottomSheet> {
  List<dynamic> _contacts = [];
  List<dynamic> _filteredContacts = [];
  bool _isLoading = true;
  String _searchQuery = '';
  final Set<int> _sentUserIds = {};
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _fetchContacts();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchContacts() async {
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/users/contacts'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['contacts'] != null) {
          if (mounted) {
            setState(() {
              _contacts = data['contacts'];
              _filteredContacts = _contacts;
              _isLoading = false;
            });
          }
          return;
        }
      }
    } catch (e) {
      debugPrint('Error fetching contacts for share sheet: $e');
    }
    if (mounted) {
      setState(() {
        _isLoading = false;
      });
    }
  }

  void _filterContacts(String query) {
    setState(() {
      _searchQuery = query;
      if (query.trim().isEmpty) {
        _filteredContacts = _contacts;
      } else {
        _filteredContacts = _contacts.where((c) {
          final name = (c['name'] ?? '').toString().toLowerCase();
          final username = (c['username'] ?? '').toString().toLowerCase();
          return name.contains(query.toLowerCase()) || username.contains(query.toLowerCase());
        }).toList();
      }
    });
  }

  void _sendPostToContact(dynamic contact) {
    final contactId = contact['id'] as int;
    if (_sentUserIds.contains(contactId)) return;

    final shareUrl = 'https://www.trasx.com/post/${widget.postId}';
    final messageContent = 'Regardez cette publication sur TRASX ! $shareUrl';

    if (widget.socket != null && widget.socket!.connected) {
      widget.socket!.emit('chat-message', {
        'receiverId': contactId,
        'content': messageContent,
      });
    } else {
      // Fallback HTTP request if socket is disconnected
      http.post(
        Uri.parse('https://trasx.com/api/messages/send-fallback'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
        body: jsonEncode({
          'receiverId': contactId,
          'content': messageContent,
        }),
      ).catchError((err) {
        debugPrint('HTTP message fallback error: $err');
        return http.Response('error', 500);
      });
    }

    setState(() {
      _sentUserIds.add(contactId);
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Partagé avec @${contact['username']} !'),
        duration: const Duration(seconds: 1),
        backgroundColor: const Color(0xFFC13584),
      ),
    );
  }

  Future<void> _shareExternally() async {
    final shareUrl = 'https://www.trasx.com/post/${widget.postId}';
    await Share.share(
      shareUrl,
      subject: 'Regardez cette publication de @${widget.postAuthorUsername} sur TRASX !',
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = widget.isDarkMode;
    final textPrimary = widget.textPrimaryColor;
    final textSecondary = widget.textSecondaryColor;
    final cardBg = isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF5F5F5);

    return Container(
      height: MediaQuery.of(context).size.height * 0.7,
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF121212) : Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Drag Handle
          Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: isDark ? Colors.white24 : Colors.black26,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
            child: Text(
              'Partager',
              style: TextStyle(
                color: textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.bold,
                fontFamily: 'Montserrat',
              ),
            ),
          ),
          // Search Box
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: TextField(
              controller: _searchController,
              onChanged: _filterContacts,
              style: TextStyle(color: textPrimary),
              decoration: InputDecoration(
                hintText: 'Rechercher des amis...',
                hintStyle: TextStyle(color: textSecondary, fontSize: 14),
                prefixIcon: Icon(CupertinoIcons.search, color: textSecondary, size: 20),
                fillColor: cardBg,
                filled: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 16),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          // Contacts List
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFC13584)))
                : _filteredContacts.isEmpty
                    ? Center(
                        child: Text(
                          'Aucun ami trouvé',
                          style: TextStyle(color: textSecondary, fontFamily: 'Montserrat'),
                        ),
                      )
                    : ListView.builder(
                        physics: const BouncingScrollPhysics(),
                        itemCount: _filteredContacts.length,
                        itemBuilder: (context, index) {
                          final c = _filteredContacts[index];
                          final int cid = c['id'];
                          final bool isSent = _sentUserIds.contains(cid);
                          final avatar = c['avatar'] as String?;
                          final name = c['name'] ?? c['username'] ?? '';
                          final username = c['username'] ?? '';

                          return ListTile(
                            leading: CircleAvatar(
                              radius: 20,
                              backgroundColor: isDark ? const Color(0xFF2E2E2E) : const Color(0xFFE2E2E2),
                              backgroundImage: (avatar != null && avatar.isNotEmpty)
                                  ? NetworkImage(avatar.startsWith('http') ? avatar : 'https://trasx.com$avatar')
                                  : null,
                              child: (avatar == null || avatar.isEmpty)
                                  ? Text(
                                      username.isNotEmpty ? username[0].toUpperCase() : 'U',
                                      style: TextStyle(color: textPrimary, fontWeight: FontWeight.bold),
                                    )
                                  : null,
                            ),
                            title: Text(
                              name,
                              style: TextStyle(color: textPrimary, fontWeight: FontWeight.w600, fontSize: 15),
                            ),
                            subtitle: Text(
                              '@$username',
                              style: TextStyle(color: textSecondary, fontSize: 13),
                            ),
                            trailing: SizedBox(
                              width: 90,
                              height: 32,
                              child: ElevatedButton(
                                onPressed: isSent ? null : () => _sendPostToContact(c),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: isSent
                                      ? (isDark ? Colors.white10 : Colors.black12)
                                      : const Color(0xFFC13584),
                                  foregroundColor: isSent ? textSecondary : Colors.white,
                                  elevation: 0,
                                  padding: EdgeInsets.zero,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                ),
                                child: Text(
                                  isSent ? 'Envoyé' : 'Envoyer',
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
          ),
          const Divider(height: 1),
          // External Share Button
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _shareExternally,
                    icon: const Icon(CupertinoIcons.share, size: 20),
                    label: const Text(
                      "Partager via d'autres applications",
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: isDark ? const Color(0xFF2E2E2E) : const Color(0xFFE2E2E2),
                      foregroundColor: textPrimary,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
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
}

