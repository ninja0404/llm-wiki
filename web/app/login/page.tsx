import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 px-4">
      <div className="w-full max-w-[400px] bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/50 p-8">
        <LoginForm />
      </div>
    </div>
  );
}
