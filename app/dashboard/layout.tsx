import { auth } from '@/auth';
import DashboardNav from '@/components/DashboardNav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardNav
        user={{
          name: session?.user?.name ?? null,
          image: session?.user?.image ?? null,
        }}
      />

      <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
