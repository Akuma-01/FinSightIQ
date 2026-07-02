import { AuthProvider } from '@/context/AuthContext';
import { WebSocketProvider } from '@/context/WebSocketContext';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FinSightIQ',
  description: 'Financial Document Intelligence — Regulatory Contradiction Detection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <WebSocketProvider>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                duration: 6000,
                style: { maxWidth: '480px' },
              }}
            />
          </WebSocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
