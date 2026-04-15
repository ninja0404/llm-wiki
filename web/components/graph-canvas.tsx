"use client";

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

interface GraphNode { id: string; type: string; ref_id: string; label: string; subtype: string | null; path: string | null; document_kind: string | null; meta: Record<string, unknown>; x?: number; y?: number; }
interface GraphEdge { id: string; type: string; source: string; target: string; label: string; meta: Record<string, unknown>; }

const NODE_COLORS: Record<string, string> = { entity: "#3b82f6", claim: "#f59e0b", document: "#64748b" };
const NODE_SIZES: Record<string, number> = { entity: 6, claim: 4, document: 5 };
const EDGE_COLORS: Record<string, string> = { relation: "#8b5cf6", claim_entity: "#f59e0b", citation: "#10b981", reference: "#94a3b8" };

export const GraphCanvas = forwardRef(function GraphCanvas({
  nodes, edges, onNodeClick, onEdgeClick, onEngineStop, width, height,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
  onEdgeClick: (edge: GraphEdge) => void;
  onEngineStop?: () => void;
  width: number;
  height: number;
}, ref) {
  const fgRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    centerAt: (x = 0, y = 0, dur?: number) => fgRef.current?.centerAt(x, y, dur),
    zoom: (val?: number, dur?: number) => {
      if (val !== undefined) fgRef.current?.zoom(val, dur);
      return fgRef.current?.zoom();
    },
    zoomToFit: (dur?: number, padding?: number) => fgRef.current?.zoomToFit(dur, padding),
  }));

  const graphData = useMemo(() => ({
    nodes: nodes.map((n) => ({ ...n })),
    links: edges.map((e) => ({ ...e, source: e.source, target: e.target })),
  }), [nodes, edges]);

  const handleNodeClick = useCallback((node: any) => {
    onNodeClick(node as GraphNode);
    if (fgRef.current) {
      fgRef.current.centerAt(node.x, node.y, 600);
      fgRef.current.zoom(3, 600);
    }
  }, [onNodeClick]);

  const handleLinkClick = useCallback((link: any) => {
    const original = edges.find((e) => e.id === link.id);
    if (original) onEdgeClick(original);
  }, [edges, onEdgeClick]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const color = NODE_COLORS[node.type] ?? "#94a3b8";
    const size = NODE_SIZES[node.type] ?? 5;
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    if (node.type === "claim") {
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    } else if (node.type === "document") {
      ctx.fillStyle = color;
      ctx.fillRect(x - size, y - size * 0.7, size * 2, size * 1.4);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }

    if (globalScale < 0.45) {
      return;
    }

    const label = (node.label ?? "").length > 20 ? node.label.slice(0, 18) + "…" : node.label;
    const fontSize = Math.max(2.2, Math.min(4.5, 3.2 / Math.max(globalScale, 0.0001)));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#334155";
    ctx.fillText(label, x, y + size + fontSize * 0.35);
  }, []);

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const color = EDGE_COLORS[link.type] ?? "#e2e8f0";
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || src.x == null || tgt.x == null) return;

    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = link.type === "relation" ? 1.2 : 0.6;
    if (link.type === "citation" || link.type === "reference") ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const ax = tgt.x - ux * 5;
    const ay = tgt.y - uy * 5;
    ctx.beginPath();
    ctx.moveTo(ax - uy * 2, ay + ux * 2);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.lineTo(ax + uy * 2, ay - ux * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, []);

  if (nodes.length === 0) return null;

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      nodeCanvasObject={paintNode}
      linkCanvasObject={paintLink}
      onNodeClick={handleNodeClick}
      onLinkClick={handleLinkClick}
      nodeLabel={(node: any) => `${node.type}: ${node.label}`}
      linkLabel={(link: any) => `${link.type}: ${link.label}`}
      cooldownTicks={80}
      d3AlphaDecay={0.02}
      d3VelocityDecay={0.3}
      onEngineStop={onEngineStop}
      enableZoomInteraction={true}
      enablePanInteraction={true}
      backgroundColor="transparent"
    />
  );
});
