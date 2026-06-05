$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8765

# Enable TLS 1.2 for outbound requests
[System.Net.ServicePointManager]::SecurityProtocol = `
    [System.Net.SecurityProtocolType]::Tls12 -bor `
    [System.Net.SecurityProtocolType]::Tls11 -bor `
    [System.Net.SecurityProtocolType]::Tls

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "  Servidor rodando em: http://localhost:$port" -ForegroundColor Green
Write-Host "  Pressione Ctrl+C para parar." -ForegroundColor Yellow
Write-Host ""

Start-Process "chrome.exe" "http://localhost:$port/index.html"

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".png"  = "image/png"
    ".ico"  = "image/x-icon"
    ".pdf"  = "application/pdf"
}

function Send-Response($ctx, $statusCode, $contentType, $bytes) {
    $ctx.Response.StatusCode = $statusCode
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.ContentType = $contentType
    $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.OutputStream.Close()
}

try {
    while ($listener.IsListening) {
      try {
        $ctx     = $listener.GetContext()
        $req     = $ctx.Request
        $urlPath = $req.Url.LocalPath.TrimStart("/")

        # ── /proxy?url=<encodedUrl> ──────────────────────────────────────
        if ($urlPath -eq "proxy") {
            $targetUrl = $req.QueryString["url"]

            if (-not $targetUrl -or
                (-not $targetUrl.StartsWith("http://") -and
                 -not $targetUrl.StartsWith("https://"))) {
                $msg = [System.Text.Encoding]::UTF8.GetBytes("Bad Request: url invalido")
                Send-Response $ctx 400 "text/plain; charset=utf-8" $msg
                continue
            }

            try {
                $webReq                  = [System.Net.HttpWebRequest]::Create($targetUrl)
                $webReq.Method           = "GET"
                $webReq.UserAgent        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                $webReq.AllowAutoRedirect = $true
                $webReq.Timeout          = 30000

                $webResp    = $webReq.GetResponse()
                $respStream = $webResp.GetResponseStream()
                $ms         = [System.IO.MemoryStream]::new()
                $buffer     = New-Object byte[] 65536
                do {
                    $read = $respStream.Read($buffer, 0, $buffer.Length)
                    if ($read -gt 0) { $ms.Write($buffer, 0, $read) }
                } while ($read -gt 0)
                $respStream.Close()
                $webResp.Close()

                $bytes       = $ms.ToArray()
                $ms.Dispose()
                $contentType = if ($webResp.ContentType) { $webResp.ContentType } else { "application/octet-stream" }

                # Forward Content-Disposition so JS can extract the filename
                $cd = $webResp.Headers["Content-Disposition"]
                if ($cd) { $ctx.Response.Headers.Add("Access-Control-Expose-Headers", "Content-Disposition"); $ctx.Response.Headers.Add("Content-Disposition", $cd) }

                Send-Response $ctx 200 $contentType $bytes
            } catch {
                $msg = [System.Text.Encoding]::UTF8.GetBytes("Proxy error: $($_.Exception.Message)")
                Send-Response $ctx 502 "text/plain; charset=utf-8" $msg
            }
            continue
        }

        # ── Static files ─────────────────────────────────────────────────
        if ($urlPath -eq "") { $urlPath = "index.html" }
        $filePath = Join-Path $root $urlPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext   = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime  = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            Send-Response $ctx 200 $mime $bytes
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            Send-Response $ctx 404 "text/plain" $body
        }
      } catch {
        Write-Host "  [erro requisição] $($_.Exception.Message)" -ForegroundColor Red
        try { $ctx.Response.Abort() } catch {}
      }
    }
} finally {
    $listener.Stop()
}
