' Starts the TabMind server with no console window (used for auto-start at login).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "node """ & dir & "\server\server.js""", 0, False
