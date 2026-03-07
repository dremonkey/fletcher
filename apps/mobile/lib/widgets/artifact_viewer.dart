import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../models/conversation_state.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';

// ---------------------------------------------------------------------------
// Type badge helpers
// ---------------------------------------------------------------------------

/// Returns a short uppercase badge string for an artifact type.
String _typeBadge(ArtifactType type) {
  switch (type) {
    case ArtifactType.diff:
      return 'DIFF';
    case ArtifactType.code:
      return 'CODE';
    case ArtifactType.markdown:
      return 'TEXT';
    case ArtifactType.file:
      return 'FILE';
    case ArtifactType.searchResults:
      return 'SEARCH';
    case ArtifactType.error:
      return 'ERROR';
    case ArtifactType.unknown:
      return 'JSON';
  }
}

/// Returns preview text for an artifact (first 2-3 lines of content).
String _artifactPreview(ArtifactEvent artifact) {
  switch (artifact.artifactType) {
    case ArtifactType.diff:
      return artifact.diff ?? '';
    case ArtifactType.code:
    case ArtifactType.file:
    case ArtifactType.markdown:
      return artifact.content ?? '';
    case ArtifactType.searchResults:
      final results = artifact.results;
      if (results != null && results.isNotEmpty) {
        return results.map((r) => '${r.file}:${r.line}').take(3).join('\n');
      }
      return 'No results';
    case ArtifactType.error:
      return artifact.message ?? 'An error occurred';
    case ArtifactType.unknown:
      return artifact.rawJson != null
          ? const JsonEncoder.withIndent('  ').convert(artifact.rawJson)
          : '{}';
  }
}

// ---------------------------------------------------------------------------
// Public API: show a single artifact in a bottom sheet drawer
// ---------------------------------------------------------------------------

/// Opens a bottom sheet displaying a single artifact.
void showSingleArtifactDrawer(BuildContext context,
    {required ArtifactEvent artifact}) {
  HapticFeedback.lightImpact();
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    builder: (context) => _SingleArtifactDrawer(artifact: artifact),
  );
}

/// Opens a bottom sheet showing the legacy multi-artifact tabbed view.
///
/// Kept for backwards-compatibility with existing callers. New code should
/// prefer [showArtifactsListModal] + [showSingleArtifactDrawer].
void showArtifactDrawer(
  BuildContext context, {
  required List<ArtifactEvent> artifacts,
  required VoidCallback onClear,
}) {
  if (artifacts.isEmpty) return;
  if (artifacts.length == 1) {
    showSingleArtifactDrawer(context, artifact: artifacts.first);
    return;
  }
  showArtifactsListModal(context, artifacts: artifacts);
}

// ---------------------------------------------------------------------------
// Public API: artifacts list modal (full-screen overlay)
// ---------------------------------------------------------------------------

/// Opens a full-screen modal listing all artifacts.
///
/// Tapping an artifact dismisses the modal and opens the single-artifact
/// drawer for that item.
void showArtifactsListModal(
  BuildContext context, {
  required List<ArtifactEvent> artifacts,
}) {
  HapticFeedback.lightImpact();
  showGeneralDialog(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Artifacts list',
    barrierColor: Colors.black87,
    transitionDuration: const Duration(milliseconds: 200),
    pageBuilder: (context, animation, secondaryAnimation) {
      return _ArtifactsListModal(artifacts: artifacts);
    },
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      return FadeTransition(opacity: animation, child: child);
    },
  );
}

// ---------------------------------------------------------------------------
// Artifacts list modal widget
// ---------------------------------------------------------------------------

class _ArtifactsListModal extends StatelessWidget {
  final List<ArtifactEvent> artifacts;

  const _ArtifactsListModal({required this.artifacts});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.base),
          child: TuiModal(
            title: 'ARTIFACTS (${artifacts.length})',
            child: Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Close button row
                  Align(
                    alignment: Alignment.topRight,
                    child: SizedBox(
                      width: 48,
                      height: 48,
                      child: IconButton(
                        icon: Text(
                          '[X]',
                          style: AppTypography.label
                              .copyWith(color: AppColors.textSecondary),
                        ),
                        onPressed: () {
                          HapticFeedback.lightImpact();
                          Navigator.of(context).pop();
                        },
                      ),
                    ),
                  ),

                  // List or empty state
                  Flexible(
                    child: artifacts.isEmpty
                        ? Padding(
                            padding:
                                const EdgeInsets.all(AppSpacing.base),
                            child: Text(
                              'No artifacts in this session',
                              style: AppTypography.body
                                  .copyWith(color: AppColors.textSecondary),
                            ),
                          )
                        : ListView.builder(
                            shrinkWrap: true,
                            padding: const EdgeInsets.only(
                              top: AppSpacing.sm,
                              bottom: AppSpacing.base,
                            ),
                            itemCount: artifacts.length,
                            itemBuilder: (context, index) {
                              final artifact = artifacts[index];
                              final isLatest =
                                  index == artifacts.length - 1;
                              return Padding(
                                padding: const EdgeInsets.only(
                                    bottom: AppSpacing.sm),
                                child: _ArtifactListCard(
                                  artifact: artifact,
                                  isActive: isLatest,
                                  onTap: () {
                                    HapticFeedback.lightImpact();
                                    Navigator.of(context).pop();
                                    showSingleArtifactDrawer(context,
                                        artifact: artifact);
                                  },
                                ),
                              );
                            },
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
}

class _ArtifactListCard extends StatelessWidget {
  final ArtifactEvent artifact;
  final bool isActive;
  final VoidCallback onTap;

  const _ArtifactListCard({
    required this.artifact,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final preview = _artifactPreview(artifact);
    final previewLines = preview.split('\n').take(3).join('\n');

    return GestureDetector(
      onTap: onTap,
      child: TuiCard(
        borderColor: isActive ? AppColors.amber : AppColors.textSecondary,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 72),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      artifact.displayTitle,
                      style: AppTypography.body
                          .copyWith(fontWeight: FontWeight.bold),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    '[${_typeBadge(artifact.artifactType)}]',
                    style: AppTypography.artifactBadge
                        .copyWith(color: AppColors.textSecondary),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                previewLines,
                style: AppTypography.overline
                    .copyWith(color: AppColors.textSecondary),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Single artifact drawer (bottom sheet)
// ---------------------------------------------------------------------------

class _SingleArtifactDrawer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _SingleArtifactDrawer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.of(context).size.height * 0.65;

    return Container(
      height: height,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.zero,
        border: Border(
          top: BorderSide(color: AppColors.amber, width: 2),
        ),
      ),
      child: Column(
        children: [
          // Header row
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.base,
              vertical: AppSpacing.md,
            ),
            child: Row(
              children: [
                Expanded(
                  child: TuiHeader(
                    label: artifact.displayTitle,
                    color: AppColors.amber,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  '[${_typeBadge(artifact.artifactType)}]',
                  style: AppTypography.artifactBadge
                      .copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),

          // Content area
          Expanded(
            child: Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: AppSpacing.base),
              child: _ArtifactContent(artifact: artifact),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Inline artifact button (for embedding in chat messages)
// ---------------------------------------------------------------------------

/// A TuiButton-style inline button for opening a single artifact.
///
/// Renders as `[ARTIFACT: NAME]` with amber border and monospace text.
class ArtifactInlineButton extends StatelessWidget {
  final ArtifactEvent artifact;
  final VoidCallback onTap;

  const ArtifactInlineButton({
    super.key,
    required this.artifact,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.base,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.zero,
          border: Border.all(color: AppColors.amber, width: 1),
        ),
        child: Text(
          '[ARTIFACT: ${_shortenTitle(artifact.displayTitle)}]',
          style: AppTypography.artifactBadge.copyWith(color: AppColors.amber),
        ),
      ),
    );
  }

  static String _shortenTitle(String title) {
    if (title.length > 24) {
      return '${title.substring(0, 21)}...';
    }
    return title;
  }
}

// ---------------------------------------------------------------------------
// Content renderer (dispatches by type)
// ---------------------------------------------------------------------------

/// Renders the content of an artifact based on its type.
class _ArtifactContent extends StatelessWidget {
  final ArtifactEvent artifact;

  const _ArtifactContent({required this.artifact});

  @override
  Widget build(BuildContext context) {
    switch (artifact.artifactType) {
      case ArtifactType.diff:
        return _DiffViewer(artifact: artifact);
      case ArtifactType.markdown:
        return _MarkdownViewer(artifact: artifact);
      case ArtifactType.code:
      case ArtifactType.file:
        return _CodeViewer(artifact: artifact);
      case ArtifactType.searchResults:
        return _SearchResultsViewer(artifact: artifact);
      case ArtifactType.error:
        return _ErrorViewer(artifact: artifact);
      case ArtifactType.unknown:
        return _RawJsonViewer(artifact: artifact);
    }
  }
}

// ---------------------------------------------------------------------------
// Type-specific viewers (all restyled with design system tokens)
// ---------------------------------------------------------------------------

/// Displays a code diff with added/removed line highlighting.
class _DiffViewer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _DiffViewer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    final lines = (artifact.diff ?? '').split('\n');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // File header
        if (artifact.file != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.base,
              vertical: AppSpacing.sm,
            ),
            color: AppColors.background,
            child: Text(
              artifact.file!,
              style: AppTypography.overline
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),

        // Diff content
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(AppSpacing.base),
            itemCount: lines.length,
            itemBuilder: (context, index) {
              final line = lines[index];
              return _DiffLine(line: line);
            },
          ),
        ),
      ],
    );
  }
}

class _DiffLine extends StatelessWidget {
  final String line;

  const _DiffLine({required this.line});

  @override
  Widget build(BuildContext context) {
    Color bgColor;
    Color textColor;

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
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 2,
      ),
      color: bgColor,
      child: Text(
        line,
        style: AppTypography.artifactContent.copyWith(
          color: textColor,
          height: 1.5,
        ),
      ),
    );
  }
}

/// Displays code or file content with line numbers.
class _CodeViewer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _CodeViewer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    final content = artifact.content ?? '';
    final lines = content.split('\n');
    final startLine = artifact.startLine ?? 1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // File header
        if (artifact.file != null || artifact.path != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.base,
              vertical: AppSpacing.sm,
            ),
            color: AppColors.background,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    artifact.file ?? artifact.path ?? '',
                    style: AppTypography.overline
                        .copyWith(color: AppColors.textSecondary),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (artifact.language != null) ...[
                  const SizedBox(width: AppSpacing.sm),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.zero,
                      border: Border.all(
                        color: AppColors.textSecondary,
                      ),
                    ),
                    child: Text(
                      artifact.language!,
                      style: AppTypography.overline
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ),
                ],
              ],
            ),
          ),

        // Code content with line numbers
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(AppSpacing.base),
            itemCount: lines.length,
            itemBuilder: (context, index) {
              final lineNum = startLine + index;
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 40,
                    child: Text(
                      '$lineNum',
                      style: AppTypography.artifactContent.copyWith(
                        color: AppColors.textSecondary,
                        height: 1.5,
                      ),
                      textAlign: TextAlign.right,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Text(
                      lines[index],
                      style: AppTypography.artifactContent.copyWith(
                        height: 1.5,
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Displays markdown content rendered with TUI-appropriate styling.
class _MarkdownViewer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _MarkdownViewer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    final content = artifact.content ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // File header
        if (artifact.path != null || artifact.title != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.base,
              vertical: AppSpacing.sm,
            ),
            color: AppColors.background,
            child: Text(
              artifact.path ?? artifact.title ?? 'Markdown',
              style: AppTypography.overline
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),

        // Markdown content
        Expanded(
          child: Markdown(
            data: content,
            selectable: true,
            padding: const EdgeInsets.all(AppSpacing.base),
            styleSheet: MarkdownStyleSheet(
              p: AppTypography.artifactContent,
              h1: AppTypography.body.copyWith(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
              h2: AppTypography.body.copyWith(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
              h3: AppTypography.body.copyWith(
                fontSize: 14,
                fontWeight: FontWeight.bold,
              ),
              code: AppTypography.artifactContent.copyWith(
                backgroundColor: AppColors.background,
              ),
              codeblockDecoration: const BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.zero,
                border: Border.fromBorderSide(
                  BorderSide(color: AppColors.textSecondary),
                ),
              ),
              blockquote: AppTypography.artifactContent.copyWith(
                color: AppColors.textSecondary,
                fontStyle: FontStyle.italic,
              ),
              blockquoteDecoration: const BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.zero,
                border: Border(
                  left: BorderSide(color: AppColors.amber, width: 2),
                ),
              ),
              a: AppTypography.artifactContent.copyWith(
                color: AppColors.amber,
                decoration: TextDecoration.underline,
                decorationColor: AppColors.amber,
              ),
              listBullet: AppTypography.artifactContent,
            ),
          ),
        ),
      ],
    );
  }
}

/// Displays search results.
class _SearchResultsViewer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _SearchResultsViewer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    final results = artifact.results ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Query header
        if (artifact.query != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.base,
              vertical: AppSpacing.sm,
            ),
            color: AppColors.background,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    artifact.query!,
                    style: AppTypography.overline
                        .copyWith(color: AppColors.textSecondary),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  '${results.length} result${results.length != 1 ? 's' : ''}',
                  style: AppTypography.overline
                      .copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),

        // Results list
        Expanded(
          child: results.isEmpty
              ? Center(
                  child: Text(
                    'No results found',
                    style: AppTypography.body
                        .copyWith(color: AppColors.textSecondary),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(AppSpacing.base),
                  itemCount: results.length,
                  itemBuilder: (context, index) {
                    final result = results[index];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: TuiCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    result.file,
                                    style: AppTypography.artifactContent
                                        .copyWith(color: AppColors.cyan),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Text(
                                  ':${result.line}',
                                  style: AppTypography.overline
                                      .copyWith(color: AppColors.textSecondary),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              result.content,
                              style: AppTypography.artifactContent,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// Displays an error message and optional stack trace.
class _ErrorViewer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _ErrorViewer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Error message
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.base),
            decoration: BoxDecoration(
              color: AppColors.healthRed.withAlpha(25),
              borderRadius: BorderRadius.zero,
              border: Border.all(color: AppColors.healthRed),
            ),
            child: Text(
              artifact.message ?? 'An error occurred',
              style:
                  AppTypography.body.copyWith(color: AppColors.healthRed),
            ),
          ),

          // Stack trace
          if (artifact.stack != null) ...[
            const SizedBox(height: AppSpacing.base),
            Text(
              'STACK TRACE',
              style:
                  AppTypography.label.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.sm),
            Expanded(
              child: SingleChildScrollView(
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: const BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.zero,
                  ),
                  child: Text(
                    artifact.stack!,
                    style: AppTypography.overline
                        .copyWith(color: AppColors.textSecondary, height: 1.4),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Displays raw JSON for unknown artifact types.
class _RawJsonViewer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _RawJsonViewer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    final jsonString = artifact.rawJson != null
        ? const JsonEncoder.withIndent('  ').convert(artifact.rawJson)
        : '{}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header with warning
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.base,
            vertical: AppSpacing.sm,
          ),
          color: AppColors.background,
          child: Text(
            'Unknown artifact type -- showing raw JSON',
            style:
                AppTypography.overline.copyWith(color: AppColors.textSecondary),
          ),
        ),

        // JSON content
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.base),
            child: SelectableText(
              jsonString,
              style: AppTypography.artifactContent.copyWith(height: 1.5),
            ),
          ),
        ),
      ],
    );
  }
}
