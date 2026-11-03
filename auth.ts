import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { connectDB } from '@/lib/db';
import UserModel from '@/models/User';

const nextAuth = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: { scope: 'read:user user:email' },
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: { scope: 'openid profile email' },
      },
    }),
  ],

  session: { strategy: 'jwt' },

  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      try {
        await connectDB();

        const existingUser = await UserModel.findOne({ email: user.email });

        if (existingUser) {
          // Email-based account linking: merge provider into existing account
          const alreadyLinked = existingUser.accounts.some(
            (a) => a.provider === account?.provider
          );
          if (!alreadyLinked && account) {
            existingUser.accounts.push({
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            });
            await existingUser.save();
          }
        } else {
          // First time — create user record
          await UserModel.create({
            name: user.name ?? 'User',
            email: user.email,
            image: user.image ?? '',
            accounts: account
              ? [
                  {
                    provider: account.provider,
                    providerAccountId: account.providerAccountId,
                  },
                ]
              : [],
            freeDocsUsed: 0,
            freeDocsResetAt: new Date(),
            onboardingComplete: false,
          });
        }
        return true;
      } catch (error) {
        console.error('Error in signIn callback:', error);
        return false;
      }
    },

    async jwt({ token, user }) {
      // On sign-in, user is available. On subsequent calls, only token is available.
      if (user?.email || (token?.email && !token.onboardingComplete)) {
        await connectDB();
        const email = user?.email || token?.email;
        const dbUser = await UserModel.findOne({ email }).lean();
        if (dbUser) {
          token.userId = (dbUser._id as { toString(): string }).toString();
          token.onboardingComplete = dbUser.onboardingComplete;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      if (typeof token.onboardingComplete === 'boolean') {
        session.user.onboardingComplete = token.onboardingComplete;
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
// Explicitly wrap signIn and signOut to avoid proxy/apply issues in Next 16
export const signIn: typeof nextAuth.signIn = (
  ...args: Parameters<typeof nextAuth.signIn>
) => nextAuth.signIn(...args);
export const signOut: typeof nextAuth.signOut = (
  ...args: Parameters<typeof nextAuth.signOut>
) => nextAuth.signOut(...args);
