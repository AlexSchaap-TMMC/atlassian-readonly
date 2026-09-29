param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("jira", "confluence")]
    [string]$Product,

    [Parameter(Mandatory = $true)]
    [ValidateSet("get-issue", "search-issues", "get-page", "search")]
    [string]$Command,

    [string]$RequestJson
)

$ErrorActionPreference = "Stop"
$RequestJson = if ($RequestJson) {
    $RequestJson
}
elseif ($env:ATLASSIAN_MCP_REQUEST) {
    $env:ATLASSIAN_MCP_REQUEST
}
else {
    "{}"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $scriptDir "atlassian.mjs"

$params = $RequestJson | ConvertFrom-Json
$args = @($Product, $Command)

switch ($Command) {
    "get-issue" {
        if ($params.issueKey) { $args += "--issue-key"; $args += $params.issueKey }
        if ($params.projection) { $args += "--projection"; $args += $params.projection }
    }
    "search-issues" {
        if ($params.jql) { $args += "--jql"; $args += $params.jql }
        if ($params.limit) { $args += "--limit"; $args += $params.limit }
        if ($params.projection) { $args += "--projection"; $args += $params.projection }
    }
    "get-page" {
        if ($params.pageId) { $args += "--page-id"; $args += $params.pageId }
        if ($params.projection) { $args += "--projection"; $args += $params.projection }
    }
    "search" {
        if ($params.cql) { $args += "--cql"; $args += $params.cql }
        if ($params.limit) { $args += "--limit"; $args += $params.limit }
        if ($params.projection) { $args += "--projection"; $args += $params.projection }
    }
}

$nodeCmd = "node"
$nodeArgs = @($nodeScript) + $args

$output = & $nodeCmd @nodeArgs 2>&1
$lastExit = $LASTEXITCODE

if ($lastExit -ne 0) {
    Write-Output $output
    exit $lastExit
}
$output
