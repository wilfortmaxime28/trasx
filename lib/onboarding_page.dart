import 'dart:ui';
import 'package:flutter/material.dart';
import 'login_page.dart';

class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> with SingleTickerProviderStateMixin {
  final PageController _pageController = PageController();
  int _currentIndex = 0;
  bool _showSplash = true;

  late AnimationController _logoAnimationController;
  late Animation<double> _logoScale;
  late Animation<double> _logoOpacity;

  // Instagram gradient colors
  static const List<Color> instagramGradient = [
    Color(0xFF833AB4), // Purple
    Color(0xFFC13584), // Magenta
    Color(0xFFE1306C), // Pink
    Color(0xFFFD1D1D), // Red
    Color(0xFFF77737), // Orange-Red
    Color(0xFFFCAF45), // Orange-Yellow
  ];

  @override
  void initState() {
    super.initState();

    // Setup animation controller for splash logo pop
    _logoAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );

    _logoScale = Tween<double>(begin: 0.6, end: 1.0).animate(
      CurvedAnimation(
        parent: _logoAnimationController,
        curve: Curves.elasticOut,
      ),
    );

    _logoOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _logoAnimationController,
        curve: const Interval(0.0, 0.6, curve: Curves.easeIn),
      ),
    );

    // Start logo animation
    _logoAnimationController.forward();

    // Keep splash screen visible for 2.2 seconds, then transition to onboarding
    Future.delayed(const Duration(milliseconds: 2200), () {
      if (mounted) {
        setState(() {
          _showSplash = false;
        });
      }
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    _logoAnimationController.dispose();
    super.dispose();
  }

  void _onPageChanged(int index) {
    setState(() {
      _currentIndex = index;
    });
  }

  void _nextPage() {
    if (_currentIndex < 2) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    } else {
      // Go to login page
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (context) => const LoginPage(),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final Size size = MediaQuery.of(context).size;

    if (_showSplash) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: _buildBackground(
          child: Center(
            child: ScaleTransition(
              scale: _logoScale,
              child: FadeTransition(
                opacity: _logoOpacity,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Logo Image with white tint on black background
                    ClipRRect(
                      borderRadius: BorderRadius.circular(20),
                      child: Image.asset(
                        'assets/logo.png',
                        height: 100,
                        width: 100,
                        fit: BoxFit.cover,
                        color: Colors.white,
                        colorBlendMode: BlendMode.srcIn,
                        errorBuilder: (context, error, stackTrace) {
                          return Container(
                            height: 100,
                            width: 100,
                            decoration: const BoxDecoration(
                              gradient: LinearGradient(
                                colors: instagramGradient,
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.bolt_rounded,
                              color: Colors.black,
                              size: 55,
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 24),
                    // Beautiful styled title with Instagram gradient on "SX"
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          'TRA',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 2.0,
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
                              fontSize: 34,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 2.0,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'JEUX, LIVES & HASHTAGS',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.6),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 3.0,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: _buildBackground(
        child: SafeArea(
          bottom: true,
          child: Column(
            children: [
              const SizedBox(height: 12),
              // PageContent (PageView)
              Expanded(
                child: PageView(
                  controller: _pageController,
                  onPageChanged: _onPageChanged,
                  physics: const BouncingScrollPhysics(),
                  children: [
                    // Screen 1: Mosaic Photo Grid Intro (Gaming, Social & Monetisation)
                    _buildSocialGamingIntroSlide(size),

                    // Screen 2: Board Games & Lives (Free/Paid)
                    _buildSlide(
                      context: context,
                      title: 'Jeux & Lives rémunérateurs',
                      description:
                          'Défiez des joueurs du monde entier sur des jeux de société gratuits ou payants. Lancez des streams payants ou gratuits pour votre communauté.',
                      visual: _buildGamingLobbyMockup(size),
                    ),

                    // Screen 3: Hashtags Payants & Royalties
                    _buildSlide(
                      context: context,
                      title: 'Vos Hashtags, Vos Royalties',
                      description:
                          'Devenez propriétaire de hashtags uniques. Touchez des royalties en temps réel à chaque fois que d\'autres utilisateurs les mentionnent.',
                      visual: _buildHashtagsMockup(size),
                    ),
                  ],
                ),
              ),

              // Bottom Actions (Indicator + Navigation Row + Terms)
              Padding(
                padding: const EdgeInsets.fromLTRB(24.0, 10.0, 24.0, 24.0),
                child: Column(
                  children: [
                    // Page Indicator dots
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(3, (index) => _buildIndicatorDot(index)),
                    ),
                    const SizedBox(height: 24),

                    // Bottom Navigation Row: Back circular button + White Pill Next Button
                    Row(
                      children: [
                        // Circular Black Back Button (only shown for pages 1 and 2)
                        if (_currentIndex > 0) ...[
                          GestureDetector(
                            onTap: () {
                              _pageController.previousPage(
                                duration: const Duration(milliseconds: 300),
                                curve: Curves.easeInOut,
                              );
                            },
                            child: Container(
                              height: 48,
                              width: 48,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
                                color: Colors.black54,
                              ),
                              child: const Icon(
                                Icons.arrow_back_ios_new_rounded,
                                color: Colors.white,
                                size: 14,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                        ],
                        // Next/Start Button
                        Expanded(
                          child: InkWell(
                            onTap: _nextPage,
                            borderRadius: BorderRadius.circular(30),
                            child: Container(
                              height: 48,
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(30),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.3),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 8.0),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    const SizedBox(width: 36), // balance space
                                    Expanded(
                                      child: Center(
                                        child: Text(
                                          _currentIndex == 2
                                              ? 'Commencer l\'aventure'
                                              : 'Démarrer l\'aventure',
                                          style: const TextStyle(
                                            color: Colors.black,
                                            fontSize: 15,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                    ),
                                    // Black arrow circle
                                    Container(
                                      height: 36,
                                      width: 36,
                                      decoration: const BoxDecoration(
                                        color: Colors.black,
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(
                                        Icons.arrow_forward_rounded,
                                        color: Colors.white,
                                        size: 18,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Already have an account? Sign in link
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Text(
                          'Déjà un compte ?',
                          style: TextStyle(
                            color: Colors.white54,
                            fontSize: 13,
                          ),
                        ),
                        GestureDetector(
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (context) => const LoginPage(),
                              ),
                            );
                          },
                          child: const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                            child: Text(
                              'Se connecter',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.bold,
                                decoration: TextDecoration.underline,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // RichText Conditions of Use & Privacy Policy
                    Text.rich(
                      TextSpan(
                        text: 'En continuant, vous acceptez nos ',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.45),
                          fontSize: 11,
                        ),
                        children: [
                          TextSpan(
                            text: "Conditions d'utilisation",
                            style: const TextStyle(
                              color: Colors.white70,
                              fontWeight: FontWeight.bold,
                              decoration: TextDecoration.underline,
                            ),
                          ),
                          TextSpan(
                            text: ' et notre ',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.45),
                            ),
                          ),
                          TextSpan(
                            text: 'Politique de confidentialité',
                            style: const TextStyle(
                              color: Colors.white70,
                              fontWeight: FontWeight.bold,
                              decoration: TextDecoration.underline,
                            ),
                          ),
                          TextSpan(
                            text: '.',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.45),
                            ),
                          ),
                        ],
                      ),
                      textAlign: TextAlign.center,
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

  // Double Radial Glow background helper (Instagram Pink/Purple and Orange/Yellow)
  Widget _buildBackground({required Widget child}) {
    return Stack(
      children: [
        Container(color: Colors.black),
        // Top-left Instagram Pink/Purple glow
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
        // Bottom-right Instagram Orange/Yellow glow
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
        // BackdropFilter to blur and spread the glow smoothly
        Positioned.fill(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 95, sigmaY: 95),
            child: Container(color: Colors.transparent),
          ),
        ),
        child,
      ],
    );
  }

  // Social, Gaming & Monetisation Intro Slide
  Widget _buildSocialGamingIntroSlide(Size size) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24.0),
      child: Column(
        children: [
          // 1. Mosaic Grid with a vertical dark fade overlay (grid height set to 36% to avoid vertical scrolling)
          Stack(
            children: [
              _buildPhotoMosaicGrid(size),
              // Overlay fondu (fade) progressing from transparent at the top to black at the bottom
              Positioned.fill(
                child: IgnorePointer(
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          Colors.black.withValues(alpha: 0.0),
                          Colors.black.withValues(alpha: 0.25),
                          Colors.black.withValues(alpha: 0.7),
                          Colors.black,
                        ],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        stops: const [0.0, 0.45, 0.75, 1.0],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // 2. Title & Subtitle in French (focused on gaming & monetisation)
          const Text(
            'Jouez. Partagez. Monétisez.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
              letterSpacing: -0.8,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Rejoignez TrasX, la plateforme où les jeux de société, le streaming et les hashtags payants se transforment en revenus.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white70,
              fontSize: 13,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 12),

          // 3. Option Selection Box with rounded 30px & Instagram gradient border (Double Container)
          Container(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: instagramGradient,
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(30),
            ),
            padding: const EdgeInsets.all(1.5),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.black,
                borderRadius: BorderRadius.circular(28.5),
              ),
              child: Row(
                children: [
                  // Checked indicator circle
                  Container(
                    height: 20,
                    width: 20,
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: instagramGradient,
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.check_rounded,
                      color: Colors.white,
                      size: 12,
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Text description
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Accès Joueur & Créateur',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Jeux mondiaux, Lives & Hashtags payants',
                          style: TextStyle(
                            color: Colors.white60,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Gradient Beta badge
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFC13584).withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFC13584), width: 1),
                        ),
                        child: const Text(
                          'BÊTA',
                          style: TextStyle(
                            color: Color(0xFFE1306C),
                            fontSize: 9,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // Taller portrait images grid (increased to ~52% of the height, gaps 4px)
  Widget _buildPhotoMosaicGrid(Size size) {
    final double gridHeight = size.height * 0.42;
    return SizedBox(
      height: gridHeight,
      width: double.infinity,
      child: Column(
        children: [
          // Top Row (3 vertical portrait photos)
          Expanded(
            flex: 9,
            child: Row(
              children: [
                Expanded(
                  child: _buildNetworkImageCard(
                    url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&fit=crop&q=80', // Gamer
                  ),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: _buildNetworkImageCard(
                    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&fit=crop&q=80', // Social girl
                  ),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: _buildNetworkImageCard(
                    url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&fit=crop&q=80', // Lifestyle
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          // Bottom Row (Left shorter photo, Right vertical taller photo)
          Expanded(
            flex: 11,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  flex: 4,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        flex: 7,
                        child: _buildNetworkImageCard(
                          url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&fit=crop&q=80', // Laughing guy
                        ),
                      ),
                      const Spacer(flex: 1), // Shorter empty space
                    ],
                  ),
                ),
                const SizedBox(width: 4),
                Expanded(
                  flex: 3,
                  child: _buildNetworkImageCard(
                    url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=400&fit=crop&q=80', // Gaming setup
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Network image card builder
  Widget _buildNetworkImageCard({required String url}) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: Image.network(
        url,
        fit: BoxFit.cover,
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return _buildFallbackImagePlaceholder();
        },
        errorBuilder: (context, error, stackTrace) {
          return _buildFallbackImagePlaceholder();
        },
      ),
    );
  }

  // Fallback placeholder containing Instagram colors
  Widget _buildFallbackImagePlaceholder() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: instagramGradient,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: const Center(
        child: Icon(Icons.photo_rounded, color: Colors.white60, size: 20),
      ),
    );
  }

  // Animated page indicator dots with Instagram colors
  Widget _buildIndicatorDot(int index) {
    bool isActive = _currentIndex == index;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      margin: const EdgeInsets.symmetric(horizontal: 4.0),
      height: 8.0,
      width: isActive ? 24.0 : 8.0,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        gradient: isActive
            ? const LinearGradient(
                colors: instagramGradient,
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              )
            : null,
        color: isActive ? null : Colors.white24,
      ),
    );
  }

  // Visual Mockup for Slide 2: Gaming Lobby & Paid Live Streams
  Widget _buildGamingLobbyMockup(Size size) {
    return Container(
      width: size.width * 0.78,
      height: size.height * 0.28,
      padding: const EdgeInsets.all(16.0),
      decoration: BoxDecoration(
        color: const Color(0xFF121212),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.5),
            blurRadius: 20,
            spreadRadius: 2,
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Gaming section
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: Colors.purple.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.sports_esports_rounded, color: Colors.purpleAccent, size: 16),
              ),
              const SizedBox(width: 8),
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Jeux de société mondiaux',
                    style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    'Échecs, Ludo, Dames... gratuit ou payant',
                    style: TextStyle(color: Colors.white54, fontSize: 10),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Lobby Join Box
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E1E),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Table #402 (Défis payant)', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                    SizedBox(height: 2),
                    Text('Mise: 5.0 XTX • Cashprize: 18.0 XTX', style: TextStyle(color: Colors.white70, fontSize: 9)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: instagramGradient),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'Jouer (5 XTX)',
                    style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Paid Live Stream banner
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: Colors.red.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.live_tv_rounded, color: Colors.redAccent, size: 16),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Lancer des Lives payants', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                    Text('Faites payer l\'entrée de vos lives exclusifs', style: TextStyle(color: Colors.white54, fontSize: 10)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xFFC13584).withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: const Color(0xFFC13584)),
                ),
                child: const Text('STREAM PAYANT', style: TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // Visual Mockup for Slide 3: Paid Hashtags & Royalties Dashboard
  Widget _buildHashtagsMockup(Size size) {
    return Container(
      width: size.width * 0.78,
      height: size.height * 0.28,
      padding: const EdgeInsets.all(16.0),
      decoration: BoxDecoration(
        color: const Color(0xFF121212),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.5),
            blurRadius: 20,
            spreadRadius: 2,
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Hashtag header
          Row(
            children: [
              // Glowing hashtag symbol
              ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(
                  colors: instagramGradient,
                ).createShader(bounds),
                child: const Text(
                  '#',
                  style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w900),
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '#GamingPro2026',
                      style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Propriétaire: @vous • Royalties: 1.5% / utilisation',
                      style: TextStyle(color: Colors.white54, fontSize: 10),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.verified_user_rounded, color: Colors.blueAccent, size: 20),
            ],
          ),
          const SizedBox(height: 12),

          // Total Earnings Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Royalties cumulées', style: TextStyle(color: Colors.white70, fontSize: 11)),
              ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(colors: instagramGradient).createShader(bounds),
                child: const Text(
                  '+ 350.25 XTX (~\$1,260)',
                  style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const Divider(color: Colors.white10, height: 16),

          // Recent activity logs
          const Text('Activités récentes :', style: TextStyle(color: Colors.white60, fontSize: 9, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          _buildActivityLog(user: '@steve_g', detail: 'a posté avec votre hashtag', reward: '+0.05 XTX'),
          const SizedBox(height: 4),
          _buildActivityLog(user: '@chloe_art', detail: 'a utilisé votre hashtag', reward: '+0.05 XTX'),
        ],
      ),
    );
  }

  Widget _buildActivityLog({required String user, required String detail, required String reward}) {
    return Row(
      children: [
        const Icon(Icons.trending_up_rounded, color: Colors.greenAccent, size: 12),
        const SizedBox(width: 6),
        Text(user, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
        const SizedBox(width: 4),
        Expanded(child: Text(detail, style: const TextStyle(color: Colors.white54, fontSize: 10), overflow: TextOverflow.ellipsis)),
        Text(reward, style: const TextStyle(color: Colors.greenAccent, fontSize: 10, fontWeight: FontWeight.bold)),
      ],
    );
  }

  // Slide Layout Builder
  Widget _buildSlide({
    required BuildContext context,
    required String title,
    required String description,
    required Widget visual,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Expanded(
            flex: 11,
            child: Center(child: visual),
          ),
          const SizedBox(height: 10),
          Expanded(
            flex: 6,
            child: Column(
              children: [
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    letterSpacing: -0.5,
                    height: 1.25,
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  description,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 14,
                    height: 1.5,
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
