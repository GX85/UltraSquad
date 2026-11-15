Option Explicit
Dim fs, shell, folder, nodePath, pathFile, stream, entry, candidate, flags, code
Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
nodePath = ""
pathFile = fs.BuildPath(folder, "node-path.txt")

If fs.FileExists(pathFile) Then
  Set stream = fs.OpenTextFile(pathFile, 1, False, -1)
  nodePath = Trim(stream.ReadAll)
  stream.Close
  If Not fs.FileExists(nodePath) Then nodePath = ""
End If

If nodePath = "" Then
  For Each entry In Split(shell.ExpandEnvironmentStrings("%PATH%"), ";")
    entry = Replace(Trim(entry), Chr(34), "")
    If entry <> "" Then
      candidate = fs.BuildPath(entry, "node.exe")
      If fs.FileExists(candidate) Then
        nodePath = candidate
        Exit For
      End If
    End If
  Next
End If

If nodePath = "" Then
  candidate = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
  If fs.FileExists(candidate) Then nodePath = candidate
End If

If nodePath = "" Then
  MsgBox "Install Node.js 22 or newer, or run setup-runtime.cmd in a terminal where Node is available.", 16, "UltraSquad"
  WScript.Quit 1
End If

flags = ""
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--open" Then flags = " --open"
End If
shell.CurrentDirectory = folder
code = shell.Run(Chr(34) & nodePath & Chr(34) & " " & Chr(34) & fs.BuildPath(folder, "launch.mjs") & Chr(34) & flags, 0, True)
If code <> 0 Then
  MsgBox "UltraSquad could not start. See data\launcher-error.log and data\server-error.log.", 16, "UltraSquad"
End If
WScript.Quit code
