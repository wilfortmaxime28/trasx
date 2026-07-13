import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:http/http.dart' as http;
import 'package:video_player/video_player.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

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
  final Set<int> _likedReelIds = {}; // Local like tracking since DB has no per-user table

  bool _isLoading = false;
  bool _hasMore = true;
  String? _nextCursor;
  int _currentPageIndex = 0;

  @override
  void initState() {
    super.initState();
    _fetchReels(isRefresh: true);
    
    // Listen for real-time likes updates from socket
    widget.socket?.on('reel-likes-updated', _onReelLikesUpdated);
  }

  @override
  void dispose() {
    widget.socket?.off('reel-likes-updated', _onReelLikesUpdated);
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
          });

          // Preload the first few videos
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

    final controller = VideoPlayerController.networkUrl(Uri.parse(videoUrlStr));
    _controllers[index] = controller;

    try {
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

    // 1. Play current video
    final currentController = _controllers[index];
    if (currentController != null && currentController.value.isInitialized) {
      currentController.play();
    } else {
      _initializeController(index);
    }

    // 2. Pause and dispose surrounding videos
    _controllers.forEach((key, controller) {
      if (key != index) {
        controller.pause();
      }
    });

    // Initialize immediate adjacent videos for caching
    _initializeController(index - 1);
    _initializeController(index + 1);

    // Clean up older controllers to prevent out-of-memory errors
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

    // Emit Socket event to sync likes
    widget.socket?.emit('reel-like-toggle', {
      'reelId': reelId,
      'isLiked': !isCurrentlyLiked,
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_reels.isEmpty && _isLoading) {
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: CupertinoActivityIndicator(color: Colors.white, radius: 14),
        ),
      );
    }

    if (_reels.isEmpty) {
      return Scaffold(
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
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: PageView.builder(
        controller: _pageController,
        scrollDirection: Axis.vertical,
        onPageChanged: _onPageChanged,
        itemCount: _reels.length,
        itemBuilder: (context, index) {
          final reel = _reels[index];
          final controller = _controllers[index];
          final isLiked = _likedReelIds.contains(int.tryParse(reel['id']?.toString() ?? ''));

          return ReelPageItem(
            reel: reel,
            controller: controller,
            isLiked: isLiked,
            onLikeToggle: () => _toggleLike(index, reel),
          );
        },
      ),
    );
  }
}

class ReelPageItem extends StatefulWidget {
  final dynamic reel;
  final VideoPlayerController? controller;
  final bool isLiked;
  final VoidCallback onLikeToggle;

  const ReelPageItem({
    Key? key,
    required this.reel,
    this.controller,
    required this.isLiked,
    required this.onLikeToggle,
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

    var avatarUrl = widget.reel['author_avatar']?.toString() ?? '';
    if (avatarUrl.isNotEmpty && !avatarUrl.startsWith('http')) {
      avatarUrl = 'https://trasx.com$avatarUrl';
    }

    return Stack(
      children: [
        // 1. Video Player
        GestureDetector(
          onTap: _onTapVideo,
          child: Container(
            color: Colors.black,
            width: double.infinity,
            height: double.infinity,
            child: (controller != null && controller.value.isInitialized)
                ? Center(
                    child: AspectRatio(
                      aspectRatio: controller.value.aspectRatio,
                      child: VideoPlayer(controller),
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
          bottom: 100,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // User profile avatar
              _buildAvatarButton(avatarUrl),
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
                onTap: () {
                  // Optional: trigger comment sheet if desired
                },
              ),
              const SizedBox(height: 18),

              // Share button
              _buildActionButton(
                icon: CupertinoIcons.reply_thick_solid,
                iconColor: Colors.white,
                label: '$sharesCount',
                onTap: () {
                  // Optional: trigger system share
                },
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
          bottom: 24,
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
                    Shadow(blurRadius: 4.0, color: Colors.black54, offset: Offset(1.0, 1.0)),
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
                      Shadow(blurRadius: 4.0, color: Colors.black54, offset: Offset(1.0, 1.0)),
                    ],
                  ),
                ),
              const SizedBox(height: 12),

              // Music scrolling name
              Row(
                children: [
                  const Icon(CupertinoIcons.music_note_2, color: Colors.white70, size: 14),
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
                          Shadow(blurRadius: 4.0, color: Colors.black54, offset: Offset(1.0, 1.0)),
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
            bottom: 0,
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

  Widget _buildAvatarButton(String avatarUrl) {
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
                    errorWidget: (context, url, error) => const Icon(CupertinoIcons.person_fill, color: Colors.white54),
                  )
                : const Icon(CupertinoIcons.person_fill, color: Colors.white54),
          ),
        ),
        Positioned(
          bottom: -8,
          child: Container(
            width: 20,
            height: 20,
            decoration: const BoxDecoration(
              color: Color(0xFFE1306C),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.add, color: Colors.white, size: 14),
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
              Shadow(blurRadius: 6.0, color: Colors.black54, offset: Offset(2.0, 2.0)),
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
                Shadow(blurRadius: 4.0, color: Colors.black54, offset: Offset(1.0, 1.0)),
              ],
            ),
          )
        ],
      ),
    );
  }
}
