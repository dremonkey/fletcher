import 'package:flutter/material.dart';
import '../../models/content_block.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

/// Renders a [DiffContent] block as a unified diff display.
///
/// When [DiffContent.oldText] is provided, a character-level unified diff is
/// computed and rendered with per-line colour coding:
/// - Green `+` lines — additions
/// - Red `-` lines — removals
/// - Cyan `@@` lines — hunk headers
/// - Grey lines — context
///
/// When only [DiffContent.newText] is present (no [DiffContent.oldText]),
/// every non-empty line is rendered as an addition.
class DiffRenderer extends StatelessWidget {
  final DiffContent block;

  const DiffRenderer({super.key, required this.block});

  @override
  Widget build(BuildContext context) {
    final lines = _buildDiffLines(block);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // File path header
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.base,
            vertical: AppSpacing.sm,
          ),
          color: AppColors.background,
          child: Text(
            block.path,
            style: AppTypography.overline.copyWith(color: AppColors.textSecondary),
          ),
        ),

        // Diff line list
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(AppSpacing.base),
            itemCount: lines.length,
            itemBuilder: (context, index) => _DiffLine(line: lines[index]),
          ),
        ),
      ],
    );
  }

  /// Builds the list of diff lines to display.
  ///
  /// If [DiffContent.oldText] is available, a line-level unified diff is
  /// computed. Otherwise the new text is shown with all lines as additions.
  static List<String> _buildDiffLines(DiffContent block) => buildDiffLinesForTest(block);

  /// Public entry point for unit tests — same as [_buildDiffLines].
  @visibleForTesting
  static List<String> buildDiffLinesForTest(DiffContent block) {
    final oldText = block.oldText;
    if (oldText == null) {
      // No original — show new text with every line as an addition.
      return block.newText
          .split('\n')
          .map((l) => l.isEmpty ? l : '+$l')
          .toList();
    }
    return _unifiedDiff(oldText, block.newText, block.path);
  }

  /// Produces a minimal unified-diff string list from [oldText] to [newText].
  ///
  /// Uses a simple longest-common-subsequence (LCS) approach on lines. This
  /// mirrors the format produced by `diff -u` and understood by git.
  static List<String> _unifiedDiff(String oldText, String newText, String path) {
    final oldLines = oldText.split('\n');
    final newLines = newText.split('\n');

    final hunks = _computeHunks(oldLines, newLines);

    if (hunks.isEmpty) {
      return ['(no changes)'];
    }

    final result = <String>[];
    result.add('--- a/$path');
    result.add('+++ b/$path');

    for (final hunk in hunks) {
      result.add(hunk.header);
      result.addAll(hunk.lines);
    }

    return result;
  }

  static List<_Hunk> _computeHunks(List<String> oldLines, List<String> newLines) {
    final lcs = _lcs(oldLines, newLines);

    // Build edit script from LCS.
    final edits = <_Edit>[];
    var oi = 0;
    var ni = 0;
    for (final common in lcs) {
      while (oi < common.oldIndex) {
        edits.add(_Edit(type: '-', line: oldLines[oi], oldLine: oi + 1, newLine: ni + 1));
        oi++;
      }
      while (ni < common.newIndex) {
        edits.add(_Edit(type: '+', line: newLines[ni], oldLine: oi + 1, newLine: ni + 1));
        ni++;
      }
      edits.add(_Edit(type: ' ', line: common.line, oldLine: oi + 1, newLine: ni + 1));
      oi++;
      ni++;
    }
    while (oi < oldLines.length) {
      edits.add(_Edit(type: '-', line: oldLines[oi], oldLine: oi + 1, newLine: ni + 1));
      oi++;
    }
    while (ni < newLines.length) {
      edits.add(_Edit(type: '+', line: newLines[ni], oldLine: oi + 1, newLine: ni + 1));
      ni++;
    }

    // Group edits into hunks with 3-line context.
    return _groupIntoHunks(edits, oldLines.length, newLines.length);
  }

  static List<_Hunk> _groupIntoHunks(List<_Edit> edits, int oldLen, int newLen) {
    const ctx = 3;
    final hunks = <_Hunk>[];
    var i = 0;

    while (i < edits.length) {
      // Find the next change.
      if (edits[i].type == ' ') {
        i++;
        continue;
      }

      // Mark start of hunk — include up to [ctx] lines of context before.
      final hunkStart = (i - ctx).clamp(0, edits.length - 1);
      final lines = <String>[];
      int oldStart = edits[hunkStart].oldLine;
      int newStart = edits[hunkStart].newLine;

      // Walk forward collecting the hunk.
      var j = hunkStart;
      var lastChange = i;
      while (j < edits.length) {
        final edit = edits[j];
        if (edit.type != ' ') {
          lastChange = j;
        } else if (j > lastChange + ctx) {
          break;
        }
        lines.add('${edit.type}${edit.line}');
        j++;
      }

      // Count old/new lines in hunk.
      final oldCount = lines.where((l) => !l.startsWith('+')).length;
      final newCount = lines.where((l) => !l.startsWith('-')).length;

      hunks.add(_Hunk(
        header: '@@ -$oldStart,$oldCount +$newStart,$newCount @@',
        lines: lines,
      ));

      i = j;
    }

    return hunks;
  }

  /// Computes the LCS of two line lists. Returns matched pairs (oldIndex, newIndex).
  static List<_CommonLine> _lcs(List<String> a, List<String> b) {
    final m = a.length;
    final n = b.length;

    // Use Myers' patience-sort LCS for large inputs to avoid O(m*n) memory.
    // For simplicity here we use standard DP but cap at 500×500.
    if (m > 500 || n > 500) {
      return _lcsGreedy(a, b);
    }

    final dp = List.generate(m + 1, (_) => List<int>.filled(n + 1, 0));
    for (var i = 1; i <= m; i++) {
      for (var j = 1; j <= n; j++) {
        if (a[i - 1] == b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
        }
      }
    }

    // Backtrack.
    final result = <_CommonLine>[];
    var i = m;
    var j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] == b[j - 1]) {
        result.add(_CommonLine(oldIndex: i - 1, newIndex: j - 1, line: a[i - 1]));
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    return result.reversed.toList();
  }

  /// Greedy LCS fallback for large inputs — O(n) memory, approximate.
  static List<_CommonLine> _lcsGreedy(List<String> a, List<String> b) {
    final bIndex = <String, List<int>>{};
    for (var j = 0; j < b.length; j++) {
      bIndex.putIfAbsent(b[j], () => []).add(j);
    }

    final result = <_CommonLine>[];
    var lastJ = -1;
    for (var i = 0; i < a.length; i++) {
      final matches = bIndex[a[i]];
      if (matches == null) continue;
      for (final j in matches) {
        if (j > lastJ) {
          result.add(_CommonLine(oldIndex: i, newIndex: j, line: a[i]));
          lastJ = j;
          break;
        }
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Internal data classes
// ---------------------------------------------------------------------------

class _CommonLine {
  final int oldIndex;
  final int newIndex;
  final String line;
  const _CommonLine({required this.oldIndex, required this.newIndex, required this.line});
}

class _Edit {
  final String type; // ' ', '+', '-'
  final String line;
  final int oldLine;
  final int newLine;
  const _Edit({required this.type, required this.line, required this.oldLine, required this.newLine});
}

class _Hunk {
  final String header;
  final List<String> lines;
  const _Hunk({required this.header, required this.lines});
}

// ---------------------------------------------------------------------------
// Diff line widget (shared rendering logic)
// ---------------------------------------------------------------------------

class _DiffLine extends StatelessWidget {
  final String line;

  const _DiffLine({required this.line});

  @override
  Widget build(BuildContext context) {
    final Color bgColor;
    final Color textColor;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      bgColor = AppColors.healthGreen.withAlpha(38); // ~15% opacity
      textColor = AppColors.healthGreen;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      bgColor = AppColors.healthRed.withAlpha(38);
      textColor = AppColors.healthRed;
    } else if (line.startsWith('@@')) {
      bgColor = AppColors.cyan.withAlpha(38);
      textColor = AppColors.cyan;
    } else {
      bgColor = Colors.transparent;
      textColor = AppColors.textSecondary;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
      color: bgColor,
      child: Text(
        line,
        style: AppTypography.artifactContent.copyWith(color: textColor, height: 1.5),
      ),
    );
  }
}
