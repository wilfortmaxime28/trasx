import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:video_player/video_player.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:share_plus/share_plus.dart';
import 'package:flutter/gestures.dart';
import 'dart:convert';
import 'package:image_picker/image_picker.dart';
import 'package:http/http.dart' as http;

// Importations d'optimisation Shorts
import '../services/network_quality_service.dart';
import '../services/video_preload_manager.dart';
import '../controllers/shorts_feed_controller.dart';
import 'short_video_player.dart';
import 'weak_connection_banner.dart';
import 'shorts_search_page.dart';



Widget _buildGradientPlaceholder(String char, {double fontSize = 18}) {
  return Container(
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
    alignment: Alignment.center,
    child: Text(
      char.isNotEmpty ? char[0].toUpperCase() : 'U',
      style: TextStyle(
        color: Colors.white,
        fontWeight: FontWeight.bold,
        fontSize: fontSize,
      ),
    ),
  );
}

class ShortsView extends StatefulWidget {
  final int currentUserId;
  final int? initialReelId;
  final io.Socket? socket;
  final Function(int)? onSwitchTab;
  final ValueChanged<int>? onViewProfile;
  final ValueChanged<int>? onInitialReelConsumed;

  const ShortsView({
    Key? key,
    required this.currentUserId,
    this.initialReelId,
    this.socket,
    this.onSwitchTab,
    this.onViewProfile,
    this.onInitialReelConsumed,
  }) : super(key: key);

  @override
  State<ShortsView> createState() => _ShortsViewState();
}

class _ShortsViewState extends State<ShortsView> with WidgetsBindingObserver {
  final PageController _pageController = PageController();
  late ShortsFeedController _feedController;
  final Set<int> _likedReelIds = {}; // Local like tracking
  final Set<int> _followedUserIds = {}; // Local follow tracking
  int _currentPageIndex = 0;
  String _activeTab = 'for_you'; // 'for_you' or 'following'
  bool _isResolvingInitialReel = false;
  int? _consumedInitialReelId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    NetworkQualityService().initialize();

    _feedController = ShortsFeedController(currentUserId: widget.currentUserId);
    _feedController.addListener(_onFeedChanged);
    _feedController.fetchReels(isRefresh: true);

    // Listen for real-time socket updates
    widget.socket?.on('reel-likes-updated', _onReelLikesUpdated);
    widget.socket?.on('reel-comments-updated', _onReelCommentsUpdated);
    widget.socket?.on('reel-shares-updated', _onReelSharesUpdated);
    _tryResolveInitialReel();
  }

  @override
  void didUpdateWidget(covariant ShortsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialReelId != widget.initialReelId) {
      _consumedInitialReelId = null;
      _tryResolveInitialReel();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.socket?.off('reel-likes-updated', _onReelLikesUpdated);
    widget.socket?.off('reel-comments-updated', _onReelCommentsUpdated);
    widget.socket?.off('reel-shares-updated', _onReelSharesUpdated);
    _pageController.dispose();
    _feedController.removeListener(_onFeedChanged);
    _feedController.dispose();
    VideoPreloadManager().dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      VideoPreloadManager().pauseCurrentVideo();
    } else if (state == AppLifecycleState.resumed) {
      VideoPreloadManager().resumeCurrentVideo();
    }
  }

  void _onFeedChanged() {
    if (mounted) {
      VideoPreloadManager().setReels(_feedController.reels);

      setState(() {
        _likedReelIds.clear();
        _followedUserIds.clear();
        for (var reel in _feedController.reels) {
          final reelId = int.tryParse(reel['id']?.toString() ?? '');
          final isLiked = reel['is_liked'] == true || reel['is_liked'] == 1 || reel['is_liked'] == 'true';
          if (reelId != null && isLiked) {
            _likedReelIds.add(reelId);
          }

          final authorId = int.tryParse(reel['user_id']?.toString() ?? '');
          final isFollowing = reel['is_author_following'] == true || reel['is_author_following'] == 1 || reel['is_following'] == true || reel['is_following'] == 1;
          if (authorId != null && isFollowing) {
            _followedUserIds.add(authorId);
          }
        }
      });

      if (_feedController.state == ShortsFeedState.success &&
          _feedController.reels.isNotEmpty &&
          _currentPageIndex == 0) {
        VideoPreloadManager().setFocusedIndex(0);
      }
      setState(() {});
      _tryResolveInitialReel();
    }
  }

  Future<void> _tryResolveInitialReel() async {
    final targetReelId = widget.initialReelId;
    if (targetReelId == null || targetReelId <= 0) return;
    if (_consumedInitialReelId == targetReelId) return;

    final existingIndex = _feedController.reels.indexWhere(
      (reel) => int.tryParse(reel['id']?.toString() ?? '') == targetReelId,
    );
    if (existingIndex != -1) {
      _focusReelIndex(existingIndex, reelId: targetReelId);
      return;
    }

    if (_feedController.isLoading || _isResolvingInitialReel) return;

    _isResolvingInitialReel = true;
    try {
      final response = await http
          .get(
            Uri.parse('https://trasx.com/api/feed/reels/$targetReelId/card'),
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': '${widget.currentUserId}',
            },
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode != 200) return;

      final data = jsonDecode(response.body);
      final reel = data['reel'];
      if (data['success'] == true && reel is Map) {
        _feedController.insertOrPromoteReel(reel);
        _focusReelIndex(0, reelId: targetReelId);
      }
    } catch (error) {
      debugPrint('Error resolving shared reel $targetReelId: $error');
    } finally {
      _isResolvingInitialReel = false;
    }
  }

  void _focusReelIndex(int index, {int? reelId, int attempt = 0}) {
    if (!mounted || index < 0) return;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!_pageController.hasClients) {
        if (attempt < 6) {
          Future.delayed(const Duration(milliseconds: 80), () {
            _focusReelIndex(index, reelId: reelId, attempt: attempt + 1);
          });
        }
        return;
      }

      if (_currentPageIndex != index) {
        _pageController.jumpToPage(index);
      } else {
        _onPageChanged(index);
      }

      if (reelId != null && _consumedInitialReelId != reelId) {
        _consumedInitialReelId = reelId;
        widget.onInitialReelConsumed?.call(reelId);
      }
    });
  }

  void _onReelLikesUpdated(dynamic data) {
    if (!mounted || data == null) return;
    try {
      final reelId = int.tryParse(data['reelId']?.toString() ?? '');
      final likesCount = int.tryParse(data['likesCount']?.toString() ?? '');
      if (reelId != null && likesCount != null) {
        _feedController.updateReelLikes(reelId, likesCount);
      }
    } catch (e) {
      debugPrint('Error updating real-time likes: $e');
    }
  }

  void _onReelCommentsUpdated(dynamic data) {
    if (!mounted || data == null) return;
    try {
      final reelId = int.tryParse(data['reelId']?.toString() ?? '');
      final commentsCount = int.tryParse(data['commentsCount']?.toString() ?? '');
      if (reelId != null && commentsCount != null) {
        _feedController.updateReelComments(reelId, commentsCount);
      }
    } catch (e) {
      debugPrint('Error updating real-time comments count: $e');
    }
  }

  void _onReelSharesUpdated(dynamic data) {
    if (!mounted || data == null) return;
    try {
      final reelId = int.tryParse(data['reelId']?.toString() ?? '');
      final sharesCount = int.tryParse(data['sharesCount']?.toString() ?? '');
      if (reelId != null && sharesCount != null) {
        _feedController.updateReelShares(reelId, sharesCount);
      }
    } catch (e) {
      debugPrint('Error updating real-time shares count: $e');
    }
  }

  void _onPageChanged(int index) {
    setState(() {
      _currentPageIndex = index;
    });

    VideoPreloadManager().setFocusedIndex(index);

    // Infinite scroll check
    if (index >= _feedController.reels.length - 2) {
      _feedController.fetchReels();
    }
  }

  void _toggleLike(int index, dynamic reel) {
    final reelId = int.tryParse(reel['id']?.toString() ?? '');
    if (reelId == null) return;

    final isCurrentlyLiked = _likedReelIds.contains(reelId);
    setState(() {
      if (isCurrentlyLiked) {
        _likedReelIds.remove(reelId);
      } else {
        _likedReelIds.add(reelId);
      }
    });

    _feedController.toggleReelLikeLocal(index, !isCurrentlyLiked);

    widget.socket?.emit('reel-like-toggle', {
      'reelId': reelId,
      'isLiked': !isCurrentlyLiked,
    });
  }

  void _toggleFollow(dynamic reel) {
    final authorId = int.tryParse(reel['user_id']?.toString() ?? '');
    if (authorId == null || authorId == widget.currentUserId) return;

    final isCurrentlyFollowing = _followedUserIds.contains(authorId);
    setState(() {
      if (isCurrentlyFollowing) {
        _followedUserIds.remove(authorId);
      } else {
        _followedUserIds.add(authorId);
      }
    });

    _feedController.toggleFollowLocal(authorId, !isCurrentlyFollowing);

    widget.socket?.emit('follow-toggle', {
      'targetUserId': authorId,
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(isCurrentlyFollowing ? 'Abonnement retiré' : 'Abonné avec succès !'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  void _showCommentsSheet(dynamic reel) async {
    final reelId = int.tryParse(reel['id']?.toString() ?? '');
    if (reelId == null) return;

    final result = await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return ReelCommentsBottomSheet(
          reelId: reelId,
          currentUserId: widget.currentUserId,
          socket: widget.socket,
        );
      },
    );

    if (mounted && result != null && result.toString().startsWith('profile:')) {
      final userId = int.tryParse(result.toString().substring(8));
      if (userId != null) {
        widget.onViewProfile?.call(userId);
      }
    }
  }

  void _showShareSheet(dynamic reel) {
    final reelId = int.tryParse(reel['id']?.toString() ?? '');
    if (reelId == null) return;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return ReelShareBottomSheet(
          reelId: reelId,
          reelUrl: 'https://trasx.com/shorts/$reelId',
          caption: reel['caption']?.toString() ?? '',
          socket: widget.socket,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final reels = _feedController.reels;
    final state = _feedController.state;

    return Stack(
      children: [
        // 1. Vertical Video List
        if (reels.isEmpty && state == ShortsFeedState.initialLoading)
          const Scaffold(
            backgroundColor: Colors.black,
            body: Center(
              child: CupertinoActivityIndicator(color: Colors.white, radius: 14),
            ),
          )
        else if (reels.isEmpty && state == ShortsFeedState.networkError)
          Scaffold(
            backgroundColor: Colors.black,
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(CupertinoIcons.wifi_exclamationmark, color: Colors.white54, size: 64),
                  const SizedBox(height: 16),
                  const Text(
                    'Erreur de connexion réseau.',
                    style: TextStyle(color: Colors.white70, fontSize: 15),
                  ),
                  const SizedBox(height: 16),
                  TextButton.icon(
                    onPressed: () => _feedController.fetchReels(isRefresh: true),
                    icon: const Icon(CupertinoIcons.refresh, color: Colors.white),
                    label: const Text('Réessayer', style: TextStyle(color: Colors.white)),
                  ),
                ],
              ),
            ),
          )
        else if (reels.isEmpty)
          Scaffold(
            backgroundColor: Colors.black,
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(CupertinoIcons.play_circle, color: Colors.white54, size: 64),
                  const SizedBox(height: 16),
                  const Text(
                    'Aucune vidéo disponible pour le moment.',
                    style: TextStyle(color: Colors.white70, fontSize: 15),
                  ),
                  const SizedBox(height: 16),
                  TextButton.icon(
                    onPressed: () => _feedController.fetchReels(isRefresh: true),
                    icon: const Icon(CupertinoIcons.refresh, color: Colors.white),
                    label: const Text('Actualiser', style: TextStyle(color: Colors.white)),
                  ),
                ],
              ),
            ),
          )
        else
          PageView.builder(
            controller: _pageController,
            scrollDirection: Axis.vertical,
            onPageChanged: _onPageChanged,
            itemCount: reels.length,
            itemBuilder: (context, index) {
              final reel = reels[index];
              final isLiked = _likedReelIds.contains(int.tryParse(reel['id']?.toString() ?? ''));
              final authorId = int.tryParse(reel['user_id']?.toString() ?? '');
              final isFollowing = _followedUserIds.contains(authorId);

              return ReelPageItem(
                index: index,
                reel: reel,
                isLiked: isLiked,
                isFollowing: isFollowing,
                currentUserId: widget.currentUserId,
                onLikeToggle: () => _toggleLike(index, reel),
                onFollowToggle: () => _toggleFollow(reel),
                onCommentsPressed: () => _showCommentsSheet(reel),
                onSharePressed: () => _showShareSheet(reel),
                onViewProfile: widget.onViewProfile,
              );
            },
          ),

        // 2. Custom Top Navigation Bar (TikTok Style: Live | Tabs | Search)
        Positioned(
          top: MediaQuery.of(context).padding.top + 8,
          left: 12,
          right: 12,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Live Stream icon on Left
              GestureDetector(
                onTap: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Lancement du flux Live en direct...')),
                  );
                },
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Icon(CupertinoIcons.tv_music_note, color: Colors.black.withOpacity(0.5), size: 30),
                    const Icon(CupertinoIcons.tv_music_note, color: Colors.white, size: 28),
                  ],
                ),
              ),

              // Centered "Pour toi" and "Abonnements" Tabs
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _activeTab = 'following';
                      });
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Affichage de vos suivis...')),
                      );
                    },
                    child: Text(
                      'Suivis',
                      style: TextStyle(
                        color: _activeTab == 'following' ? Colors.white : Colors.white60,
                        fontSize: 16,
                        fontWeight: _activeTab == 'following' ? FontWeight.bold : FontWeight.w500,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Container(width: 1, height: 12, color: Colors.white24),
                  const SizedBox(width: 16),
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _activeTab = 'for_you';
                      });
                    },
                    child: Text(
                      'Pour toi',
                      style: TextStyle(
                        color: _activeTab == 'for_you' ? Colors.white : Colors.white60,
                        fontSize: 16,
                        fontWeight: _activeTab == 'for_you' ? FontWeight.bold : FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),

              // Search Button on Right
              GestureDetector(
                onTap: () async {
                  VideoPreloadManager().pauseCurrentVideo();
                  await Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => ShortsSearchPage(
                        currentUserId: widget.currentUserId,
                        socket: widget.socket,
                      ),
                    ),
                  );
                  VideoPreloadManager().resumeCurrentVideo();
                },
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Icon(CupertinoIcons.search, color: Colors.black.withOpacity(0.5), size: 30),
                    const Icon(CupertinoIcons.search, color: Colors.white, size: 28),
                  ],
                ),
              ),
            ],
          ),
        ),

        // 3. Network connection banner
        WeakConnectionBanner(
          onRetry: () {
            if (_feedController.reels.isEmpty) {
              _feedController.fetchReels(isRefresh: true);
            } else {
              VideoPreloadManager().setFocusedIndex(_currentPageIndex);
            }
          },
        ),
      ],
    );
  }
}

class DoubleTapHeart {
  final int id;
  final Offset position;
  final double angle;

  DoubleTapHeart({
    required this.id,
    required this.position,
    required this.angle,
  });
}

class HeartIconAnim extends StatefulWidget {
  final Offset position;
  final double angle;

  const HeartIconAnim({
    Key? key,
    required this.position,
    required this.angle,
  }) : super(key: key);

  @override
  State<HeartIconAnim> createState() => _HeartIconAnimState();
}

class _HeartIconAnimState extends State<HeartIconAnim> with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnimation;
  late Animation<double> _opacityAnimation;
  late Animation<double> _yOffsetAnimation;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );

    _scaleAnimation = TweenSequence<double>([
      TweenSequenceItem(tween: Tween<double>(begin: 0.0, end: 1.4).chain(CurveTween(curve: Curves.easeOut)), weight: 20),
      TweenSequenceItem(tween: Tween<double>(begin: 1.4, end: 1.0).chain(CurveTween(curve: Curves.easeIn)), weight: 15),
      TweenSequenceItem(tween: ConstantTween<double>(1.0), weight: 45),
      TweenSequenceItem(tween: Tween<double>(begin: 1.0, end: 0.0).chain(CurveTween(curve: Curves.easeIn)), weight: 20),
    ]).animate(_animController);

    _opacityAnimation = TweenSequence<double>([
      TweenSequenceItem(tween: Tween<double>(begin: 0.0, end: 1.0), weight: 15),
      TweenSequenceItem(tween: ConstantTween<double>(1.0), weight: 65),
      TweenSequenceItem(tween: Tween<double>(begin: 1.0, end: 0.0), weight: 20),
    ]).animate(_animController);

    _yOffsetAnimation = Tween<double>(begin: 0.0, end: -80.0).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeOut),
    );

    _animController.forward();
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: widget.position.dx - 50,
      top: widget.position.dy - 50,
      child: AnimatedBuilder(
        animation: _animController,
        builder: (context, child) {
          return Transform.translate(
            offset: Offset(0, _yOffsetAnimation.value),
            child: Transform.rotate(
              angle: widget.angle,
              child: Transform.scale(
                scale: _scaleAnimation.value,
                child: Opacity(
                  opacity: _opacityAnimation.value,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Icon(
                        CupertinoIcons.heart_fill,
                        color: Colors.black.withOpacity(0.4),
                        size: 102,
                      ),
                      const Icon(
                        CupertinoIcons.heart_fill,
                        color: Colors.redAccent,
                        size: 100,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class ReelPageItem extends StatefulWidget {
  final int index;
  final dynamic reel;
  final VideoPlayerController? controller;
  final bool isLiked;
  final bool isFollowing;
  final int currentUserId;
  final VoidCallback onLikeToggle;
  final VoidCallback onFollowToggle;
  final VoidCallback onCommentsPressed;
  final VoidCallback onSharePressed;
  final VideoPreloadManager? preloadManager;
  final ValueChanged<int>? onViewProfile;

  const ReelPageItem({
    Key? key,
    required this.index,
    required this.reel,
    this.controller,
    required this.isLiked,
    required this.isFollowing,
    required this.currentUserId,
    required this.onLikeToggle,
    required this.onFollowToggle,
    required this.onCommentsPressed,
    required this.onSharePressed,
    this.preloadManager,
    this.onViewProfile,
  }) : super(key: key);

  @override
  State<ReelPageItem> createState() => _ReelPageItemState();
}

class _ReelPageItemState extends State<ReelPageItem> with SingleTickerProviderStateMixin {
  late AnimationController _discAnimationController;
  bool _showPlayPauseOverlay = false;
  late VideoPlaybackControllerState _videoState;
  final List<DoubleTapHeart> _hearts = [];
  int _heartIdCounter = 0;
  VideoPreloadManager get _manager => widget.preloadManager ?? VideoPreloadManager();

  @override
  void initState() {
    super.initState();
    _discAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 5),
    );

    _initVideoState();
  }

  void _initVideoState() {
    final reel = widget.reel;
    var videoUrlStr = reel['video_url']?.toString() ?? '';
    if (!videoUrlStr.startsWith('http')) {
      videoUrlStr = 'https://trasx.com$videoUrlStr';
    }
    final thumbnailUrl = reel['thumbnail_url'] ?? reel['thumbnail'];

    _videoState = _manager.getOrCreateState(
      widget.index,
      videoUrlStr,
      thumbnailUrl,
    );
    _videoState.addListener(_onVideoStateChanged);
    _updateDiscState();
  }

  @override
  void didUpdateWidget(covariant ReelPageItem oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.index != widget.index || oldWidget.reel['video_url'] != widget.reel['video_url']) {
      _videoState.removeListener(_onVideoStateChanged);
      _initVideoState();
    }
  }

  @override
  void dispose() {
    _videoState.removeListener(_onVideoStateChanged);
    _discAnimationController.dispose();
    super.dispose();
  }

  void _onVideoStateChanged() {
    if (mounted) {
      setState(() {
        _updateDiscState();
      });
    }
  }

  void _updateDiscState() {
    final controller = _videoState.controller;
    final isPlaying = controller != null && controller.value.isInitialized && controller.value.isPlaying;
    if (isPlaying) {
      if (!_discAnimationController.isAnimating) {
        _discAnimationController.repeat();
      }
    } else {
      if (_discAnimationController.isAnimating) {
        _discAnimationController.stop();
      }
    }
  }

  void _onTapVideo() {
    final controller = _videoState.controller;
    if (controller == null || !controller.value.isInitialized) return;

    if (controller.value.isPlaying) {
      controller.pause();
    } else {
      controller.play();
    }

    setState(() {
      _showPlayPauseOverlay = true;
    });

    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() {
          _showPlayPauseOverlay = false;
        });
      }
    });
  }

  void _handleDoubleTap(Offset position) {
    if (!widget.isLiked) {
      widget.onLikeToggle();
    }

    final random = Random();
    final double angle = (random.nextDouble() - 0.5) * 0.6; // random tilt
    final heart = DoubleTapHeart(
      id: _heartIdCounter++,
      position: position,
      angle: angle,
    );

    setState(() {
      _hearts.add(heart);
    });

    Future.delayed(const Duration(milliseconds: 700), () {
      if (mounted) {
        setState(() {
          _hearts.removeWhere((h) => h.id == heart.id);
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final caption = widget.reel['caption']?.toString() ?? '';
    final username = widget.reel['author_username']?.toString() ?? 'user';
    final musicName = widget.reel['sound_name']?.toString() ?? 'Original Sound';
    final likesCount = widget.reel['likes_count'] ?? 0;
    final commentsCount = widget.reel['comments_count'] ?? 0;
    final sharesCount = widget.reel['shares_count'] ?? 0;
    final authorId = int.tryParse(widget.reel['user_id']?.toString() ?? '');

    var avatarUrl = widget.reel['author_avatar']?.toString() ?? '';
    if (avatarUrl.isNotEmpty && !avatarUrl.startsWith('http')) {
      avatarUrl = 'https://trasx.com$avatarUrl';
    }

    return Stack(
      children: [
        // 1. Full Screen Immersive Video (BoxFit.cover strategy)
        GestureDetector(
          onTap: _onTapVideo,
          onDoubleTapDown: (details) => _handleDoubleTap(details.localPosition),
          onDoubleTap: () {}, // Nécessaire pour activer le double-tap
          child: Container(
            color: Colors.black,
            width: double.infinity,
            height: double.infinity,
            child: ShortVideoPlayer(
              index: widget.index,
              videoUrl: _videoState.url,
              thumbnailUrl: _videoState.thumbnailUrl,
              preloadManager: _manager,
            ),
          ),
        ),

        // Cœurs animés lors du double-tap
        ..._hearts.map((heart) => HeartIconAnim(
              key: ValueKey(heart.id),
              position: heart.position,
              angle: heart.angle,
            )),

        // Gradient scrim overlays for readable UI
        Positioned(
          left: 0,
          right: 0,
          top: 0,
          height: 140,
          child: IgnorePointer(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withOpacity(0.5),
                    Colors.black.withOpacity(0.2),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 240,
          child: IgnorePointer(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withOpacity(0.15),
                    Colors.black.withOpacity(0.4),
                    Colors.black.withOpacity(0.7),
                  ],
                  stops: const [0.0, 0.3, 0.7, 1.0],
                ),
              ),
            ),
          ),
        ),

        // 2. Play/Pause Overlay Animation
        if (_showPlayPauseOverlay)
          Center(
            child: AnimatedOpacity(
              opacity: _showPlayPauseOverlay ? 1.0 : 0.0,
              duration: const Duration(milliseconds: 300),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.black45,
                  borderRadius: BorderRadius.circular(50),
                ),
                child: Icon(
                  (_videoState.controller != null && _videoState.controller!.value.isPlaying)
                      ? CupertinoIcons.play_fill
                      : CupertinoIcons.pause_fill,
                  color: Colors.white,
                  size: 40,
                ),
              ),
            ),
          ),

        // 3. Side Action Buttons (Right side)
        Positioned(
          right: 12,
          bottom: 50.0,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // User profile avatar + follow button
              _buildAvatarButton(avatarUrl, authorId, username),
              const SizedBox(height: 20),

              // Like button
              _buildActionButton(
                icon: CupertinoIcons.heart_fill,
                iconColor: widget.isLiked ? Colors.red : Colors.white,
                label: '$likesCount',
                onTap: widget.onLikeToggle,
              ),
              const SizedBox(height: 18),

              // Comment button
              _buildActionButton(
                icon: CupertinoIcons.chat_bubble_fill,
                iconColor: Colors.white,
                label: '$commentsCount',
                onTap: widget.onCommentsPressed,
              ),
              const SizedBox(height: 18),

              // Share button
              _buildActionButton(
                icon: CupertinoIcons.reply_thick_solid,
                iconColor: Colors.white,
                label: '$sharesCount',
                onTap: widget.onSharePressed,
              ),
              const SizedBox(height: 24),

              // Rotating Music Disc
              RotationTransition(
                turns: _discAnimationController,
                child: Container(
                  width: 44,
                  height: 44,
                  padding: const EdgeInsets.all(8),
                  decoration: const BoxDecoration(
                    color: Colors.black87,
                    shape: BoxShape.circle,
                  ),
                  child: ClipOval(
                    child: Container(
                      color: Colors.grey[900],
                      child: const Icon(CupertinoIcons.music_note_2, color: Colors.white, size: 20),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),

        // 4. Bottom overlays (Caption, Author, Music metadata)
        Positioned(
          left: 16,
          bottom: 16.0,
          right: 80,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Author username
              GestureDetector(
                onTap: () {
                  if (authorId != null) {
                    widget.onViewProfile?.call(authorId);
                  }
                },
                child: Text(
                  '@$username',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    shadows: [
                      Shadow(blurRadius: 6.0, color: Colors.black45, offset: Offset.zero),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 6),

              // Caption
              if (caption.isNotEmpty)
                Text(
                  caption,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 14,
                    shadows: [
                      Shadow(blurRadius: 6.0, color: Colors.black45, offset: Offset.zero),
                    ],
                  ),
                ),
              const SizedBox(height: 12),

              // Music scrolling name
              Row(
                children: [
                  const Icon(
                    CupertinoIcons.music_note_2,
                    color: Colors.white70,
                    size: 14,
                    shadows: [
                      Shadow(blurRadius: 6.0, color: Colors.black45, offset: Offset.zero),
                    ],
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      musicName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        shadows: [
                          Shadow(blurRadius: 6.0, color: Colors.black45, offset: Offset.zero),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        // 5. Very thin Video Progress Bar at the bottom
        if (_videoState.controller != null && _videoState.controller!.value.isInitialized)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0.0,
            child: VideoProgressIndicator(
              _videoState.controller!,
              allowScrubbing: true,
              colors: const VideoProgressColors(
                playedColor: Colors.white,
                bufferedColor: Colors.white24,
                backgroundColor: Colors.transparent,
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildAvatarButton(String avatarUrl, int? authorId, String username) {
    final showPlus = authorId != widget.currentUserId && !widget.isFollowing;

    return Stack(
      alignment: Alignment.bottomCenter,
      clipBehavior: Clip.none,
      children: [
        GestureDetector(
          onTap: () {
            if (authorId != null) {
              widget.onViewProfile?.call(authorId);
            }
          },
          child: Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 1.5),
              color: Colors.grey[900],
            ),
            child: ClipOval(
              child: avatarUrl.isNotEmpty
                  ? CachedNetworkImage(
                      imageUrl: avatarUrl,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => Container(color: Colors.black26),
                      errorWidget: (context, url, error) => _buildGradientPlaceholder(username.isNotEmpty ? username : 'U', fontSize: 18),
                    )
                  : _buildGradientPlaceholder(username.isNotEmpty ? username : 'U', fontSize: 18),
            ),
          ),
        ),
        if (showPlus)
          Positioned(
            bottom: -8,
            child: GestureDetector(
              onTap: widget.onFollowToggle,
              child: Container(
                width: 20,
                height: 20,
                decoration: const BoxDecoration(
                  color: Color(0xFFE1306C),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.add, color: Colors.white, size: 14),
              ),
            ),
          )
      ],
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required Color iconColor,
    required String label,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Column(
        children: [
          Icon(
            icon,
            color: iconColor,
            size: 32,
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          )
        ],
      ),
    );
  }
}

// ── REAL TIME COMMENTS BOTTOM SHEET ──────────────────────────────────────────
class ReelCommentsBottomSheet extends StatefulWidget {
  final int reelId;
  final int currentUserId;
  final io.Socket? socket;

  const ReelCommentsBottomSheet({
    Key? key,
    required this.reelId,
    required this.currentUserId,
    this.socket,
  }) : super(key: key);

  @override
  State<ReelCommentsBottomSheet> createState() => _ReelCommentsBottomSheetState();
}

class _ReelCommentsBottomSheetState extends State<ReelCommentsBottomSheet> {
  final List<dynamic> _comments = [];
  final TextEditingController _commentInputController = TextEditingController();
  bool _isLoading = true;

  // Real-time reply tree, local comment likes, and expanding state
  final Set<int> _likedCommentIds = {};
  final Set<int> _expandedCommentIds = {};
  dynamic _replyingToComment; // comment object we are replying to, if any
  bool _showEmojiPicker = false;

  final List<String> _allEmojis = const [
    '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫣','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾',
    '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🫶','🤝','🙏','✍️','💅','🤳','💪','🧠','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'
  ];

  @override
  void initState() {
    super.initState();
    // Join comments room
    widget.socket?.emit('reel-comments-join', {'reelId': widget.reelId});
    
    // Fetch initial comments
    widget.socket?.emitWithAck('reel-comments-fetch', {'reelId': widget.reelId}, ack: (response) {
      if (mounted && response != null && response['success'] == true) {
        setState(() {
          _comments.clear();
          _comments.addAll(response['comments'] ?? []);
          _isLoading = false;
        });
      }
    });

    // Listen for new comments broadcasted in real time
    widget.socket?.on('reel-comment-broadcast', _onCommentReceived);
  }

  @override
  void dispose() {
    widget.socket?.off('reel-comment-broadcast', _onCommentReceived);
    widget.socket?.emit('reel-comments-leave', {'reelId': widget.reelId});
    _commentInputController.dispose();
    super.dispose();
  }

  void _onCommentReceived(dynamic data) {
    if (!mounted || data == null) return;
    final int receivedReelId = int.tryParse(data['reelId']?.toString() ?? '') ?? 0;
    if (receivedReelId == widget.reelId && data['comment'] != null) {
      setState(() {
        _comments.insert(0, data['comment']);
      });
    }
  }

  bool _isUploadingImage = false;
  bool _isSubmittingComment = false;
  String? _selectedCommentImageUrl;

  bool get _canSendComment =>
      !_isUploadingImage &&
      !_isSubmittingComment &&
      (_commentInputController.text.trim().isNotEmpty || _selectedCommentImageUrl != null);

  Future<void> _pickAndUploadImage() async {
    if (_isUploadingImage || _isSubmittingComment) return;

    try {
      final ImagePicker picker = ImagePicker();
      final XFile? image = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
      if (image == null) return;

      setState(() {
        _isUploadingImage = true;
      });

      final request = http.MultipartRequest(
        'POST',
        Uri.parse('https://trasx.com/api/comments/upload-image'),
      );
      request.headers['x-user-id'] = '${widget.currentUserId}';
      request.files.add(await http.MultipartFile.fromPath('image', image.path));

      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);
      if (!mounted) return;

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          _selectedCommentImageUrl = data['imageUrl'];
          _isUploadingImage = false;
        });
      } else {
        setState(() {
          _isUploadingImage = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Échec de l'envoi de l'image.")),
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isUploadingImage = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Erreur lors de la sélection de l'image.")),
      );
    }
  }

  Future<void> _sendComment() async {
    final text = _commentInputController.text.trim();
    if (text.isEmpty && _selectedCommentImageUrl == null) return;

    if (_isUploadingImage) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("Patientez pendant l'envoi de l'image."),
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    if (_isSubmittingComment || widget.socket == null) return;

    final int? parentId = _replyingToComment != null 
        ? int.tryParse(_replyingToComment['id']?.toString() ?? '') 
        : null;

    setState(() {
      _isSubmittingComment = true;
    });

    final completer = Completer<dynamic>();
    widget.socket!.emitWithAck('reel-comment-add', {
      'reelId': widget.reelId,
      'content': text,
      'parentId': parentId,
      'imageUrl': _selectedCommentImageUrl,
    }, ack: (ack) {
      if (!completer.isCompleted) {
        completer.complete(ack);
      }
    });

    dynamic response;
    try {
      response = await completer.future.timeout(const Duration(seconds: 8));
    } on TimeoutException {
      response = {'success': false, 'error': "Le serveur met trop de temps à répondre."};
    }

    if (!mounted) return;

    if (response != null && response['success'] == true) {
      _commentInputController.clear();
      setState(() {
        _replyingToComment = null;
        _selectedCommentImageUrl = null;
        _isSubmittingComment = false;
      });
      return;
    }

    setState(() {
      _isSubmittingComment = false;
    });

    final errorMessage = response is Map && response['error'] != null
        ? response['error'].toString()
        : "Échec de l'envoi du commentaire.";
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(errorMessage),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  void _toggleCommentLike(dynamic comment) {
    final int commentId = int.tryParse(comment['id']?.toString() ?? '') ?? 0;
    if (commentId == 0) return;

    setState(() {
      if (_likedCommentIds.contains(commentId)) {
        _likedCommentIds.remove(commentId);
        final current = int.tryParse(comment['likes_count']?.toString() ?? '0') ?? 0;
        comment['likes_count'] = (current - 1) < 0 ? 0 : (current - 1);
      } else {
        _likedCommentIds.add(commentId);
        final current = int.tryParse(comment['likes_count']?.toString() ?? '0') ?? 0;
        comment['likes_count'] = current + 1;
      }
    });
  }

  String _formatRelativeTime(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return "";
    try {
      final dateTime = DateTime.parse(dateStr).toLocal();
      final now = DateTime.now();
      final difference = now.difference(dateTime);

      if (difference.inSeconds < 60) {
        return "À l'instant";
      } else if (difference.inMinutes < 60) {
        return "${difference.inMinutes}m";
      } else if (difference.inHours < 24) {
        return "${difference.inHours}h";
      } else if (difference.inDays < 7) {
        return "${difference.inDays}j";
      } else {
        return "${dateTime.day}/${dateTime.month}";
      }
    } catch (e) {
      return "";
    }
  }

  @override
  Widget build(BuildContext context) {
    final double keyboardHeight = MediaQuery.of(context).viewInsets.bottom;
    final bool isDark = Theme.of(context).brightness == Brightness.dark;

    final sheetBgColor = isDark ? const Color(0xFF161616) : Colors.white;
    final textPrimaryColor = isDark ? Colors.white : Colors.black;
    final textSecondaryColor = isDark ? Colors.white70 : Colors.black87;
    final textMutedColor = isDark ? Colors.white38 : Colors.black38;
    final dividerColor = isDark ? Colors.white12 : Colors.black12;
    final inputBgColor = isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF2F2F2);

    // Build hierarchical Tree items list
    final List<Map<String, dynamic>> listItems = [];
    final rootComments = _comments.where((c) {
      final parentId = c['parent_id'];
      if (parentId == null) return true;
      final parsedParentId = int.tryParse(parentId.toString());
      if (parsedParentId == 0) return true;
      return !_comments.any((parent) => int.tryParse(parent['id'].toString()) == parsedParentId);
    }).toList();

    final Map<int, List<dynamic>> repliesMap = {};
    for (var c in _comments) {
      final parentId = c['parent_id'];
      if (parentId != null) {
        final parsedParentId = int.tryParse(parentId.toString());
        if (parsedParentId != null && parsedParentId != 0) {
          repliesMap.putIfAbsent(parsedParentId, () => []).add(c);
        }
      }
    }

    // Sort replies chronological order
    repliesMap.forEach((key, list) {
      list.sort((a, b) {
        final aDate = DateTime.tryParse(a['created_at']?.toString() ?? '') ?? DateTime.now();
        final bDate = DateTime.tryParse(b['created_at']?.toString() ?? '') ?? DateTime.now();
        return aDate.compareTo(bDate);
      });
    });

    for (var root in rootComments) {
      final rootId = int.tryParse(root['id']?.toString() ?? '') ?? 0;
      listItems.add({'type': 'comment', 'comment': root, 'isReply': false});
      
      final parentReplies = repliesMap[rootId] ?? [];
      if (parentReplies.isNotEmpty) {
        final isExpanded = _expandedCommentIds.contains(rootId);
        if (!isExpanded) {
          listItems.add({
            'type': 'toggle_expand',
            'parentId': rootId,
            'count': parentReplies.length,
            'expand': true,
          });
        } else {
          for (var reply in parentReplies) {
            listItems.add({'type': 'comment', 'comment': reply, 'isReply': true});
          }
          listItems.add({
            'type': 'toggle_expand',
            'parentId': rootId,
            'count': parentReplies.length,
            'expand': false,
          });
        }
      }
    }

    return Container(
      height: MediaQuery.of(context).size.height * 0.65 + keyboardHeight,
      decoration: BoxDecoration(
        color: sheetBgColor,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      padding: EdgeInsets.only(bottom: keyboardHeight > 0 ? keyboardHeight : MediaQuery.of(context).padding.bottom),
      child: Column(
        children: [
          // Drag handle
          Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(
              color: textMutedColor,
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Title/Count
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${_comments.length} commentaires',
                  style: TextStyle(color: textPrimaryColor, fontSize: 15, fontWeight: FontWeight.bold),
                ),
                GestureDetector(
                  onTap: () => Navigator.pop(context),
                  child: Icon(CupertinoIcons.xmark, color: textSecondaryColor, size: 20),
                )
              ],
            ),
          ),
          Divider(color: dividerColor, height: 1),

          // Comments List
          Expanded(
            child: _isLoading
                ? Center(child: CupertinoActivityIndicator(color: textPrimaryColor))
                : listItems.isEmpty
                    ? Center(
                        child: Text(
                          'Soyez le premier à commenter !',
                          style: TextStyle(color: textMutedColor, fontSize: 13),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: listItems.length,
                        itemBuilder: (context, index) {
                          final item = listItems[index];

                          if (item['type'] == 'toggle_expand') {
                            final parentId = item['parentId'] as int;
                            final count = item['count'] as int;
                            final expand = item['expand'] as bool;

                            return Padding(
                              padding: const EdgeInsets.only(left: 48.0, bottom: 12.0),
                              child: GestureDetector(
                                onTap: () {
                                  setState(() {
                                    if (expand) {
                                      _expandedCommentIds.add(parentId);
                                    } else {
                                      _expandedCommentIds.remove(parentId);
                                    }
                                  });
                                },
                                child: Row(
                                  children: [
                                    Container(
                                      width: 24,
                                      height: 1,
                                      color: dividerColor,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      expand ? "Afficher les réponses ($count)" : "Masquer les réponses",
                                      style: TextStyle(
                                        color: textSecondaryColor,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    Icon(
                                      expand ? CupertinoIcons.chevron_down : CupertinoIcons.chevron_up,
                                      color: textSecondaryColor,
                                      size: 12,
                                    )
                                  ],
                                ),
                              ),
                            );
                          }

                          // Render Comment / Reply
                          final comment = item['comment'];
                          final bool isReply = item['isReply'] as bool;
                          final cId = int.tryParse(comment['id']?.toString() ?? '') ?? 0;
                          final cAuthor = comment['username']?.toString() ?? 'user';
                          final cText = comment['content']?.toString() ?? '';
                          final cDate = _formatRelativeTime(comment['created_at']?.toString());
                          final bool isLiked = _likedCommentIds.contains(cId);
                          final int likesCount = comment['likes_count'] ?? 0;

                          final cImageUrl = comment['image_url']?.toString() ?? '';
                          var cAvatar = comment['avatar']?.toString() ?? '';
                          if (cAvatar.isNotEmpty && !cAvatar.startsWith('http')) {
                            cAvatar = 'https://trasx.com$cAvatar';
                          }

                          return Padding(
                            padding: EdgeInsets.only(
                              left: isReply ? 40.0 : 0.0,
                              bottom: 16.0,
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Avatar with Gradient Fallback
                                Container(
                                  width: isReply ? 28 : 36,
                                  height: isReply ? 28 : 36,
                                  decoration: const BoxDecoration(
                                    shape: BoxShape.circle,
                                  ),
                                  child: ClipOval(
                                    child: cAvatar.isNotEmpty
                                        ? CachedNetworkImage(
                                            imageUrl: cAvatar,
                                            fit: BoxFit.cover,
                                            placeholder: (context, url) => Container(color: Colors.black26),
                                            errorWidget: (context, url, error) => _buildGradientPlaceholder(cAuthor.isNotEmpty ? cAuthor : 'U', fontSize: isReply ? 11 : 14),
                                          )
                                        : _buildGradientPlaceholder(cAuthor.isNotEmpty ? cAuthor : 'U', fontSize: isReply ? 11 : 14),
                                  ),
                                ),
                                const SizedBox(width: 12),

                                // Author + Text content + Actions row
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '@$cAuthor',
                                        style: TextStyle(color: textSecondaryColor, fontSize: 12, fontWeight: FontWeight.bold),
                                      ),
                                      const SizedBox(height: 4),
                                      _buildCommentText(cText, context, textPrimaryColor),
                                      if (cImageUrl.isNotEmpty) ...[
                                        const SizedBox(height: 6),
                                        GestureDetector(
                                          onTap: () {
                                            showDialog(
                                              context: context,
                                              builder: (context) => Dialog(
                                                backgroundColor: Colors.transparent,
                                                child: CachedNetworkImage(
                                                  imageUrl: cImageUrl.startsWith('http') ? cImageUrl : 'https://trasx.com$cImageUrl',
                                                  fit: BoxFit.contain,
                                                ),
                                              ),
                                            );
                                          },
                                          child: ClipRRect(
                                            borderRadius: BorderRadius.circular(8),
                                            child: CachedNetworkImage(
                                              imageUrl: cImageUrl.startsWith('http') ? cImageUrl : 'https://trasx.com$cImageUrl',
                                              width: 120,
                                              height: 120,
                                              fit: BoxFit.cover,
                                              placeholder: (context, url) => Container(color: Colors.white10),
                                              errorWidget: (context, url, error) => const SizedBox.shrink(),
                                            ),
                                          ),
                                        ),
                                      ],
                                      const SizedBox(height: 6),

                                      // Actions: Date & Reply button
                                      Row(
                                        children: [
                                          Text(
                                            cDate,
                                            style: TextStyle(color: textMutedColor, fontSize: 11),
                                          ),
                                          const SizedBox(width: 16),
                                          GestureDetector(
                                            onTap: () {
                                              setState(() {
                                                _replyingToComment = comment;
                                              });
                                            },
                                            child: Text(
                                              'Répondre',
                                              style: TextStyle(
                                                color: textMutedColor,
                                                fontSize: 11,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),

                                // Like button on the right
                                GestureDetector(
                                  onTap: () => _toggleCommentLike(comment),
                                  child: Column(
                                    children: [
                                      Icon(
                                        isLiked ? CupertinoIcons.heart_fill : CupertinoIcons.heart,
                                        color: isLiked ? Colors.red : textMutedColor,
                                        size: 16,
                                      ),
                                      if (likesCount > 0) ...[
                                        const SizedBox(height: 2),
                                        Text(
                                          '$likesCount',
                                          style: TextStyle(color: textMutedColor, fontSize: 10),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
          ),

          // Replying to bar indicator
          if (_replyingToComment != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF9F9F9),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "En réponse à @${_replyingToComment['username']}",
                    style: TextStyle(color: textSecondaryColor, fontSize: 12, fontWeight: FontWeight.w500),
                  ),
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _replyingToComment = null;
                      });
                    },
                    child: Icon(CupertinoIcons.xmark_circle_fill, color: textMutedColor, size: 18),
                  )
                ],
              ),
            ),

          // Horizontal Emojis selector bar
          Container(
            height: 38,
            decoration: BoxDecoration(
              color: sheetBgColor,
              border: Border(top: BorderSide(color: dividerColor, width: 0.5)),
            ),
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              children: ['❤️', '😂', '🙌', '🔥', '😮', '😢', '👏', '😍', '👍', '🎉', '💡', '💯']
                  .map((emoji) => GestureDetector(
                        onTap: () {
                          final text = _commentInputController.text;
                          final selection = _commentInputController.selection;
                          final newText = text.replaceRange(
                            selection.start >= 0 ? selection.start : text.length,
                            selection.end >= 0 ? selection.end : text.length,
                            emoji,
                          );
                          _commentInputController.value = TextEditingValue(
                            text: newText,
                            selection: TextSelection.collapsed(
                              offset: (selection.start >= 0 ? selection.start : text.length) + emoji.length,
                            ),
                          );
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                          child: Text(emoji, style: const TextStyle(fontSize: 20)),
                        ),
                      ))
                  .toList(),
            ),
          ),

          // Image upload/attached banner
          if (_isUploadingImage || _selectedCommentImageUrl != null)
            Container(
              color: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF9F9F9),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Container(
                      color: isDark ? Colors.white10 : Colors.black12,
                      width: 32,
                      height: 32,
                      child: _isUploadingImage
                          ? const CupertinoActivityIndicator(radius: 8)
                          : CachedNetworkImage(
                              imageUrl: _selectedCommentImageUrl!.startsWith('http')
                                  ? _selectedCommentImageUrl!
                                  : 'https://trasx.com$_selectedCommentImageUrl',
                              fit: BoxFit.cover,
                            ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    _isUploadingImage ? "Envoi de l'image..." : "Image attachée au commentaire",
                    style: TextStyle(color: textSecondaryColor, fontSize: 12),
                  ),
                  const Spacer(),
                  if (!_isUploadingImage)
                    GestureDetector(
                      onTap: () {
                        setState(() {
                          _selectedCommentImageUrl = null;
                        });
                      },
                      child: Icon(CupertinoIcons.xmark_circle_fill, color: textMutedColor, size: 18),
                    ),
                ],
              ),
            ),

          // Input field at bottom
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
            decoration: BoxDecoration(
              color: inputBgColor,
              border: Border(top: BorderSide(color: dividerColor, width: 0.5)),
            ),
            child: Row(
              children: [
                // Smiley / Keyboard Toggle button
                IconButton(
                  icon: Icon(
                    _showEmojiPicker ? CupertinoIcons.keyboard : CupertinoIcons.smiley,
                    color: textSecondaryColor,
                    size: 24,
                  ),
                  onPressed: () {
                    setState(() {
                      _showEmojiPicker = !_showEmojiPicker;
                      if (_showEmojiPicker) {
                        FocusScope.of(context).unfocus();
                      }
                    });
                  },
                ),
                Expanded(
                  child: Container(
                    height: 38,
                    decoration: BoxDecoration(
                      color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _commentInputController,
                            style: TextStyle(color: textPrimaryColor, fontSize: 14),
                            cursorColor: textPrimaryColor,
                            textAlignVertical: TextAlignVertical.center,
                            onTap: () {
                              if (_showEmojiPicker) {
                                setState(() {
                                  _showEmojiPicker = false;
                                });
                              }
                            },
                            decoration: InputDecoration(
                              hintText: _replyingToComment != null 
                                  ? 'Répondre à @${_replyingToComment['username']}...' 
                                  : 'Ajouter un commentaire...',
                              hintStyle: TextStyle(color: textMutedColor, fontSize: 14),
                              border: InputBorder.none,
                              isCollapsed: true,
                              contentPadding: const EdgeInsets.symmetric(vertical: 10),
                            ),
                            onSubmitted: (_) => _sendComment(),
                          ),
                        ),
                        // Image selection icon
                        GestureDetector(
                          onTap: (_isUploadingImage || _isSubmittingComment) ? null : _pickAndUploadImage,
                          child: Icon(
                            CupertinoIcons.photo,
                            color: _selectedCommentImageUrl != null ? const Color(0xFFE9435A) : textSecondaryColor,
                            size: 20,
                          ),
                        ),
                        const SizedBox(width: 10),
                        // @ Tag icon shortcut
                        GestureDetector(
                          onTap: () {
                            final text = _commentInputController.text;
                            final selection = _commentInputController.selection;
                            final newText = text.replaceRange(
                              selection.start >= 0 ? selection.start : text.length,
                              selection.end >= 0 ? selection.end : text.length,
                              '@',
                            );
                            _commentInputController.value = TextEditingValue(
                              text: newText,
                              selection: TextSelection.collapsed(
                                offset: (selection.start >= 0 ? selection.start : text.length) + 1,
                              ),
                            );
                          },
                          child: Icon(
                            CupertinoIcons.at,
                            color: textSecondaryColor,
                            size: 20,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  icon: Icon(
                    CupertinoIcons.paperplane_fill,
                    color: _canSendComment
                        ? const Color(0xFFE1306C)
                        : Colors.white38,
                  ),
                  onPressed: _sendComment,
                )
              ],
            ),
          ),
          
          // Collapsible Emoji Picker grid below the input bar
          if (_showEmojiPicker)
            Container(
              height: 220,
              decoration: BoxDecoration(
                color: sheetBgColor,
                border: Border(top: BorderSide(color: dividerColor, width: 0.5)),
              ),
              child: GridView.builder(
                padding: const EdgeInsets.all(8),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 8,
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                ),
                itemCount: _allEmojis.length,
                itemBuilder: (context, index) {
                  final emoji = _allEmojis[index];
                  return GestureDetector(
                    onTap: () {
                      final text = _commentInputController.text;
                      final selection = _commentInputController.selection;
                      final newText = text.replaceRange(
                        selection.start >= 0 ? selection.start : text.length,
                        selection.end >= 0 ? selection.end : text.length,
                        emoji,
                      );
                      _commentInputController.value = TextEditingValue(
                        text: newText,
                        selection: TextSelection.collapsed(
                          offset: (selection.start >= 0 ? selection.start : text.length) + emoji.length,
                        ),
                      );
                    },
                    child: Center(
                      child: Text(
                        emoji,
                        style: const TextStyle(fontSize: 24),
                      ),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildCommentText(String text, BuildContext context, Color textPrimaryColor) {
    final List<TextSpan> spans = [];
    final words = text.split(' ');

    for (int i = 0; i < words.length; i++) {
      final word = words[i];
      final trailingSpace = i == words.length - 1 ? "" : " ";

      if (word.startsWith('@') && word.length > 1) {
        final username = word.substring(1).replaceAll(RegExp(r'[^\w_]'), '');
        spans.add(
          TextSpan(
            text: '$word$trailingSpace',
            style: const TextStyle(
              color: Color(0xFF3897F0), // TikTok blue tag
              fontWeight: FontWeight.bold,
            ),
            recognizer: TapGestureRecognizer()
              ..onTap = () async {
                try {
                  final response = await http.get(
                    Uri.parse('https://trasx.com/api/users/search?q=${Uri.encodeComponent(username)}'),
                    headers: {'Content-Type': 'application/json'},
                  ).timeout(const Duration(seconds: 4));

                  if (response.statusCode == 200) {
                    final List<dynamic> users = jsonDecode(response.body);
                    final matchingUser = users.firstWhere(
                      (u) => u['username']?.toString().toLowerCase() == username.toLowerCase(),
                      orElse: () => null,
                    );

                    if (matchingUser != null) {
                      final userId = int.tryParse(matchingUser['id']?.toString() ?? '');
                      if (userId != null && context.mounted) {
                        Navigator.pop(context, 'profile:$userId');
                      }
                    }
                  }
                } catch (_) {}
              },
          ),
        );
      } else {
        spans.add(
          TextSpan(
            text: '$word$trailingSpace',
            style: TextStyle(color: textPrimaryColor),
          ),
        );
      }
    }

    return RichText(
      text: TextSpan(
        style: TextStyle(fontSize: 13.5, fontFamily: 'Outfit', color: textPrimaryColor),
        children: spans,
      ),
    );
  }
}

// ── REAL TIME TIKTOK SHARE BOTTOM SHEET ──────────────────────────────────────
class ReelShareBottomSheet extends StatefulWidget {
  final int reelId;
  final String reelUrl;
  final String caption;
  final io.Socket? socket;

  const ReelShareBottomSheet({
    Key? key,
    required this.reelId,
    required this.reelUrl,
    required this.caption,
    this.socket,
  }) : super(key: key);

  @override
  State<ReelShareBottomSheet> createState() => _ReelShareBottomSheetState();
}

class _ReelShareBottomSheetState extends State<ReelShareBottomSheet> {
  final Set<String> _sentUsers = {};

  final List<Map<String, String>> _usersList = [
    {'name': 'Lucas_Pro', 'avatar': 'https://api.dicebear.com/7.x/avataaars/png?seed=Felix'},
    {'name': 'Elena_P2P', 'avatar': 'https://api.dicebear.com/7.x/avataaars/png?seed=Aneka'},
    {'name': 'Mélanie', 'avatar': 'https://api.dicebear.com/7.x/avataaars/png?seed=Mimi'},
    {'name': 'Wilfort', 'avatar': 'https://api.dicebear.com/7.x/avataaars/png?seed=Jack'},
    {'name': 'Support_TrasX', 'avatar': 'https://api.dicebear.com/7.x/avataaars/png?seed=Sam'},
  ];

  void _sendDirect(String username) {
    if (_sentUsers.contains(username)) return;

    setState(() {
      _sentUsers.add(username);
    });

    // Notify server of share count increment
    widget.socket?.emit('reel-share-add', {'reelId': widget.reelId});

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Partagé avec @$username !'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  void _shareExternal() {
    Share.share('Découvrez cette vidéo sur TrasX : ${widget.reelUrl}\n\n"${widget.caption}"');
    widget.socket?.emit('reel-share-add', {'reelId': widget.reelId});
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final bool isDark = Theme.of(context).brightness == Brightness.dark;

    final sheetBgColor = isDark ? const Color(0xFF1E1E1E) : Colors.white;
    final textPrimaryColor = isDark ? Colors.white : Colors.black;
    final textSecondaryColor = isDark ? Colors.white70 : Colors.black87;
    final textMutedColor = isDark ? Colors.white24 : Colors.black26;
    final dividerColor = isDark ? Colors.white12 : Colors.black12;

    return Container(
      padding: EdgeInsets.only(top: 12, bottom: 24 + MediaQuery.of(context).padding.bottom),
      decoration: BoxDecoration(
        color: sheetBgColor,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: textMutedColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Send to section
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Text(
              'Envoyer à des amis',
              style: TextStyle(color: textSecondaryColor, fontSize: 13, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 12),

          // Friends horizontal list
          SizedBox(
            height: 90,
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              scrollDirection: Axis.horizontal,
              itemCount: _usersList.length,
              itemBuilder: (context, index) {
                final user = _usersList[index];
                final uName = user['name']!;
                final uAvatar = user['avatar']!;
                final sent = _sentUsers.contains(uName);

                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8.0),
                  child: Column(
                    children: [
                      GestureDetector(
                        onTap: () => _sendDirect(uName),
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            Container(
                              width: 50,
                              height: 50,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                              ),
                              child: ClipOval(
                                child: uAvatar.isNotEmpty
                                    ? CachedNetworkImage(
                                        imageUrl: uAvatar,
                                        fit: BoxFit.cover,
                                        placeholder: (context, url) => Container(color: Colors.black26),
                                        errorWidget: (context, url, error) => _buildGradientPlaceholder(uName.isNotEmpty ? uName : 'U', fontSize: 18),
                                      )
                                    : _buildGradientPlaceholder(uName.isNotEmpty ? uName : 'U', fontSize: 18),
                              ),
                            ),
                            if (sent)
                              Container(
                                width: 50,
                                height: 50,
                                decoration: const BoxDecoration(
                                  color: Colors.black54,
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(CupertinoIcons.checkmark_alt, color: Colors.green, size: 30),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 6),
                      SizedBox(
                        width: 60,
                        child: Text(
                          uName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: textPrimaryColor, fontSize: 11),
                        ),
                      )
                    ],
                  ),
                );
              },
            ),
          ),
          Divider(color: dividerColor, height: 16),

          // Action Options (TikTok style share bar)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Text(
              'Partager',
              style: TextStyle(color: textSecondaryColor, fontSize: 13, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 12),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildShareActionItem(
                icon: CupertinoIcons.link,
                label: 'Copier le lien',
                color: Colors.blueAccent,
                textColor: textSecondaryColor,
                onTap: () {
                  // Copy link action
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Lien copié dans le presse-papiers !')),
                  );
                  widget.socket?.emit('reel-share-add', {'reelId': widget.reelId});
                  Navigator.pop(context);
                },
              ),
              _buildShareActionItem(
                icon: CupertinoIcons.share,
                label: 'Partager via...',
                color: Colors.purple,
                textColor: textSecondaryColor,
                onTap: _shareExternal,
              ),
              _buildShareActionItem(
                icon: CupertinoIcons.exclamationmark_bubble_fill,
                color: Colors.amber,
                label: 'Signaler',
                textColor: textSecondaryColor,
                onTap: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Signalement envoyé à la modération.')),
                  );
                  Navigator.pop(context);
                },
              ),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildShareActionItem({
    required IconData icon,
    required String label,
    required Color color,
    required Color textColor,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(height: 6),
          Text(label, style: TextStyle(color: textColor, fontSize: 11)),
        ],
      ),
    );
  }
}
