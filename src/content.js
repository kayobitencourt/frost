export const SECTIONS = [
  { id: 'origin', label: 'ORIGIN', range: [0, 0.06], jump: 0 },
  { id: 'structure', label: 'STRUCTURE', range: [0.14, 0.34], jump: 0.2 },
  { id: 'passage', label: 'PASSAGE', range: [0.44, 0.6], jump: 0.5 },
  { id: 'ventures', label: 'VENTURES', range: [0.66, 0.84], jump: 0.75 },
  { id: 'manifesto', label: 'MANIFESTO', range: [0.88, 1.01], jump: 1 },
];

export const VENTURES = [
  {
    code: 'FROST_CO',
    name: 'Whiteout',
    tag: 'Signal / Identity',
    summary:
      'Whiteout is a quiet identity layer. It lets people carry who they are between networks without leaving a trail behind them, and gives communities a way to recognise their own members without asking for anything they do not need.',
    meta: [['Founded', '2023'], ['Stage', 'Live'], ['Focus', 'Identity']],
  },
  {
    code: 'FROST_CO',
    name: 'Permafrost',
    tag: 'Storage / Memory',
    summary:
      'Permafrost keeps things that should not disappear. Archives, records and creative work are sealed into durable storage that outlives the platforms they were first published on, so the history of a community stays with the community.',
    meta: [['Founded', '2024'], ['Stage', 'Beta'], ['Focus', 'Archival']],
  },
  {
    code: 'FROST_CO',
    name: 'Rime',
    tag: 'Tools / Creators',
    summary:
      'Rime is a studio toolkit for people who build worlds. It turns small, scattered contributions into shared canon, and makes sure every contributor is credited and rewarded for the layer they added.',
    meta: [['Founded', '2025'], ['Stage', 'Private'], ['Focus', 'Creation']],
  },
];

export const MANIFESTO = [
  'Most things built for the internet melt the moment attention moves on.',
  'We build for the long winter instead: systems that keep their shape when nobody is watching, and communities that hold together under pressure.',
  'Slow to form. Hard to break. Clear all the way through.',
];
