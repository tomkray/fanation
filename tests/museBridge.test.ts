import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mediaIdFromBatch, museCommentId, parseMuseBatch } from '../src/infrastructure/instagram/museBridge.js';

describe('muse bridge', () => {
  it('keeps an official Meta comment id', () => {
    const parsed = parseMuseBatch(
      {
        mediaId: 'media_1',
        comments: [{ commentId: '1789001', authorUsername: '@Fan_One', text: '  @taylorswift  ', timestamp: '2026-10-16T20:00:00.000Z' }],
      },
      1_700_000_000_000
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.events[0]?.commentId).toBe('1789001');
    expect(parsed.events[0]?.authorUsername).toBe('fan_one');
    expect(parsed.events[0]?.text).toBe('@taylorswift');
  });

  it('hashes missing ids so the same dump never remints', () => {
    const a = museCommentId('media_1', 'fan_one', '@taylorswift day one');
    const b = museCommentId('media_1', 'fan_one', '@taylorswift day one');
    const c = museCommentId('media_1', 'fan_one', '@taylorswift day two');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('muse_')).toBe(true);
  });

  it('dedupes identical rows inside one batch', () => {
    const parsed = parseMuseBatch({
      mediaUrl: 'https://www.instagram.com/p/abc/',
      comments: [
        { authorUsername: 'fan_one', text: '@taylorswift' },
        { authorUsername: 'fan_one', text: '@taylorswift' },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.events).toHaveLength(1);
    expect(parsed.mediaId).toBe(`muse_media_${createHash('sha256').update('https://www.instagram.com/p/abc/').digest('hex').slice(0, 32)}`);
  });

  it('builds a media id from the post url', () => {
    expect(mediaIdFromBatch({ mediaUrl: 'https://instagram.com/p/x/', comments: [] })).toMatch(/^muse_media_/);
  });
});
