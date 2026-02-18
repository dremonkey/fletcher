import 'dart:convert';
import 'package:flutter/material.dart';
import '../models/conversation_state.dart';

/// A chip that indicates artifacts are available.
/// Tap to open the artifact drawer.
class ArtifactChip extends StatelessWidget {
  final int count;
  final VoidCallback onTap;

  const ArtifactChip({
    super.key,
    required this.count,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    if (count == 0) return const SizedBox.shrink();

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF1F1F1F),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: const Color(0xFF3B82F6).withOpacity(0.4),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.code_rounded,
              size: 16,
              color: Color(0xFF3B82F6),
            ),
            const SizedBox(width: 6),
            Text(
              '$count artifact${count > 1 ? 's' : ''}',
              style: const TextStyle(
                color: Color(0xFF3B82F6),
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.keyboard_arrow_up_rounded,
              size: 16,
              color: Color(0xFF3B82F6),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shows the artifact drawer as a bottom sheet.
void showArtifactDrawer(
  BuildContext context, {
  required List<ArtifactEvent> artifacts,
  required VoidCallback onClear,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => ArtifactDrawer(
      artifacts: artifacts,
      onClear: onClear,
    ),
  );
}

/// The artifact drawer that shows all artifacts.
class ArtifactDrawer extends StatefulWidget {
  final List<ArtifactEvent> artifacts;
  final VoidCallback onClear;

  const ArtifactDrawer({
    super.key,
    required this.artifacts,
    required this.onClear,
  });

  @override
  State<ArtifactDrawer> createState() => _ArtifactDrawerState();
}

class _ArtifactDrawerState extends State<ArtifactDrawer> {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    // Default to latest artifact
    if (widget.artifacts.isNotEmpty) {
      _selectedIndex = widget.artifacts.length - 1;
    }
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.of(context).size.height * 0.7;

    return Container(
      height: height,
      decoration: const BoxDecoration(
        color: Color(0xFF0D0D0D),
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        border: Border(
          top: BorderSide(color: Color(0xFF2D2D2D)),
          left: BorderSide(color: Color(0xFF2D2D2D)),
          right: BorderSide(color: Color(0xFF2D2D2D)),
        ),
      ),
      child: Column(
        children: [
          // Handle bar
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: const Color(0xFF4B5563),
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Artifacts',
                  style: TextStyle(
                    color: Color(0xFFE5E7EB),
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Row(
                  children: [
                    IconButton(
                      icon: const Icon(
                        Icons.delete_outline_rounded,
                        color: Color(0xFF6B7280),
                        size: 20,
                      ),
                      onPressed: () {
                        widget.onClear();
                        Navigator.pop(context);
                      },
                      tooltip: 'Clear all',
                    ),
                    IconButton(
                      icon: const Icon(
                        Icons.close_rounded,
                        color: Color(0xFF6B7280),
                        size: 20,
                      ),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Tabs (if multiple artifacts)
          if (widget.artifacts.length > 1)
            SizedBox(
              height: 40,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                itemCount: widget.artifacts.length,
                itemBuilder: (context, index) {
                  final artifact = widget.artifacts[index];
                  final isSelected = index == _selectedIndex;

                  return GestureDetector(
                    onTap: () => setState(() => _selectedIndex = index),
                    child: Container(
                      margin: const EdgeInsets.only(right: 8),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? const Color(0xFF3B82F6).withOpacity(0.2)
                            : const Color(0xFF1F1F1F),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: isSelected
                              ? const Color(0xFF3B82F6)
                              : const Color(0xFF2D2D2D),
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            _getArtifactIcon(artifact.artifactType),
                            size: 14,
                            color: isSelected
                                ? const Color(0xFF3B82F6)
                                : const Color(0xFF6B7280),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _shortenTitle(artifact.displayTitle),
                            style: TextStyle(
                              color: isSelected
                                  ? const Color(0xFF3B82F6)
                                  : const Color(0xFF9CA3AF),
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),

          const SizedBox(height: 8),

          // Content
          Expanded(
            child: widget.artifacts.isEmpty
                ? const Center(
                    child: Text(
                      'No artifacts',
                      style: TextStyle(color: Color(0xFF6B7280)),
                    ),
                  )
                : _ArtifactContent(artifact: widget.artifacts[_selectedIndex]),
          ),
        ],
      ),
    );
  }

  IconData _getArtifactIcon(ArtifactType type) {
    switch (type) {
      case ArtifactType.diff:
        return Icons.difference_rounded;
      case ArtifactType.code:
        return Icons.code_rounded;
      case ArtifactType.markdown:
        return Icons.description_rounded;
      case ArtifactType.file:
        return Icons.description_outlined;
      case ArtifactType.searchResults:
        return Icons.search_rounded;
      case ArtifactType.error:
        return Icons.error_outline_rounded;
      case ArtifactType.unknown:
        return Icons.data_object_rounded;
    }
  }

  String _shortenTitle(String title) {
    if (title.length > 20) {
      return '${title.substring(0, 17)}...';
    }
    return title;
  }
}

/// Renders the content of an artifact.
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
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: const Color(0xFF1F1F1F),
            child: Text(
              artifact.file!,
              style: const TextStyle(
                color: Color(0xFF9CA3AF),
                fontSize: 12,
                fontFamily: 'monospace',
              ),
            ),
          ),

        // Diff content
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(12),
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
      bgColor = const Color(0xFF10B981).withOpacity(0.15);
      textColor = const Color(0xFF34D399);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      bgColor = const Color(0xFFEF4444).withOpacity(0.15);
      textColor = const Color(0xFFF87171);
    } else if (line.startsWith('@@')) {
      bgColor = const Color(0xFF3B82F6).withOpacity(0.15);
      textColor = const Color(0xFF60A5FA);
    } else {
      bgColor = Colors.transparent;
      textColor = const Color(0xFF9CA3AF);
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      color: bgColor,
      child: Text(
        line,
        style: TextStyle(
          color: textColor,
          fontSize: 12,
          fontFamily: 'monospace',
          height: 1.5,
        ),
      ),
    );
  }
}

/// Displays code or file content.
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
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: const Color(0xFF1F1F1F),
            child: Row(
              children: [
                Text(
                  artifact.file ?? artifact.path ?? '',
                  style: const TextStyle(
                    color: Color(0xFF9CA3AF),
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                ),
                if (artifact.language != null) ...[
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFF3B82F6).withOpacity(0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      artifact.language!,
                      style: const TextStyle(
                        color: Color(0xFF60A5FA),
                        fontSize: 10,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),

        // Code content with line numbers
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(12),
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
                      style: const TextStyle(
                        color: Color(0xFF4B5563),
                        fontSize: 12,
                        fontFamily: 'monospace',
                        height: 1.5,
                      ),
                      textAlign: TextAlign.right,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      lines[index],
                      style: const TextStyle(
                        color: Color(0xFFE5E7EB),
                        fontSize: 12,
                        fontFamily: 'monospace',
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

/// Displays markdown content as text (until flutter_markdown is added).
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
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: const Color(0xFF1F1F1F),
            child: Row(
              children: [
                const Icon(
                  Icons.markdown_rounded,
                  size: 14,
                  color: Color(0xFF6B7280),
                ),
                const SizedBox(width: 8),
                Text(
                  artifact.path ?? artifact.title ?? 'Markdown',
                  style: const TextStyle(
                    color: Color(0xFF9CA3AF),
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ),
          ),

        // Markdown content
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: SelectableText(
              content,
              style: const TextStyle(
                color: Color(0xFFE5E7EB),
                fontSize: 14,
                fontFamily: 'monospace',
                height: 1.6,
              ),
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
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: const Color(0xFF1F1F1F),
            child: Row(
              children: [
                const Icon(
                  Icons.search_rounded,
                  size: 14,
                  color: Color(0xFF6B7280),
                ),
                const SizedBox(width: 8),
                Text(
                  artifact.query!,
                  style: const TextStyle(
                    color: Color(0xFF9CA3AF),
                    fontSize: 12,
                  ),
                ),
                const Spacer(),
                Text(
                  '${results.length} result${results.length != 1 ? 's' : ''}',
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),

        // Results list
        Expanded(
          child: results.isEmpty
              ? const Center(
                  child: Text(
                    'No results found',
                    style: TextStyle(color: Color(0xFF6B7280)),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: results.length,
                  itemBuilder: (context, index) {
                    final result = results[index];
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1F1F1F),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFF2D2D2D)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  result.file,
                                  style: const TextStyle(
                                    color: Color(0xFF60A5FA),
                                    fontSize: 12,
                                    fontFamily: 'monospace',
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Text(
                                ':${result.line}',
                                style: const TextStyle(
                                  color: Color(0xFF6B7280),
                                  fontSize: 12,
                                  fontFamily: 'monospace',
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            result.content,
                            style: const TextStyle(
                              color: Color(0xFFE5E7EB),
                              fontSize: 12,
                              fontFamily: 'monospace',
                              height: 1.4,
                            ),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// Displays an error message.
class _ErrorViewer extends StatelessWidget {
  final ArtifactEvent artifact;

  const _ErrorViewer({required this.artifact});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFEF4444).withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: const Color(0xFFEF4444).withOpacity(0.3),
              ),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.error_outline_rounded,
                  color: Color(0xFFF87171),
                  size: 20,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    artifact.message ?? 'An error occurred',
                    style: const TextStyle(
                      color: Color(0xFFF87171),
                      fontSize: 14,
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (artifact.stack != null) ...[
            const SizedBox(height: 16),
            const Text(
              'Stack trace',
              style: TextStyle(
                color: Color(0xFF6B7280),
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: SingleChildScrollView(
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1F1F1F),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    artifact.stack!,
                    style: const TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 11,
                      fontFamily: 'monospace',
                      height: 1.4,
                    ),
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
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          color: const Color(0xFF1F1F1F),
          child: Row(
            children: [
              Icon(
                Icons.warning_amber_rounded,
                size: 16,
                color: const Color(0xFFFBBF24).withOpacity(0.8),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Unknown artifact type - showing raw JSON',
                  style: TextStyle(
                    color: Color(0xFF9CA3AF),
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
        ),

        // JSON content
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              jsonString,
              style: const TextStyle(
                color: Color(0xFFE5E7EB),
                fontSize: 12,
                fontFamily: 'monospace',
                height: 1.5,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
