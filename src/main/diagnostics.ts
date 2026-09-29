/** Export only operational context; never export config, credentials, saves, or account names. */
export function redactDiagnostics(line: string): string {
  return line.replace(/\b(?:raKey|raUser|raSecret|api[_ -]?key|authorization)\b\s*[:=]\s*[^\r\n]*/gi, '[credential redacted]')
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, '[path redacted]')
    .replace(/\\\\[^\r\n]*/g, '[network path redacted]')
    .replace(/https?:\/\/\S+/g, '[URL redacted]')
}
