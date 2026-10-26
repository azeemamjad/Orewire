# OreWire outreach bridge - Stage 3: apply verification results
# Suppresses (blacklists) leads whose mailbox does not exist; records everything in email_verifications.
$ErrorActionPreference = "Stop"
$results = Import-Csv (Join-Path $PSScriptRoot "results-final.csv")
Write-Host "Loaded $($results.Count) verification results"

# ensure verification table exists in listmonk DB
@"
CREATE TABLE IF NOT EXISTS email_verifications (
  email TEXT PRIMARY KEY,
  is_reachable TEXT,
  is_deliverable BOOLEAN,
  is_catch_all BOOLEAN,
  is_disposable BOOLEAN,
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  suppress_reason TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"@ | docker exec -i listmonk_db psql -U listmonk -d listmonk | Out-Null

$sb = New-Object System.Text.StringBuilder
$suppressed = 0; $kept = 0; $errors = 0
foreach ($r in $results) {
  $email = "$($r.email)".ToLower().Trim().Replace("'", "''")
  $reach = "$($r.is_reachable)".Trim()
  $deliv = "$($r.is_deliverable)".Trim()
  $catch = "$($r.is_catch_all)".Trim()
  $disp  = "$($r.is_disposable)".Trim()
  $delivSql = if ($deliv -eq "") { "NULL" } elseif ($deliv -eq "True") { "TRUE" } else { "FALSE" }
  $catchSql = if ($catch -eq "True") { "TRUE" } elseif ($catch -eq "False") { "FALSE" } else { "NULL" }
  $dispSql  = if ($disp  -eq "True") { "TRUE" } elseif ($disp  -eq "False") { "FALSE" } else { "NULL" }

  $suppress = ($reach -eq "invalid") -or ($deliv -eq "False")
  if ($reach -eq "error") { $errors++; continue }   # never suppress on probe failure

  if ($suppress) {
    $suppressed++
    [void]$sb.AppendLine("UPDATE subscribers SET status='blacklisted' WHERE email='$email';")
  } else { $kept++ }

  $reason = if ($suppress) { "'mailbox does not exist (is_reachable=$reach, is_deliverable=$deliv)'" } else { "NULL" }
  [void]$sb.AppendLine("INSERT INTO email_verifications (email, is_reachable, is_deliverable, is_catch_all, is_disposable, suppressed, suppress_reason) VALUES ('$email', '$reach', $delivSql, $catchSql, $dispSql, $(if ($suppress) {'TRUE'} else {'FALSE'}), $reason) ON CONFLICT (email) DO UPDATE SET is_reachable=EXCLUDED.is_reachable, is_deliverable=EXCLUDED.is_deliverable, is_catch_all=EXCLUDED.is_catch_all, is_disposable=EXCLUDED.is_disposable, suppressed=EXCLUDED.suppressed, suppress_reason=EXCLUDED.suppress_reason, checked_at=NOW();")
}

$sqlFile = Join-Path $PSScriptRoot "apply-verification.sql"
$sb.ToString() | Set-Content $sqlFile -Encoding UTF8
Write-Host "suppressed=$suppressed kept=$kept probe-errors=$errors"
Get-Content $sqlFile -Raw | docker exec -i listmonk_db psql -U listmonk -d listmonk 2>&1 | Select-Object -Last 2
docker exec listmonk_db psql -U listmonk -d listmonk -c "SELECT status, COUNT(*) FROM subscribers GROUP BY status;"
