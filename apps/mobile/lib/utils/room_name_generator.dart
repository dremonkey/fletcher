import 'dart:math';

/// Generates memorable word-pair names for rooms and sessions.
///
/// Word lists contain 100+ entries each, giving 10,000+ unique combinations
/// — sufficient for single-user usage without collision detection.
///
/// Sprinkled with obscure references to classic NES-era Nintendo games
/// (Zelda, Mario, Metroid, Kid Icarus, etc.) for extra flavor.
abstract final class NameGenerator {
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
    // NES-era Nintendo flavor
    'hyrule', 'warp', 'lakitu', 'varia', 'tanooki', 'moblin',
    'gerudo', 'koopa', 'ridley', 'brinstar', 'subcon', 'zebes',
    'palutena', 'starman', 'hammer', 'peahat', 'buzzy', 'blooper',
    'lanmola', 'pols', 'podoboo', 'lynel', 'armos', 'gibdo',
    'chozo', 'kraid', 'wizzrobe', 'stalfos', 'zora', 'dodongo',
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
    // NES-era Nintendo flavor
    'triforce', 'ocarina', 'rupee', 'hookshot', 'bobomb', 'warpzone',
    'fireflower', 'mushroom', 'boomerang', 'dungeon', 'morphball',
    'screw', 'piranha', 'goomba', 'thwomp', 'whistle', 'raft',
    'canoe', 'flute', 'hammer', 'ladder', 'potion', 'cucco',
    'chalice', 'scepter', 'gauntlet', 'tunic', 'pendant', 'relic',
  ];

  /// Returns the adjective word list (exposed for testing).
  static List<String> get adjectives => List.unmodifiable(_adjectives);

  /// Returns the noun word list (exposed for testing).
  static List<String> get nouns => List.unmodifiable(_nouns);

  /// Generate a random word pair (adjective-noun).
  static String generateWordPair() {
    final adj = _adjectives[_random.nextInt(_adjectives.length)];
    final noun = _nouns[_random.nextInt(_nouns.length)];
    return '$adj-$noun';
  }

  /// Generate a room name: word pair + 4-char alphanumeric suffix.
  /// Room names are disposable transport identifiers.
  ///
  /// When [wordPair] is provided, the room name shares that prefix
  /// (e.g., session "amber-elm-20260315" → room "amber-elm-7x2q").
  /// When omitted, a fresh random pair is generated.
  static String generateRoomName({String? wordPair}) {
    final pair = wordPair ?? generateWordPair();
    final suffix = _random4CharAlphanumeric();
    return '$pair-$suffix';
  }

  /// Extract the word pair prefix from a session name.
  ///
  /// Session names have the form "adj-noun-YYYYMMDD".
  /// Returns the "adj-noun" portion.
  static String extractWordPair(String sessionName) {
    final lastDash = sessionName.lastIndexOf('-');
    if (lastDash <= 0) return sessionName;
    return sessionName.substring(0, lastDash);
  }

  /// Generate a session name: word pair + YYYYMMDD suffix.
  /// Session names are durable conversation identifiers.
  static String generateSessionName() {
    final pair = generateWordPair();
    final now = DateTime.now();
    final date =
        '${now.year}${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}';
    return '$pair-$date';
  }

  static String _random4CharAlphanumeric() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return List.generate(4, (_) => chars[_random.nextInt(chars.length)]).join();
  }
}

/// Backward-compatible alias. Use [NameGenerator] for new code.
@Deprecated('Use NameGenerator instead')
typedef RoomNameGenerator = NameGenerator;
