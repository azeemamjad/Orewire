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

["getorewire.com", "orewiredata.com", "orewirehq.com"].each do |name|
  d = server.domains.find_or_create_by!(name: name) do |dom|
    dom.outgoing = true
    dom.incoming = false
    dom.verification_method = "DNS"
  end
  puts "DOMAIN=#{d.name} verified=#{d.verified?}"
end
