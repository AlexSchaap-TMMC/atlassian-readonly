// Windows Credential Manager access with no third-party code.
//
// `cmdkey` can write and delete entries but never prints a stored secret, and the
// PowerShell CredentialManager module is not installed by default. So reads go
// through `CredRead` in advapi32.dll, compiled on the fly by PowerShell.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// The target name is fixed by this skill's storage convention, so it never
// reaches PowerShell as interpolated text.
const script = `
$ErrorActionPreference = 'Stop'
$Signature = @'
using System;
using System.Runtime.InteropServices;
public static class WinCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CRED {
    public int Flags; public int Type;
    public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public long CredentialBlobSize;
    public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);
  public static string Get(string target) {
    IntPtr cred;
    if (!CredRead(target, 1, 0, out cred)) return null;
    try {
      CRED c = (CRED)Marshal.PtrToStructure(cred, typeof(CRED));
      if (c.CredentialBlobSize == 0 || c.CredentialBlob == IntPtr.Zero) return null;
      return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);
    } finally { CredFree(cred); }
  }
}
'@
Add-Type -TypeDefinition $Signature | Out-Null
$value = [WinCred]::Get((Get-Content -Raw -LiteralPath $env:WINCRED_TARGET_FILE))
if ($null -ne $value) { $value.Trim() }
`;

// The target is passed through a temporary file rather than the command line,
// which avoids PowerShell quoting entirely and keeps the name out of the process
// list. The secret itself only ever goes to stdout of this one call.
async function readTarget(target) {
  const dir = await mkdtemp(join(tmpdir(), "atlas-wincred-"));
  const file = join(dir, "target");
  try {
    await writeFile(file, target, { mode: 0o600 });
    const { stdout } = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ], {
      env: { ...process.env, WINCRED_TARGET_FILE: file },
    });
    return stdout.trim() || null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export const windowsBackend = {
  name: "Windows Credential Manager",
  read: readTarget,
  async write(target, user, secret) {
    await run("cmdkey", [
      `/generic:${target}`,
      `/user:${user}`,
      `/password:${secret}`,
    ]);
  },
  async remove(target) {
    await run("cmdkey", [`/delete:${target}`]);
  },
};
