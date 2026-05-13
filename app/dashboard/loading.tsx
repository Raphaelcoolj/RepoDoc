export default function Loading() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-6">
      <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      <div className="space-y-2 text-center">
        <h2 className="text-xl font-bold text-white animate-pulse">Loading...</h2>
        <p className="text-slate-500 text-sm">Preparing your dashboard</p>
      </div>
      
      <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-4 opacity-20">
        <div className="h-32 bg-surface-700 rounded-2xl" />
        <div className="h-32 bg-surface-700 rounded-2xl" />
        <div className="h-32 bg-surface-700 rounded-2xl" />
        <div className="h-32 bg-surface-700 rounded-2xl" />
      </div>
    </div>
  );
}
