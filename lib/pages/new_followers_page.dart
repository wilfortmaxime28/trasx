import 'dart:async';
import 'dart:convert';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

class NewFollowersPage extends StatefulWidget {
  final io.Socket? socket;
  final bool isDarkMode;
  final int currentUserId;
  final String currentUsername;
  final String currentAvatarUrl;

  const NewFollowersPage({
    super.key,
    required this.socket,
    required this.isDarkMode,
    required this.currentUserId,
    required this.currentUsername,
    required this.currentAvatarUrl,
  });

  @override
  State<NewFollowersPage> createState() => _NewFollowersPageState();
}

class _NewFollowersPageState extends State<NewFollowersPage> {
  final Color _tiktokPink = const Color(0xFFFE2C55);
  final Color _tiktokCyan = const Color(0xFF25F4EE);

  List<dynamic> _followers = [];
  List<dynamic> _suggestions = [];
  bool _isLoadingFollowers = true;
  bool _isLoadingSuggestions = true;

  @override
  void initState() {
    super.initState();
    _fetchFollowers();
    _fetchSuggestions();
    _setupSocketListeners();
  }

  void _setupSocketListeners() {
    widget.socket?.on('follow-state-updated', _handleFollowStateUpdated);
  }

  @override
  void dispose() {
    widget.socket?.off('follow-state-updated', _handleFollowStateUpdated);
    super.dispose();
  }

  void _handleFollowStateUpdated(dynamic data) {
    if (!mounted || data == null) return;
    final actorId = int.tryParse(data['actorId']?.toString() ?? '');
    final targetId = int.tryParse(data['targetId']?.toString() ?? '');
    final isFollowing = data['isFollowing'] == true;

    if (targetId == widget.currentUserId && isFollowing) {
      _fetchFollowers();
      return;
    }

    if (targetId != null) {
      setState(() {
        for (var user in _followers) {
          if (user['id'] == targetId) {
            user['is_following'] = isFollowing;
            user['is_mutual'] = isFollowing && user['is_follower_of_user'] == true;
          }
        }
        for (var user in _suggestions) {
          if (user['id'] == targetId) {
            user['is_following'] = isFollowing;
          }
        }
      });
    }
  }

  Future<void> _fetchFollowers() async {
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/users/followers'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (mounted) {
          setState(() {
            _followers = data['followers'] as List<dynamic>? ?? [];
            _isLoadingFollowers = false;
          });
        }
      } else {
        throw Exception('Status code: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint('Error fetching followers: $e');
      if (mounted) {
        setState(() {
          _isLoadingFollowers = false;
          _followers = _getMockFollowers();
        });
      }
    }
  }

  Future<void> _fetchSuggestions() async {
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/users/suggestions?limit=6'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (mounted) {
          setState(() {
            _suggestions = data['suggestions'] as List<dynamic>? ?? [];
            _isLoadingSuggestions = false;
          });
        }
      } else {
        throw Exception('Status code: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint('Error fetching suggestions: $e');
      if (mounted) {
        setState(() {
          _isLoadingSuggestions = false;
          _suggestions = _getMockSuggestions();
        });
      }
    }
  }

  Future<void> _toggleFollow(int targetUserId) async {
    setState(() {
      for (var user in _followers) {
        if (user['id'] == targetUserId) {
          user['is_following'] = !(user['is_following'] ?? false);
          user['is_mutual'] = (user['is_following'] ?? false);
        }
      }
      for (var user in _suggestions) {
        if (user['id'] == targetUserId) {
          user['is_following'] = !(user['is_following'] ?? false);
        }
      }
    });

    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/api/users/$targetUserId/follow'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final isFollowing = data['isFollowing'] == true;
        if (mounted) {
          setState(() {
            for (var user in _followers) {
              if (user['id'] == targetUserId) {
                user['is_following'] = isFollowing;
                user['is_mutual'] = isFollowing;
              }
            }
            for (var user in _suggestions) {
              if (user['id'] == targetUserId) {
                user['is_following'] = isFollowing;
              }
            }
          });
        }
      }
    } catch (e) {
      debugPrint('Error toggling follow: $e');
      _fetchFollowers();
      _fetchSuggestions();
    }
  }

  void _removeSuggestion(int userId) {
    setState(() {
      _suggestions.removeWhere((user) => user['id'] == userId);
    });
  }

  String _resolveUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return '';
    if (trimmed.startsWith('http')) return trimmed;
    return 'https://trasx.com$trimmed';
  }

  List<dynamic> _getMockFollowers() {
    return [
      {
        'id': 301,
        'username': 'user4422390800517',
        'name': 'user4422390800517',
        'avatar': '',
        'is_following': false,
        'is_follower_of_user': true,
        'is_unread': true,
        'time_ago': '2 j'
      },
      {
        'id': 302,
        'username': 'Miss_Lessky',
        'name': '👸 Miss_Lessky ✨',
        'avatar': '',
        'is_following': true,
        'is_follower_of_user': true,
        'is_unread': false,
        'time_ago': '28 avr.'
      },
      {
        'id': 303,
        'username': 'jean_lessky',
        'name': 'Jean Lessky',
        'avatar': '',
        'is_following': true,
        'is_follower_of_user': true,
        'is_unread': false,
        'time_ago': '3 juin'
      }
    ];
  }

  List<dynamic> _getMockSuggestions() {
    return [
      {
        'id': 201,
        'username': 'alynxjoseph',
        'name': 'Alpha le Positiviste ✌️',
        'avatar': '',
        'is_following': false,
        'is_follower_of_user': true,
        'reason': 'Tu connais peut-être Alpha le Positiviste'
      },
      {
        'id': 204,
        'username': 'mirtilefredelinee0',
        'name': 'mirtilefredelinee0',
        'avatar': '',
        'is_following': false,
        'is_follower_of_user': true,
        'reason': 'Tu connais peut-être Mirtile Fredeline Exalus'
      }
    ];
  }

  @override
  Widget build(BuildContext context) {
    final bgColor = widget.isDarkMode ? const Color(0xFF000000) : Colors.white;
    final cardColor = widget.isDarkMode ? const Color(0xFF161618) : const Color(0xFFF3F4F6);
    final textPrimary = widget.isDarkMode ? Colors.white : const Color(0xFF111827);
    final textSecondary = widget.isDarkMode ? Colors.white70 : const Color(0xFF6B7280);

    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: bgColor,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, color: textPrimary),
          onPressed: () => Navigator.of(context).pop(),
        ),
        centerTitle: true,
        title: Text(
          'Nouveaux followers',
          style: TextStyle(
            color: textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await _fetchFollowers();
          await _fetchSuggestions();
        },
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          children: [
            if (_isLoadingFollowers)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(child: CupertinoActivityIndicator()),
              )
            else if (_followers.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: Text(
                    'Aucun nouveau follower.',
                    style: TextStyle(color: textSecondary, fontSize: 14),
                  ),
                ),
              )
            else
              ..._followers.map((user) => _buildFollowerItem(user, textPrimary, textSecondary)),

            const SizedBox(height: 12),
            Center(
              child: TextButton.icon(
                onPressed: () {},
                icon: Text(
                  'Tout voir',
                  style: TextStyle(color: textSecondary, fontSize: 14, fontWeight: FontWeight.w600),
                ),
                label: Icon(Icons.keyboard_arrow_down_rounded, color: textSecondary, size: 18),
              ),
            ),
            
            const SizedBox(height: 24),
            Text(
              'Comptes suggérés',
              style: TextStyle(
                color: textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 16),

            if (_isLoadingSuggestions)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 30),
                child: Center(child: CupertinoActivityIndicator()),
              )
            else if (_suggestions.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 30),
                child: Center(
                  child: Text(
                    'Aucune suggestion pour le moment.',
                    style: TextStyle(color: textSecondary, fontSize: 13),
                  ),
                ),
              )
            else
              ..._suggestions.map((user) => _buildSuggestedCard(user, cardColor, textPrimary, textSecondary)),
            const SizedBox(height: 30),
          ],
        ),
      ),
    );
  }

  Widget _buildFollowerItem(dynamic user, Color textPrimary, Color textSecondary) {
    final avatar = user['avatar']?.toString() ?? '';
    final username = user['username']?.toString() ?? '';
    final name = user['name']?.toString() ?? '';
    final isUnread = user['is_unread'] == true;
    final isFollowing = user['is_following'] == true;
    final timeAgo = user['time_ago']?.toString() ?? '';

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Blue unread indicator
          if (isUnread)
            Container(
              margin: const EdgeInsets.only(right: 8),
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                color: Color(0xFF27B8FF),
                shape: BoxShape.circle,
              ),
            )
          else
            const SizedBox(width: 16),

          _buildAvatarWidget(avatar, name.isNotEmpty ? name : username, radius: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  username,
                  style: TextStyle(color: textPrimary, fontSize: 14, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 2),
                RichText(
                  text: TextSpan(
                    style: TextStyle(color: textSecondary, fontSize: 13, height: 1.3),
                    children: [
                      const TextSpan(text: 's\'est abonné(e) à ton compte. '),
                      TextSpan(text: timeAgo, style: const TextStyle(fontWeight: FontWeight.w400)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          GestureDetector(
            onTap: () => _toggleFollow(user['id'] as int),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: isFollowing
                    ? (widget.isDarkMode ? Colors.grey.shade800 : const Color(0xFFE5E7EB))
                    : _tiktokPink,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                isFollowing ? 'Message' : 'Retour',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: isFollowing
                      ? (widget.isDarkMode ? Colors.white : Colors.black)
                      : Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSuggestedCard(dynamic user, Color cardColor, Color textPrimary, Color textSecondary) {
    final avatar = user['avatar']?.toString() ?? '';
    final username = user['username']?.toString() ?? 'user';
    final name = user['name']?.toString() ?? 'User';
    final reason = user['reason']?.toString() ?? 'Tu connais peut-être $name';
    final isFollowing = user['is_following'] == true;
    final userId = user['id'] as int;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: textSecondary.withOpacity(0.12)),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildAvatarWidget(avatar, name, radius: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(color: textPrimary, fontSize: 15, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '@$username',
                      style: TextStyle(color: textSecondary, fontSize: 13),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      reason,
                      style: TextStyle(color: textSecondary.withOpacity(0.85), fontSize: 12),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: Icon(Icons.more_horiz_rounded, color: textSecondary),
                onPressed: () {},
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 32,
                  child: OutlinedButton(
                    onPressed: () => _removeSuggestion(userId),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: textPrimary,
                      side: BorderSide(color: textSecondary.withOpacity(0.3)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                      padding: EdgeInsets.zero,
                    ),
                    child: const Text('Supprimer', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: SizedBox(
                  height: 32,
                  child: FilledButton(
                    onPressed: () => _toggleFollow(userId),
                    style: FilledButton.styleFrom(
                      backgroundColor: isFollowing
                          ? (widget.isDarkMode ? Colors.grey.shade800 : const Color(0xFFE5E7EB))
                          : _tiktokPink,
                      foregroundColor: isFollowing
                          ? (widget.isDarkMode ? Colors.white : Colors.black)
                          : Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                      padding: EdgeInsets.zero,
                    ),
                    child: Text(
                      isFollowing ? 'Abonné' : 'Suivre',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildAvatarWidget(String avatarUrl, String displayName, {required double radius}) {
    final initial = displayName.isNotEmpty ? displayName[0].toUpperCase() : 'U';
    final hasAvatar = avatarUrl.isNotEmpty;

    return CircleAvatar(
      radius: radius,
      backgroundColor: Colors.grey.shade800,
      child: ClipOval(
        child: hasAvatar
            ? CachedNetworkImage(
                imageUrl: _resolveUrl(avatarUrl),
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                errorWidget: (_, _, _) => _buildAvatarFallback(initial, radius),
              )
            : _buildAvatarFallback(initial, radius),
      ),
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
          fontSize: radius * 0.9,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}
