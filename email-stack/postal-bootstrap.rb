# OreWire email stack - Postal bootstrap (runs via rails runner inside postal-init)
# Idempotent: safe to run on every deploy. Runs domain verification each pass.

admin = User.find_by!(email_address: "admin@orewire.com")
org = Organization.find_or_create_by!(name: "OreWire Outreach") { |o| o.owner = admin }
OrganizationUser.find_or_create_by!(organization: org, user: admin)

server = org.servers.find_or_create_by!(name: "Outreach") { |s| s.mode = "Live" }
smtp = server.credentials.find_or_create_by!(type: "SMTP", name: "console")
api = server.credentials.find_or_create_by!(type: "API", name: "bridge")

puts "ORG_PERMALINK=#{org.permalink}"
puts "SERVER_PERMALINK=#{server.permalink}"
puts "SMTP_KEY=#{smtp.key}"
puts "API_KEY=#{api.key}"

spf_include = Postal::Config.dns.spf_include
smtp_host = Postal::Config.postal.smtp_hostname
vps_ip = ENV["VPS_IP"] || "2.24.106.85"

# Global infrastructure records (once)
puts "CF|INFRA|A|spf.#{ENV.fetch('EMAIL_DOMAIN', 'emails.orewire.com')}|#{vps_ip}"
puts "CF|INFRA|TXT|spf.#{ENV.fetch('EMAIL_DOMAIN', 'emails.orewire.com')}|v=spf1 ip4:#{vps_ip} ~all"
puts "CF|INFRA|MX|rp.#{ENV.fetch('EMAIL_DOMAIN', 'emails.orewire.com')}|10 #{smtp_host}"
puts "CF|INFRA|TXT|rp.#{ENV.fetch('EMAIL_DOMAIN', 'emails.orewire.com')}|v=spf1 a mx include:#{spf_include} ~all"
puts "CF|INFRA|A|track.#{ENV.fetch('EMAIL_DOMAIN', 'emails.orewire.com')}|#{vps_ip}"

# Per sending domain
["getorewire.com", "orewiredata.com", "orewirehq.com"].each do |name|
  d = server.domains.find_or_create_by!(name: name) do |dom|
    dom.outgoing = true
    dom.incoming = false
    dom.verification_method = "DNS"
  end
  verified_now = d.verify_with_dns
  puts "DOMAIN=#{d.name} verified=#{d.verified?} (verify_run=#{verified_now})"

  puts "CF|#{d.name}|TXT|#{d.name}|#{d.dns_verification_string}"
  puts "CF|#{d.name}|TXT|#{d.name}|#{d.spf_record}"
  puts "CF|#{d.name}|TXT|#{d.dkim_record_name}.#{d.name}|#{d.dkim_record}"
  rp = d.return_path_domain
  puts "CF|#{d.name}|MX|#{rp}|10 #{smtp_host}"
  puts "CF|#{d.name}|TXT|#{rp}|v=spf1 a mx include:#{spf_include} ~all"
end

# ---------- inbound mail -> console inbox portal ----------
# Catch-all route: every incoming address on the domain is POSTed to the console.
http = server.http_endpoints.find_or_create_by!(name: "console-inbox") do |e|
  e.url = "http://console:8018/api/inbound?key=inbound-8x3k"
  e.encoding = "BodyAsJSON"
  e.format = "Hash"
  e.include_attachments = false
  e.strip_replies = false
end
puts "HTTPENDPOINT=#{http.name} url=#{http.url}"

["getorewire.com", "orewiredata.com", "orewirehq.com"].each do |name|
  d = server.domains.find_by(name: name)
  next unless d
  begin
    if d.incoming != true
      d.incoming = true
      d.save!
    end
    route = Route.find_or_create_by!(domain: d, name: "*") do |r|
      r.server = server
      r.mode = "Endpoint"
      r.endpoint = http
      r.spam_mode = "Mark"
    end
    puts "ROUTE=#{d.name} catch-all -> console (mode=#{route.mode})"
  rescue => e
    puts "ROUTE_ERROR=#{d.name}: #{e.message[0, 140]}"
  end
end

