/** Notes compare and merge on LF; the receiver's own line ending is written back. */
export const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

export const usesCrlf = (text: string): boolean => text.includes('\r\n');

export const withEnding = (text: string, crlf: boolean): string => (crlf ? toLf(text).replace(/\n/g, '\r\n') : text);
