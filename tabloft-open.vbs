' Opens the TabLoft library, starting the server first if it isn't running.
' Used by the "TabLoft Library" Start Menu shortcut.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:7878"

Function IsUp()
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", url & "/api/health", False
  http.Send
  IsUp = (Err.Number = 0 And http.Status = 200)
  On Error GoTo 0
End Function

If Not IsUp() Then
  sh.CurrentDirectory = dir
  sh.Run "node """ & dir & "\server\server.js""", 0, False
  For i = 1 To 40
    WScript.Sleep 250
    If IsUp() Then Exit For
  Next
End If
sh.Run url
