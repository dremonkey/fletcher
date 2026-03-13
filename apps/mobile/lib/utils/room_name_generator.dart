import 'dart:math';

/// Generates memorable two-word room names from curated word lists.
///
/// Each call to [generate] picks one adjective and one noun at random,
/// returning `adjective-noun` (e.g. `jade-beacon`, `frost-summit`).
///
/// Word lists contain 100+ entries each, giving 10,000+ unique combinations
/// — sufficient for single-user usage without collision detection.
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

  /// Returns the adjective word list (exposed for testing).
  static List<String> get adjectives => List.unmodifiable(_adjectives);

  /// Returns the noun word list (exposed for testing).
  static List<String> get nouns => List.unmodifiable(_nouns);

  /// Generate a random two-word room name: `word1-word2`.
  static String generate() {
    final adj = _adjectives[_random.nextInt(_adjectives.length)];
    final noun = _nouns[_random.nextInt(_nouns.length)];
    return '$adj-$noun';
  }
}
