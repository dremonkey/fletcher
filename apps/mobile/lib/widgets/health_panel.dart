import 'package:flutter/material.dart';
import '../models/health_state.dart';
import '../services/health_service.dart';

/// A small tappable chip showing overall health status as a colored dot.
class HealthChip extends StatelessWidget {
  final OverallHealth overall;
  final VoidCallback onTap;

  const HealthChip({
    super.key,
    required this.overall,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF1F1F1F),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: _dotColor.withOpacity(0.4),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: _dotColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              'Diagnostics',
              style: TextStyle(
                color: _dotColor,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.keyboard_arrow_up_rounded,
              size: 16,
              color: _dotColor,
            ),
          ],
        ),
      ),
    );
  }

  Color get _dotColor {
    switch (overall) {
      case OverallHealth.healthy:
        return const Color(0xFF10B981);
      case OverallHealth.degraded:
        return const Color(0xFFF59E0B);
      case OverallHealth.unhealthy:
        return const Color(0xFFEF4444);
    }
  }
}

/// Shows the health diagnostics panel as a bottom sheet.
void showHealthPanel(
  BuildContext context, {
  required HealthService healthService,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _HealthPanel(healthService: healthService),
  );
}

class _HealthPanel extends StatefulWidget {
  final HealthService healthService;

  const _HealthPanel({required this.healthService});

  @override
  State<_HealthPanel> createState() => _HealthPanelState();
}

class _HealthPanelState extends State<_HealthPanel> {
  @override
  void initState() {
    super.initState();
    widget.healthService.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.healthService.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.of(context).size.height * 0.55;
    final checks = widget.healthService.state.checks;

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
                  'Diagnostics',
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
                        Icons.refresh_rounded,
                        color: Color(0xFF6B7280),
                        size: 20,
                      ),
                      onPressed: () => widget.healthService.refresh(),
                      tooltip: 'Re-run checks',
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

          // Check list
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: checks.length,
              itemBuilder: (context, index) {
                return _HealthCheckRow(check: checks[index]);
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _HealthCheckRow extends StatefulWidget {
  final HealthCheck check;

  const _HealthCheckRow({required this.check});

  @override
  State<_HealthCheckRow> createState() => _HealthCheckRowState();
}

class _HealthCheckRowState extends State<_HealthCheckRow> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final check = widget.check;
    final hasDetail = check.detail != null || check.suggestion != null;

    return GestureDetector(
      onTap: hasDetail ? () => setState(() => _expanded = !_expanded) : null,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF1F1F1F),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFF2D2D2D)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _StatusIcon(status: check.status),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    check.label,
                    style: const TextStyle(
                      color: Color(0xFFE5E7EB),
                      fontSize: 14,
                    ),
                  ),
                ),
                if (hasDetail)
                  Icon(
                    _expanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    size: 18,
                    color: const Color(0xFF6B7280),
                  ),
              ],
            ),
            if (_expanded && hasDetail) ...[
              const SizedBox(height: 8),
              const Divider(color: Color(0xFF2D2D2D), height: 1),
              const SizedBox(height: 8),
              if (check.detail != null)
                Text(
                  check.detail!,
                  style: const TextStyle(
                    color: Color(0xFF9CA3AF),
                    fontSize: 12,
                  ),
                ),
              if (check.suggestion != null) ...[
                const SizedBox(height: 4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.lightbulb_outline_rounded,
                      size: 14,
                      color: Color(0xFFF59E0B),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        check.suggestion!,
                        style: const TextStyle(
                          color: Color(0xFFF59E0B),
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusIcon extends StatelessWidget {
  final HealthCheckStatus status;

  const _StatusIcon({required this.status});

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case HealthCheckStatus.ok:
        return const Icon(Icons.check_circle_rounded, size: 18, color: Color(0xFF10B981));
      case HealthCheckStatus.warning:
        return const Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFFF59E0B));
      case HealthCheckStatus.error:
        return const Icon(Icons.cancel_rounded, size: 18, color: Color(0xFFEF4444));
      case HealthCheckStatus.pending:
        return const SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: Color(0xFF6B7280),
          ),
        );
    }
  }
}
