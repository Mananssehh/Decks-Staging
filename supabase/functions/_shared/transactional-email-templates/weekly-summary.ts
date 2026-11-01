import { Email } from './weekly-summary.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: 'Your Decks week in review',
  displayName: 'Weekly DJ summary',
  previewData: {
    djName: 'Nova',
    weekStart: 'Jun 16',
    weekEnd: 'Jun 22',
    grossCents: 4200,
    netCents: 2940,
    guestCount: 8,
    upcomingPayoutCents: 2940,
    topSongs: [
      { title: 'One More Time — Daft Punk', count: 5 },
      { title: 'Sicko Mode — Travis Scott', count: 3 },
    ],
    topTippers: [
      { nickname: 'Sam', amountCents: 1500 },
      { nickname: 'Alex', amountCents: 1000 },
    ],
  },
} satisfies TemplateEntry
