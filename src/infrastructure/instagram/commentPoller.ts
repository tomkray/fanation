/**
 * The automatic collector: every N seconds asks the comment source for what
 * exists now and hands it to the city. Ticks never overlap; failures back off
 * (x2 up to x8) and recover on the next success.
 */

import { InstagramCommentEvent } from '../../core/types.js';
import { logger } from '../../utils/logger.js';
import { CommentSource } from './commentSource.js';

const MAX_BACKOFF_FACTOR = 8;

export class CommentPoller {
  private timer: NodeJS.Timeout | null = null;
  private backoffFactor = 1;
  private stopped = true;

  constructor(
    private readonly source: CommentSource,
    private readonly intervalMs: number,
    private readonly onComments: (events: InstagramCommentEvent[], source: CommentSource['name']) => void
  ) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    logger.info('comment_poller_started', { source: this.source.name, intervalMs: this.intervalMs });
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<number> {
    const events = await this.source.fetchComments();
    this.onComments(events, this.source.name);
    return events.length;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      const fetched = await this.runOnce();
      this.backoffFactor = 1;
      logger.info('comment_poller_tick', { source: this.source.name, fetched });
    } catch (err) {
      this.backoffFactor = Math.min(MAX_BACKOFF_FACTOR, this.backoffFactor * 2);
      logger.error('comment_poller_tick_failed', {
        source: this.source.name,
        message: err instanceof Error ? err.message : String(err),
        nextDelayMs: this.intervalMs * this.backoffFactor,
      });
    } finally {
      this.schedule(this.intervalMs * this.backoffFactor);
    }
  }
}
