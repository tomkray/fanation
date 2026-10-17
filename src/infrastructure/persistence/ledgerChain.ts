/**
 * Tamper evidence for the journal (A6).
 *
 * Every record is chained to the one before it with SHA-256, so changing,
 * inserting or dropping any line changes every hash after it. All records also
 * form one Merkle tree (RFC 6962 hashing: 0x00 leaves, 0x01 nodes), so a single
 * record can be shown to be in the book with log2(n) hashes against the root.
 *
 * The head and root are public. A history rewritten after the fact no longer
 * matches a head that was published before; anchoring that head outside this
 * machine is what makes a rewrite by the operator detectable too.
 */

import { createHash } from 'node:crypto';

const CHAIN_DOMAIN = 'naoeumfa.ledger.v1';
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);
const LINK_SEPARATOR = Buffer.from([0x0a]);

function sha256(...parts: readonly Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

export const GENESIS_LINK = sha256(Buffer.from(CHAIN_DOMAIN, 'utf-8'));

export function chainLink(previous: Buffer, body: string): Buffer {
  return sha256(previous, LINK_SEPARATOR, Buffer.from(body, 'utf-8'));
}

export function leafHash(body: string): Buffer {
  return sha256(LEAF_PREFIX, Buffer.from(body, 'utf-8'));
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(NODE_PREFIX, left, right);
}

/** Largest power of two strictly below n (n ≥ 2). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }
  return k;
}

/** RFC 6962 Merkle Tree Hash over leaf hashes. */
export function merkleRoot(leaves: readonly Buffer[]): Buffer {
  if (leaves.length === 0) {
    return sha256();
  }
  if (leaves.length === 1) {
    return leaves[0];
  }
  const k = splitPoint(leaves.length);
  return nodeHash(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}

/** RFC 6962 audit path for the leaf at `index`. */
export function inclusionPath(leaves: readonly Buffer[], index: number): Buffer[] {
  if (index < 0 || index >= leaves.length) {
    throw new RangeError(`No leaf ${index} in a tree of ${leaves.length}.`);
  }
  if (leaves.length === 1) {
    return [];
  }
  const k = splitPoint(leaves.length);
  return index < k
    ? [...inclusionPath(leaves.slice(0, k), index), merkleRoot(leaves.slice(k))]
    : [...inclusionPath(leaves.slice(k), index - k), merkleRoot(leaves.slice(0, k))];
}

/** RFC 9162 §2.1.3.2: does `path` prove `leaf` sits at `index` under `root`? */
export function verifyInclusion(leaf: Buffer, index: number, size: number, path: readonly Buffer[], root: Buffer): boolean {
  if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || index >= size) {
    return false;
  }
  let fn = index;
  let sn = size - 1;
  let r = leaf;
  for (const p of path) {
    if (sn === 0) {
      return false;
    }
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && r.equals(root);
}

export class LedgerTamperError extends Error {
  constructor(readonly seq: number) {
    super(`Journal record ${seq} does not match its hash: the book was changed after it was written.`);
    this.name = 'LedgerTamperError';
  }
}

export interface LedgerHead {
  readonly size: number;
  readonly seq: number;
  readonly chainHash: string;
  readonly merkleRoot: string;
}

export interface LedgerProof {
  readonly seq: number;
  readonly index: number;
  readonly size: number;
  readonly leafHash: string;
  readonly path: readonly string[];
  readonly merkleRoot: string;
}

/** The running chain head and Merkle leaves of one journal, in order. */
export class LedgerChain {
  private head = GENESIS_LINK;
  private lastSeq = 0;
  private readonly leaves: Buffer[] = [];
  private readonly indexBySeq = new Map<number, number>();
  private rootCache: { readonly size: number; readonly root: Buffer } | null = null;

  /** The hash the next record with this body will carry. */
  nextLink(body: string): string {
    return chainLink(this.head, body).toString('hex');
  }

  /**
   * Adds a record. A stored hash must equal the recomputed link; records
   * written before the chain existed carry none and are covered by the next
   * hash written after them.
   */
  append(seq: number, body: string, storedHash: string | undefined): string {
    const link = chainLink(this.head, body);
    if (storedHash !== undefined && link.toString('hex') !== storedHash) {
      throw new LedgerTamperError(seq);
    }
    this.head = link;
    this.lastSeq = seq;
    this.indexBySeq.set(seq, this.leaves.length);
    this.leaves.push(leafHash(body));
    this.rootCache = null;
    return link.toString('hex');
  }

  get headInfo(): LedgerHead {
    return { size: this.leaves.length, seq: this.lastSeq, chainHash: this.head.toString('hex'), merkleRoot: this.root().toString('hex') };
  }

  proof(seq: number): LedgerProof | null {
    const index = this.indexBySeq.get(seq);
    if (index === undefined) {
      return null;
    }
    return {
      seq,
      index,
      size: this.leaves.length,
      leafHash: this.leaves[index].toString('hex'),
      path: inclusionPath(this.leaves, index).map((h) => h.toString('hex')),
      merkleRoot: this.root().toString('hex'),
    };
  }

  private root(): Buffer {
    if (this.rootCache?.size !== this.leaves.length) {
      this.rootCache = { size: this.leaves.length, root: merkleRoot(this.leaves) };
    }
    return this.rootCache.root;
  }
}
