import { Radio } from "lucide-react";

/**
 * Bridge connect helper. Pairing Protocol v2 codes are secrets that are typed or pasted into
 * the desktop app: this page reads nothing from the URL, renders no code, launches no
 * custom-scheme link and links to no download. The previously published Bridge build only
 * supports the retired six-digit pairing. See docs/BRIDGE_PAIRING_PROTOCOL_V2.md.
 */
export default function Connect() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-primary/30 bg-card/40 p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-4">
          <Radio className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Connect Decks Bridge</h1>
        </div>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm mb-5" role="status">
          <div className="font-medium">An updated Decks Bridge is required</div>
          <p className="text-muted-foreground text-xs mt-1">
            Pairing now uses a 16-character code. Earlier versions of Decks Bridge cannot pair, and the updated
            desktop app is not yet available from this staging page.
          </p>
        </div>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal pl-5 mb-5">
          <li>Open your event in the DJ dashboard and choose Connect Decks Bridge.</li>
          <li>Open the updated Decks Bridge on the computer you're DJing from.</li>
          <li>Type or paste the 16-character code shown on the dashboard. It expires after five minutes and works once.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Pairing codes are never sent in links or QR codes. If a link asks you for one, don't use it.
        </p>
      </div>
    </div>
  );
}
