import { describe, expect, it } from 'vitest';
import { assignIdentities, getIdentityCounts } from './identity-engine.js';

const expectedCounts = [
  [4, { red: 2, blue: 2, white: 0 }],
  [5, { red: 2, blue: 2, white: 1 }],
  [6, { red: 2, blue: 2, white: 2 }],
  [7, { red: 3, blue: 3, white: 1 }],
  [8, { red: 3, blue: 3, white: 2 }],
] as const;

describe('identity-engine', () => {
  it.each(expectedCounts)('returns configured counts for %i players', (playerCount, counts) => {
    expect(getIdentityCounts(playerCount)).toEqual(counts);
  });

  it('assigns the right number of identities', () => {
    const identities = assignIdentities(5, () => 0);
    expect(identities).toHaveLength(5);
    expect(identities.filter((item) => item === 'red')).toHaveLength(2);
    expect(identities.filter((item) => item === 'blue')).toHaveLength(2);
    expect(identities.filter((item) => item === 'white')).toHaveLength(1);
  });

  it('rejects unsupported player counts', () => {
    expect(() => getIdentityCounts(3)).toThrow(/Unsupported/);
    expect(() => getIdentityCounts(9)).toThrow(/Unsupported/);
  });
});
