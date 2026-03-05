import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:mic_stream/mic_stream.dart';
import 'package:onnxruntime/onnxruntime.dart';

class WakeWordService extends ChangeNotifier {
  OrtSession? _session;
  StreamSubscription<List<int>>? _audioSubscription;
  final StreamController<bool> _wakeWordController = StreamController<bool>.broadcast();
  
  Stream<bool> get onWakeWord => _wakeWordController.stream;
  
  bool _isListening = false;
  bool get isListening => _isListening;
  
  bool _isLoaded = false;
  bool get isLoaded => _isLoaded;

  // Audio settings for Hey Jarvis model (16kHz, mono)
  static const int sampleRate = 16000;
  static const int frameLength = 1280; // 80ms at 16kHz
  
  Future<void> init() async {
    if (_isLoaded) return;

    try {
      debugPrint('[WakeWord] Initializing ONNX Runtime...');
      OrtEnv.instance.init();
      
      final sessionOptions = OrtSessionOptions();
      // Use NNAPI on Android if available for better performance/battery
      // sessionOptions.addExucutionProvider(OrtExecutionProvider.nnapi); 
      
      const assetPath = 'assets/models/hey_jarvis_v0.1.onnx';
      final rawAsset = await rootBundle.load(assetPath);
      final bytes = rawAsset.buffer.asUint8List();
      
      _session = OrtSession.fromBuffer(bytes, sessionOptions);
      _isLoaded = true;
      debugPrint('[WakeWord] Model loaded successfully');
    } catch (e) {
      debugPrint('[WakeWord] Failed to load model: $e');
      // For the spike, we don't want to crash the app if the model fails
    }
  }

  Future<void> startListening() async {
    if (!_isLoaded) {
      debugPrint('[WakeWord] Model not loaded, cannot start listening');
      return;
    }
    if (_isListening) return;

    try {
      debugPrint('[WakeWord] Starting microphone stream...');
      Stream<List<int>>? stream = await MicStream.microphone(
        sampleRate: sampleRate,
        channelConfig: ChannelConfig.CHANNEL_IN_MONO,
        audioFormat: AudioFormat.ENCODING_PCM_16BIT,
      );

      if (stream == null) {
        debugPrint('[WakeWord] Failed to get microphone stream');
        return;
      }

      _isListening = true;
      notifyListeners();

      List<int> buffer = [];

      _audioSubscription = stream.listen((samples) {
        buffer.addAll(samples);
        
        // Process when we have enough data (chunk size)
        // Note: Real implementation needs a rolling window and Mel Spectrogram conversion
        // This is a placeholder for the data flow
        if (buffer.length >= frameLength * 2) { // *2 for 16-bit
          _processAudioFrame(buffer.sublist(0, frameLength * 2));
          buffer.removeRange(0, frameLength * 2); 
        }
      });
      
    } catch (e) {
      debugPrint('[WakeWord] Error starting stream: $e');
      _isListening = false;
      notifyListeners();
    }
  }

  Future<void> stopListening() async {
    await _audioSubscription?.cancel();
    _audioSubscription = null;
    _isListening = false;
    notifyListeners();
    debugPrint('[WakeWord] Stopped listening');
  }

  void debugTriggerWakeWord() {
    _wakeWordController.add(true);
  }

  Future<void> _processAudioFrame(List<int> pcmBytes) async {
    if (_session == null) return;
    
    // TODO: 
    // 1. Convert PCM bytes to Float32List
    // 2. Compute Mel Spectrogram (The Hard Part™)
    // 3. Run Inference
    
    // Mock inference for Spike:
    // Randomly trigger wake word for testing UI integration? 
    // Or just simple RMS check?
    
    // For now, we just acknowledge receipt
    // debugPrint('[WakeWord] Processed frame of ${pcmBytes.length} bytes');
  }

  @override
  void dispose() {
    stopListening();
    _session?.release();
    _wakeWordController.close();
    OrtEnv.instance.release();
    super.dispose();
  }
}
