import { QRCodeCanvas } from "qrcode.react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { brandedQRDataUrl, eventJoinUrl, eventQRSettings, EVENT_QR_DOWNLOAD_SIZE } from '@/lib/eventQR';

interface EventQRProps {
  roomCode: string;
  size?: number;
  showActions?: boolean;
}

export function EventQR({ roomCode, size = 240, showActions = true }: EventQRProps) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [colors] = useState(() => {
    const css = getComputedStyle(document.documentElement);
    return { bgColor: css.getPropertyValue('--qr-background').trim(), fgColor: css.getPropertyValue('--qr-foreground').trim() };
  });
  const joinUrl = eventJoinUrl(window.location.origin, roomCode);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast({ title: "Link copied", description: joinUrl });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const url = await brandedQRDataUrl(exportRef.current);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-${roomCode}.png`;
      a.click();
    } catch {
      toast({ title: 'QR download failed', description: 'The branded QR could not be saved. Reload to retry the logo.', variant: 'destructive' });
    } finally { setDownloading(false); }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-lg border event-qr-paper">
        <QRCodeCanvas
          value={joinUrl}
          size={size}
          {...colors}
          {...eventQRSettings(size)}
        />
      </div>
      <div ref={exportRef} className="hidden" aria-hidden="true" onLoadCapture={() => setLogoLoaded(true)} onErrorCapture={() => { setLogoLoaded(false); setLogoFailed(true); }}>
        <QRCodeCanvas value={joinUrl} size={EVENT_QR_DOWNLOAD_SIZE} {...colors} {...eventQRSettings(EVENT_QR_DOWNLOAD_SIZE)} />
      </div>
      {logoFailed && <p role="alert" className="text-sm text-destructive">QR logo failed to load. Reload to retry; download is unavailable.</p>}
      <div className="font-mono font-bold tracking-widest text-xl">{roomCode}</div>
      {showActions && (
        <div className="flex flex-wrap gap-2 justify-center">
          <Button variant="outline" size="sm" onClick={copyLink}>
            <Copy className="mr-2 h-4 w-4" /> Copy join link
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={!logoLoaded || logoFailed || downloading}>
            <Download className="mr-2 h-4 w-4" /> Download QR
          </Button>
        </div>
      )}
    </div>
  );
}
