# Feasibility Spec: Generative UI for Flutter (json-render style)

## Overview

This spec explores integrating a **Generative UI** system into Fletcher's Flutter app, inspired by [Vercel's json-render](https://github.com/vercel-labs/json-render). The goal is to allow the AI agent to generate dynamic, personalized UIs from prompts while maintaining safety through predefined component catalogs.

## What is json-render?

[json-render](https://json-render.dev/) is a framework where:
1. You define a **catalog** of allowed components with typed props
2. AI generates **JSON specs** constrained to your catalog
3. A **renderer** maps JSON to actual UI components
4. Responses **stream progressively** as the model responds

Key properties:
- **Guardrailed** - AI can only use components in your catalog
- **Predictable** - JSON output matches your schema, every time
- **Streamable** - Render partial results as JSON arrives
- **Cross-platform** - Same catalog works for web, mobile, video

## Current State in Fletcher

We already have a primitive version:
- `ArtifactEvent` with types: `diff`, `code`, `file`, `searchResults`, `error`
- `ArtifactViewer` that renders each type
- Data channel streaming from agent to Flutter

This is essentially a **hardcoded catalog** with a **switch-based renderer**.

## Proposed Architecture

### 1. Catalog Definition (Dart)

```dart
// catalog.dart
import 'package:json_annotation/json_annotation.dart';

/// Component definition with typed props
class ComponentDef<T> {
  final String description;
  final T Function(Map<String, dynamic>) propsFromJson;
  final List<String> slots; // Named child slots
  final List<String> events; // Emittable events

  const ComponentDef({
    required this.description,
    required this.propsFromJson,
    this.slots = const [],
    this.events = const [],
  });
}

/// The catalog of allowed components
final catalog = <String, ComponentDef>{
  'Card': ComponentDef(
    description: 'Container with title and optional children',
    propsFromJson: CardProps.fromJson,
    slots: ['default'],
  ),
  'CodeBlock': ComponentDef(
    description: 'Syntax-highlighted code display',
    propsFromJson: CodeBlockProps.fromJson,
  ),
  'DiffViewer': ComponentDef(
    description: 'Unified diff with line highlighting',
    propsFromJson: DiffViewerProps.fromJson,
  ),
  'Button': ComponentDef(
    description: 'Tappable button that emits press event',
    propsFromJson: ButtonProps.fromJson,
    events: ['press'],
  ),
  'MetricCard': ComponentDef(
    description: 'Display a metric with label and value',
    propsFromJson: MetricCardProps.fromJson,
  ),
  'FileTree': ComponentDef(
    description: 'Collapsible file/folder tree view',
    propsFromJson: FileTreeProps.fromJson,
    events: ['select'],
  ),
  // ... more components
};
```

### 2. JSON Spec Format

```json
{
  "root": {
    "type": "Card",
    "props": { "title": "Search Results" },
    "children": [
      {
        "type": "Text",
        "props": { "content": "Found 3 matches:" }
      },
      {
        "type": "FileTree",
        "props": {
          "files": [
            { "path": "src/index.ts", "line": 42 },
            { "path": "src/utils.ts", "line": 15 }
          ]
        }
      },
      {
        "type": "Button",
        "props": { "label": "Open in Editor" },
        "on": { "press": { "action": "open_file", "args": { "path": "$selected" } } }
      }
    ]
  }
}
```

### 3. Renderer (Flutter)

```dart
// renderer.dart
class JsonRenderer extends StatelessWidget {
  final Map<String, dynamic> spec;
  final Map<String, Widget Function(BuildContext, RendererProps)> registry;
  final void Function(String action, Map<String, dynamic> args)? onAction;

  const JsonRenderer({
    required this.spec,
    required this.registry,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return _renderNode(context, spec['root']);
  }

  Widget _renderNode(BuildContext context, Map<String, dynamic> node) {
    final type = node['type'] as String;
    final props = node['props'] as Map<String, dynamic>? ?? {};
    final children = node['children'] as List<dynamic>? ?? [];

    final builder = registry[type];
    if (builder == null) {
      return _UnknownComponent(type: type, props: props);
    }

    return builder(
      context,
      RendererProps(
        props: props,
        children: children.map((c) => _renderNode(context, c)).toList(),
        emit: (event) => _handleEvent(node, event),
      ),
    );
  }

  void _handleEvent(Map<String, dynamic> node, String event) {
    final handlers = node['on'] as Map<String, dynamic>?;
    if (handlers == null) return;

    final handler = handlers[event] as Map<String, dynamic>?;
    if (handler != null) {
      onAction?.call(
        handler['action'] as String,
        handler['args'] as Map<String, dynamic>? ?? {},
      );
    }
  }
}
```

### 4. Streaming Support

```dart
// spec_stream.dart
class SpecStreamCompiler {
  Map<String, dynamic>? _result;
  final _patches = <JsonPatch>[];

  /// Process incoming JSON chunk (partial/streaming)
  CompileResult push(String chunk) {
    // Use streaming JSON parser (e.g., json_stream package)
    // Apply incremental patches to _result
    // Return { result, newPatches } for efficient UI updates
  }

  Map<String, dynamic>? get result => _result;
}

// Usage with LiveKit data channel
void _handleDataReceived(DataReceivedEvent event) {
  if (event.topic != 'ganglia-ui') return;

  final result = _specCompiler.push(utf8.decode(event.data));
  if (result.newPatches.isNotEmpty) {
    setState(() => _currentSpec = result.result);
  }
}
```

### 5. Catalog → Prompt Generation

The catalog needs to generate a prompt that tells the AI what components are available:

```dart
String generateSystemPrompt(Map<String, ComponentDef> catalog) {
  final buffer = StringBuffer();
  buffer.writeln('You can generate UI using these components:');
  buffer.writeln();

  for (final entry in catalog.entries) {
    buffer.writeln('## ${entry.key}');
    buffer.writeln(entry.value.description);
    if (entry.value.slots.isNotEmpty) {
      buffer.writeln('Slots: ${entry.value.slots.join(", ")}');
    }
    if (entry.value.events.isNotEmpty) {
      buffer.writeln('Events: ${entry.value.events.join(", ")}');
    }
    buffer.writeln();
  }

  buffer.writeln('Output valid JSON matching the spec schema.');
  return buffer.toString();
}
```

## Key Differences from json-render

| Aspect | json-render (React) | Flutter Implementation |
|--------|---------------------|------------------------|
| Type system | Zod schemas | Dart classes + json_serializable |
| Streaming | Custom SpecStream | json_stream + setState |
| Hot reload | React reconciliation | Flutter widget rebuild |
| Component registration | `defineRegistry()` | Static registry map |
| Cross-platform | Web + RN from same catalog | Flutter already cross-platform |

## Feasibility Assessment

### What's Easy

1. **JSON parsing** - Dart has excellent JSON support
2. **Widget registry** - Map of type → builder function
3. **Recursive rendering** - `_renderNode()` pattern is straightforward
4. **Event handling** - Callback-based, similar to React
5. **Catalog definition** - Dart classes with `fromJson`

### What's Harder

1. **Streaming JSON parsing** - Need incremental parser
   - Options: `json_stream` package, custom SAX-style parser
   - Complexity: Medium

2. **Type safety** - No Zod equivalent in Dart
   - Options: Code generation with `json_serializable`, `freezed`
   - Complexity: Medium (more boilerplate than Zod)

3. **JSON Schema export** - For structured AI outputs
   - Options: `json_schema` package, manual generation
   - Complexity: Medium

4. **Hot reloading specs** - Efficient partial updates
   - Options: JSON Patch (RFC 6902), custom diffing
   - Complexity: High (for optimal performance)

### What Needs Research

1. **Streaming JSON parsers for Dart** - Performance characteristics
2. **AI structured output** - Does Ganglia support JSON Schema constraints?
3. **Component complexity** - How complex can generated UIs get before latency suffers?

## Integration with Fletcher

### Phase 1: Extend ArtifactEvent (Low effort)
- Add `type: 'ui'` artifact with JSON spec
- Render with basic JsonRenderer
- No streaming, full spec replacement

### Phase 2: Streaming Renderer (Medium effort)
- Add `ganglia-ui` topic for streaming specs
- Implement SpecStreamCompiler
- Progressive rendering as JSON arrives

### Phase 3: Full Catalog System (High effort)
- Define catalog with all component props
- Generate JSON Schema for AI constraints
- Add action handling (button presses, selections)
- Support dynamic data bindings (`$variable` references)

## Proposed Component Catalog (Initial)

| Component | Description | Props |
|-----------|-------------|-------|
| `Card` | Container with title | `title`, `subtitle`, `variant` |
| `Text` | Text with styling | `content`, `size`, `color`, `weight` |
| `CodeBlock` | Syntax-highlighted code | `code`, `language`, `startLine` |
| `DiffViewer` | Unified diff display | `diff`, `file` |
| `FileTree` | File/folder tree | `files`, `selected` |
| `SearchResults` | List of search matches | `query`, `results` |
| `MetricCard` | KPI display | `label`, `value`, `format`, `trend` |
| `Button` | Action button | `label`, `variant`, `disabled` |
| `Row` | Horizontal layout | `gap`, `align`, `justify` |
| `Column` | Vertical layout | `gap`, `align` |
| `Image` | Remote image | `url`, `alt`, `width`, `height` |
| `ProgressBar` | Progress indicator | `value`, `max`, `label` |
| `Alert` | Status message | `message`, `severity` |

## Recommendation

**Start with Phase 1** - Extend the existing artifact system with a `ui` type that takes a full JSON spec. This validates the concept with minimal effort.

If Phase 1 proves useful, invest in Phase 2 for streaming. Phase 3 (full catalog with AI constraints) should wait until we have real usage data showing what components are actually needed.

## Open Questions

1. Should the catalog be defined in Flutter or shared with the TypeScript agent?
2. How do we handle component-specific actions (e.g., file tree selection)?
3. Should we support two-way data binding or keep it one-way?
4. What's the latency budget for generating UI specs vs just generating text?

---

## Sources

- [Vercel's json-render: A step toward generative UI](https://thenewstack.io/vercels-json-render-a-step-toward-generative-ui/)
- [GitHub - vercel-labs/json-render](https://github.com/vercel-labs/json-render)
- [json-render.dev](https://json-render.dev/)
