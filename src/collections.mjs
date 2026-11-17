// Collection slugs must be verified against objekt.top when published.
// HyeRin 331 is confirmed from the user-provided objekt.top URL.
export const COLLECTIONS = [
  { slug: 'binary02-hyerin-331z', member: '혜린', number: 'BB331', verified: true },
  { slug: 'binary02-hyerin-332z', member: '혜린', number: 'BB332' },
  { slug: 'binary02-soomin-331z', member: '수민', number: 'BB331' },
  { slug: 'binary02-soomin-332z', member: '수민', number: 'BB332' },
  { slug: 'binary02-hayeon-331z', member: '하연', number: 'BB331' },
  { slug: 'binary02-hayeon-332z', member: '하연', number: 'BB332' },
  { slug: 'binary02-chaewon-331z', member: '채원', number: 'BB331' },
  { slug: 'binary02-chaewon-332z', member: '채원', number: 'BB332' },
];
export const BY_SLUG = Object.fromEntries(COLLECTIONS.map(x => [x.slug, x]));
