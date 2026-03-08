import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';
import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/widgets/mic_button.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Center(child: child),
    ),
  );
}

void main() {
  group('MicButton', () {
    testWidgets('renders mic icon when not muted', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.idle,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () {},
        ),
      ));

      expect(find.byIcon(Icons.mic_rounded), findsOneWidget);
    });

    testWidgets('renders mic_off icon when muted', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.idle,
          aiAudioLevel: 0.0,
          isMuted: true,
          onToggleMute: () {},
        ),
      ));

      expect(find.byIcon(Icons.mic_off_rounded), findsOneWidget);
    });

    testWidgets('has 56dp x 56dp size', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.idle,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () {},
        ),
      ));

      final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
      expect(sizedBox.width, 56);
      expect(sizedBox.height, 56);
    });

    testWidgets('calls onToggleMute when tapped', (tester) async {
      var toggled = false;
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.idle,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () => toggled = true,
        ),
      ));

      await tester.tap(find.byType(MicButton));
      await tester.pump();

      expect(toggled, isTrue);
    });

    testWidgets('has amber border when idle', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.idle,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () {},
        ),
      ));

      // Find the main button container (56x56 with border)
      final containers = find.byType(Container);
      bool foundAmberBorder = false;
      for (final element in containers.evaluate()) {
        final widget = element.widget as Container;
        final decoration = widget.decoration;
        if (decoration is BoxDecoration &&
            decoration.color == AppColors.surface) {
          final border = decoration.border as Border?;
          if (border != null && border.top.color == AppColors.amber) {
            foundAmberBorder = true;
            break;
          }
        }
      }
      expect(foundAmberBorder, isTrue);
    });

    testWidgets('has red border when error', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.error,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () {},
        ),
      ));

      final containers = find.byType(Container);
      bool foundRedBorder = false;
      for (final element in containers.evaluate()) {
        final widget = element.widget as Container;
        final decoration = widget.decoration;
        if (decoration is BoxDecoration &&
            decoration.color == AppColors.surface) {
          final border = decoration.border as Border?;
          if (border != null && border.top.color == AppColors.healthRed) {
            foundRedBorder = true;
            break;
          }
        }
      }
      expect(foundRedBorder, isTrue);
    });

    testWidgets('has sharp corners (BorderRadius.zero)', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.idle,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () {},
        ),
      ));

      final containers = find.byType(Container);
      for (final element in containers.evaluate()) {
        final widget = element.widget as Container;
        final decoration = widget.decoration;
        if (decoration is BoxDecoration &&
            decoration.color == AppColors.surface) {
          expect(decoration.borderRadius, BorderRadius.zero);
          break;
        }
      }
    });

    testWidgets('has dimmed opacity when connecting', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.connecting,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () {},
        ),
      ));

      final opacity = tester.widget<Opacity>(find.byType(Opacity));
      expect(opacity.opacity, 0.5);
    });

    testWidgets('has Semantics label', (tester) async {
      await tester.pumpWidget(_wrap(
        MicButton(
          status: ConversationStatus.idle,
          aiAudioLevel: 0.0,
          isMuted: false,
          onToggleMute: () {},
        ),
      ));

      expect(
        find.bySemanticsLabel(
          RegExp(r'Microphone.*listening.*Double tap to toggle mute'),
        ),
        findsOneWidget,
      );
    });
  });
}
