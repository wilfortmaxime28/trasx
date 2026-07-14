// lib/widgets/short_video_player.dart
import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../models/video_play_state.dart';
import '../services/video_preload_manager.dart';

class ShortVideoPlayer extends StatefulWidget {
  final int index;
  final String videoUrl;
  final String? thumbnailUrl;
  final VideoPreloadManager? preloadManager;

  const ShortVideoPlayer({
    Key? key,
    required this.index,
    required this.videoUrl,
    this.thumbnailUrl,
    this.preloadManager,
  }) : super(key: key);

  @override
  State<ShortVideoPlayer> createState() => _ShortVideoPlayerState();
}

class _ShortVideoPlayerState extends State<ShortVideoPlayer> {
  late VideoPlaybackControllerState _videoState;
  bool _showLoadingIndicator = false;
  Timer? _loadingTimer;
  VideoPreloadManager get _manager => widget.preloadManager ?? VideoPreloadManager();

  @override
  void initState() {
    super.initState();
    _initVideoState();
  }

  void _initVideoState() {
    _videoState = _manager.getOrCreateState(
      widget.index,
      widget.videoUrl,
      widget.thumbnailUrl,
    );
    _videoState.addListener(_onStateChanged);
    _checkLoadingIndicator(themeState: _videoState.playState);
  }

  @override
  void didUpdateWidget(covariant ShortVideoPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.index != widget.index || oldWidget.videoUrl != widget.videoUrl) {
      _videoState.removeListener(_onStateChanged);
      _loadingTimer?.cancel();
      _loadingTimer = null;
      _initVideoState();
    }
  }

  @override
  void dispose() {
    _videoState.removeListener(_onStateChanged);
    _loadingTimer?.cancel();
    super.dispose();
  }

  void _onStateChanged() {
    if (mounted) {
      setState(() {
        _checkLoadingIndicator(themeState: _videoState.playState);
      });
    }
  }

  void _checkLoadingIndicator({required VideoPlayState themeState}) {
    if (themeState == VideoPlayState.loading || themeState == VideoPlayState.buffering) {
      if (_loadingTimer == null) {
        _loadingTimer = Timer(const Duration(milliseconds: 400), () {
          if (mounted) {
            setState(() {
              _showLoadingIndicator = true;
            });
          }
        });
      }
    } else {
      _loadingTimer?.cancel();
      _loadingTimer = null;
      _showLoadingIndicator = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _videoState.controller;
    final isInitialized = controller != null && controller.value.isInitialized;
    final state = _videoState.playState;

    Widget mediaWidget;

    if (isInitialized &&
        (state == VideoPlayState.playing ||
            state == VideoPlayState.paused ||
            state == VideoPlayState.buffering ||
            state == VideoPlayState.ready)) {
      mediaWidget = SizedBox.expand(
        child: FittedBox(
          fit: BoxFit.cover,
          clipBehavior: Clip.hardEdge,
          child: SizedBox(
            width: controller.value.size.width,
            height: controller.value.size.height,
            child: VideoPlayer(controller),
          ),
        ),
      );
    } else {
      mediaWidget = const SizedBox.shrink();
    }

    Widget? thumbnailWidget;
    if (widget.thumbnailUrl != null && widget.thumbnailUrl!.isNotEmpty) {
      var thumbUrl = widget.thumbnailUrl!;
      if (!thumbUrl.startsWith('http')) {
        thumbUrl = 'https://trasx.com$thumbUrl';
      }
      thumbnailWidget = CachedNetworkImage(
        imageUrl: thumbUrl,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        fadeInDuration: const Duration(milliseconds: 200),
        placeholder: (context, url) => Container(color: Colors.black),
        errorWidget: (context, url, error) => Container(color: Colors.black),
      );
    } else {
      thumbnailWidget = Container(color: Colors.black);
    }

    return Stack(
      children: [
        // Miniature d'arrière-plan visible pendant le chargement
        if (!isInitialized || state == VideoPlayState.loading)
          Positioned.fill(child: thumbnailWidget),

        // Lecteur vidéo avec fondu d'apparition
        Positioned.fill(
          child: AnimatedOpacity(
            opacity: isInitialized ? 1.0 : 0.0,
            duration: const Duration(milliseconds: 300),
            child: mediaWidget,
          ),
        ),

        // Indicateur de chargement (affiché seulement après un délai)
        if (_showLoadingIndicator)
          const Center(
            child: CupertinoActivityIndicator(color: Colors.white, radius: 14),
          ),

        // Écran d'erreur en cas d'échec
        if (state == VideoPlayState.error)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(CupertinoIcons.exclamationmark_circle, color: Colors.white70, size: 48),
                  const SizedBox(height: 12),
                  const Text(
                    'Impossible de charger la vidéo',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70, fontSize: 14),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white24,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    onPressed: () {
                      VideoPreloadManager().setFocusedIndex(widget.index);
                    },
                    icon: const Icon(CupertinoIcons.refresh, size: 16),
                    label: const Text('Réessayer'),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
