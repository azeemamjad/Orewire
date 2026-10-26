# OreWire email stack - Postal bootstrap (runs via rails runner inside postal-init)
# Idempotent: safe to run on every deploy.

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
  puts "DOMAIN=#{d.name} verified=#{d.verified?}"

  puts "CF|#{d.name}|TXT|#{d.name}|#{d.dns_verification_string}"
  puts "CF|#{d.name}|TXT|#{d.name}|#{d.spf_record}"
  puts "CF|#{d.name}|TXT|#{d.dkim_record_name}.#{d.name}|#{d.dkim_record}"
  rp = d.return_path_domain
  puts "CF|#{d.name}|MX|#{rp}|10 #{smtp_host}"
  puts "CF|#{d.name}|TXT|#{rp}|v=spf1 a mx include:#{spf_include} ~all"
end
