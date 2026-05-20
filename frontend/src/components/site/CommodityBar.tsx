import { ArrowDownRight, ArrowUpRight } from "lucide-react";

const commodities = [
  { sym: "GOLD", name: "Gold", px: "2,418.30", unit: "oz", chg: "+0.82%", up: true },
  { sym: "SLVR", name: "Silver", px: "31.74", unit: "oz", chg: "+1.14%", up: true },
  { sym: "COPR", name: "Copper", px: "4.42", unit: "lb", chg: "-0.31%", up: false },
  { sym: "LITH", name: "Lithium", px: "13,950", unit: "t", chg: "-1.84%", up: false },
  { sym: "URAN", name: "U₃O₈", px: "92.10", unit: "lb", chg: "+0.44%", up: true },
  { sym: "NICK", name: "Nickel", px: "16,820", unit: "t", chg: "-0.62%", up: false },
];

const CommodityBar = () => (
  <div className="bg-surface border-b border-border">
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-2.5 flex items-center gap-6 overflow-x-auto">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">Spot</span>
      {commodities.map((c) => (
        <div key={c.sym} className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
          <span className="text-muted-foreground">{c.name}</span>
          <span className="font-bold text-foreground">${c.px}</span>
          <span className="text-muted-foreground">/{c.unit}</span>
          <span className={`flex items-center gap-0.5 font-semibold ${c.up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
            {c.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{c.chg}
          </span>
        </div>
      ))}
      <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0 hidden lg:inline">Powered by TradingView · Delayed</span>
    </div>
  </div>
);

export default CommodityBar;
