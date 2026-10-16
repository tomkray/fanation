/**
 * Structured safe logger for Não É Um Fã.
 * Redacts sensitive keys, tokens, and secrets before writing to stdout/stderr.
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';

export interface LogMetadata {
  readonly [key: string]: string | number | boolean | null | undefined;
}

const SENSITIVE_KEY_PATTERN = /(secret|token|password|key|signature|authorization|pix_key|mnemonic)/i;

function sanitizeMetadata(meta?: LogMetadata): Record<string, string | number | boolean | null> {
  if (!meta) {
    return {};
  }
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) {
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export const logger = {
  info(event: string, meta?: LogMetadata): void {
    this.write('INFO', event, meta);
  },
  warn(event: string, meta?: LogMetadata): void {
    this.write('WARN', event, meta);
  },
  error(event: string, meta?: LogMetadata): void {
    this.write('ERROR', event, meta);
  },
  security(event: string, meta?: LogMetadata): void {
    this.write('SECURITY', event, meta);
  },
  write(level: LogLevel, event: string, meta?: LogMetadata): void {
    const entry = {
      timestamp: new Date().toISOString(),
      service: 'naoeumfa',
      level,
      event,
      ...sanitizeMetadata(meta),
    };
    const serialized = JSON.stringify(entry);
    if (level === 'ERROR' || level === 'SECURITY') {
      process.stderr.write(`${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  },
};
