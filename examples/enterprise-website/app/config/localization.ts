import { defineLocalizationConfig } from '@tangen/cms'

export const localizationConfig = defineLocalizationConfig({
  enabled: true,
  // Values in the default locale live directly in your content tables;
  // translations live in per-type side tables managed by `tangen push`.
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
  ],
})
