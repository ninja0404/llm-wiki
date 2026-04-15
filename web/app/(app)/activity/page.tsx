import Link from "next/link";

import { PageFrame } from "@/components/page-frame";
import { apiFetch } from "@/lib/api";

export default async function ActivityPage() {
  const workspaces = await apiFetch<{ data: { id: string; name: string }[] }>("/v1/workspaces").catch(() => ({ data: [] }));
  const firstWorkspace = workspaces.data[0];
  const [activity, revisions] = firstWorkspace
    ? await Promise.all([
        apiFetch<{ data: { id: string; event_type: string; actor_type: string; actor_id: string | null; document_id?: string | null; document_path: string | null; run_id?: string | null; created_at: string }[] }>(
          `/v1/workspaces/${firstWorkspace.id}/activity`
        ).catch(() => ({ data: [] })),
        apiFetch<{ data: { id: string; path: string; reason: string; actor_type: string; created_at: string }[] }>(
          `/v1/workspaces/${firstWorkspace.id}/revisions`
        ).catch(() => ({ data: [] }))
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <PageFrame
      title="Activity / Revisions"
      description="Every wiki mutation is revisioned and attributable to human, agent, or system actors."
    >
      <div className="card-grid">
        <div className="panel">
          <h2>Activity Events</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Actor</th>
                <th>Path</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {activity.data.map((item) => (
                <tr key={item.id}>
                  <td>{item.event_type}</td>
                  <td>{item.actor_type}</td>
                  <td>
                    {item.document_id && item.document_path ? (
                      <Link href={`/vault/${item.document_id}`}>{item.document_path}</Link>
                    ) : (
                      item.document_path ?? "-"
                    )}
                    {item.run_id ? (
                      <>
                        {" "}
                        · <Link href={`/runs/${item.run_id}`}>run</Link>
                      </>
                    ) : null}
                  </td>
                  <td className="text-xs text-slate-400">{new Date(item.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Recent Revisions</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Reason</th>
                <th>Actor</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {revisions.data.map((revision) => (
                <tr key={revision.id}>
                  <td><Link href={`/revisions/${revision.id}`}>{revision.path}</Link></td>
                  <td>{revision.reason}</td>
                  <td>{revision.actor_type}</td>
                  <td className="text-xs text-slate-400">{new Date(revision.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}
