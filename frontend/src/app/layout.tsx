import { AuthProvider } from '@/context/AuthContext';
import { WebSocketProvider } from '@/context/WebSocketContext';
import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'FinSightIQ',
  description: 'Financial Document Intelligence — Regulatory Contradiction Detection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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
