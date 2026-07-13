import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:http/http.dart' as http;
import 'package:video_player/video_player.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:share_plus/share_plus.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';

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
  final io.Socket? socket;

  const ShortsView({
    Key? key,
    required this.currentUserId,
    this.socket,
  }) : super(key: key);

  @override
  State<ShortsView> createState() => _ShortsViewState();
}

class _ShortsViewState extends State<ShortsView> {
  final PageController _pageController = PageController();
  final List<dynamic> _reels = [];
  final Map<int, VideoPlayerController> _controllers = {};
  final Set<int> _likedReelIds = {}; // Local like tracking
  final Set<int> _followedUserIds = {}; // Local follow tracking

  bool _isLoading = false;
  bool _hasMore = true;
  String? _nextCursor;
  int _currentPageIndex = 0;
  String _activeTab = 'for_you'; // 'for_you' or 'following'

  @override
  void initState() {
    super.initState();
    _fetchReels(isRefresh: true);
    
    // Listen for real-time socket updates
    widget.socket?.on('reel-likes-updated', _onReelLikesUpdated);
    widget.socket?.on('reel-comments-updated', _onReelCommentsUpdated);
    widget.socket?.on('reel-shares-updated', _onReelSharesUpdated);
  }

  @override
  void dispose() {
    widget.socket?.off('reel-likes-updated', _onReelLikesUpdated);
    widget.socket?.off('reel-comments-updated', _onReelCommentsUpdated);
    widget.socket?.off('reel-shares-updated', _onReelSharesUpdated);
    _pageController.dispose();
    _controllers.forEach((_, controller) => controller.dispose());
    super.dispose();
  }

  void _onReelLikesUpdated(dynamic data) {
    if (!mounted || data == null) return;
    try {
      final reelId = int.tryParse(data['reelId']?.toString() ?? '');
      final likesCount = int.tryParse(data['likesCount']?.toString() ?? '');
      if (reelId != null && likesCount != null) {
        setState(() {
          final index = _reels.indexWhere((r) => int.tryParse(r['id']?.toString() ?? '') == reelId);
          if (index != -1) {
            _reels[index]['likes_count'] = likesCount;
          }
        });
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
        setState(() {
          final index = _reels.indexWhere((r) => int.tryParse(r['id']?.toString() ?? '') == reelId);
          if (index != -1) {
            _reels[index]['comments_count'] = commentsCount;
          }
        });
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
        setState(() {
          final index = _reels.indexWhere((r) => int.tryParse(r['id']?.toString() ?? '') == reelId);
          if (index != -1) {
            _reels[index]['shares_count'] = sharesCount;
          }
        });
      }
    } catch (e) {
      debugPrint('Error updating real-time shares count: $e');
    }
  }

  Future<void> _fetchReels({bool isRefresh = false}) async {
    if (_isLoading) return;
    if (!isRefresh && !_hasMore) return;

    setState(() {
      _isLoading = true;
    });

    try {
      final cursorParam = isRefresh ? '' : (_nextCursor ?? '');
      final response = await http.get(
        Uri.parse('https://trasx.com/api/feed/reels?cursor=$cursorParam&limit=5'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['reels'] != null) {
          final List<dynamic> newReels = data['reels'];
          setState(() {
            if (isRefresh) {
              _reels.clear();
              _controllers.forEach((_, controller) => controller.dispose());
              _controllers.clear();
              _currentPageIndex = 0;
            }
            _reels.addAll(newReels);
            _hasMore = data['hasMore'] ?? false;
            _nextCursor = data['nextCursor']?.toString();

            // Populate local following state
            for (var reel in newReels) {
              final authorId = int.tryParse(reel['user_id']?.toString() ?? '');
              final isFollowing = reel['is_author_following'] == true || reel['is_author_following'] == 1;
              if (authorId != null && isFollowing) {
                _followedUserIds.add(authorId);
              }
            }
          });

          // Preload
          if (isRefresh && _reels.isNotEmpty) {
            _initializeController(0);
            if (_reels.length > 1) _initializeController(1);
          }
        }
      }
    } catch (e) {
      debugPrint('Error loading reels: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _initializeController(int index) async {
    if (index < 0 || index >= _reels.length) return;
    if (_controllers.containsKey(index)) return;

    final reel = _reels[index];
    var videoUrlStr = reel['video_url']?.toString() ?? '';
    if (videoUrlStr.isEmpty) return;

    if (!videoUrlStr.startsWith('http')) {
      videoUrlStr = 'https://trasx.com$videoUrlStr';
    }

    try {
      final file = await DefaultCacheManager().getSingleFile(videoUrlStr);
      final controller = VideoPlayerController.file(file);
      _controllers[index] = controller;

      await controller.initialize();
      controller.setLooping(true);
      if (mounted && _currentPageIndex == index) {
        setState(() {});
        controller.play();
      }
    } catch (e) {
      debugPrint('Error initializing video at index $index: $e');
    }
  }

  void _onPageChanged(int index) {
    setState(() {
      _currentPageIndex = index;
    });

    // Play current video
    final currentController = _controllers[index];
    if (currentController != null && currentController.value.isInitialized) {
      currentController.play();
    } else {
      _initializeController(index);
    }

    // Pause all other videos
    _controllers.forEach((key, controller) {
      if (key != index) {
        controller.pause();
      }
    });

    // Initialize immediate adjacent videos for caching
    _initializeController(index - 1);
    _initializeController(index + 1);

    // Clean up older controllers
    final keysToRemove = <int>[];
    _controllers.forEach((key, controller) {
      if ((key - index).abs() > 1) {
        controller.dispose();
        keysToRemove.add(key);
      }
    });
    for (var key in keysToRemove) {
      _controllers.remove(key);
    }

    // Infinite scroll check
    if (index >= _reels.length - 2) {
      _fetchReels();
    }
  }

  void _toggleLike(int index, dynamic reel) {
    final reelId = int.tryParse(reel['id']?.toString() ?? '');
    if (reelId == null) return;

    final isCurrentlyLiked = _likedReelIds.contains(reelId);
    setState(() {
      if (isCurrentlyLiked) {
        _likedReelIds.remove(reelId);
        reel['likes_count'] = (int.tryParse(reel['likes_count']?.toString() ?? '0') ?? 0) - 1;
      } else {
        _likedReelIds.add(reelId);
        reel['likes_count'] = (int.tryParse(reel['likes_count']?.toString() ?? '0') ?? 0) + 1;
      }
    });

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

  void _showCommentsSheet(dynamic reel) {
    final reelId = int.tryParse(reel['id']?.toString() ?? '');
    if (reelId == null) return;

    showModalBottomSheet(
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
    return Stack(
      children: [
        // 1. Vertical Video List
        if (_reels.isEmpty && _isLoading)
          const Scaffold(
            backgroundColor: Colors.black,
            body: Center(
              child: CupertinoActivityIndicator(color: Colors.white, radius: 14),
            ),
          )
        else if (_reels.isEmpty)
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
                    onPressed: () => _fetchReels(isRefresh: true),
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
            itemCount: _reels.length,
            itemBuilder: (context, index) {
              final reel = _reels[index];
              final controller = _controllers[index];
              final isLiked = _likedReelIds.contains(int.tryParse(reel['id']?.toString() ?? ''));
              final authorId = int.tryParse(reel['user_id']?.toString() ?? '');
              final isFollowing = _followedUserIds.contains(authorId);

              return ReelPageItem(
                reel: reel,
                controller: controller,
                isLiked: isLiked,
                isFollowing: isFollowing,
                currentUserId: widget.currentUserId,
                onLikeToggle: () => _toggleLike(index, reel),
                onFollowToggle: () => _toggleFollow(reel),
                onCommentsPressed: () => _showCommentsSheet(reel),
                onSharePressed: () => _showShareSheet(reel),
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
                child: const Icon(CupertinoIcons.tv_music_note, color: Colors.white, size: 28),
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
                onTap: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Ouverture de la recherche de vidéos...')),
                  );
                },
                child: const Icon(CupertinoIcons.search, color: Colors.white, size: 28),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class ReelPageItem extends StatefulWidget {
  final dynamic reel;
  final VideoPlayerController? controller;
  final bool isLiked;
  final bool isFollowing;
  final int currentUserId;
  final VoidCallback onLikeToggle;
  final VoidCallback onFollowToggle;
  final VoidCallback onCommentsPressed;
  final VoidCallback onSharePressed;

  const ReelPageItem({
    Key? key,
    required this.reel,
    this.controller,
    required this.isLiked,
    required this.isFollowing,
    required this.currentUserId,
    required this.onLikeToggle,
    required this.onFollowToggle,
    required this.onCommentsPressed,
    required this.onSharePressed,
  }) : super(key: key);

  @override
  State<ReelPageItem> createState() => _ReelPageItemState();
}

class _ReelPageItemState extends State<ReelPageItem> with SingleTickerProviderStateMixin {
  late AnimationController _discAnimationController;
  bool _isPlaying = true;
  bool _showPlayPauseOverlay = false;

  @override
  void initState() {
    super.initState();
    _discAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 5),
    )..repeat();
  }

  @override
  void dispose() {
    _discAnimationController.dispose();
    super.dispose();
  }

  void _onTapVideo() {
    final controller = widget.controller;
    if (controller == null || !controller.value.isInitialized) return;

    setState(() {
      if (controller.value.isPlaying) {
        controller.pause();
        _isPlaying = false;
        _discAnimationController.stop();
      } else {
        controller.play();
        _isPlaying = true;
        _discAnimationController.repeat();
      }
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

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
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
          child: Container(
            color: Colors.black,
            width: double.infinity,
            height: double.infinity,
            child: (controller != null && controller.value.isInitialized)
                ? SizedBox.expand(
                    child: FittedBox(
                      fit: BoxFit.cover,
                      clipBehavior: Clip.hardEdge,
                      child: SizedBox(
                        width: controller.value.size.width,
                        height: controller.value.size.height,
                        child: VideoPlayer(controller),
                      ),
                    ),
                  )
                : const Center(
                    child: CupertinoActivityIndicator(color: Colors.white),
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
                  _isPlaying ? CupertinoIcons.play_fill : CupertinoIcons.pause_fill,
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
              Text(
                '@$username',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  shadows: [
                    Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, -1.5)),
                    Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, -1.5)),
                    Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, 1.5)),
                    Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, 1.5)),
                    Shadow(blurRadius: 6.0, color: Colors.black87, offset: Offset(2.0, 2.0)),
                  ],
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
                      Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, -1.5)),
                      Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, -1.5)),
                      Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, 1.5)),
                      Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, 1.5)),
                      Shadow(blurRadius: 6.0, color: Colors.black87, offset: Offset(2.0, 2.0)),
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
                      Shadow(blurRadius: 4.0, color: Colors.black, offset: Offset(1.0, 1.0)),
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
                          Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, -1.5)),
                          Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, -1.5)),
                          Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, 1.5)),
                          Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, 1.5)),
                          Shadow(blurRadius: 6.0, color: Colors.black87, offset: Offset(2.0, 2.0)),
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
        if (controller != null && controller.value.isInitialized)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0.0,
            child: VideoProgressIndicator(
              controller,
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
        Container(
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
            shadows: const [
              Shadow(blurRadius: 8.0, color: Colors.black87, offset: Offset(1.5, 1.5)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              shadows: [
                Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, -1.5)),
                Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, -1.5)),
                Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(-1.5, 1.5)),
                Shadow(blurRadius: 1.0, color: Colors.black, offset: Offset(1.5, 1.5)),
                Shadow(blurRadius: 6.0, color: Colors.black87, offset: Offset(2.0, 2.0)),
              ],
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

  void _sendComment() {
    final text = _commentInputController.text.trim();
    if (text.isEmpty) return;

    widget.socket?.emitWithAck('reel-comment-add', {
      'reelId': widget.reelId,
      'content': text,
    }, ack: (ack) {
      if (ack != null && ack['success'] == true) {
        _commentInputController.clear();
      }
    });
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
                : _comments.isEmpty
                    ? Center(
                        child: Text(
                          'Soyez le premier à commenter !',
                          style: TextStyle(color: textMutedColor, fontSize: 13),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _comments.length,
                        itemBuilder: (context, index) {
                          final comment = _comments[index];
                          final cAuthor = comment['username']?.toString() ?? 'user';
                          final cText = comment['content']?.toString() ?? '';
                          var cAvatar = comment['avatar']?.toString() ?? '';
                          if (cAvatar.isNotEmpty && !cAvatar.startsWith('http')) {
                            cAvatar = 'https://trasx.com$cAvatar';
                          }

                          return Padding(
                            padding: const EdgeInsets.only(bottom: 16.0),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  width: 36,
                                  height: 36,
                                  decoration: const BoxDecoration(
                                    shape: BoxShape.circle,
                                  ),
                                  child: ClipOval(
                                    child: cAvatar.isNotEmpty
                                        ? CachedNetworkImage(
                                            imageUrl: cAvatar,
                                            fit: BoxFit.cover,
                                            placeholder: (context, url) => Container(color: Colors.black26),
                                            errorWidget: (context, url, error) => _buildGradientPlaceholder(cAuthor.isNotEmpty ? cAuthor : 'U', fontSize: 14),
                                          )
                                        : _buildGradientPlaceholder(cAuthor.isNotEmpty ? cAuthor : 'U', fontSize: 14),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '@$cAuthor',
                                        style: TextStyle(color: textSecondaryColor, fontSize: 12, fontWeight: FontWeight.bold),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        cText,
                                        style: TextStyle(color: textPrimaryColor, fontSize: 13.5),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
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
                Expanded(
                  child: TextField(
                    controller: _commentInputController,
                    style: TextStyle(color: textPrimaryColor, fontSize: 14),
                    cursorColor: textPrimaryColor,
                    decoration: InputDecoration(
                      hintText: 'Ajouter un commentaire...',
                      hintStyle: TextStyle(color: textMutedColor),
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8.0),
                    ),
                    onSubmitted: (_) => _sendComment(),
                  ),
                ),
                IconButton(
                  icon: const Icon(CupertinoIcons.paperplane_fill, color: Color(0xFFE1306C)),
                  onPressed: _sendComment,
                )
              ],
            ),
          )
        ],
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
