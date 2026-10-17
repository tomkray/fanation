/**
 * Rebuilds the chain from the journal bytes alone and prints the head.
 *
 *   npm run ledger:verify
 *   npm run ledger:verify -- data/ledger.jsonl <published-chainHash>
 *
 * Exit 1 when a stored hash does not match (the book was edited) or when the
 * head differs from the one you published.
 */

import path from 'node:path';
import { FileEventJournal, serializeRecordBody } from '../src/infrastructure/persistence/eventJournal.js';
import { LedgerChain, LedgerTamperError } from '../src/infrastructure/persistence/ledgerChain.js';

function main(): number {
  const file = path.resolve(process.argv[2] ?? 'data/ledger.jsonl');
  const published = process.argv[3]?.trim().toLowerCase() ?? null;
  const chain = new LedgerChain();
  let unhashed = 0;
  try {
    for (const record of new FileEventJournal(file).load()) {
      if (record.hash === undefined) {
        unhashed += 1;
      }
      chain.append(record.seq, serializeRecordBody(record), record.hash);
    }
  } catch (err) {
    if (err instanceof LedgerTamperError) {
      console.error(`✗ ${err.message}`);
      return 1;
    }
    throw err;
  }
  const head = chain.headInfo;
  console.log(`✓ ${head.size} records · seq ${head.seq}`);
  console.log(`  chainHash  ${head.chainHash}`);
  console.log(`  merkleRoot ${head.merkleRoot}`);
  if (unhashed > 0) {
    console.log(`  ${unhashed} older record(s) carry no stored hash; the next hashed record covers them.`);
  }
  if (published && published !== head.chainHash) {
    console.error(`✗ head differs from the published ${published}`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
