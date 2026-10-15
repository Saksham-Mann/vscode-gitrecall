/**
 * Minimal structural interface for a VS Code OutputChannel.
 * Keeps the logger decoupled from the live 'vscode' module during unit tests.
 */
export interface OutputChannelLike {
  appendLine(value: string): void;
}

let sharedChannel: OutputChannelLike | undefined;

/**
 * Registers or clears the shared OutputChannel used across all GitRecall modules.
 */
export function setOutputChannel(channel: OutputChannelLike | undefined): void {
  sharedChannel = channel;
}

/**
 * Sanitizes single-line diagnostic log messages by escaping control characters.
 */
function sanitizeLogMessage(message: string): string {
  // eslint-disable-next-line no-control-regex
  return message.replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === '\n') {
      return '\\n';
    }
    if (ch === '\r') {
      return '\\r';
    }
    if (ch === '\t') {
      return '\\t';
    }
    return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}

/**
 * Logs an informational message to the shared GitRecall OutputChannel and console.
 */
export function log(message: string): void {
  const safe = sanitizeLogMessage(message);
  const timestamped = `[${new Date().toISOString()}] ${safe}`;
  sharedChannel?.appendLine(timestamped);
  console.log(`[GitRecall] ${safe}`);
}

/**
 * Logs a warning message (and optional error detail) to the shared GitRecall OutputChannel and console.
 */
export function logWarn(message: string, error?: unknown): void {
  const detail =
    error === undefined
      ? ''
      : `: ${error instanceof Error ? error.message : String(error)}`;
  const safe = sanitizeLogMessage(`${message}${detail}`);
  const timestamped = `[${new Date().toISOString()}] WARN: ${safe}`;
  sharedChannel?.appendLine(timestamped);
  console.warn(`[GitRecall] ${safe}`);
}
