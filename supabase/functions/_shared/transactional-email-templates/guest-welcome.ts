import { Email } from './guest-welcome.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: 'Welcome to Decks 🎧',
  displayName: 'Guest welcome',
  previewData: { nickname: 'Sam' },
} satisfies TemplateEntry
