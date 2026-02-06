import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'screens/conversation_screen.dart';

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

  runApp(const FletcherApp());
}

class FletcherApp extends StatelessWidget {
  const FletcherApp({super.key});

  @override
  Widget build(BuildContext context) {
    final livekitUrl = dotenv.env['LIVEKIT_URL'] ?? '';
    final livekitToken = dotenv.env['LIVEKIT_TOKEN'] ?? '';

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
      home: ConversationScreen(
        livekitUrl: livekitUrl,
        token: livekitToken,
      ),
    );
  }
}
