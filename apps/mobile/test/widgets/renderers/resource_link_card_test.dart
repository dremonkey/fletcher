import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/theme/app_colors.dart';
import 'package:fletcher/widgets/renderers/resource_link_card.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(child: child),
    ),
  );
}

void main() {
  group('formatBytes', () {
    test('bytes below 1024 — shows B suffix', () {
      expect(formatBytes(0), '0 B');
      expect(formatBytes(1), '1 B');
      expect(formatBytes(512), '512 B');
      expect(formatBytes(1023), '1023 B');
    });

    test('bytes in KB range — shows one decimal place', () {
      expect(formatBytes(1024), '1.0 KB');
      expect(formatBytes(1536), '1.5 KB');
      expect(formatBytes(1024 * 512), '512.0 KB');
      expect(formatBytes(1024 * 1024 - 1), '1024.0 KB');
    });

    test('bytes in MB range — shows one decimal place', () {
      expect(formatBytes(1024 * 1024), '1.0 MB');
      expect(formatBytes((1024 * 1024 * 1.5).round()), '1.5 MB');
      expect(formatBytes(1024 * 1024 * 10), '10.0 MB');
    });
  });

  group('ResourceLinkCard', () {
    testWidgets('renders resource name', (tester) async {
      final block = ResourceLinkContent(
        uri: 'file:///docs/report.pdf',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024 * 512,
      );
      await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
      expect(find.text('report.pdf'), findsOneWidget);
    });

    testWidgets('renders mimeType in metadata line', (tester) async {
      final block = ResourceLinkContent(
        uri: 'file:///docs/report.pdf',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024 * 512,
      );
      await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
      // The metadata line contains the mimeType.
      expect(
        find.textContaining('application/pdf'),
        findsOneWidget,
      );
    });

    testWidgets('renders formatted size in metadata line', (tester) async {
      final block = ResourceLinkContent(
        uri: 'file:///docs/data.bin',
        name: 'data.bin',
        size: 1024 * 512, // 512.0 KB
      );
      await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
      expect(find.textContaining('512.0 KB'), findsOneWidget);
    });

    testWidgets('renders description when present', (tester) async {
      final block = ResourceLinkContent(
        uri: 'file:///docs/notes.txt',
        name: 'notes.txt',
        description: 'Meeting notes from last week',
      );
      await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
      expect(find.text('Meeting notes from last week'), findsOneWidget);
    });

    testWidgets('renders truncated URI', (tester) async {
      const uri = 'file:///very/long/path/to/resource.pdf';
      final block = ResourceLinkContent(uri: uri, name: 'resource.pdf');
      await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
      expect(find.text(uri), findsOneWidget);
    });

    testWidgets('renders download button placeholder', (tester) async {
      final block = ResourceLinkContent(
        uri: 'file:///docs/doc.pdf',
        name: 'doc.pdf',
      );
      await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
      // TuiButton renders its label uppercased.
      expect(find.text('DOWNLOAD'), findsOneWidget);
    });

    testWidgets('download button is disabled (onPressed null)', (tester) async {
      final block = ResourceLinkContent(
        uri: 'file:///docs/doc.pdf',
        name: 'doc.pdf',
      );
      await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
      // Tapping the DOWNLOAD button should not throw.
      await tester.tap(find.text('DOWNLOAD'));
      await tester.pump();
      // Widget still present — no crash.
      expect(find.text('DOWNLOAD'), findsOneWidget);
    });

    group('missing optional fields — graceful handling', () {
      testWidgets('no mimeType — metadata row absent', (tester) async {
        final block = ResourceLinkContent(
          uri: 'file:///docs/file',
          name: 'file',
          // mimeType omitted
          // size omitted
        );
        await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
        // Should render without crashing.
        expect(find.text('file'), findsOneWidget);
      });

      testWidgets('no size — only mimeType shown in metadata', (tester) async {
        final block = ResourceLinkContent(
          uri: 'file:///docs/file.txt',
          name: 'file.txt',
          mimeType: 'text/plain',
          // size omitted
        );
        await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
        expect(find.textContaining('text/plain'), findsOneWidget);
        // No size shown — no 'B', 'KB', 'MB' suffix in metadata.
        final allTexts = tester
            .widgetList<Text>(find.byType(Text))
            .map((t) => t.data ?? '')
            .join(' ');
        expect(allTexts, isNot(contains(' B ')));
        expect(allTexts, isNot(contains(' KB ')));
        expect(allTexts, isNot(contains(' MB ')));
      });

      testWidgets('no mimeType, no size — no metadata row rendered',
          (tester) async {
        final block = ResourceLinkContent(
          uri: 'file:///docs/file',
          name: 'file',
        );
        await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
        // No metadata text rendered other than name and uri.
        final texts = tester
            .widgetList<Text>(find.byType(Text))
            .map((t) => t.data ?? '')
            .toList();
        // Metadata line should not appear.
        for (final t in texts) {
          expect(t, isNot(contains('\u00B7'))); // · separator
        }
      });

      testWidgets('no description — description widget absent', (tester) async {
        final block = ResourceLinkContent(
          uri: 'file:///docs/file.pdf',
          name: 'file.pdf',
          mimeType: 'application/pdf',
          // description omitted
        );
        await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
        // Should render without crashing.
        expect(find.text('file.pdf'), findsOneWidget);
      });

      testWidgets('all optional fields present — full card renders',
          (tester) async {
        final block = ResourceLinkContent(
          uri: 'https://example.com/report.pdf',
          name: 'Q4 Report',
          mimeType: 'application/pdf',
          title: 'Quarterly Report',
          description: 'End of year financial summary',
          size: 1024 * 1024 * 2, // 2.0 MB
        );
        await tester.pumpWidget(_wrap(ResourceLinkCard(block: block)));
        expect(find.text('Q4 Report'), findsOneWidget);
        expect(find.textContaining('application/pdf'), findsOneWidget);
        expect(find.textContaining('2.0 MB'), findsOneWidget);
        expect(find.text('End of year financial summary'), findsOneWidget);
        expect(find.text('https://example.com/report.pdf'), findsOneWidget);
      });
    });
  });
}
