import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { CompanySnapshot } from "@/lib/api";

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
  snapshot: CompanySnapshot | undefined;
  isLoading?: boolean;
}

export default function CompanySnapshotCard({ snapshot, isLoading }: CompanySnapshotCardProps) {
  if (isLoading) {
    return (
      <Card className="mt-10">
        <CardHeader className="pb-2">
          <h3 className="font-semibold font-display text-base uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Snapshot, what&apos;s happening now
          </h3>
          <p className="text-sm text-muted-foreground">Generating summary…</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-4 bg-muted rounded animate-pulse w-full" />
          <div className="h-4 bg-muted rounded animate-pulse w-11/12" />
          <div className="h-4 bg-muted rounded animate-pulse w-4/5" />
        </CardContent>
      </Card>
    );
  }

  if (!snapshot || (!snapshot.paragraphs?.length && !snapshot.keyPoints?.length)) {
    return null;
  }

  const updated = snapshot.generatedAt ? snapshotUpdatedAgo(snapshot.generatedAt) : null;

  return (
    <Card className="mt-10">
      <CardHeader className="pb-2">
        <h3 className="font-semibold font-display text-base uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Snapshot, what&apos;s happening now
        </h3>
        <p className="text-sm text-muted-foreground">
          Summarized from recent filings, news &amp; financings
          {updated ? ` · Updated ${updated}` : ""}
          {snapshot.stale ? " · showing cached summary" : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        {snapshot.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {snapshot.keyPoints.length > 0 && (
          <div>
            <p className="font-medium mb-2">Key points</p>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              {snapshot.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground italic pt-2 border-t border-border">
          AI-generated summary for informational purposes only. Not investment advice. Verify against
          official filings and news releases.
        </p>
      </CardContent>
    </Card>
  );
}
