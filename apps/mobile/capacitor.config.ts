import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.zotstop.app',
  appName: 'ZotStop',
  webDir: '../web/dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  plugins: { SystemBars: { insetsHandling: 'native', initialViewportFitValueHint: 'cover', style: 'LIGHT' } }
}

export default config
