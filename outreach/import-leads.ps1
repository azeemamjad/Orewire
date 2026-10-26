# OreWire outreach bridge - Stage 1: import leads CSV into Listmonk
# Usage: pwsh import-leads.ps1 [path-to-csv]
param(
  [string]$CsvPath = "C:\Users\Azeem\Downloads\orewire_australia_leads.csv"
)

$ErrorActionPreference = "Stop"
$csv = Import-Csv $CsvPath
Write-Host "Loaded $($csv.Count) rows from $CsvPath"

function esc($s) { if ($null -eq $s) { "" } else { "$s" -replace "'", "''" } }

# --- 1. Lists (idempotent) ---
@"
INSERT INTO lists (uuid, name, type, optin, status, tags)
VALUES
  (gen_random_uuid(), 'AU Leads Master', 'private', 'single', 'active', '{}'),
  (gen_random_uuid(), 'AU Research Analysts', 'private', 'single', 'active', '{}'),
  (gen_random_uuid(), 'AU Company IR', 'private', 'single', 'active', '{}')
ON CONFLICT DO NOTHING;
"@ | docker exec -i listmonk_db psql -U listmonk -d listmonk

# --- 2. Build one big SQL for subscribers + list memberships ---
$sb = New-Object System.Text.StringBuilder
$countA = 0; $countB = 0; $countU = 0

foreach ($r in $csv) {
  $email = esc("$($r.email)".ToLower().Trim())
  if (-not $email) { continue }
  $name = esc((("$($r.first_name) $($r.last_name)").Trim()))
  $attribs = @{
    company_name = $r.company_name
    title        = $r.title
    city         = $r.city
    country      = $r.country
    firm_type    = $r.firm_type
    fit_score    = $r.fit_score
    linkedin     = $r.linkedin
    website      = $r.website
  } | ConvertTo-Json -Compress
  $a = esc($attribs)

  # classify by title/firm_type
  $t = "$($r.title) $($r.firm_type)".ToLower()
  $listNames = "'AU Leads Master'"
  if ($t -match 'analyst|research|portfolio|fund manager|fund mgr|investment|investments|\bcio\b|equity|capital markets|institutional|asset management|wealth') {
    $listNames += ", 'AU Research Analysts'"; $script:countA++
  } elseif ($t -match '\bceo\b|chief executive|investor relations|\bir\b|corporate development|corp dev|founder|co-founder|managing director|managing partner|vice president|\bvp\b|head of|director|partner|\bpresident\b|general manager') {
    $listNames += ", 'AU Company IR'"; $script:countB++
  } else { $script:countU++ }

  [void]$sb.AppendLine("INSERT INTO subscribers (uuid, email, name, status, attribs) VALUES (gen_random_uuid(), '$email', '$name', 'enabled', '$a') ON CONFLICT (email) DO NOTHING;")
  [void]$sb.AppendLine("INSERT INTO subscriber_lists (subscriber_id, list_id, status) SELECT s.id, l.id, 'confirmed' FROM subscribers s JOIN lists l ON l.name = ANY(ARRAY[$listNames]) WHERE s.email = '$email' ON CONFLICT DO NOTHING;")
}

$sqlFile = Join-Path $PSScriptRoot "leads-import.sql"
$sb.ToString() | Set-Content $sqlFile -Encoding UTF8
Write-Host "Generated $sqlFile (research=$countA, ir=$countB, unclassified=$countU)"

# --- 3. Apply ---
Get-Content $sqlFile -Raw | docker exec -i listmonk_db psql -U listmonk -d listmonk 2>&1 | Select-Object -Last 3

# --- 4. Totals ---
docker exec listmonk_db psql -U listmonk -d listmonk -c "SELECT l.name, COUNT(sl.subscriber_id) AS leads FROM lists l LEFT JOIN subscriber_lists sl ON sl.list_id = l.id AND sl.status='confirmed' WHERE l.name LIKE 'AU %' GROUP BY l.name ORDER BY l.name;"
