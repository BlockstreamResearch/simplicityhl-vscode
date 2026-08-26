// Parses simfmt diagnostics and builds concise failure notifications.

const DIAGNOSTIC_HEADER = /^error(?:\[[^\]]+\])?:\s*(.+)$/gm;
const DIAGNOSTIC_LOCATION = /^\s*-->\s+(.+):(\d+):(\d+)\s*$/m;
const MAX_NOTIFICATION_LENGTH = 200;

export interface FormatterDiagnostic {
  message: string;
  filePath: string;
  line: number;
  column: number;
}

export function parseFormatterDiagnostics(output: string): FormatterDiagnostic[] {
  const headers = [...output.matchAll(DIAGNOSTIC_HEADER)];

  return headers.flatMap((header, index) => {
    const blockStart = (header.index ?? 0) + header[0].length;
    const blockEnd = headers[index + 1]?.index ?? output.length;
    const block = output.slice(blockStart, blockEnd);
    const location = block.match(DIAGNOSTIC_LOCATION);

    if (!location) return [];

    return [{
      message: header[1].trim(),
      filePath: location[1],
      line: Number(location[2]),
      column: Number(location[3]),
    }];
  });
}

export function getFailureNotification(output: string): string {
  const message = parseFormatterDiagnostics(output)[0]?.message
    || output.trim().split(/\r?\n/)[0]
    || "simfmt failed without reporting an error";
  const notification = `Formatting failed: ${message}`;

  // Limit only the notification preview; callers retain the complete output.
  return notification.length > MAX_NOTIFICATION_LENGTH
    ? `${notification.slice(0, MAX_NOTIFICATION_LENGTH - 1).trimEnd()}…`
    : notification;
}
