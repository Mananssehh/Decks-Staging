export const EVENT_QR_LOGO = '/brand/decks-logo-mark-transparent.png';
export const EVENT_QR_DOWNLOAD_SIZE = 1024;
export function eventJoinUrl(origin: string, roomCode: string) {
  return `${origin}/join?code=${encodeURIComponent(roomCode)}`;
}
export function eventQRSettings(size: number) {
  return {
    level: 'H' as const,
    marginSize: 4,
    imageSettings: { src: EVENT_QR_LOGO, height: size * 0.18, width: size * 0.18, excavate: true, crossOrigin: 'anonymous' as const },
  };
}
export async function brandedQRDataUrl(wrap: HTMLElement | null) {
  const canvas = wrap?.querySelector('canvas');
  const image = wrap?.querySelector('img');
  if (!canvas || !image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
    throw new Error('The QR logo has not loaded. Please try again.');
  }
  await image.decode();
  // qrcode.react paints its embedded image in a React effect after image load.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const url = canvas.toDataURL('image/png');
  if (!url.startsWith('data:image/png')) throw new Error('Could not export the branded QR.');
  return url;
}