import { InstagramCommentEvent } from '../../core/types.js';
import { CommentSourceName } from '../../shared/apiContract.js';

/** Anything that can be asked "what comments exist now?" on a timer. */
export interface CommentSource {
  readonly name: Extract<CommentSourceName, 'instagram_poll' | 'simulated'>;
  fetchComments(): Promise<InstagramCommentEvent[]>;
}
