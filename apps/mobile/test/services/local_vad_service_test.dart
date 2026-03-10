import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/local_vad_service.dart';

// NOTE: These tests cover state management only. The actual VAD detection
// (Silero model, microphone input) requires device hardware and is validated
// through field testing, not unit tests.
//
// We cannot call startListening() in unit tests because VadHandler.create()
// initializes native platform channels that are not available in the test
// environment. Instead we verify the service's initial state and the guards
// that prevent redundant start/stop calls.

void main() {
  group('LocalVadService', () {
    late LocalVadService service;
    late int speechCount;

    setUp(() {
      speechCount = 0;
      service = LocalVadService(
        onSpeechDetected: () => speechCount++,
      );
    });

    test('isListening starts as false', () {
      expect(service.isListening, isFalse);
    });

    test('dispose can be called on a fresh instance without error', () {
      // Should not throw even though we never started listening
      service.dispose();
      expect(service.isListening, isFalse);
    });

    test('stopListening is a no-op when not listening', () async {
      // Should not throw
      await service.stopListening();
      expect(service.isListening, isFalse);
    });

    test('onSpeechDetected callback is stored', () {
      // Verify the callback fires when invoked directly
      expect(speechCount, 0);
      service.onSpeechDetected();
      expect(speechCount, 1);
    });
  });
}
