// tripleS Cream02 CC372Z, CC373Z, CC374Z — ten-member first-receiver ranking.
// Slugs follow objekt.top's season-member-number naming convention.
// Verify these slugs against the live catalog before treating API results as complete.
export const MEMBERS = [
  { member: '혜린', english: 'hyerin', label: 'HyeRin', s: 2 },
  { member: '지우', english: 'jiwoo', label: 'JiWoo', s: 3 },
  { member: '수민', english: 'soomin', label: 'SooMin', s: 6 },
  { member: '유빈', english: 'yubin', label: 'YuBin', s: 8 },
  { member: '다현', english: 'dahyun', label: 'DaHyun', s: 10 },
  { member: '니엔', english: 'nien', label: 'Nien', s: 13 },
  { member: '소현', english: 'sohyun', label: 'SoHyun', s: 14 },
  { member: '시온', english: 'shion', label: 'ShiOn', s: 20 },
  { member: '설린', english: 'sullin', label: 'Sullin', s: 22 },
  { member: '서아', english: 'seoah', label: 'SeoAh', s: 23 },
];

export const NUMBERS = [372, 373, 374];
export const COLLECTIONS = MEMBERS.flatMap(({ member, english }) =>
  NUMBERS.map(number => ({
    slug: `cream02-${english}-${number}z`,
    member,
    number: `CC${number}Z`,
  }))
);
export const BY_SLUG = Object.fromEntries(COLLECTIONS.map(x => [x.slug, x]));
