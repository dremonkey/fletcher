# Task 029: Random Two-Word Room Names

**Epic:** 07 — UI/UX (TUI Brutalist)
**Status:** [x]
**Depends on:** none
**Blocks:** none

## Goal

Replace timestamp-based room names (`fletcher-1710355200000`) with human-readable two-word names (e.g., `orphan-jewel`, `jade-basket`). Room names should be memorable and easy to communicate verbally.

## Context

Currently `_generateRoomName()` in `LiveKitService` produces `fletcher-<unix-millis>` (or `e2e-fletcher-<millis>` for E2E tests). These are opaque and hard to reference in conversation or logs.

The room name appears in:
- `DiagnosticsInfo.sessionName` (diagnostics modal)
- LiveKit server room list
- Relay bridge room management
- Session storage for reconnection

Collision resistance: Two word lists of 100 words each = 10,000 unique combinations. For a single user creating a few rooms per day, collisions are effectively impossible. If needed, a third word or suffix can be added later.

### E2E prefix preservation

E2E test rooms use `e2e-fletcher-<millis>` to signal minimal system prompt to the agent. The new format should preserve this: `e2e-<word1>-<word2>`.

## Implementation

### 1. Create RoomNameGenerator utility (`apps/mobile/lib/utils/room_name_generator.dart`)

```dart
abstract final class RoomNameGenerator {
  static final _random = Random();

  static const _adjectives = [
    'amber', 'arctic', 'azure', 'bitter', 'blaze', 'bold', 'brass',
    'bright', 'bronze', 'calm', 'cedar', 'chalk', 'chrome', 'clay',
    'clear', 'cliff', 'cloud', 'cold', 'copper', 'coral',
    'crimson', 'crystal', 'dark', 'dawn', 'deep', 'dense', 'drift',
    'dusk', 'dusty', 'echo', 'ember', 'faded', 'fern', 'fierce',
    'flint', 'flock', 'forge', 'frost', 'ghost', 'glass',
    'golden', 'granite', 'green', 'grey', 'haze', 'hollow', 'hushed',
    'iron', 'ivory', 'jade', 'keen', 'lapis', 'light', 'lunar',
    'marble', 'marsh', 'matte', 'misty', 'moss', 'muted',
    'narrow', 'night', 'noble', 'north', 'oaken', 'onyx', 'pale',
    'pearl', 'pine', 'plain', 'polar', 'proud', 'quiet',
    'rapid', 'raven', 'raw', 'reed', 'rocky', 'rough', 'ruby',
    'rust', 'sage', 'salt', 'sandy', 'sharp', 'silent', 'silver',
    'slate', 'sleek', 'solar', 'stark', 'steel', 'stone', 'storm',
    'swift', 'tawny', 'thorn', 'timber', 'vast', 'velvet', 'wild',
  ];

  static const _nouns = [
    'arrow', 'badge', 'basin', 'beacon', 'blade', 'bloom', 'bolt',
    'bone', 'brook', 'cairn', 'candle', 'canyon', 'cask', 'cave',
    'chain', 'citadel', 'cliff', 'cloud', 'cobalt', 'coin',
    'compass', 'cove', 'crane', 'creek', 'crest', 'crown', 'dagger',
    'den', 'dome', 'drum', 'dune', 'eagle', 'edge', 'elm',
    'falcon', 'fang', 'field', 'flame', 'flask', 'ford',
    'forge', 'gate', 'glade', 'gleam', 'grove', 'harbor', 'hawk',
    'hearth', 'hedge', 'helm', 'heron', 'hill', 'horn', 'island',
    'jewel', 'keep', 'knoll', 'lance', 'lantern', 'latch',
    'ledge', 'loom', 'manor', 'maple', 'marsh', 'mesa', 'mill',
    'mirror', 'moat', 'mound', 'nest', 'oasis', 'orchard', 'peak',
    'pier', 'pillar', 'plume', 'pond', 'quartz', 'rail', 'reef',
    'ridge', 'river', 'rook', 'shard', 'shell', 'shield', 'shore',
    'spark', 'spire', 'spring', 'spur', 'stone', 'summit', 'sword',
    'tide', 'torch', 'tower', 'trail', 'vale', 'vault', 'well',
  ];

  /// Generate a random two-word room name: `word1-word2`.
  static String generate() {
    final adj = _adjectives[_random.nextInt(_adjectives.length)];
    final noun = _nouns[_random.nextInt(_nouns.length)];
    return '$adj-$noun';
  }
}
```

### 2. Update `_generateRoomName()` (`apps/mobile/lib/services/livekit_service.dart`)

Replace the current implementation:

```dart
String _generateRoomName() {
  final isE2e = dotenv.env['E2E_TEST_MODE']?.toLowerCase() == 'true';
  final name = RoomNameGenerator.generate();
  return isE2e ? 'e2e-$name' : name;
}
```

### 3. Unit tests (`apps/mobile/test/utils/room_name_generator_test.dart`)

- `generate()` returns `word1-word2` format (contains exactly one hyphen)
- `generate()` returns all lowercase
- `generate()` returns different names on successive calls (probabilistic — run 10 times, expect at least 2 unique)
- Both words are from the word lists (split on hyphen, check membership)
- E2E prefix: verify `_generateRoomName()` produces `e2e-<word>-<word>` when `E2E_TEST_MODE=true`

## Not in scope

- Collision detection/retry (10K combinations is sufficient)
- User-configurable word lists
- Persistent name assignment (new name each room creation)

## Relates to

- Task 021: Dynamic Room Names (original timestamp-based implementation)
- `apps/mobile/lib/services/session_storage.dart` — stores room name for reconnection

## Acceptance criteria

- [ ] `RoomNameGenerator` utility created with 100+ adjectives and 100+ nouns
- [ ] `_generateRoomName()` returns `word1-word2` format
- [ ] E2E rooms use `e2e-word1-word2` format
- [ ] All existing room reconnection logic works with new name format
- [ ] Unit tests for generator format, uniqueness, and E2E prefix
