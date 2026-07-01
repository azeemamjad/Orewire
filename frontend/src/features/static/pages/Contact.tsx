import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { z } from "zod";
import SiteLayout from "@/layouts/SiteLayout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { submitContactMessage } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Valid email is required").max(200),
  company: z.string().trim().max(100).optional().or(z.literal("")),
  subject: z.string().trim().min(1, "Subject is required").max(150),
  message: z.string().trim().min(1, "Message is required").max(2000),
});

const Contact = () => {
  const [form, setForm] = useState({ name: "", email: "", company: "", subject: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = schema.safeParse(form);
    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.issues.forEach((i) => {
        errs[i.path[0] as string] = i.message;
      });
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await submitContactMessage({
        name: result.data.name,
        email: result.data.email,
        company: result.data.company || undefined,
        subject: result.data.subject,
        message: result.data.message,
      });
      setForm({ name: "", email: "", company: "", subject: "", message: "" });
      toast({
        title: "Message sent",
        description: "Thanks for reaching out. We will get back to you as soon as possible.",
      });
    } catch (err) {
      toast({
        title: "Could not send message",
        description: err instanceof Error ? err.message : "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SiteLayout className="min-h-screen flex flex-col bg-background">
      <main className="flex-1">
        <section className="border-b border-border bg-card">
          <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-10">
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Contact</div>
            <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">Get in touch</h1>
            <p className="text-muted-foreground mt-2 max-w-xl">
              Have a question, feedback, or an advertising or sponsorship inquiry? Send a message below or email{" "}
              <a href="mailto:hello@orewire.com" className="text-foreground underline underline-offset-2">
                hello@orewire.com
              </a>
              .
            </p>
          </div>
        </section>

        <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-10 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
          <form onSubmit={submit} className="border border-border bg-surface p-6 lg:p-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <Label htmlFor="name" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Name *</Label>
                <Input id="name" value={form.name} onChange={update("name")} maxLength={100} className="mt-1.5 rounded-none" />
                {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
              </div>
              <div>
                <Label htmlFor="email" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={update("email")}
                  maxLength={200}
                  className="mt-1.5 rounded-none"
                />
                {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
              </div>
            </div>
            <div>
              <Label htmlFor="company" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Company</Label>
              <Input id="company" value={form.company} onChange={update("company")} maxLength={100} className="mt-1.5 rounded-none" />
            </div>
            <div>
              <Label htmlFor="subject" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Subject *</Label>
              <Input id="subject" value={form.subject} onChange={update("subject")} maxLength={150} className="mt-1.5 rounded-none" />
              {errors.subject && <p className="mt-1 text-xs text-destructive">{errors.subject}</p>}
            </div>
            <div>
              <Label htmlFor="message" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Message *</Label>
              <Textarea id="message" value={form.message} onChange={update("message")} maxLength={2000} rows={7} className="mt-1.5 rounded-none resize-y" />
              {errors.message && <p className="mt-1 text-xs text-destructive">{errors.message}</p>}
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="h-11 px-6 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
            >
              <Send className="w-4 h-4 mr-2" /> {submitting ? "Sending…" : "Send message"}
            </Button>
          </form>

          <aside className="space-y-5">
            <div className="border border-border bg-surface p-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <Mail className="w-3 h-3 text-accent" /> Email us
              </div>
              <a href="mailto:hello@orewire.com" className="font-display text-lg font-bold hover:text-accent break-all">
                hello@orewire.com
              </a>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                We will get back to you as soon as possible.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </SiteLayout>
  );
};

export default Contact;
