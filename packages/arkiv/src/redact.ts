/**
 * Removes secrets from text before it is printed or logged. An Arkiv access key is part of the RPC URL, and viem puts that URL
 * into its error messages, so an ordinary network error would otherwise print the key into a log, a terminal or a chat.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/ark_(?:live|test)_[A-Za-z0-9]+/g, 'ark_***')
    .replace(/(https?:\/\/[^\s/]+\/)[A-Za-z0-9_-]{24,}/g, '$1***')
    .replace(/\b0x[0-9a-fA-F]{64}\b(?=\s*[,;)]?\s*(?:is|as|was)?\s*(?:the )?(?:private|secret))/gi, '0x***');
}

export const safeMessage = (e: unknown): string => redactSecrets(e instanceof Error ? e.message : String(e));

/**
 * Makes any crash print a scrubbed message. A thrown viem error carries the RPC URL, which contains the Arkiv access key, and Node
 * prints it whole. Call this once at the top of a command-line entry point.
 */
export function installErrorScrubbing(): void {
  const scrub = (e: unknown) => redactSecrets(e instanceof Error ? `${e.stack ?? e.message}` : String(e));
  process.on('uncaughtException', (e) => { console.error(scrub(e)); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error(scrub(e)); process.exit(1); });
}
