import { ArrowDownRight, ArrowUpRight, Flame } from "lucide-react";

const gainers = [
  { sym: "SCZ", ex: "TSX-V", name: "Santa Cruz Resources", px: "0.42", chg: "+18.2%", vol: "4.2M", catalyst: "Drill: 12.4m @ 3.2 g/t Au" },
  { sym: "DEG", ex: "ASX", name: "De Grey Mining", px: "1.24", chg: "+6.1%", vol: "8.9M", catalyst: "Resource +18% to 6.8 Moz" },
  { sym: "NFG", ex: "TSX-V", name: "New Found Gold", px: "3.81", chg: "+4.4%", vol: "1.8M", catalyst: "Step-out: 2.1m @ 24 g/t" },
  { sym: "NXE", ex: "TSX-V", name: "NexGen Energy", px: "9.12", chg: "+3.8%", vol: "3.1M", catalyst: "PCE: 19.2 Mlb U₃O₈" },
  { sym: "FIL", ex: "TSX-V", name: "Filo Mining", px: "24.10", chg: "+2.9%", vol: "0.9M", catalyst: "156m @ 1.4% CuEq" },
];

const losers = [
  { sym: "CXO", ex: "ASX", name: "Core Lithium", px: "0.09", chg: "-3.4%", vol: "12.4M", catalyst: "Quarterly in-line, no surprise" },
  { sym: "GR", ex: "CSE", name: "Great Atlantic", px: "0.18", chg: "-2.1%", vol: "0.4M", catalyst: "$4.2M flow-through PP" },
  { sym: "LAC", ex: "TSX-V", name: "Lithium Americas", px: "5.22", chg: "-1.8%", vol: "2.1M", catalyst: "DOE loan condition met" },
  { sym: "RMS", ex: "ASX", name: "Ramelius Resources", px: "2.34", chg: "-1.2%", vol: "1.6M", catalyst: "Mt Magnet ext. modest" },
  { sym: "AAU", ex: "TSX-V", name: "Almaden Minerals", px: "0.31", chg: "-0.6%", vol: "0.2M", catalyst: "MD&A — no new data" },
];

const Table = ({ title, rows, up }: { title: string; rows: typeof gainers; up: boolean }) => (
  <div className="border border-border bg-surface">
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <Flame className={`w-3.5 h-3.5 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`} />
        <h3 className="font-display text-sm font-bold tracking-tight">{title}</h3>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Today · Mining</span>
    </div>
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <th className="text-left px-4 py-2 font-medium">Ticker</th>
          <th className="text-left py-2 font-medium hidden md:table-cell">Catalyst</th>
          <th className="text-right py-2 font-medium">Last</th>
          <th className="text-right py-2 font-medium">Chg</th>
          <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">Vol</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.sym} className="hover:bg-background/60 transition-colors">
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold">{r.sym}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">{r.ex}</span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{r.name}</div>
            </td>
            <td className="py-2.5 text-foreground/75 hidden md:table-cell text-[12px]">{r.catalyst}</td>
            <td className="py-2.5 text-right font-mono font-semibold">${r.px}</td>
            <td className={`py-2.5 text-right font-mono font-bold ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
              <span className="inline-flex items-center gap-0.5">
                {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{r.chg}
              </span>
            </td>
            <td className="px-4 py-2.5 text-right font-mono text-muted-foreground hidden sm:table-cell">{r.vol}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Movers = () => (
  <section className="border-b border-border bg-background">
    <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-10">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[hsl(var(--up))] animate-pulse-dot" /> Market movers
          </div>
          <h2 className="font-display text-2xl lg:text-3xl font-extrabold leading-tight">Top gainers & losers — junior mining</h2>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">TSX-V · CSE · ASX · Delayed 15m</div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Table title="Top Gainers" rows={gainers} up />
        <Table title="Top Losers" rows={losers} up={false} />
      </div>
    </div>
  </section>
);

export default Movers;
