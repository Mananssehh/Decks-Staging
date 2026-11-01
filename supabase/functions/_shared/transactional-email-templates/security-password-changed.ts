import { Email } from './security-password-changed.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: 'Your Decks password was changed',
  displayName: 'Security: password changed',
  previewData: { nickname: 'Sam', changedAt: new Date().toUTCString() },
} satisfies TemplateEntry
