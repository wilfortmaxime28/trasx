// lib/widgets/shorts_search_page.dart
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:http/http.dart' as http;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:image_picker/image_picker.dart';
import 'package:video_player/video_player.dart';

import '../services/video_preload_manager.dart';
import '../services/network_quality_service.dart';
import 'shorts_view.dart'; // Pour utiliser ReelPageItem

class ShortsSearchPage extends StatefulWidget {
  final int currentUserId;
  final io.Socket? socket;
  final VoidCallback? onBack; // Callback de retour au flux principal

  const ShortsSearchPage({
    Key? key,
    required this.currentUserId,
    this.socket,
    this.onBack,
  }) : super(key: key);

  @override
  State<ShortsSearchPage> createState() => _ShortsSearchPageState();
}

class _ShortsSearchPageState extends State<ShortsSearchPage> {
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  List<dynamic> _searchResults = [];
  bool _isLoading = false;
  String? _errorMsg;
  bool _hasSearched = false;
  Timer? _debounceTimer;

  // Liste des suggestions de recherche intelligentes actives
  List<String> _activeSuggestions = [];

  // Gestionnaire de préchargement indépendant pour les résultats
  late final VideoPreloadManager _preloadManager;

  // État local du lecteur plein écran des résultats
  List<dynamic>? _playerReels;
  int _playerInitialIndex = 0;

  final List<String> _searchHistory = ['humour', 'danse', 'viral', 'trasx'];
  final List<String> _trendingSearches = [
    'trasx_challenge',
    'humour_afrique',
    'funny_moments',
    'musique_chill',
    'sport_motivation'
  ];

  @override
  void initState() {
    super.initState();
    _preloadManager = VideoPreloadManager.createIndependent();
    _fetchTrendingHashtags();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _searchFocusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchController.dispose();
    _searchFocusNode.dispose();
    for (var state in _preloadManager.activeStates.values) {
      state.dispose();
    }
    super.dispose();
  }

  Future<void> _fetchTrendingHashtags() async {
    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/hashtags'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final List<dynamic> tags = jsonDecode(response.body);
        final List<String> trending = [];
        for (var t in tags) {
          if (t['name'] != null) {
            final name = t['name'].toString();
            if (name.toLowerCase() != 'flutter_reels') {
              trending.add(name);
            }
          }
        }
        if (mounted && trending.isNotEmpty) {
          setState(() {
            _trendingSearches.clear();
            _trendingSearches.addAll(trending.take(8));
          });
        }
      }
    } catch (_) {
      // Fallback
    }
  }

  // Générateur local de suggestions de saisie rapides
  List<String> _getLocalSearchSuggestions(String query) {
    if (query.trim().isEmpty) return [];
    final cleanQuery = query.toLowerCase().trim();
    final Set<String> suggestions = {};

    // 1. Ajoute les termes de l'historique correspondants
    for (var hist in _searchHistory) {
      if (hist.toLowerCase().contains(cleanQuery)) {
        suggestions.add(hist);
      }
    }

    // 2. Ajoute les tendances populaires correspondantes
    for (var trend in _trendingSearches) {
      if (trend.toLowerCase().contains(cleanQuery)) {
        suggestions.add(trend);
      }
    }

    // 3. Suffixes intelligents inspirés de TikTok
    final commonSuffixes = [
      ' viral',
      ' humour',
      ' danse',
      ' challenge',
      ' compilation',
      ' 2026',
      ' motivation',
      ' music',
    ];
    for (var suf in commonSuffixes) {
      if (cleanQuery.length >= 2) {
        suggestions.add(query.trim() + suf);
      }
    }

    return suggestions.take(8).toList();
  }

  // Chargeur de suggestions à l'écrit via serveur (en arrière-plan)
  Future<void> _fetchSuggestions(String query) async {
    if (query.trim().isEmpty) return;

    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/feed/reels/search?q=${Uri.encodeComponent(query)}&limit=10'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 4));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          final results = data['results'] ?? [];
          final Set<String> serverSug = {};
          
          for (var reel in results) {
            final username = reel['author_username']?.toString() ?? '';
            if (username.toLowerCase().contains(query.toLowerCase())) {
              serverSug.add(username);
            }
            final caption = reel['caption']?.toString() ?? '';
            final words = caption.split(RegExp(r'\s+'));
            for (var w in words) {
              final cw = w.replaceAll(RegExp(r'[^\w#@]'), '');
              if (cw.toLowerCase().contains(query.toLowerCase()) && cw.length > 2) {
                serverSug.add(cw);
              }
            }
          }

          if (mounted) {
            setState(() {
              final localSug = _getLocalSearchSuggestions(query);
              final combined = <String>{...localSug, ...serverSug};
              _activeSuggestions = combined.take(8).toList();
            });
          }
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _activeSuggestions = _getLocalSearchSuggestions(query);
        });
      }
    }
  }

  Future<void> _performSearch(String query) async {
    if (query.trim().isEmpty) return;
    
    // Add to history if not exists
    if (!_searchHistory.contains(query.trim())) {
      setState(() {
        _searchHistory.insert(0, query.trim());
        if (_searchHistory.length > 8) _searchHistory.removeLast();
      });
    }

    setState(() {
      _isLoading = true;
      _errorMsg = null;
      _hasSearched = true;
    });

    try {
      final response = await http.get(
        Uri.parse('https://trasx.com/api/feed/reels/search?q=${Uri.encodeComponent(query)}&limit=24'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '${widget.currentUserId}',
        },
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          final results = data['results'] ?? [];
          setState(() {
            _searchResults = results;
            _isLoading = false;
          });
          // Précharger immédiatement le flux de recherche dans notre manager indépendant
          _preloadManager.setReels(results);
          _preloadManager.setFocusedIndex(0);

          NetworkQualityService().recordSuccess();
        } else {
          setState(() {
            _errorMsg = data['error'] ?? 'Une erreur est survenue lors de la recherche.';
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _errorMsg = 'Impossible de contacter le serveur (code ${response.statusCode}).';
          _isLoading = false;
        });
        NetworkQualityService().recordError();
      }
    } catch (e) {
      setState(() {
        _errorMsg = 'Erreur de connexion réseau.';
        _isLoading = false;
      });
      final errStr = e.toString().toLowerCase();
      if (errStr.contains('socketexception') || errStr.contains('handshake') || errStr.contains('failed host lookup') || errStr.contains('timeout')) {
        NetworkQualityService().recordOffline();
      } else {
        NetworkQualityService().recordError();
      }
    }
  }

  void _onSearchSubmit(String val) {
    _debounceTimer?.cancel();
    _performSearch(val);
  }

  void _onSearchChanged(String query) {
    setState(() {}); // Met à jour l'icône de suppression
    _debounceTimer?.cancel();
    
    if (query.trim().isEmpty) {
      setState(() {
        _hasSearched = false;
        _activeSuggestions.clear();
        _searchResults.clear();
        _errorMsg = null;
      });
      return;
    }

    // Affiche d'abord les suggestions locales immédiates
    setState(() {
      _hasSearched = false;
      _activeSuggestions = _getLocalSearchSuggestions(query);
    });

    // Cherche et enrichit en arrière-plan avec un debouncer de 300 ms
    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      _fetchSuggestions(query);
    });
  }

  @override
  Widget build(BuildContext context) {
    // Si l'utilisateur clique sur une vidéo, on affiche le lecteur plein écran au sein du même onglet
    if (_playerReels != null) {
      return ShortsPlayerPage(
        searchResults: _playerReels!,
        initialIndex: _playerInitialIndex,
        currentUserId: widget.currentUserId,
        socket: widget.socket,
        searchQuery: _searchController.text,
        preloadManager: _preloadManager,
        onBack: () {
          setState(() {
            _playerReels = null;
          });
        },
      );
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scaffoldBgColor = Theme.of(context).scaffoldBackgroundColor;
    final textPrimaryColor = isDark ? Colors.white : Colors.black87;
    final textSecondaryColor = isDark ? Colors.white60 : Colors.black54;

    return Scaffold(
      backgroundColor: scaffoldBgColor,
      appBar: AppBar(
        backgroundColor: scaffoldBgColor,
        elevation: 0,
        scrolledUnderElevation: 0, // Désactive l'élévation et l'ombre lors du défilement
        leadingWidth: 40,
        leading: GestureDetector(
          onTap: () {
            if (widget.onBack != null) {
              widget.onBack!();
            } else {
              Navigator.pop(context);
            }
          },
          child: Padding(
            padding: const EdgeInsets.only(left: 12.0),
            child: Icon(CupertinoIcons.left_chevron, color: textPrimaryColor, size: 26),
          ),
        ),
        titleSpacing: 8,
        title: Container(
          height: 38,
          decoration: BoxDecoration(
            color: isDark ? Colors.white12 : Colors.black.withOpacity(0.05),
            borderRadius: BorderRadius.circular(20),
          ),
          child: TextField(
            controller: _searchController,
            focusNode: _searchFocusNode,
            onSubmitted: _onSearchSubmit,
            style: TextStyle(color: textPrimaryColor, fontSize: 15),
            cursorColor: const Color(0xFFE9435A), // Rouge TikTok
            decoration: InputDecoration(
              hintText: 'Rechercher des vidéos...',
              hintStyle: TextStyle(color: textSecondaryColor.withOpacity(0.6), fontSize: 14),
              prefixIcon: Icon(CupertinoIcons.search, color: textSecondaryColor.withOpacity(0.6), size: 18),
              suffixIcon: _searchController.text.isNotEmpty
                  ? GestureDetector(
                      onTap: () {
                        _searchController.clear();
                        _debounceTimer?.cancel();
                        setState(() {
                          _hasSearched = false;
                          _searchResults.clear();
                          _errorMsg = null;
                        });
                      },
                      child: Icon(CupertinoIcons.clear_thick_circled, color: textSecondaryColor.withOpacity(0.6), size: 18),
                    )
                  : null,
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 9),
            ),
            onChanged: _onSearchChanged,
          ),
        ),
        actions: [
          GestureDetector(
            onTap: () => _onSearchSubmit(_searchController.text),
            child: Container(
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: const Text(
                'Rechercher',
                style: TextStyle(
                  color: Color(0xFFE9435A), // Rouge TikTok
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                ),
              ),
            ),
          ),
        ],
      ),
      body: GestureDetector(
        onTap: () => FocusScope.of(context).unfocus(),
        child: _buildBody(scaffoldBgColor, textPrimaryColor, textSecondaryColor, isDark),
      ),
    );
  }

  Widget _buildBody(Color bgColor, Color textPrimary, Color textSecondary, bool isDark) {
    return Column(
      children: [
        if (_isLoading)
          const SizedBox(
            height: 2,
            child: LinearProgressIndicator(
              color: Color(0xFFE9435A),
              backgroundColor: Colors.transparent,
            ),
          ),
        Expanded(
          child: _buildMainContent(bgColor, textPrimary, textSecondary, isDark),
        ),
      ],
    );
  }

  Widget _buildMainContent(Color bgColor, Color textPrimary, Color textSecondary, bool isDark) {
    if (_errorMsg != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(CupertinoIcons.wifi_exclamationmark, color: textSecondary.withOpacity(0.5), size: 64),
            const SizedBox(height: 16),
            Text(
              _errorMsg!,
              style: TextStyle(color: textSecondary, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => _performSearch(_searchController.text),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFE9435A),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              ),
              child: const Text('Réessayer'),
            ),
          ],
        ),
      );
    }

    // 1. Si le champ de recherche est vide, on affiche l'historique et les tendances
    if (_searchController.text.trim().isEmpty) {
      return _buildSearchSuggestions(textPrimary, textSecondary, isDark);
    }

    // 2. Si l'utilisateur a soumis sa recherche, on affiche les vidéos correspondantes
    if (_hasSearched) {
      if (_searchResults.isEmpty && !_isLoading) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.videocam_off_outlined, color: textSecondary.withOpacity(0.5), size: 64),
              const SizedBox(height: 16),
              Text(
                "Aucun Short trouvé pour \"${_searchController.text}\"",
                style: TextStyle(color: textSecondary, fontSize: 15),
              ),
            ],
          ),
        );
      }
      return _buildSearchResultsGrid(textPrimary, textSecondary);
    }

    // 3. Sinon, pendant que l'utilisateur écrit, on affiche les suggestions de recherche
    return _buildSuggestionsList(textPrimary, textSecondary, isDark);
  }

  Widget _buildSuggestionsList(Color textPrimary, Color textSecondary, bool isDark) {
    if (_activeSuggestions.isEmpty) {
      return const SizedBox.shrink();
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: _activeSuggestions.length,
      separatorBuilder: (context, index) => Divider(
        color: isDark ? Colors.white10 : Colors.black12,
        height: 1,
        indent: 48,
      ),
      itemBuilder: (context, index) {
        final suggestion = _activeSuggestions[index];
        return ListTile(
          leading: Icon(CupertinoIcons.search, color: textSecondary.withOpacity(0.5), size: 20),
          title: Text(
            suggestion,
            style: TextStyle(color: textPrimary, fontSize: 15, fontWeight: FontWeight.w400),
          ),
          trailing: GestureDetector(
            onTap: () {
              // Remplit le champ mais garde la recherche active pour l'affiner
              _searchController.text = suggestion;
              _onSearchChanged(suggestion);
            },
            child: Padding(
              padding: const EdgeInsets.all(8.0),
              child: Icon(
                CupertinoIcons.arrow_up_left,
                color: textSecondary.withOpacity(0.5),
                size: 20,
              ),
            ),
          ),
          onTap: () {
            // Sélectionne et effectue immédiatement la recherche (grille de vidéos)
            _searchController.text = suggestion;
            _performSearch(suggestion);
          },
        );
      },
    );
  }

  Widget _buildSearchSuggestions(Color textPrimary, Color textSecondary, bool isDark) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_searchHistory.isNotEmpty) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Recherches récentes',
                  style: TextStyle(color: textPrimary, fontSize: 15, fontWeight: FontWeight.bold),
                ),
                GestureDetector(
                  onTap: () {
                    setState(() {
                      _searchHistory.clear();
                    });
                  },
                  child: Icon(CupertinoIcons.trash, color: textSecondary.withOpacity(0.6), size: 18),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _searchHistory.map((query) => _buildHistoryChip(query, textSecondary, isDark)).toList(),
            ),
            const SizedBox(height: 24),
          ],

          Row(
            children: [
              const Icon(CupertinoIcons.flame_fill, color: Color(0xFFE9435A), size: 18),
              const SizedBox(width: 6),
              Text(
                'Recherches populaires',
                style: TextStyle(color: textPrimary, fontSize: 15, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 16),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              childAspectRatio: 3.5,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
            ),
            itemCount: _trendingSearches.length,
            itemBuilder: (context, index) {
              final query = _trendingSearches[index];
              return GestureDetector(
                onTap: () {
                  _searchController.text = query;
                  _performSearch(query);
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white.withOpacity(0.06) : Colors.black.withOpacity(0.03),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Text(
                        '${index + 1}',
                        style: TextStyle(
                          color: index < 3 ? const Color(0xFFE9435A) : textSecondary.withOpacity(0.5),
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          query,
                          style: TextStyle(color: textPrimary.withOpacity(0.9), fontSize: 13, fontWeight: FontWeight.w500),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildHistoryChip(String query, Color textSecondary, bool isDark) {
    return GestureDetector(
      onTap: () {
        _searchController.text = query;
        _performSearch(query);
      },
      child: Chip(
        backgroundColor: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.04),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        label: Text(
          query,
          style: TextStyle(color: textSecondary, fontSize: 13),
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
    );
  }

  Widget _buildSearchResultsGrid(Color textPrimary, Color textSecondary) {
    return GridView.builder(
      padding: const EdgeInsets.all(8),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.62,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
      ),
      itemCount: _searchResults.length,
      itemBuilder: (context, index) {
        final reel = _searchResults[index];
        final thumbnailUrl = reel['thumbnail_url'] ?? reel['thumbnail'] ?? '';
        final caption = reel['caption']?.toString() ?? '';
        final username = reel['author_username']?.toString() ?? 'user';
        final likesCount = reel['likes_count'] ?? 0;

        var avatarUrl = reel['author_avatar']?.toString() ?? '';
        if (avatarUrl.isNotEmpty && !avatarUrl.startsWith('http')) {
          avatarUrl = 'https://trasx.com${avatarUrl.startsWith('/') ? avatarUrl : '/$avatarUrl'}';
        }

        return GestureDetector(
          onTap: () {
            setState(() {
              _playerReels = _searchResults;
              _playerInitialIndex = index;
            });
            // Indiquer l'index cliqué pour concentrer la vidéo
            _preloadManager.setFocusedIndex(index);
          },
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Container(
              color: const Color(0xFF1E1E1E),
              child: Stack(
                children: [
                  Positioned.fill(
                    child: SearchReelThumbnail(
                      videoUrl: reel['video_url']?.toString() ?? '',
                      thumbnailUrl: thumbnailUrl.toString(),
                    ),
                  ),

                  Positioned.fill(
                    child: Container(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.transparent,
                            Colors.transparent,
                            Colors.black54,
                            Colors.black87,
                          ],
                        ),
                      ),
                    ),
                  ),

                  Positioned(
                    left: 8,
                    right: 8,
                    bottom: 8,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          caption,
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            ClipOval(
                              child: avatarUrl.isNotEmpty
                                  ? CachedNetworkImage(
                                      imageUrl: avatarUrl,
                                      width: 18,
                                      height: 18,
                                      fit: BoxFit.cover,
                                      errorWidget: (context, url, error) => Container(
                                        color: Colors.white24,
                                        child: const Icon(CupertinoIcons.person_fill, color: Colors.white70, size: 10),
                                      ),
                                    )
                                  : Container(
                                      color: Colors.white24,
                                      width: 18,
                                      height: 18,
                                      child: const Icon(CupertinoIcons.person_fill, color: Colors.white70, size: 10),
                                    ),
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                username,
                                style: const TextStyle(color: Colors.white70, fontSize: 11),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const Icon(CupertinoIcons.heart, color: Colors.white60, size: 12),
                            const SizedBox(width: 2),
                            Text(
                              '$likesCount',
                              style: const TextStyle(color: Colors.white60, fontSize: 11),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class ShortsPlayerPage extends StatefulWidget {
  final List<dynamic> searchResults;
  final int initialIndex;
  final int currentUserId;
  final io.Socket? socket;
  final String searchQuery;
  final VideoPreloadManager preloadManager;
  final VoidCallback? onBack;

  const ShortsPlayerPage({
    Key? key,
    required this.searchResults,
    required this.initialIndex,
    required this.currentUserId,
    required this.searchQuery,
    required this.preloadManager,
    this.socket,
    this.onBack,
  }) : super(key: key);

  @override
  State<ShortsPlayerPage> createState() => _ShortsPlayerPageState();
}

class _ShortsPlayerPageState extends State<ShortsPlayerPage> {
  late PageController _pageController;
  final Set<int> _likedReelIds = {};
  final Set<int> _followedUserIds = {};
  late int _currentActiveIndex;

  // Contrôleurs pour la gestion interactive du champ de commentaire
  final TextEditingController _commentInputController = TextEditingController();
  final FocusNode _commentFocusNode = FocusNode();
  bool _showQuickEmojis = false;
  bool _isImageAttached = false;
  bool _isUploadingImage = false;
  String? _selectedCommentImageUrl;

  @override
  void initState() {
    super.initState();
    _currentActiveIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
    
    // Le manager a déjà été configuré au chargement de la recherche
    widget.preloadManager.setFocusedIndex(widget.initialIndex);

    for (var reel in widget.searchResults) {
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

    // Reconstruction dynamique lors de la saisie pour changer la couleur du bouton d'envoi
    _commentInputController.addListener(() {
      setState(() {});
    });

    // Écoute de la mise à jour des commentaires en temps réel
    widget.socket?.on('reel-comments-updated', _onCommentsUpdatedBroadcast);
  }

  @override
  void dispose() {
    widget.socket?.off('reel-comments-updated', _onCommentsUpdatedBroadcast);
    _pageController.dispose();
    _commentInputController.dispose();
    _commentFocusNode.dispose();
    super.dispose();
  }

  void _onCommentsUpdatedBroadcast(dynamic data) {
    if (!mounted || data == null) return;
    try {
      final reelId = int.tryParse(data['reelId']?.toString() ?? '');
      final count = int.tryParse(data['commentsCount']?.toString() ?? '');
      if (reelId != null && count != null) {
        for (var reel in widget.searchResults) {
          if (int.tryParse(reel['id']?.toString() ?? '') == reelId) {
            setState(() {
              reel['comments_count'] = count;
            });
          }
        }
      }
    } catch (e) {
      debugPrint('Error updating real-time comment count: $e');
    }
  }

  void _onPageChanged(int index) {
    widget.preloadManager.setFocusedIndex(index);
    setState(() {
      _currentActiveIndex = index;
    });
  }

  void _toggleLike(int index, dynamic reel) {
    final reelId = int.tryParse(reel['id']?.toString() ?? '');
    if (reelId == null) return;

    final isCurrentlyLiked = _likedReelIds.contains(reelId);
    setState(() {
      if (isCurrentlyLiked) {
        _likedReelIds.remove(reelId);
        reel['likes_count'] = (reel['likes_count'] ?? 0) - 1;
      } else {
        _likedReelIds.add(reelId);
        reel['likes_count'] = (reel['likes_count'] ?? 0) + 1;
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
      // Propage la redirection de profil en fermant la page de recherche plein écran
      Navigator.pop(context, result);
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

  Future<void> _pickAndUploadImage() async {
    try {
      final ImagePicker picker = ImagePicker();
      final XFile? image = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
      if (image == null) return;

      setState(() {
        _isUploadingImage = true;
        _showQuickEmojis = false;
      });

      final request = http.MultipartRequest(
        'POST',
        Uri.parse('https://trasx.com/api/comments/upload-image'),
      );
      request.headers['x-user-id'] = '${widget.currentUserId}';
      request.files.add(await http.MultipartFile.fromPath('image', image.path));

      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          _selectedCommentImageUrl = data['imageUrl'];
          _isImageAttached = true;
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
      setState(() {
        _isUploadingImage = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Erreur lors de la sélection de l'image.")),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentReel = widget.searchResults[_currentActiveIndex];

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          PageView.builder(
            scrollDirection: Axis.vertical,
            controller: _pageController,
            onPageChanged: _onPageChanged,
            itemCount: widget.searchResults.length,
            itemBuilder: (context, index) {
              final reel = widget.searchResults[index];
              return ReelPageItem(
                index: index,
                reel: reel,
                isLiked: _likedReelIds.contains(int.tryParse(reel['id']?.toString() ?? '')),
                isFollowing: _followedUserIds.contains(int.tryParse(reel['user_id']?.toString() ?? '')),
                currentUserId: widget.currentUserId,
                onLikeToggle: () => _toggleLike(index, reel),
                onFollowToggle: () => _toggleFollow(reel),
                onCommentsPressed: () => _showCommentsSheet(reel),
                onSharePressed: () => _showShareSheet(reel),
                preloadManager: widget.preloadManager, // Utilise le manager partagé
                onViewProfile: (userId) {
                  // Redirige vers le profil
                  Navigator.pop(context, 'profile:$userId');
                },
              );
            },
          ),

          // 1. Barre de recherche flottante en haut (TikTok Style)
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () {
                      if (widget.onBack != null) {
                        widget.onBack!();
                      } else {
                        Navigator.pop(context);
                      }
                    },
                    child: const Padding(
                      padding: EdgeInsets.all(8.0),
                      child: Icon(CupertinoIcons.left_chevron, color: Colors.white, size: 28),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      onTap: () {
                        if (widget.onBack != null) {
                          widget.onBack!();
                        } else {
                          Navigator.pop(context);
                        }
                      },
                      child: Container(
                        height: 38,
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Row(
                          children: [
                            Icon(CupertinoIcons.search, color: Colors.white.withOpacity(0.6), size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                widget.searchQuery.isNotEmpty ? widget.searchQuery : 'Trouver du contenu...',
                                style: const TextStyle(color: Colors.white, fontSize: 14),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  GestureDetector(
                    onTap: () {
                      if (widget.onBack != null) {
                        widget.onBack!();
                      } else {
                        Navigator.pop(context);
                      }
                    },
                    child: Container(
                      alignment: Alignment.center,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: const Text(
                        'Rechercher',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _buildCommentInputBar(context, currentReel),
    );
  }

  Widget _buildCommentInputBar(BuildContext context, dynamic currentReel) {
    final textMuted = Colors.white.withOpacity(0.5);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 1. Image attachée preview banner (si sélectionnée)
        if (_isUploadingImage || _selectedCommentImageUrl != null)
          Container(
            color: const Color(0xFF1E1E1E),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: Container(
                    color: Colors.white24,
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
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
                const Spacer(),
                if (!_isUploadingImage)
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _selectedCommentImageUrl = null;
                        _isImageAttached = false;
                      });
                    },
                    child: const Icon(CupertinoIcons.xmark_circle_fill, color: Colors.white54, size: 18),
                  ),
              ],
            ),
          ),

        // 2. Suggestions d'émojis rapides (si smiley cliqué)
        if (_showQuickEmojis)
          Container(
            height: 44,
            color: Colors.black87,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              children: ['❤️', '😂', '🔥', '👏', '😍', '👍', '🎉', '😊', '😮', '😢', '💯', '💡']
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
                          _commentFocusNode.requestFocus();
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          child: Text(emoji, style: const TextStyle(fontSize: 20)),
                        ),
                      ))
                  .toList(),
            ),
          ),

        // 3. Barre de saisie principale
        Container(
          color: Colors.black,
          padding: EdgeInsets.only(
            left: 12,
            right: 12,
            top: 8,
            bottom: MediaQuery.of(context).padding.bottom + 8,
          ),
          child: Row(
            children: [
              Expanded(
                child: Container(
                  height: 38,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    children: [
                      // Champ de saisie centré verticalement
                      Expanded(
                        child: TextField(
                          controller: _commentInputController,
                          focusNode: _commentFocusNode,
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          textAlignVertical: TextAlignVertical.center, // Centrage vertical
                          decoration: InputDecoration(
                            hintText: 'Ajouter un commentaire...',
                            hintStyle: TextStyle(color: textMuted, fontSize: 14),
                            border: InputBorder.none,
                            isCollapsed: true, // Supprime les marges internes par défaut
                            contentPadding: const EdgeInsets.symmetric(vertical: 10), // Calage parfait
                          ),
                          onSubmitted: (val) {
                            _submitComment(currentReel);
                          },
                        ),
                      ),
                      // Bouton Image (Simulation)
                      GestureDetector(
                        onTap: _pickAndUploadImage,
                        child: Icon(
                          CupertinoIcons.photo,
                          color: _selectedCommentImageUrl != null ? const Color(0xFFE9435A) : Colors.white.withOpacity(0.7),
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 10),
                      // Bouton Smiley
                      GestureDetector(
                        onTap: () {
                          setState(() {
                            _showQuickEmojis = !_showQuickEmojis;
                          });
                        },
                        child: Icon(
                          CupertinoIcons.smiley,
                          color: _showQuickEmojis ? const Color(0xFFE9435A) : Colors.white.withOpacity(0.7),
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 10),
                      // Bouton Tag/Mention (@)
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
                          _commentFocusNode.requestFocus();
                        },
                        child: Icon(
                          CupertinoIcons.at,
                          color: Colors.white.withOpacity(0.7),
                          size: 20,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // Bouton avion d'envoi à droite
              GestureDetector(
                onTap: () => _submitComment(currentReel),
                child: Padding(
                  padding: const EdgeInsets.only(left: 12.0, right: 4.0),
                  child: Icon(
                    CupertinoIcons.paperplane_fill,
                    color: _commentInputController.text.trim().isNotEmpty || _selectedCommentImageUrl != null
                        ? const Color(0xFFE9435A)
                        : Colors.white38,
                    size: 20,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _submitComment(dynamic currentReel) {
    final val = _commentInputController.text.trim();
    if (val.isEmpty && _selectedCommentImageUrl == null) return;

    final reelId = int.tryParse(currentReel['id']?.toString() ?? '');
    if (reelId != null) {
      widget.socket?.emit('reel-comment-add', {
        'reelId': reelId,
        'content': val,
        'imageUrl': _selectedCommentImageUrl,
      });

      // Incrémentation locale immédiate en attendant le broadcast
      setState(() {
        currentReel['comments_count'] = (currentReel['comments_count'] ?? 0) + 1;
        _commentInputController.clear();
        _selectedCommentImageUrl = null;
        _isImageAttached = false;
        _showQuickEmojis = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Commentaire ajouté !'),
          duration: Duration(seconds: 1),
        ),
      );
    }
  }
}

class SearchReelThumbnail extends StatefulWidget {
  final String videoUrl;
  final String? thumbnailUrl;

  const SearchReelThumbnail({
    Key? key,
    required this.videoUrl,
    this.thumbnailUrl,
  }) : super(key: key);

  @override
  State<SearchReelThumbnail> createState() => _SearchReelThumbnailState();
}

class _SearchReelThumbnailState extends State<SearchReelThumbnail> {
  VideoPlayerController? _controller;
  bool _isInitialized = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    if (widget.thumbnailUrl == null || widget.thumbnailUrl!.isEmpty) {
      // Retardateur de 150ms pour optimiser le chargement lourd en défilement
      Future.delayed(const Duration(milliseconds: 150), () {
        if (mounted) {
          _initializeVideo();
        }
      });
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
    if (widget.thumbnailUrl != null && widget.thumbnailUrl!.isNotEmpty) {
      final fullThumbUrl = widget.thumbnailUrl!.startsWith('http')
          ? widget.thumbnailUrl!
          : 'https://trasx.com${widget.thumbnailUrl!.startsWith('/') ? widget.thumbnailUrl! : '/${widget.thumbnailUrl!}'}';
      return CachedNetworkImage(
        imageUrl: fullThumbUrl,
        fit: BoxFit.cover,
        placeholder: (_, __) => Container(color: Colors.white10),
        errorWidget: (_, __, ___) => const Center(
          child: Icon(CupertinoIcons.play_rectangle, color: Colors.white24, size: 40),
        ),
      );
    }

    if (_hasError) {
      return const Center(
        child: Icon(CupertinoIcons.play_rectangle, color: Colors.white24, size: 40),
      );
    }

    if (!_isInitialized) {
      return Container(
        color: Colors.white10,
        child: const Center(
          child: CupertinoActivityIndicator(color: Colors.white30),
        ),
      );
    }

    return FittedBox(
      fit: BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: SizedBox(
        width: _controller!.value.size.width,
        height: _controller!.value.size.height,
        child: VideoPlayer(_controller!),
      ),
    );
  }
}
