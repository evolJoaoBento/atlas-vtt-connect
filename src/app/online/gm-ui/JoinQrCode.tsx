import React from 'react';
import qrcode from 'qrcode-generator';

/** The join link's QR modules (true: dark), row by row; null when the link is too long for a QR code. */
export function qrModules(text: string): boolean[][] | null {
  // The lowest error correction holds the most: a join link carries its table's key and servers, so it can be long.
  try {
    const code = qrcode(0, 'L');
    code.addData(text, 'Byte');
    code.make();
    const count = code.getModuleCount();
    return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (__, col) => code.isDark(row, col)));
  } catch {
    return null;
  }
}

/** The quiet margin a scanner needs round a QR code, in modules. */
const QUIET = 4;

/**
 * The join link as a QR code, for a player to open it on a phone by pointing its camera at the screen. Drawn as one
 * SVG path, dark on white whatever the theme (a scanner needs the contrast), and big enough to scan from a screen.
 */
export function JoinQrCode({ url }: { url: string }): React.ReactElement {
  const modules = React.useMemo(() => qrModules(url), [url]);
  if (!modules) return <p className="atlas-connect-panel__help" role="note">The join link is too long for a QR code. Copy it instead.</p>;
  const size = modules.length + QUIET * 2;
  let path = '';
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`; }));
  return (
    <figure className="atlas-connect-panel__qr">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code of the join link" shapeRendering="crispEdges">
        <rect width={size} height={size} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
      <figcaption>Scan with a phone&apos;s camera to open the join page.</figcaption>
    </figure>
  );
}
