-- Vivaldi OS Updater (macOS): opens vivaldios://update links from Bento OS's
-- "Update Now" button. It takes nothing from the link: it only ever installs the
-- latest official release of github.com/AbdullahEgh/vivaldi-os, after you confirm,
-- and only if it carries the signature of Bento OS's release key.
on open location theURL
	-- Bento OS's Dark Mode: the system's own appearance (light / dark); nothing else is read from the link
	if theURL starts with "vivaldios://appearance/" then
		set wantDark to (theURL is "vivaldios://appearance/dark")
		if theURL is not "vivaldios://appearance/dark" and theURL is not "vivaldios://appearance/light" then return
		tell application "System Events" to tell appearance preferences to set dark mode to wantDark
		return
	end if
	if theURL does not start with "vivaldios://update" then return
	try
		display dialog "Update Bento OS now?" & return & return & "Vivaldi will close, update and reopen with your tabs." buttons {"Cancel", "Update"} default button "Update" cancel button "Cancel" with title "Bento OS" with icon note
	on error
		return
	end try
	do shell script "rm -f /tmp/vivaldi-os-updated"
	tell application "Terminal"
		activate
		set u to "https://github.com/AbdullahEgh/vivaldi-os/releases/latest/download/VivaldiOS-Mac.command"
		set k to "vivaldi-os ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJJewhzxQTTIQOK45iTV0OoL3VTClELYcOCLU9GvmG3a"
		-- a private folder (not /tmp), and the installer runs only if Bento OS's release key signed it
		set t to do script "d=$(mktemp -d) && curl -fsSL " & u & " -o $d/v.command && curl -fsSL " & u & ".sig -o $d/v.sig && echo " & quoted form of k & " > $d/k && ssh-keygen -q -Y verify -f $d/k -I vivaldi-os -n vivaldi-os-release -s $d/v.sig < $d/v.command && bash $d/v.command && touch /tmp/vivaldi-os-updated || echo 'NOT INSTALLED: the update could not be downloaded or its signature did not check out.'"
		set w to front window
	end tell
	-- done: the Terminal window closes by itself (it stays open only if something went wrong)
	repeat 600 times
		delay 1
		try
			tell application "Terminal" to if not (busy of t) then exit repeat
		on error
			exit repeat
		end try
	end repeat
	try
		do shell script "test -e /tmp/vivaldi-os-updated"
		tell application "Terminal" to close w saving no
	end try
end open location

on run
	display dialog "Vivaldi OS Updater runs when you press Update Now in Bento OS." buttons {"OK"} default button "OK" with title "Bento OS" with icon note
end run
