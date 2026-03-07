import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'screens/conversation_screen.dart';
import 'theme/app_colors.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load environment variables from .env file
  await dotenv.load(fileName: '.env');

  // Force dark status bar
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
    ),
  );

  // Lock app to portrait orientation (Brutalist UI designed for portrait only)
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const FletcherApp());
}

class FletcherApp extends StatelessWidget {
  const FletcherApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Collect all configured LiveKit URLs for the resolver to race.
    // Whichever responds first wins (LAN, Tailscale, emulator — all safe to try).
    final livekitUrls = [
      dotenv.env['LIVEKIT_URL'],
      dotenv.env['LIVEKIT_URL_TAILSCALE'],
      dotenv.env['LIVEKIT_URL_EMULATOR'],
    ].where((u) => u != null && u.isNotEmpty).cast<String>().toList();

    // TOKEN_SERVER_PORT: must match TOKEN_SERVER_PORT in docker-compose.yml
    final tokenServerPort =
        int.tryParse(dotenv.env['TOKEN_SERVER_PORT'] ?? '') ?? 7882;
    // DEPARTURE_TIMEOUT_S: must match room.departure_timeout in livekit.yaml
    // The client uses this to decide when a saved room is stale (session gone)
    // and to size the reconnect budget (departure_timeout + 10s margin).
    final departureTimeoutS =
        int.tryParse(dotenv.env['DEPARTURE_TIMEOUT_S'] ?? '') ?? 120;

    return MaterialApp(
      title: 'Fletcher',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        fontFamily: 'monospace',
        colorScheme: const ColorScheme(
          brightness: Brightness.dark,
          primary: AppColors.amber,
          onPrimary: AppColors.background,
          secondary: AppColors.cyan,
          onSecondary: AppColors.background,
          error: AppColors.healthRed,
          onError: AppColors.textPrimary,
          surface: AppColors.surface,
          onSurface: AppColors.textPrimary,
        ),
        scaffoldBackgroundColor: AppColors.background,
        useMaterial3: true,
      ),
      home: ConversationScreen(
        livekitUrls: livekitUrls,
        tokenServerPort: tokenServerPort,
        departureTimeoutS: departureTimeoutS,
      ),
    );
  }
}
