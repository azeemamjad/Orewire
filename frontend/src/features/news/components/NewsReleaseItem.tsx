import FeedRow from "@/components/site/FeedRow";

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

/**
 * Single row in the hero “News releases” panel.
 *
 * The row presentation lives in <FeedRow> so this panel, the /news list and the
 * /filings list render identical rows. `severity` accepts the internal
 * Critical/High/Medium/Low scale as well as real verdicts; FeedRow normalises it
 * to Noteworthy | Watch | Routine so the internal scale is never shown.
 */
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
  <FeedRow
    density="dense"
    href={href}
    ticker={ticker}
    exchange={exchange}
    verdict={severity}
    typeLabel={filingType}
    time={timeAgo}
    company={company}
    summary={summary}
  />
);

export default NewsReleaseItem;
