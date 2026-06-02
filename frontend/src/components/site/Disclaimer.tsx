// Required on every page that shows an AI-generated summary (compliance rule).
export default function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed text-muted-foreground border-t border-border pt-4 ${className || ""}`}>
      This summary is generated for informational purposes only. It does not constitute investment advice. Always read
      the original document and do your own due diligence.
    </p>
  );
}
