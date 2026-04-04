param(
  [Parameter(Mandatory = $true)][string]$DocxPath,
  [Parameter(Mandatory = $true)][string]$OutPath
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($DocxPath)
try {
  $entry = $zip.GetEntry('word/document.xml')
  if (-not $entry) { throw "word/document.xml not found" }
  $sr = New-Object System.IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
  $xml = $sr.ReadToEnd()
  $sr.Close()
} finally {
  $zip.Dispose()
}

$matches = [regex]::Matches($xml, '<w:t(?:[^>]*)>([\s\S]*?)</w:t>')
$sb = New-Object System.Text.StringBuilder
foreach ($m in $matches) {
  $t = $m.Groups[1].Value
  $t = $t -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&' -replace '&quot;', '"'
  if ($t -match '\S') {
    [void]$sb.AppendLine($t)
  }
}
[System.IO.File]::WriteAllText($OutPath, $sb.ToString(), [Text.UTF8Encoding]::new($false))
