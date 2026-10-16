/**
 * PIX BR Code ("Copia e Cola") builder per the BACEN EMV-MPM manual.
 * Static code with amount and txid; reconciliation still needs a PSP.
 */

export interface PixBrCodeInput {
  readonly pixKey: string;
  readonly amountBrlCents: bigint;
  readonly merchantName: string;
  readonly merchantCity: string;
  readonly txid: string;
}

/** CRC16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor. */
export function crc16CcittFalse(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id: string, value: string): string {
  if (value.length > 99) {
    throw new RangeError(`EMV field ${id} exceeds 99 characters.`);
  }
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

/** Strips accents and anything outside printable ASCII; banks reject the rest. */
function toEmvAscii(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, maxLength);
}

export function formatBrlCents(amountBrlCents: bigint): string {
  const reais = amountBrlCents / 100n;
  const cents = (amountBrlCents % 100n).toString().padStart(2, '0');
  return `${reais}.${cents}`;
}

export function buildPixBrCode(input: PixBrCodeInput): string {
  if (input.amountBrlCents <= 0n) {
    throw new RangeError('amountBrlCents must be positive.');
  }
  const key = input.pixKey.trim();
  if (key.length === 0 || key.length > 77) {
    throw new RangeError('PIX key must have 1..77 characters.');
  }
  const txid = input.txid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
  if (txid.length === 0) {
    throw new RangeError('txid must contain at least one alphanumeric character.');
  }

  const merchantAccount = emvField('00', 'br.gov.bcb.pix') + emvField('01', key);
  const withoutCrc =
    emvField('00', '01') +
    emvField('26', merchantAccount) +
    emvField('52', '0000') +
    emvField('53', '986') +
    emvField('54', formatBrlCents(input.amountBrlCents)) +
    emvField('58', 'BR') +
    emvField('59', toEmvAscii(input.merchantName, 25)) +
    emvField('60', toEmvAscii(input.merchantCity, 15)) +
    emvField('62', emvField('05', txid)) +
    '6304';

  return withoutCrc + crc16CcittFalse(withoutCrc);
}
