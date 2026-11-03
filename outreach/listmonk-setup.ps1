# OreWire - deploy Listmonk setup through the browser bridge
# Lists (idempotent), lead imports (per-subscriber POSTs), Campaign A/B drafts.
param([string]$Bridge = "http://localhost:8766/execute")
$ErrorActionPreference = "Stop"
$base = "https://lists.emails.orewire.com"

function Bridge($obj) {
  $json = $obj | ConvertTo-Json -Depth 10 -Compress
  return Invoke-RestMethod -Uri $Bridge -Method Post -ContentType "application/json" -Body $json -TimeoutSec 180
}
function Lfetch($url, $method, $body) {
  $o = @{ cmd = "lfetch"; url = $url; method = $method }
  if ($body) { $o.body = $body }
  return Bridge $o
}

# ---------- 1. Lists ----------
$existing = Lfetch "$base/api/lists?per_page=100" "GET" $null
$ids = @{}
if ($existing.text) { $j = $existing.text | ConvertFrom-Json; foreach ($l in $j.data.results) { $ids[$l.name] = $l.id } }
$wanted = @("AU Leads Master","AU Research Analysts","AU Company IR","CA Leads Master","CA Research Analysts","CA Company IR")
foreach ($name in $wanted) {
  if ($ids.ContainsKey($name)) { continue }
  $body = @{ name = $name; type = "private"; optin = "single" } | ConvertTo-Json -Compress
  $r = Lfetch "$base/api/lists" "POST" $body
  $j = $r.text | ConvertFrom-Json
  $ids[$name] = $j.data.id
  Write-Host "created list: $name (id $($j.data.id))"
}
Write-Host "lists ready: $($ids.Keys -join ', ')"

# ---------- 2. Subscribers (per-subscriber POST) ----------
function Classify($title, $firm) {
  $t = "$title $firm".ToLower()
  if ($t -match 'analyst|research|portfolio|fund manager|fund mgr|investment|investments|\bcio\b|equity|capital markets|institutional|asset management|wealth') { return "A" }
  if ($t -match '\bceo\b|chief executive|investor relations|\bir\b|corporate development|corp dev|founder|co-founder|managing director|managing partner|vice president|\bvp\b|head of|director|partner|\bpresident\b|general manager|national|leader|audit|assurance|tax|advisor') { return "B" }
  return ""
}

function ImportCsv($path, $prefix) {
  $rows = Import-Csv $path
  Write-Host "=== $prefix : $($rows.Count) rows ==="
  $ok = 0; $fail = 0; $i = 0
  foreach ($r in $rows) {
    $i++
    $email = "$($r.email)".ToLower().Trim()
    if (-not $email) { continue }
    $attribs = @{
      company_name = $r.company_name; title = $r.title; city = $r.city; country = $r.country
      firm_type = $r.firm_type; fit_score = $r.fit_score; linkedin = $r.linkedin; website = $r.website
    }
    $name = ("$($r.first_name) $($r.last_name)").Trim()
    $listNames = @("$prefix Leads Master")
    $seg = Classify $r.title $r.firm_type
    if ($seg -eq "A") { $listNames += "$prefix Research Analysts" }
    elseif ($seg -eq "B") { $listNames += "$prefix Company IR" }
    $listIds = @($listNames | ForEach-Object { $ids[$_] } | Where-Object { $_ })
    $obj = @{ email = $email; name = $name; status = "enabled"; attribs = $attribs; lists = $listIds; preconfirm_subscriptions = $true }
    $payload = $obj | ConvertTo-Json -Depth 6 -Compress
    $resp = Lfetch "$base/api/subscribers" "POST" $payload
    if ($resp.status -eq 200) { $ok++ }
    else {
      $fail++
      if ($fail -le 5) { $t = $resp.text; if (-not $t) { $t = "no body" }; Write-Host "  FAIL ${email}: $($t.Substring(0, [Math]::Min(90, $t.Length)))" }
    }
    if ($i % 50 -eq 0) { Write-Host "  $prefix progress: $i/$($rows.Count) ok=$ok fail=$fail" }
  }
  Write-Host "$prefix RESULT: ok=$ok fail=$fail"
  return @{ ok = $ok; fail = $fail }
}

$au = ImportCsv "C:\Users\Azeem\Downloads\orewire_australia_leads.csv" "AU"
$ca = ImportCsv "C:\Users\Azeem\Downloads\orewire_canada_leads.csv" "CA"

# ---------- 3. Cleanup test subscriber ----------
$test = Lfetch "$base/api/subscribers?query=email:azeemamjad225@gmail.com" "GET" $null
if ($test.text) {
  $tj = $test.text | ConvertFrom-Json
  foreach ($s in $tj.data.results) { if ($s.email -eq "azeemamjad225@gmail.com") { $null = Lfetch "$base/api/subscribers/$($s.id)" "DELETE" $null; Write-Host "removed test subscriber $($s.id)" } }
}

# ---------- 4. Final counts ----------
$sum = Lfetch "$base/api/lists?per_page=100" "GET" $null
$sj = $sum.text | ConvertFrom-Json
Write-Host "`n=== FINAL LIST COUNTS ==="
$sj.data.results | ForEach-Object { Write-Host "$($_.name): $($_.subscriber_count)" }
$camp = Lfetch "$base/api/campaigns?per_page=100" "GET" $null
Write-Host "`n=== CAMPAIGNS ==="
($camp.text | ConvertFrom-Json).data.results | ForEach-Object { Write-Host "$($_.name) [$($_.status)]" }
