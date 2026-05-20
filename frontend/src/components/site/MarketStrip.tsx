import { ArrowDownRight, ArrowUpRight } from "lucide-react";

const tickers = [
  { sym: "TSXV:SCZ", px: "0.42", chg: "+18.2%", up: true },
  { sym: "ASX:DEG", px: "1.24", chg: "+6.1%", up: true },
  { sym: "TSXV:NFG", px: "3.81", chg: "+4.4%", up: true },
  { sym: "TSXV:NXE", px: "9.12", chg: "+3.8%", up: true },
  { sym: "TSXV:FIL", px: "24.10", chg: "+2.9%", up: true },
  { sym: "ASX:RMS", px: "2.34", chg: "+1.6%", up: true },
  { sym: "CSE:GR", px: "0.18", chg: "-2.1%", up: false },
  { sym: "ASX:CXO", px: "0.09", chg: "-3.4%", up: false },
  { sym: "TSXV:LAC", px: "5.22", chg: "-1.8%", up: false },
  { sym: "TSXV:AAU", px: "0.31", chg: "-0.6%", up: false },
];

const MarketStrip = () => (
  <div className="bg-[hsl(220_45%_10%)] text-[hsl(36_30%_94%)] border-b border-[hsl(36_30%_94%/0.1)] overflow-hidden">
    <div className="ticker flex items-center gap-8 py-2 whitespace-nowrap w-max">
      {[...tickers, ...tickers].map((t, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[11px] shrink-0">
          <span className="text-[hsl(36_30%_94%/0.7)]">{t.sym}</span>
          <span className="font-bold">${t.px}</span>
          <span className={`flex items-center gap-0.5 font-semibold ${t.up ? "text-[hsl(174_62%_52%)]" : "text-[hsl(0_70%_60%)]"}`}>
            {t.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{t.chg}
          </span>
        </div>
      ))}
    </div>
  </div>
);

export default MarketStrip;
