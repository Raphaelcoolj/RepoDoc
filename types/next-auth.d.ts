// Extend Auth.js session types to include custom fields
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      onboardingComplete?: boolean;
    };
  }
}
