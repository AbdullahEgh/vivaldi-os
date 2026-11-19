-- Vivaldi OS Updater (macOS): opens vivaldios://update links from Vivaldi OS's
-- "Update Now" button. It takes nothing from the link: it only ever installs the
-- latest official release of github.com/AbdullahEgh/vivaldi-os, after you confirm.
on open location theURL
	if theURL does not start with "vivaldios://update" then return
	try
		display dialog "Update Vivaldi OS now?" & return & return & "Vivaldi will close, update and reopen with your tabs." buttons {"Cancel", "Update"} default button "Update" cancel button "Cancel" with title "Vivaldi OS" with icon note
	on error
		return
	end try
	do shell script "rm -f /tmp/vivaldi-os-updated"
	tell application "Terminal"
		activate
		set t to do script "curl -fsSL https://github.com/AbdullahEgh/vivaldi-os/releases/latest/download/VivaldiOS-Mac.command -o /tmp/vivaldi-os.command && bash /tmp/vivaldi-os.command && touch /tmp/vivaldi-os-updated"
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
	display dialog "Vivaldi OS Updater runs when you press Update Now in Vivaldi OS." buttons {"OK"} default button "OK" with title "Vivaldi OS" with icon note
end run
