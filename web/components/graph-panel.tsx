"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Minus, Maximize, Network, Plus, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { clientApiFetch } from "@/lib/api";
import { GraphCanvas } from "@/components/graph-canvas";
import { Card, CardContent } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";

interface GraphNode { id: string; type: string; ref_id: string; label: string; subtype: string | null; path: string | null; document_kind: string | null; meta: Record<string, unknown>; x?: number; y?: number; }
interface GraphEdge { id: string; type: string; source: string; target: string; label: string; meta: Record<string, unknown>; }
interface GraphSummary { entity_count: number; claim_count: number; relation_count: number; citation_count: number; reference_count: number; document_count: number; truncated: boolean; }
interface GraphData { workspace_id: string; summary: GraphSummary; nodes: GraphNode[]; edges: GraphEdge[]; }

const typeColors: Record<string, string> = { entity: "bg-blue-50 text-blue-700", claim: "bg-amber-50 text-amber-700", document: "bg-slate-100 text-slate-700" };
const edgeColors: Record<string, string> = { relation: "bg-purple-50 text-purple-700", claim_entity: "bg-amber-50 text-amber-700", citation: "bg-emerald-50 text-emerald-700", reference: "bg-slate-100 text-slate-600" };

export function GraphPanel({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showClaims, setShowClaims] = useState(true);
  const [showDocuments, setShowDocuments] = useState(true);
  const [showReferences, setShowReferences] = useState(true);
  const [focusDocId, setFocusDocId] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  const sheetOpen = !!(selectedNode || selectedEdge);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ include_claims: String(showClaims), include_documents: String(showDocuments), include_references: String(showReferences) });
      if (focusDocId) params.set("focus_document_id", focusDocId);
      const payload = await clientApiFetch<{ data: GraphData }>(`/v1/workspaces/${workspaceId}/graph?${params}`);
      setData(payload.data);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to load graph"); }
    setLoading(false);
  }, [workspaceId, showClaims, showDocuments, showReferences, focusDocId]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width: Math.floor(width), height: Math.max(Math.floor(height), 400) });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const prevSheetRef = useRef(false);

  useEffect(() => {
    if (!data || loading || dimensions.width <= 0 || dimensions.height <= 0) return;
    if (!sheetOpen && prevSheetRef.current) {
      const timer = window.setTimeout(() => graphRef.current?.zoomToFit(400, 20), 200);
      prevSheetRef.current = false;
      return () => window.clearTimeout(timer);
    }
    prevSheetRef.current = sheetOpen;
  }, [data, loading, dimensions.width, dimensions.height, sheetOpen]);

  const handleEngineStop = useCallback(() => {
    if (!sheetOpen) graphRef.current?.zoomToFit(0, 40);
  }, [sheetOpen]);

  const handleZoomIn = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.4, 300);
  const handleZoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() / 1.4, 300);
  const handleZoomReset = () => graphRef.current?.zoomToFit(350, sheetOpen ? 72 : 40);

  const t = useTranslations("graph");

  if (loading) {
    return <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-400"><Loader2 size={28} className="animate-spin" /><p className="text-sm">{t("loading")}</p></div>;
  }
  if (error) {
    return <Card className="shadow-sm"><CardContent className="flex flex-col items-center justify-center py-16 gap-3"><AlertCircle size={28} className="text-red-400" /><p className="text-sm text-red-600">{error}</p><button onClick={loadGraph} className="text-sm text-blue-600 hover:underline">Retry</button></CardContent></Card>;
  }
  if (!data || data.nodes.length === 0) {
    return <Card className="shadow-sm"><CardContent className="flex flex-col items-center justify-center py-20 gap-3"><Network size={36} strokeWidth={1.2} className="text-slate-300" /><p className="text-sm font-medium text-slate-500">{t("noData")}</p><p className="text-xs text-slate-400 max-w-sm text-center">{t("noDataHint")}</p></CardContent></Card>;
  }

  const s = data.summary;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> {s.entity_count} {t("entities")}</Badge>
          {showClaims && <Badge variant="secondary" className="gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {s.claim_count} {t("claims")}</Badge>}
          {showDocuments && <Badge variant="secondary" className="gap-1"><span className="w-2 h-2 rounded-full bg-slate-500 inline-block" /> {s.document_count} {t("documents")}</Badge>}
          <Badge variant="secondary">{data.edges.length} {t("edges")}</Badge>
          {s.truncated && <Badge variant="destructive">{t("truncated")}</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterToggle label={t("claims")} active={showClaims} onChange={setShowClaims} />
          <FilterToggle label={t("documents")} active={showDocuments} onChange={setShowDocuments} />
          <FilterToggle label={t("references")} active={showReferences} onChange={setShowReferences} />
          <div className="flex items-center gap-1.5 ml-2">
            <input type="text" value={focusDocId} onChange={(e) => setFocusDocId(e.target.value.trim())} placeholder={t("focusDoc")} className="h-7 w-40 rounded-lg border border-slate-200 bg-white px-2.5 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
            {focusDocId && <button type="button" onClick={() => setFocusDocId("")} className="text-xs text-slate-400 hover:text-slate-600">{t("clear")}</button>}
          </div>
        </div>
      </div>

      {/* Graph Container — split-pane layout */}
      <Card className="w-full overflow-hidden shadow-sm ring-slate-200/80" style={{ height: "calc(100vh - 280px)", minHeight: 450 }}>
        <div className="flex h-full">
          {/* Left: Graph Pane */}
          <div className="flex-1 basis-0 min-w-0 relative overflow-hidden bg-white" ref={containerRef}>
            <GraphCanvas
              ref={graphRef}
              nodes={data.nodes}
              edges={data.edges}
              onNodeClick={(n) => { setSelectedNode(n); setSelectedEdge(null); }}
              onEdgeClick={(e) => { setSelectedEdge(e); setSelectedNode(null); }}
              onEngineStop={handleEngineStop}
              width={dimensions.width}
              height={dimensions.height}
            />
            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-white/90 backdrop-blur rounded-lg px-3 py-2 text-xs text-slate-500 border border-slate-100 shadow-sm">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> {t("entity")}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-500 rotate-45 scale-75" /> {t("claim")}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-500" /> {t("document")}</span>
            </div>
            {/* Zoom Controls */}
            <div className="absolute bottom-3 right-3 flex flex-col gap-1">
              <Button variant="outline" size="icon-xs" onClick={handleZoomIn} title="Zoom in"><Plus size={14} /></Button>
              <Button variant="outline" size="icon-xs" onClick={handleZoomOut} title="Zoom out"><Minus size={14} /></Button>
              <Button variant="outline" size="icon-xs" onClick={handleZoomReset} title="Fit to view"><Maximize size={14} /></Button>
            </div>
          </div>

          {/* Right: Detail Panel (real split-pane, not overlay) */}
          {sheetOpen && (
            <div className="w-80 shrink-0 border-l border-slate-200 bg-white p-5 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-900">{selectedNode ? t("node") : t("edge")}</h3>
                <Button variant="ghost" size="icon-xs" onClick={() => { setSelectedNode(null); setSelectedEdge(null); }}><X size={14} /></Button>
              </div>

              {selectedNode && (
                <div className="space-y-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${typeColors[selectedNode.type] ?? "bg-slate-100 text-slate-600"}`}>
                    {selectedNode.type}{selectedNode.subtype ? ` · ${selectedNode.subtype}` : ""}
                  </span>
                  <p className="text-sm font-medium text-slate-900">{selectedNode.label}</p>
                  {selectedNode.path && <div><p className="text-xs text-slate-400 uppercase">Path</p><p className="text-sm font-mono text-slate-600">{selectedNode.path}</p></div>}
                  <div><p className="text-xs text-slate-400 uppercase">ID</p><p className="text-xs font-mono text-slate-500 break-all">{selectedNode.ref_id}</p></div>
                  {selectedNode.meta && Object.entries(selectedNode.meta).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm"><span className="text-slate-500">{k}</span><span className="text-slate-700 text-right max-w-[180px] truncate">{String(v)}</span></div>
                  ))}
                  {selectedNode.type === "document" && (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <Link href={`/vault/${selectedNode.ref_id}`} className="flex items-center justify-center gap-1.5 w-full h-7 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"><ExternalLink size={13} /> {t("openVault")}</Link>
                      <button onClick={() => { setFocusDocId(selectedNode.ref_id); setSelectedNode(null); }} className="flex items-center justify-center gap-1.5 w-full h-7 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 transition-all">{t("focusThis")}</button>
                    </div>
                  )}
                  {selectedNode.type === "entity" && selectedNode.path && (
                    <Link href={`/search?q=${encodeURIComponent(selectedNode.label)}`} className="flex items-center justify-center gap-1.5 w-full h-7 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"><ExternalLink size={13} /> {t("searchWiki")}</Link>
                  )}
                </div>
              )}

              {selectedEdge && (
                <div className="space-y-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${edgeColors[selectedEdge.type] ?? "bg-slate-100 text-slate-600"}`}>{selectedEdge.type}</span>
                  <div><p className="text-xs text-slate-400 uppercase">Label</p><p className="text-sm font-medium text-slate-900">{selectedEdge.label}</p></div>
                  <div><p className="text-xs text-slate-400 uppercase">Source → Target</p><p className="text-xs font-mono text-slate-500 break-all">{typeof selectedEdge.source === "string" ? selectedEdge.source : (selectedEdge.source as any)?.id ?? ""}</p><p className="text-xs text-slate-400">→</p><p className="text-xs font-mono text-slate-500 break-all">{typeof selectedEdge.target === "string" ? selectedEdge.target : (selectedEdge.target as any)?.id ?? ""}</p></div>
                  {selectedEdge.meta && Object.entries(selectedEdge.meta).map(([k, v]) => (
                    <div key={k}><span className="text-xs text-slate-500">{k}</span><p className="text-sm text-slate-700 break-words">{String(v)}</p></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function FilterToggle({ label, active, onChange }: { label: string; active: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!active)} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${active ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-slate-400 border-slate-200 hover:text-slate-600"}`}>{label}</button>
  );
}
