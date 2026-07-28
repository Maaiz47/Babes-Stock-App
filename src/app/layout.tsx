import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ui/toast';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Pacific Stock',
  description: 'Stock inventory management',
  manifest: '/manifest.webmanifest',
  // Declaring `icons` here suppresses the file-convention icons entirely
  // (app/icon.tsx and app/apple-icon.tsx stop being linked), so `apple` points
  // back at the existing generated route on purpose — otherwise the iPhone
  // home-screen icon she already has installed would silently disappear.
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Pacific Stock',
    statusBarStyle: 'black-translucent',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

// In Next 16 themeColor lives on the viewport export — putting it in `metadata`
// is deprecated and logs a build warning.
export const viewport: Viewport = {
  themeColor: '#080810',
  width: 'device-width',
  initialScale: 1,
  // Lets the PWA draw under the notch / home indicator on iPhone.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
