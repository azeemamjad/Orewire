import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase, Search, Filter, Megaphone, Sparkles, Building2, MapPin, DollarSign, Clock,
  ArrowUpRight, CheckCircle2, Zap, Eye, BarChart3, Users, X,
} from "lucide-react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import MorningBrief from "@/components/site/MorningBrief";
import SearchHeroBar from "@/components/site/SearchHeroBar";
import Footer from "@/components/site/Footer";
import { fetchJobs, postJob, applyToJob, fetchMyApplications, login as apiLogin, register as apiRegister, type JobListing, type MyApplication } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { FileText } from "lucide-react";

const disciplines = ["All", "Geology", "Mining Engineering", "Metallurgy", "Exploration", "Operations", "Environment & Permitting", "Finance & IR", "HSE", "Drilling", "Surveying"];
const jobTypes = ["All", "Full-time", "Contract", "Fly-in/Fly-out", "Internship", "Part-time"];

const typeStyle: Record<string, string> = {
  "Full-time": "bg-foreground text-background",
  "Contract": "bg-muted text-foreground",
  "Fly-in/Fly-out": "bg-primary text-primary-foreground",
  "Internship": "bg-watch text-watch-foreground",
  "Part-time": "bg-routine text-routine-foreground",
};


const Jobs = () => {
  const { isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [discipline, setDiscipline] = useState("All");
  const [type, setType] = useState("All");
  const [showPostForm, setShowPostForm] = useState(false);
  const [applyingTo, setApplyingTo] = useState<JobListing | null>(null);
  const [tab, setTab] = useState<"browse" | "applied">("browse");

  const { data: liveJobs, isLoading, refetch } = useQuery({
    queryKey: ["jobs", search, discipline, type],
    queryFn: () => fetchJobs({ search, discipline, type }),
    staleTime: 60000,
  });

  const jobs = liveJobs ?? [];

  const promoted = jobs.filter((j) => j.promoted);
  const regular = jobs.filter((j) => !j.promoted);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <MarketStrip />
      <MorningBrief />
      <SearchHeroBar />

      <section className="border-b border-border bg-gradient-to-br from-background via-background to-muted/40">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-8 lg:py-10">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 inline-flex items-center gap-2">
                <Briefcase className="w-3 h-3" /> Mining careers · Updated daily
              </div>
              <h1 className="font-display text-3xl lg:text-4xl font-extrabold leading-tight">Jobs at listed mining companies</h1>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
                Geologists, engineers, metallurgists and operators — straight from the issuers. Hiring? Post a listing or promote it across the Orewire feed.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isAuthenticated && (
                <Link to="/jobs/dashboard" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium px-4 py-2 rounded-none border border-border bg-surface hover:bg-muted h-11">
                  <FileText className="w-4 h-4 mr-1" /> My listings
                </Link>
              )}
              <button
                onClick={() => setShowPostForm(true)}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium px-4 py-2 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 h-11"
              >
                <Megaphone className="w-4 h-4 mr-1.5" /> Post a job
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, company, location, tag…"
              className="flex w-full border px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:text-sm pl-10 h-12 bg-card rounded-none border-foreground/20 focus-visible:ring-accent"
            />
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">
                <Filter className="w-3 h-3" /> Discipline
              </span>
              {disciplines.map((d) => (
                <button key={d} onClick={() => setDiscipline(d)} className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 border ${discipline === d ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{d}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Type</span>
              {jobTypes.map((t) => (
                <button key={t} onClick={() => setType(t)} className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 border ${type === t ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{t}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <main className="flex-1">
        {isAuthenticated && (
          <div className="border-b border-border bg-surface">
            <div className="max-w-[1440px] mx-auto px-4 lg:px-6 flex gap-0">
              <button onClick={() => setTab("browse")} className={`font-mono text-[11px] uppercase tracking-widest px-4 py-3 border-b-2 transition-colors ${tab === "browse" ? "border-accent text-foreground font-bold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                Browse jobs
              </button>
              <button onClick={() => setTab("applied")} className={`font-mono text-[11px] uppercase tracking-widest px-4 py-3 border-b-2 transition-colors ${tab === "applied" ? "border-accent text-foreground font-bold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                My applications
              </button>
            </div>
          </div>
        )}

        {tab === "applied" && isAuthenticated ? (
          <MyApplicationsSection />
        ) : (
        <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            {isLoading ? (
              <div className="py-16 text-center text-sm text-muted-foreground border border-border bg-surface">
                <Briefcase className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50 animate-pulse" />
                <p>Loading jobs...</p>
              </div>
            ) : jobs.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground border border-border bg-surface">
                <Briefcase className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
                <p className="mb-2">No jobs available right now.</p>
                <p className="text-xs">Be the first to post — your listing will be seen by thousands of mining professionals.</p>
                <button onClick={() => setShowPostForm(true)} className="mt-4 inline-flex items-center gap-2 text-sm font-medium px-4 py-2 bg-accent text-accent-foreground hover:bg-accent/90">
                  <Megaphone className="w-4 h-4" /> Post a job
                </button>
              </div>
            ) : (
            <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {jobs.length} role{jobs.length !== 1 ? "s" : ""} · {promoted.length} promoted
            </div>

            {[...promoted, ...regular].map((job) => (
              <article key={job.id} className={`border bg-surface p-4 lg:p-5 hover:bg-background/60 transition-colors relative ${job.promoted ? "border-accent" : "border-border"}`}>
                {job.promoted && (
                  <div className="absolute -top-2.5 left-4 font-mono text-[9px] uppercase tracking-widest bg-accent text-accent-foreground px-2 py-0.5 font-bold inline-flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> Promoted
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold ${typeStyle[job.jobType] || "bg-foreground text-background"}`}>{job.jobType}</span>
                      {job.discipline && <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border border-border px-1.5 py-0.5">{job.discipline}</span>}
                      {job.tags.map((tag) => (
                        <span key={tag} className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                    <h3 className="font-display text-lg lg:text-xl font-bold leading-tight">{job.title}</h3>
                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[12.5px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" />
                        {job.ticker ? (
                          <Link to={`/company/${job.ticker}`} className="hover:text-foreground hover:underline font-medium">
                            {job.companyName} <span className="font-mono text-[10px]">· {job.ticker}</span>
                          </Link>
                        ) : (
                          <span className="font-medium">{job.companyName}</span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{job.location}</span>
                      {job.salary && <span className="inline-flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />{job.salary}</span>}
                      <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{job.timeAgo}</span>
                    </div>
                    <p className="mt-2.5 text-sm text-foreground/80 leading-snug">{job.description}</p>
                  </div>
                  <button
                    onClick={() => setApplyingTo(job)}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium h-10 px-4 py-2 rounded-none bg-foreground text-background hover:bg-foreground/90 shrink-0"
                  >
                    Apply <ArrowUpRight className="w-4 h-4 ml-1" />
                  </button>
                </div>
              </article>
            ))}

            </>
            )}
          </div>

          <aside className="lg:col-span-4 space-y-4">
            <div className="border border-border bg-surface p-5">
              <h3 className="font-display text-base font-bold mb-3">Why post on Orewire?</h3>
              <ul className="space-y-3 text-sm text-foreground/80">
                <li className="flex items-start gap-2.5"><Eye className="w-4 h-4 mt-0.5 text-accent shrink-0" /><span>Seen by 4,200+ mining investors and professionals daily</span></li>
                <li className="flex items-start gap-2.5"><Zap className="w-4 h-4 mt-0.5 text-accent shrink-0" /><span>Promoted listings appear in the news feed alongside filings</span></li>
                <li className="flex items-start gap-2.5"><BarChart3 className="w-4 h-4 mt-0.5 text-accent shrink-0" /><span>Company-linked — applicants see your stock page and filings</span></li>
                <li className="flex items-start gap-2.5"><Users className="w-4 h-4 mt-0.5 text-accent shrink-0" /><span>Targeted audience of geologists, engineers, and operators</span></li>
              </ul>
            </div>

            <div className="border border-accent bg-surface p-5">
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-2">Listing</div>
              <h3 className="font-display text-xl font-bold mb-1">Post a job — $299/30d</h3>
              <p className="text-sm text-muted-foreground mb-4">Or $799 for promoted placement in the feed.</p>
              <ul className="space-y-2 text-sm mb-5">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--up))]" /> 30-day listing on the jobs board</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--up))]" /> Linked to your company page</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--up))]" /> Included in daily newsletter</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--up))]" /> Application tracking dashboard</li>
              </ul>
              <button
                onClick={() => setShowPostForm(true)}
                className="w-full h-11 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 transition-colors inline-flex items-center justify-center gap-2"
              >
                <Megaphone className="w-4 h-4" /> Post a job
              </button>
            </div>
          </aside>
        </div>
        )}
      </main>

      <Footer />

      {showPostForm && (
        <PostJobDialog
          isAuthenticated={isAuthenticated}
          onClose={() => setShowPostForm(false)}
          onPosted={() => { setShowPostForm(false); refetch(); }}
        />
      )}

      {applyingTo && (
        <ApplyDialog
          job={applyingTo}
          onClose={() => setApplyingTo(null)}
          onApplied={() => setApplyingTo(null)}
        />
      )}
    </div>
  );
};

const statusLabel: Record<string, string> = { new: "Submitted", reviewed: "Reviewed", shortlisted: "Shortlisted", rejected: "Not selected", hired: "Hired!" };
const statusColor: Record<string, string> = {
  new: "bg-accent/20 text-accent-foreground border-accent",
  reviewed: "bg-muted text-foreground border-border",
  shortlisted: "bg-noteworthy/20 text-noteworthy border-noteworthy",
  rejected: "bg-destructive/10 text-destructive border-destructive",
  hired: "bg-[hsl(var(--up))]/20 text-[hsl(var(--up))] border-[hsl(var(--up))]",
};

const MyApplicationsSection = () => {
  const { data: apps = [] } = useQuery({
    queryKey: ["my-applications"],
    queryFn: fetchMyApplications,
  });

  return (
    <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
        {apps.length} application{apps.length !== 1 ? "s" : ""}
      </div>

      {apps.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground border border-border bg-surface">
          <Briefcase className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p>You haven't applied to any jobs yet.</p>
        </div>
      ) : (
        <div className="border border-border bg-surface">
          {/* Header */}
          <div className="grid grid-cols-[1fr_150px_120px_100px] gap-3 px-5 py-2.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border">
            <div>Position</div>
            <div>Company</div>
            <div>Applied</div>
            <div>Status</div>
          </div>
          <div className="divide-y divide-border">
            {apps.map((app) => (
              <div key={app.applicationId} className="grid grid-cols-[1fr_150px_120px_100px] gap-3 px-5 py-3.5 items-center hover:bg-background/60 transition-colors">
                <div className="min-w-0">
                  <div className="font-display text-sm font-bold truncate">{app.jobTitle}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{app.jobLocation}</span>
                    {app.salary && <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{app.salary}</span>}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{app.companyName}</div>
                  {app.ticker && <div className="font-mono text-[10px] text-muted-foreground">{app.ticker}</div>}
                </div>
                <div className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />{app.timeAgo}
                </div>
                <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold border text-center ${statusColor[app.status] || "bg-muted text-foreground border-border"}`}>
                  {statusLabel[app.status] || app.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const PostJobDialog = ({
  isAuthenticated,
  onClose,
  onPosted,
}: {
  isAuthenticated: boolean;
  onClose: () => void;
  onPosted: () => void;
}) => {
  const [companyName, setCompanyName] = useState("");
  const [ticker, setTicker] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [description, setDescription] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const [showAuth, setShowAuth] = useState(!isAuthenticated);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthError("");
    setAuthLoading(true);
    try {
      if (authMode === "login") await apiLogin(authEmail, authPassword);
      else await apiRegister(authEmail, authPassword);
      setShowAuth(false);
    } catch (err: any) {
      setAuthError(err.message || "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName || !title || !location || !contactEmail) return;
    setPosting(true);
    setError("");
    try {
      await postJob({ companyName, ticker, title, location, contactEmail, description });
      onPosted();
    } catch (err: any) {
      if (err.message?.includes("401") || err.message?.includes("Login")) {
        setShowAuth(true);
      } else {
        setError(err.message || "Failed to post job");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div className="fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg max-w-2xl rounded-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h2 className="font-semibold tracking-tight font-display text-2xl">Post a job on Orewire</h2>
          <p className="text-sm text-muted-foreground">
            Reach 80,000+ mining professionals, analysts and investors across TSX, TSX-V, CSE and ASX.
          </p>
        </div>

        {showAuth ? (
          <div>
            {authError && <div className="mb-3 p-2.5 bg-destructive/10 text-destructive text-xs">{authError}</div>}
            <form onSubmit={handleAuth} className="space-y-3">
              <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="Email" required className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password" required minLength={6} className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <button type="submit" disabled={authLoading} className="w-full h-10 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 rounded-none disabled:opacity-50">
                {authLoading ? "..." : authMode === "login" ? "Log in to post" : "Create account"}
              </button>
            </form>
            <div className="mt-3 text-center text-xs text-muted-foreground">
              {authMode === "login" ? (
                <>Don't have an account? <button onClick={() => { setAuthMode("register"); setAuthError(""); }} className="text-accent hover:underline font-medium">Sign up</button></>
              ) : (
                <>Already have an account? <button onClick={() => { setAuthMode("login"); setAuthError(""); }} className="text-accent hover:underline font-medium">Log in</button></>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && <div className="p-2.5 bg-destructive/10 text-destructive text-xs">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" required className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker (optional)" className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" required className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none sm:col-span-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (City, Country)" required className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Contact email" required className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            </div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Job description, requirements, salary range…" rows={5} className="flex min-h-[80px] w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />

            <div className="border border-border bg-muted/30 p-3 text-xs space-y-1.5">
              <div className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground">Pricing</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--up))]" /> Standard listing — $299 · 30 days</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--up))]" /> Promoted (top + accent border + newsletter) — $799 · 30 days</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--up))]" /> Unlimited posts for issuers — from $2,400 / yr</div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <button type="submit" disabled={posting} className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium h-10 px-4 py-2 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50">
                {posting ? "Submitting..." : "Submit listing"}
              </button>
            </div>
          </form>
        )}

        <button onClick={onClose} className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </div>
  );
};

const ApplyDialog = ({
  job,
  onClose,
  onApplied,
}: {
  job: JobListing;
  onClose: () => void;
  onApplied: () => void;
}) => {
  const { isAuthenticated, user } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [resumeUrl, setResumeUrl] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [expectedSalary, setExpectedSalary] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setSubmitting(true);
    setError("");
    try {
      await applyToJob(job.id, {
        name,
        email: isAuthenticated ? undefined : email,
        phone,
        resumeUrl,
        coverLetter,
        expectedSalary,
        website,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div className="fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg max-w-2xl rounded-none max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h2 className="font-semibold tracking-tight font-display text-2xl">Apply for this position</h2>
          <p className="text-sm text-muted-foreground">{job.title} at {job.companyName}</p>
        </div>

        {success ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-[hsl(var(--up))] mx-auto" />
            <h3 className="font-display text-xl font-bold">Application submitted!</h3>
            <p className="text-sm text-muted-foreground">Your application for <strong>{job.title}</strong> at {job.companyName} has been sent. The hiring team will contact you via email.</p>
            <button onClick={onApplied} className="inline-flex items-center justify-center gap-2 text-sm font-medium h-10 px-6 py-2 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 mt-2">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && <div className="p-2.5 bg-destructive/10 text-destructive text-xs">{error}</div>}

            {/* Job info bar */}
            <div className="border border-border bg-muted/30 p-3 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{job.companyName}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
              {job.salary && <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{job.salary}</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *" required className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              {isAuthenticated ? (
                <div className="flex h-10 w-full border border-input bg-muted/30 px-3 py-2 text-sm rounded-none items-center text-muted-foreground">
                  {user?.email}
                </div>
              ) : (
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" required className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              )}
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input value={expectedSalary} onChange={(e) => setExpectedSalary(e.target.value)} placeholder="Expected salary" className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input type="url" value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} placeholder="Resume link (Google Drive, Dropbox, LinkedIn)" className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none sm:col-span-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
              <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website / Portfolio (optional)" className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm rounded-none sm:col-span-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            </div>

            <textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} placeholder="Cover letter (optional) — why you're a great fit for this role…" rows={4} className="flex min-h-[80px] w-full border border-input bg-background px-3 py-2 text-sm rounded-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <button type="button" onClick={onClose} className="inline-flex items-center justify-center text-sm font-medium h-10 px-4 py-2 rounded-none border border-border hover:bg-muted">Cancel</button>
              <button type="submit" disabled={submitting || !name} className="inline-flex items-center justify-center gap-2 text-sm font-medium h-10 px-4 py-2 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50">
                {submitting ? "Submitting..." : "Submit application"}
              </button>
            </div>
          </form>
        )}

        <button onClick={onClose} className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" /><span className="sr-only">Close</span>
        </button>
      </div>
    </div>
  );
};

export default Jobs;
