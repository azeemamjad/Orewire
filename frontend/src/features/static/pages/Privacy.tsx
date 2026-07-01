import SiteLayout from "@/layouts/SiteLayout";

const Privacy = () => (
  <SiteLayout className="min-h-screen flex flex-col bg-background text-foreground">
    <main className="flex-1">
      <section className="border-b border-border bg-card">
        <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-10 text-left">
          <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">Privacy Policy</h1>
          <p className="text-muted-foreground mt-2 text-sm italic">Last updated: June 2026</p>
        </div>
      </section>

      <article className="max-w-[900px] mx-auto px-6 lg:px-10 py-10 prose prose-sm md:prose-base prose-neutral dark:prose-invert max-w-none">
        <p>
          This Privacy Policy describes how OreWire (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, and protects your personal information when you use the OreWire platform at orewire.com, including the website, the morning briefing, watchlist alerts, and related services (the &quot;Platform&quot;).
        </p>

        <h2>Information We Collect</h2>
        <p><strong>Information you provide to us:</strong></p>
        <ul>
          <li>Account information: name, email address, and password when you create an account.</li>
          <li>Payment information: credit card or payment details when you subscribe to a paid plan. Payment processing is handled by Stripe, and we do not store your full credit card number on our servers.</li>
          <li>Watchlist preferences: companies you add to your watchlist and your alert preferences.</li>
          <li>Communications: any messages you send us via email or support channels.</li>
          <li>Newsletter signup: your email address when you subscribe to our free newsletter.</li>
        </ul>
        <p><strong>Information collected automatically:</strong></p>
        <ul>
          <li>Usage data: pages visited, features used, search queries, filing and news items viewed.</li>
          <li>Device and browser information: IP address, browser type, operating system, device type, and screen resolution.</li>
          <li>Cookies and similar technologies: we use cookies to maintain your session, remember your preferences, and analyze usage patterns.</li>
          <li>Log data: server logs recording your interactions with the Platform, including timestamps and referring URLs.</li>
        </ul>

        <h2>How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul>
          <li>Provide and maintain the Platform, including your account, watchlist, alerts, and newsletters.</li>
          <li>Process payments and manage your subscription.</li>
          <li>Send you the daily morning briefing, watchlist alerts, and other email communications you have opted into.</li>
          <li>Personalize your experience, including showing content relevant to your watchlist and preferences.</li>
          <li>Analyze usage patterns to improve the Platform, fix issues, and develop new features.</li>
          <li>Respond to your inquiries and provide customer support.</li>
          <li>Comply with legal obligations and enforce our Terms of Use.</li>
        </ul>

        <h2>How We Share Your Information</h2>
        <p>We do not sell, rent, or trade your personal information to third parties for marketing purposes. We may share your information with:</p>
        <ul>
          <li>Payment processors: Stripe processes your payment information. Their use of your data is governed by their own privacy policy.</li>
          <li>Email service providers: we use Resend (or similar services) to deliver emails. These providers process your email address to deliver newsletters and alerts on our behalf.</li>
          <li>Analytics providers: we may use analytics services to understand how the Platform is used. These services collect anonymized or aggregated usage data.</li>
          <li>Legal requirements: we may disclose your information if required to do so by law, regulation, legal process, or governmental request.</li>
          <li>Business transfers: if OreWire is acquired, merged, or sells substantially all of its assets, your information may be transferred as part of that transaction. We will notify you of any such change.</li>
        </ul>

        <h2>Cookies</h2>
        <p>We use cookies and similar technologies for the following purposes:</p>
        <ul>
          <li>Essential cookies: required for the Platform to function, including maintaining your login session and processing payments.</li>
          <li>Preference cookies: remember your settings, such as your preferred exchange filters or watchlist configuration.</li>
          <li>Analytics cookies: help us understand how visitors use the Platform so we can improve it.</li>
        </ul>
        <p>You can control cookies through your browser settings. Disabling essential cookies may prevent some features of the Platform from working correctly.</p>

        <h2>Data Retention</h2>
        <p>
          We retain your personal information for as long as your account is active or as needed to provide you with the Platform. If you delete your account, we will delete your personal information within 30 days, except where we are required to retain it for legal, accounting, or regulatory purposes.
        </p>
        <p>Usage data and analytics may be retained in anonymized or aggregated form indefinitely.</p>

        <h2>Data Security</h2>
        <p>
          We take reasonable measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. These measures include encryption of data in transit (TLS/SSL), secure storage of passwords (hashing), and access controls limiting who can access personal data.
        </p>
        <p>However, no method of transmission over the internet or electronic storage is completely secure. We cannot guarantee absolute security of your information.</p>

        <h2>Your Rights</h2>
        <p>Depending on your jurisdiction, you may have the following rights regarding your personal information:</p>
        <ul>
          <li>Access: request a copy of the personal information we hold about you.</li>
          <li>Correction: request that we correct any inaccurate or incomplete information.</li>
          <li>Deletion: request that we delete your personal information, subject to legal retention requirements.</li>
          <li>Opt-out: unsubscribe from marketing emails at any time using the unsubscribe link in any email, or through your account settings.</li>
          <li>Data portability: request your data in a machine-readable format.</li>
        </ul>
        <p>To exercise any of these rights, contact us at <a href="mailto:hello@orewire.com" className="text-accent underline underline-offset-2">hello@orewire.com</a>.</p>

        <h2>Email Communications</h2>
        <p>By creating an account or subscribing to our newsletter, you consent to receiving the following emails:</p>
        <ul>
          <li>Daily morning briefing (weekdays).</li>
          <li>Watchlist alerts (when a company on your watchlist files or publishes a news release).</li>
          <li>Weekly recap email (Fridays).</li>
          <li>Account-related emails (subscription confirmations, payment receipts, password resets).</li>
        </ul>
        <p>You can opt out of non-essential emails (briefing, alerts, weekly recap) at any time through your account settings or by clicking the unsubscribe link in any email. Account-related transactional emails cannot be opted out of while your account is active.</p>

        <h2>Children&apos;s Privacy</h2>
        <p>
          The Platform is not intended for use by individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected information from a child under 18, we will take steps to delete that information.
        </p>

        <h2>International Users</h2>
        <p>
          OreWire is operated remotely and may process your data in various jurisdictions. By using the Platform, you consent to the transfer and processing of your information in the jurisdictions where our service providers operate, which may have different data protection laws than your own.
        </p>

        <h2>Third-Party Services</h2>
        <p>
          The Platform may contain links to third-party websites, services, or content. We are not responsible for the privacy practices of third parties. We encourage you to read the privacy policies of any third-party services you interact with through the Platform, including TradingView, Stripe, and any linked regulatory filing databases.
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we will update the &quot;Last updated&quot; date at the top of this page. Material changes will be communicated via email or through a notice on the Platform. Your continued use of the Platform after any changes constitutes your acceptance of the updated Privacy Policy.
        </p>

        <h2>Contact</h2>
        <p>
          If you have questions or concerns about this Privacy Policy or your personal information, contact us at{" "}
          <a href="mailto:hello@orewire.com" className="text-accent underline underline-offset-2">hello@orewire.com</a>.
        </p>
      </article>
    </main>
  </SiteLayout>
);

export default Privacy;
