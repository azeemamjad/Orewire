import { ChevronRight, Clock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { getNewsSeverity, getNewsTags, severityStyle, type NewsSeverity } from "@/lib/news-severity";

export type Severity = NewsSeverity;

export interface NewsArticleCardProps {
  title: string;
  summary?: string | null;
  source?: string | null;
  timeAgo?: string | null;
  /** External news URL - used to build the detail-page slug. */
  link?: string | null;
  severity: Severity;
  tags?: string[];
}

function buildDetailSlug(link: string | null | undefined, title: string): string {
  return encodeURIComponent(link || title);
}

export function NewsArticleCard({
  title,
  summary,
  source,
  timeAgo,
  link,
  severity,
  tags = [],
}: NewsArticleCardProps) {
  const slug = buildDetailSlug(link, title);

  return (
    <article className="border border-border bg-card">
      <Link
        to={`/news/${slug}`}
        className="block w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 font-bold ${severityStyle[severity]}`}>
            {severity}
          </span>
          {source && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5">
              {source}
            </span>
          )}
          {timeAgo && (
            <span className="font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {timeAgo}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Read
            <ChevronRight className="w-3 h-3" />
          </span>
        </div>
        <h3 className="font-display text-base font-semibold leading-snug mb-1.5">{title}</h3>
        {summary && (
          <p className="text-sm text-foreground/80 leading-snug">
            <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
            {summary}
          </p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-muted/40 border border-border text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </Link>
    </article>
  );
}

export { getNewsSeverity, getNewsTags };
