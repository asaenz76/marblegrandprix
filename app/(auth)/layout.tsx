import { Wordmark } from "@/components/Wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1>
            <Wordmark href="/" variant="full" size="xl" />
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Pick the winner. Race your friends.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
