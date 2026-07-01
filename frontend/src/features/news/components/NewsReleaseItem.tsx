import { Link } from "react-router-dom";
import { Clock, FileText } from "lucide-react";
import { newsSeverityStyle, getNewsSeverity, newsDisplayTime } from "@/lib/news-severity";

export type NewsReleaseItemProps = {
  href: string;
  ticker: string;
  exchange?: string | null;
  company?: string | null;
  timeAgo: string;
  severity: string;
  filingType: string;
  summary: string;
};

/** Single row in the hero “News releases” panel. */
const NewsReleaseItem = ({
  href,
  ticker,
  exchange,
  company,
  timeAgo,
  severity,
  filingType,
  summary,
}: NewsReleaseItemProps) => (
  <li className="hover:bg-background/60">
    <Link to={href} className="block px-3.5 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-mono text-[13px] font-bold whitespace-nowrap">{ticker}</span>
        {exchange ? (
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5 whitespace-nowrap">
            {exchange}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
          <Clock className="w-2.5 h-2.5" />
          {timeAgo}
        </span>
      </div>
      {company ? (
        <div className="text-[12px] font-semibold text-foreground/90 mb-1.5 leading-snug truncate">{company}</div>
      ) : null}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span
          className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold whitespace-nowrap ${newsSeverityStyle[severity] || newsSeverityStyle.Low}`}
        >
          {severity}
        </span>
        <span className="inline-flex items-center gap-1 text-[12.5px] font-bold tracking-tight text-foreground leading-snug">
          <FileText className="w-3 h-3 text-accent shrink-0" />
          {filingType}
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-foreground/70 line-clamp-2">{summary}</p>
    </Link>
  </li>
);

export default NewsReleaseItem;
