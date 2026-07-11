// lib/widgets/feed_skeleton.dart
// Skeleton loading pour le fil de publications

import 'package:flutter/material.dart';

class FeedSkeleton extends StatefulWidget {
  final bool isDarkMode;
  const FeedSkeleton({super.key, required this.isDarkMode});

  @override
  State<FeedSkeleton> createState() => _FeedSkeletonState();
}

class _FeedSkeletonState extends State<FeedSkeleton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _animation = Tween<double>(begin: 0.3, end: 0.8).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (_, __) {
        final shimmer = widget.isDarkMode
            ? Color.fromRGBO(255, 255, 255, _animation.value * 0.08)
            : Color.fromRGBO(0, 0, 0, _animation.value * 0.06);
        final base = widget.isDarkMode
            ? const Color(0xFF1A1A1A)
            : const Color(0xFFF0F0F0);

        return Column(
          children: List.generate(
            4,
            (_) => _buildSkeletonCard(base, shimmer),
          ),
        );
      },
    );
  }

  Widget _buildSkeletonCard(Color base, Color shimmer) {
    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                // Avatar circle
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color.alphaBlend(shimmer, base),
                  ),
                ),
                const SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _box(120, 11, base, shimmer),
                    const SizedBox(height: 5),
                    _box(70, 9, base, shimmer),
                  ],
                ),
              ],
            ),
          ),
          // Media placeholder
          Container(
            width: double.infinity,
            height: 280,
            color: Color.alphaBlend(shimmer, base),
          ),
          // Actions row
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                _box(60, 14, base, shimmer),
                const SizedBox(width: 16),
                _box(50, 14, base, shimmer),
                const SizedBox(width: 16),
                _box(30, 14, base, shimmer),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: _box(180, 11, base, shimmer),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: _box(260, 11, base, shimmer),
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: _box(200, 11, base, shimmer),
          ),
        ],
      ),
    );
  }

  Widget _box(double w, double h, Color base, Color shimmer) => Container(
        width: w,
        height: h,
        decoration: BoxDecoration(
          color: Color.alphaBlend(shimmer, base),
          borderRadius: BorderRadius.circular(4),
        ),
      );
}
