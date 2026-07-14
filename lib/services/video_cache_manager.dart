// lib/services/video_cache_manager.dart
import 'dart:io';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:http/http.dart' as http;

class VideoCacheManager {
  static const String _cacheKey = 'video_cache_manager';

  static final CacheManager instance = CacheManager(
    Config(
      _cacheKey,
      stalePeriod: const Duration(days: 3),
      maxNrOfCacheObjects: 50,
    ),
  );

  /// Récupère le fichier vidéo depuis le cache local s'il existe et est valide.
  static Future<File?> getCachedFile(String url) async {
    try {
      final fileInfo = await instance.getFileFromCache(url);
      if (fileInfo != null && await fileInfo.file.exists()) {
        return fileInfo.file;
      }
    } catch (_) {}
    return null;
  }

  /// Prefetch/télécharge une vidéo en tâche de fond pour une lecture ultérieure.
  static Future<void> prefetchVideo(String url) async {
    try {
      final fileInfo = await instance.getFileFromCache(url);
      if (fileInfo == null) {
        // Déclenche le téléchargement sans bloquer
        instance.downloadFile(url);
      }
    } catch (_) {}
  }

  /// Efface tout le cache vidéo.
  static Future<void> clearCache() async {
    await instance.emptyCache();
  }

  /// Vérifie si le serveur hébergeant la vidéo prend en charge les requêtes HTTP Range
  /// et renvoie le code de statut 206 Partial Content.
  static Future<bool> checkServerSupportsRange(String url) async {
    try {
      final response = await http.get(
        Uri.parse(url),
        headers: {'Range': 'bytes=0-0'},
      );
      if (response.statusCode == 206) return true;
      final acceptRanges = response.headers['accept-ranges']?.toLowerCase();
      if (acceptRanges == 'bytes') return true;
    } catch (_) {}
    return false;
  }
}
