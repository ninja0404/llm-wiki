import { ReactNode } from "react";

export function PageFrame({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="p-6 max-w-7xl mx-auto">
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        {actions}
      </header>
      <div className="space-y-4">
        {children}
      </div>
    </section>
  );
}
