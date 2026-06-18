import { Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { CompanySnapshot, CompanySnapshotStatus } from "@/lib/api";

function snapshotUpdatedAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface CompanySnapshotCardProps {
  snapshot: CompanySnapshot | null | undefined;
  status?: CompanySnapshotStatus;
  isLoading?: boolean;
}

export default function CompanySnapshotCard({ snapshot, status, isLoading }: CompanySnapshotCardProps) {
  const isGenerating = status === "generating";
  const showSkeleton = isLoading && !snapshot;
  const hasContent = snapshot && (snapshot.paragraphs?.length > 0 || snapshot.keyPoints?.length > 0);

  if (showSkeleton) {
    return (
      <Card className="mt-10">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold font-display text-base uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Snapshot, what&apos;s happening now
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Summarized from recent filings, news, financings &amp; price action
              </p>
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating…
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-4 bg-muted rounded animate-pulse w-full" />
          <div className="h-4 bg-muted rounded animate-pulse w-11/12" />
          <div className="h-4 bg-muted rounded animate-pulse w-4/5" />
        </CardContent>
      </Card>
    );
  }

  if (!hasContent && !isGenerating) {
    return null;
  }

  const updated = snapshot?.generatedAt ? snapshotUpdatedAgo(snapshot.generatedAt) : null;

  return (
    <Card className="mt-10">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold font-display text-base uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0" />
              Snapshot, what&apos;s happening now
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Summarized from recent filings, news, financings &amp; price action
              {!isGenerating && updated ? ` · Updated ${updated}` : ""}
            </p>
          </div>
          {isGenerating && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0 pt-0.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
              Generating…
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        {hasContent ? (
          <>
            {snapshot!.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {snapshot!.keyPoints.length > 0 && (
              <div>
                <p className="font-medium mb-2">Key points</p>
                <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                  {snapshot!.keyPoints.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="h-4 bg-muted/60 rounded animate-pulse w-full" />
            <div className="h-4 bg-muted/60 rounded animate-pulse w-11/12" />
            <div className="h-4 bg-muted/60 rounded animate-pulse w-4/5" />
          </div>
        )}
        <p className="text-xs text-muted-foreground italic pt-2 border-t border-border">
          Summarized clearly to help you understand the company&apos;s current situation. Not investment
          advice, always do your own due diligence.
        </p>
      </CardContent>
    </Card>
  );
}
