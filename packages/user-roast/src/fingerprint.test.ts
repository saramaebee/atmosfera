import { describe, expect, it } from 'bun:test';
import { type Fingerprint, summarizeFingerprint } from './fingerprint';

function fp(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    source: 'index',
    guildId: 'g1',
    targetUserId: 't1',
    windowDays: 30,
    totalMessages: 295,
    avgMessageLength: 42,
    attachmentRate: 0,
    activeChannels: 1,
    totalGuildChannels: 139,
    rank: { position: 5, total: 200 },
    topChannels: [{ channelId: 'c1', channelName: 'general', msgCount: 295 }],
    hourHistogram: new Array(24).fill(0).map((_, i) => (i === 18 ? 100 : 1)),
    longestStreakDays: 3,
    topPartners: [{ userId: 'p1', displayName: 'Bob', replies: 10, mentions: 2 }],
    lengthBucketHistogram: [10, 50, 100, 30, 5],
    ...overrides,
  };
}

describe('summarizeFingerprint', () => {
  it('includes channel-distribution + histograms by default', () => {
    const out = summarizeFingerprint(fp(), 'Sarah');
    expect(out).toContain('Server has 139 readable channels');
    expect(out).toContain('ignores 138');
    expect(out).toContain('Peak posting hour (UTC):');
    expect(out).toContain('Hour-of-day histogram');
    expect(out).toContain('Length-bucket histogram');
  });

  it('omits channel-distribution + histograms when deemphasized', () => {
    const out = summarizeFingerprint(fp(), 'Sarah', { deemphasizeChannelDist: true });
    expect(out).not.toContain('readable channels');
    expect(out).not.toContain('ignores');
    expect(out).not.toContain('Hour-of-day histogram');
    expect(out).not.toContain('Length-bucket histogram');
    expect(out).not.toContain('Top channels');
    // Still keeps target + partners — those don't bias toward channel-monoculture jokes.
    expect(out).toContain('Target: Sarah');
    expect(out).toContain('Top interaction partners');
  });
});
