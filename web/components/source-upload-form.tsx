"use client";

import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { getApiUrl } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Button } from "@/src/components/ui/button";

const ACCEPTED = ".md,.txt,.html,.htm,.pdf,.docx,.csv,.xlsx,.xlsm,.pptx";

export function SourceUploadForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState("/sources/");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Please choose a source file.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");

    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());
    formData.append("source_path", sourcePath.trim() || "/sources/");

    const response = await fetch(`${getApiUrl()}/v1/workspaces/${workspaceId}/documents/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.detail ?? "Upload failed");
      setSubmitting(false);
      return;
    }

    const payload = await response.json().catch(() => ({ data: null }));
    setTitle("");
    setFile(null);
    setSourcePath("/sources/");
    setSubmitting(false);
    setSuccess(payload.data?.run_id ? `Ingest run ${payload.data.run_id.slice(0, 8)}… queued.` : "Upload accepted.");
    router.refresh();
  }

  const t = useTranslations("sources");

  return (
    <Card className="shadow-sm ring-slate-200/80">
      <CardHeader>
        <CardTitle>{t("upload")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-input")?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-8 px-4 cursor-pointer transition-colors ${
              dragActive
                ? "border-blue-500 bg-blue-50/50"
                : file
                  ? "border-emerald-300 bg-emerald-50/30"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
            }`}
          >
            {file ? (
              <>
                <FileText size={28} className="text-emerald-500" />
                <p className="text-sm font-medium text-slate-700">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
              </>
            ) : (
              <>
                <CloudUpload size={28} className="text-slate-400" />
                <p className="text-sm font-medium text-slate-600">
                  {t("dragDrop")} <span className="text-blue-600">{t("browse")}</span>
                </p>
                <p className="text-xs text-slate-400">
                  {t("formats")}
                </p>
              </>
            )}
            <input
              id="file-input"
              type="file"
              className="hidden"
              accept={ACCEPTED}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700" htmlFor="upload-title">{t("titleField")}</label>
              <Input
                id="upload-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700" htmlFor="upload-path">{t("vaultPath")}</label>
              <Input
                id="upload-path"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                placeholder="/sources/"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">{error}</div>
          )}
          {success && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-sm text-emerald-700">{success}</div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={submitting || !file}
              className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t("uploading") : t("uploadBtn")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
