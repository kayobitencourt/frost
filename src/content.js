// Scroll layout: each scene owns a slice of the 0..1 progress, transitions sit on the cuts.
export const SECTIONS = [
  { id: 'origin', label: 'ORIGIN', jump: 0 },
  { id: 'ventures', label: 'VENTURES', jump: 0.28 },
  { id: 'passage', label: 'PASSAGE', jump: 0.5 },
  { id: 'contact', label: 'CONTACT', jump: 1 },
];
export const CUTS = [0.18, 0.42, 0.78];

export const MISSION =
  'Our mission is to build systems that keep their shape through the long winter: durable identity, memory and tools for communities.';

export const VENTURES = [
  {
    code: 'VENTURE_CO_01',
    name: 'Whiteout',
    tag: 'Signal / Identity',
    summary:
      'Whiteout is a quiet identity layer. It lets people carry who they are between networks without leaving a trail behind them, and gives communities a way to recognise their own members without asking for anything they do not need.',
    meta: [['Founded', '2023'], ['Stage', 'Live'], ['Focus', 'Identity']],
    date: '06.01.2023',
    socials: [['X', 'https://x.com/'], ['IG', 'https://instagram.com/'], ['LI', 'https://linkedin.com/']],
    site: 'https://example.com/',
  },
  {
    code: 'VENTURE_CO_02',
    name: 'Permafrost',
    tag: 'Storage / Memory',
    summary:
      'Permafrost keeps things that should not disappear. Archives, records and creative work are sealed into durable storage that outlives the platforms they were first published on, so the history of a community stays with the community.',
    meta: [['Founded', '2024'], ['Stage', 'Beta'], ['Focus', 'Archival']],
    date: '14.03.2024',
    socials: [['X', 'https://x.com/'], ['IG', 'https://instagram.com/'], ['LI', 'https://linkedin.com/']],
    site: 'https://example.com/',
  },
  {
    code: 'VENTURE_CO_03',
    name: 'Rime',
    tag: 'Tools / Creators',
    summary:
      'Rime is a studio toolkit for people who build worlds. It turns small, scattered contributions into shared canon, and makes sure every contributor is credited and rewarded for the layer they added.',
    meta: [['Founded', '2025'], ['Stage', 'Private'], ['Focus', 'Creation']],
    date: '22.09.2025',
    socials: [['X', 'https://x.com/'], ['IG', 'https://instagram.com/'], ['LI', 'https://linkedin.com/']],
    site: 'https://example.com/',
  },
];

// Replace the venture dates/socials/site and these hrefs with FROST's real profiles.
export const LINKS = [
  { label: 'Medium', glyph: 'M', href: 'https://medium.com/' },
  { label: 'LinkedIn', glyph: 'in', href: 'https://www.linkedin.com/' },
  { label: 'X / Twitter', glyph: 'X', href: 'https://x.com/' },
];

// Large blurred telemetry rows floating behind the crystal and platform scenes.
export const GHOST_ROWS = [
  'PRE LOAD OFF  //  2026',
  'TEMP -32.18  CORE 04',
  'ICE / SHEET 7  NOMINAL',
  'LAT 78.2232 N  LON 15.6267 E',
  'OPTICAL POS  00.4471',
  'DRIFT 0.03 M  /  H',
];
