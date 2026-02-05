import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'screens/conversation_screen.dart';

// TODO: Replace with your LiveKit credentials
// Generate a token with: bun run token:generate
const String livekitUrl = 'wss://YOUR-PROJECT.livekit.cloud';
const String livekitToken = 'YOUR_TOKEN_HERE';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Force dark status bar
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
    ),
  );

  runApp(const FletcherApp());
}

class FletcherApp extends StatelessWidget {
  const FletcherApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Fletcher',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFF59E0B),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF0D0D0D),
        useMaterial3: true,
      ),
      home: const ConversationScreen(
        livekitUrl: livekitUrl,
        token: livekitToken,
      ),
    );
  }
}
