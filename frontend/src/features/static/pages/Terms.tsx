import SiteLayout from "@/layouts/SiteLayout";

const Terms = () => (
  <SiteLayout className="min-h-screen flex flex-col bg-background text-foreground">
    <main className="flex-1">
      <section className="border-b border-border bg-card">
        <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-10 text-left">
          <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">Terms of Use</h1>
          <p className="text-muted-foreground mt-2 text-sm italic">Last updated: June 2026</p>
        </div>
      </section>

      <article className="max-w-[900px] mx-auto px-6 lg:px-10 py-10 prose prose-sm md:prose-base prose-neutral dark:prose-invert max-w-none">
        <p>
          Welcome to OreWire (the &quot;Platform&quot;), operated by OreWire (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). By accessing or using OreWire, including the website at orewire.com, the morning briefing, watchlist alerts, and any related services, you agree to be bound by these Terms of Use. If you do not agree, do not use the Platform.
        </p>

        <h2>About the Platform</h2>
        <p>
          OreWire is a financial information platform that monitors public company filings and news releases from mining and resource companies listed on the Toronto Stock Exchange (TSX), TSX Venture Exchange (TSX-V), Canadian Securities Exchange (CSE), and Australian Securities Exchange (ASX). The Platform uses artificial intelligence to generate summaries, significance assessments, and data extractions from publicly available documents.
        </p>

        <h2>Not Investment Advice</h2>
        <p>
          The information provided on OreWire, including all AI-generated summaries, significance verdicts, data extractions, newsletters, alerts, and any other content, is for informational and educational purposes only. Nothing on this Platform constitutes investment advice, financial advice, trading advice, or any other kind of professional advice.
        </p>
        <p>
          OreWire does not recommend, endorse, or suggest the purchase, sale, or holding of any security, commodity, or financial instrument. We do not provide price targets, ratings, or investment recommendations of any kind.
        </p>
        <p>
          You should not make any investment decision based solely on information found on OreWire. Always consult with a qualified financial advisor, broker, or other licensed professional before making investment decisions. Always conduct your own independent research and due diligence.
        </p>
        <p>
          OreWire is not registered as a securities dealer, broker, investment advisor, or in any other capacity with any securities regulatory authority in any jurisdiction.
        </p>

        <h2>AI-Generated Content</h2>
        <p>
          OreWire uses artificial intelligence (AI) technology to read, summarize, and analyze publicly available filings and news releases. While we strive for accuracy, AI-generated content may contain errors, omissions, misinterpretations, or inaccuracies. The AI may misread data, misclassify the significance of a filing, or produce incomplete summaries.
        </p>
        <p>You acknowledge and agree that:</p>
        <ul>
          <li>AI-generated summaries are not a substitute for reading the original filing or news release.</li>
          <li>OreWire provides links to original source documents where available, and you are encouraged to review them.</li>
          <li>The significance verdicts (Noteworthy, Watch, Routine) assigned by the AI are automated assessments and may not reflect the true significance of a filing to any particular investor.</li>
          <li>Data points extracted by AI (resource estimates, cash positions, insider holdings, grades, widths, and other figures) should be verified against the original source documents before relying on them.</li>
        </ul>
        <p>
          OreWire is not responsible or liable for any errors, omissions, or inaccuracies in AI-generated content, or for any decisions made based on such content.
        </p>

        <h2>No Guarantee of Accuracy or Completeness</h2>
        <p>
          While OreWire endeavors to provide timely and accurate information, we make no representations or warranties of any kind, express or implied, regarding the accuracy, completeness, reliability, timeliness, or suitability of any information on the Platform. Information may be delayed, incomplete, or contain errors.
        </p>
        <p>
          Stock prices, market data, commodity prices, and other financial data displayed on the Platform may be delayed and are provided by third-party sources. OreWire does not guarantee the accuracy or timeliness of such data.
        </p>

        <h2>User Accounts and Subscriptions</h2>
        <p>
          Certain features of the Platform require registration and may require a paid subscription. By creating an account, you agree to provide accurate and complete information and to keep your account credentials secure.
        </p>
        <p>
          Subscription plans, pricing, and features are described on our pricing page and may change from time to time. Changes to pricing will not affect your current billing cycle but may apply upon renewal.
        </p>
        <p>
          You may cancel your subscription at any time through your account settings. Cancellations take effect at the end of the current billing period. We do not provide refunds for partial billing periods.
        </p>
        <p>
          Free trials, if offered, automatically convert to a paid subscription at the end of the trial period unless cancelled.
        </p>

        <h2>Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Platform for any unlawful purpose or in violation of any applicable laws or regulations.</li>
          <li>Redistribute, republish, resell, or commercially exploit any content from the Platform without our prior written consent.</li>
          <li>Scrape, crawl, or use automated means to access or collect data from the Platform.</li>
          <li>Attempt to gain unauthorized access to any part of the Platform, other user accounts, or related systems.</li>
          <li>Interfere with or disrupt the operation of the Platform.</li>
          <li>Use the Platform to distribute spam, misleading content, or any form of market manipulation.</li>
        </ul>

        <h2>Intellectual Property</h2>
        <p>
          All content on OreWire, including AI-generated summaries, website design, logos, graphics, and software, is the property of OreWire or its licensors and is protected by applicable intellectual property laws. You may not reproduce, distribute, modify, or create derivative works from any content on the Platform without our prior written consent.
        </p>
        <p>
          Original filings and news releases summarized on the Platform are public documents owned by the issuing companies and regulatory bodies. OreWire&apos;s summaries and analyses of those documents are original works.
        </p>

        <h2>Third-Party Content and Links</h2>
        <p>
          The Platform may display data, content, or links from third-party sources, including stock exchanges, newswire services, market data providers, and regulatory bodies. OreWire does not endorse and is not responsible for the accuracy or content of any third-party materials.
        </p>
        <p>
          Stock charts and market data widgets may be provided by TradingView or other third-party services and are subject to their own terms of use.
        </p>

        <h2>Disclaimer of Warranties</h2>
        <p>
          The Platform is provided on an &quot;as is&quot; and &quot;as available&quot; basis without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, accuracy, and non-infringement.
        </p>
        <p>
          We do not warrant that the Platform will be uninterrupted, error-free, secure, or free of viruses or other harmful components.
        </p>

        <h2>Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, OreWire, its officers, directors, employees, agents, and affiliates shall not be liable for any direct, indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of the Platform, including but not limited to:
        </p>
        <ul>
          <li>Investment losses or trading losses based in whole or in part on information from the Platform.</li>
          <li>Errors, omissions, or inaccuracies in AI-generated summaries or data.</li>
          <li>Delays in the processing or delivery of filings, summaries, alerts, or newsletters.</li>
          <li>Unauthorized access to your account or personal information.</li>
          <li>Any interruption or cessation of the Platform.</li>
        </ul>
        <p>
          In no event shall our total liability exceed the amount you have paid to OreWire for the service in the twelve (12) months preceding the event giving rise to the claim.
        </p>

        <h2>Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless OreWire, its officers, directors, employees, and affiliates from any claims, damages, losses, or expenses (including legal fees) arising out of your use of the Platform, your violation of these Terms, or your violation of any rights of another party.
        </p>

        <h2>Governing Law</h2>
        <p>
          These Terms of Use shall be governed by and construed in accordance with applicable laws. Any disputes arising from these Terms shall be resolved through good-faith negotiation or, if necessary, through binding arbitration or the courts of a competent jurisdiction.
        </p>

        <h2>Changes to These Terms</h2>
        <p>
          We may update these Terms of Use from time to time. When we do, we will update the &quot;Last updated&quot; date at the top of this page. Your continued use of the Platform after any changes constitutes your acceptance of the updated Terms.
        </p>

        <h2>Contact</h2>
        <p>
          If you have questions about these Terms of Use, contact us at{" "}
          <a href="mailto:hello@orewire.com" className="text-accent underline underline-offset-2">hello@orewire.com</a>.
        </p>
      </article>
    </main>
  </SiteLayout>
);

export default Terms;
