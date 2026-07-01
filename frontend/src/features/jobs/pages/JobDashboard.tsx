import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase, ChevronDown, ChevronUp, Clock, ExternalLink, Globe, Mail, MapPin, Phone, User,
  DollarSign, FileText, CheckCircle2, Trash2, Eye, EyeOff,
} from "lucide-react";
import SiteLayout from "@/layouts/SiteLayout";
import { fetchMyJobApplications, updateApplicationStatus, updateJobStatus, deleteJob, type JobWithApplications, type JobApplication } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const statusStyle: Record<string, string> = {
  new: "bg-accent/20 text-accent-foreground border-accent",
  reviewed: "bg-muted text-foreground border-border",
  shortlisted: "bg-noteworthy/20 text-noteworthy border-noteworthy",
  rejected: "bg-destructive/10 text-destructive border-destructive",
  hired: "bg-[hsl(var(--up))]/20 text-[hsl(var(--up))] border-[hsl(var(--up))]",
};

const statuses = ["new", "reviewed", "shortlisted", "rejected", "hired"];

const JobDashboard = () => {
  const { isAuthenticated, loading } = useAuth();

  const { data: jobs = [], refetch } = useQuery({
    queryKey: ["my-job-applications"],
    queryFn: fetchMyJobApplications,
    enabled: isAuthenticated && !loading,
  });

  if (loading) {
    return (
      <SiteLayout className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
      </SiteLayout>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login?redirect=/jobs/dashboard" replace />;
  }

  const totalApps = jobs.reduce((sum, j) => sum + j.applications.length, 0);

  return (
    <SiteLayout className="min-h-screen bg-background flex flex-col">
      <section className="border-b border-border bg-background">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 lg:py-10">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 inline-flex items-center gap-2">
                <Briefcase className="w-3 h-3" /> Employer dashboard
              </div>
              <h1 className="font-display text-3xl lg:text-4xl font-extrabold leading-tight">Your job listings</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {jobs.length} active listing{jobs.length !== 1 ? "s" : ""} · {totalApps} application{totalApps !== 1 ? "s" : ""}
              </p>
            </div>
            <Link
              to="/jobs"
              className="inline-flex items-center justify-center gap-2 text-sm font-medium px-4 py-2 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 h-10"
            >
              <FileText className="w-4 h-4" /> Post another job
            </Link>
          </div>
        </div>
      </section>

      <main className="flex-1">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-6 lg:py-8 space-y-6">
          {jobs.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground border border-border bg-surface">
              <Briefcase className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
              <p>You haven't posted any jobs yet.</p>
              <Link to="/jobs" className="text-accent hover:underline font-medium mt-2 inline-block">Post your first job →</Link>
            </div>
          ) : (
            jobs.map((job) => (
              <JobCard key={job.jobId} job={job} onStatusChange={refetch} />
            ))
          )}
        </div>
      </main>
    </SiteLayout>
  );
};

const JobCard = ({ job, onStatusChange }: { job: JobWithApplications; onStatusChange: () => void }) => {
  const [expanded, setExpanded] = useState(true);
  const [acting, setActing] = useState(false);
  const isPrivate = job.jobStatus === "private";

  const handleToggleVisibility = async () => {
    setActing(true);
    try {
      await updateJobStatus(job.jobId, isPrivate ? "active" : "private");
      onStatusChange();
    } catch { /* skip */ }
    finally { setActing(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${job.jobTitle}"? This cannot be undone.`)) return;
    setActing(true);
    try {
      await deleteJob(job.jobId);
      onStatusChange();
    } catch { /* skip */ }
    finally { setActing(false); }
  };

  return (
    <div className={`border bg-surface ${isPrivate ? "border-border opacity-75" : "border-border"}`}>
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button onClick={() => setExpanded(!expanded)} className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-bold">{job.jobTitle}</h3>
            {isPrivate && <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 bg-muted text-muted-foreground border border-border">Private</span>}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span>{job.companyName}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{job.jobLocation}</span>
            <span className="font-mono">{job.applications.length} application{job.applications.length !== 1 ? "s" : ""}</span>
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleToggleVisibility}
            disabled={acting}
            title={isPrivate ? "Make public" : "Make private"}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {isPrivate ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={handleDelete}
            disabled={acting}
            title="Delete job"
            className="p-2 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-2 text-muted-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border">
          {job.applications.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">No applications yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {/* Header */}
              <div className="grid grid-cols-[1fr_120px_100px_80px] gap-3 px-5 py-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                <div>Applicant</div>
                <div>Salary</div>
                <div>Applied</div>
                <div>Status</div>
              </div>

              {job.applications.map((app) => (
                <ApplicationRow key={app.id} app={app} onStatusChange={onStatusChange} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ApplicationRow = ({ app, onStatusChange }: { app: JobApplication; onStatusChange: () => void }) => {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);

  const handleStatus = async (status: string) => {
    setUpdating(true);
    try {
      await updateApplicationStatus(app.id, status);
      onStatusChange();
    } catch { /* skip */ }
    finally { setUpdating(false); }
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full grid grid-cols-[1fr_120px_100px_80px] gap-3 px-5 py-3 items-center text-left hover:bg-background/60 transition-colors text-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-muted grid place-items-center shrink-0">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{app.name}</div>
            <div className="text-xs text-muted-foreground truncate">{app.email}</div>
          </div>
        </div>
        <div className="font-mono text-xs text-muted-foreground">{app.expectedSalary || "-"}</div>
        <div className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1"><Clock className="w-3 h-3" />{app.timeAgo}</div>
        <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold border text-center ${statusStyle[app.status] || "bg-muted text-foreground border-border"}`}>
          {app.status}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-4 pt-1 ml-10 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {app.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="w-3.5 h-3.5" /> {app.phone}
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-3.5 h-3.5" /> <a href={`mailto:${app.email}`} className="hover:text-foreground hover:underline">{app.email}</a>
            </div>
            {app.resumeUrl && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="w-3.5 h-3.5" /> <a href={app.resumeUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline inline-flex items-center gap-1">Resume <ExternalLink className="w-3 h-3" /></a>
              </div>
            )}
            {app.website && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="w-3.5 h-3.5" /> <a href={app.website} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline inline-flex items-center gap-1">Website <ExternalLink className="w-3 h-3" /></a>
              </div>
            )}
            {app.expectedSalary && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <DollarSign className="w-3.5 h-3.5" /> Expected: {app.expectedSalary}
              </div>
            )}
          </div>

          {app.coverLetter && (
            <div className="text-sm text-foreground/80 bg-muted/30 border border-border p-3 leading-relaxed">
              {app.coverLetter}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-1">Set status:</span>
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => handleStatus(s)}
                disabled={updating || app.status === s}
                className={`font-mono text-[9px] uppercase tracking-widest px-2 py-1 border transition-colors disabled:opacity-40 ${
                  app.status === s
                    ? statusStyle[s] || "bg-muted text-foreground border-border"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
              >
                {s === "new" ? "New" : s === "reviewed" ? "Reviewed" : s === "shortlisted" ? "Shortlisted" : s === "rejected" ? "Rejected" : "Hired"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default JobDashboard;
