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
	tell application "Terminal"
		activate
		do script "curl -fsSL https://github.com/AbdullahEgh/vivaldi-os/releases/latest/download/VivaldiOS-Mac.command -o /tmp/vivaldi-os.command && bash /tmp/vivaldi-os.command"
	end tell
end open location

on run
	display dialog "Vivaldi OS Updater runs when you press Update Now in Vivaldi OS." buttons {"OK"} default button "OK" with title "Vivaldi OS" with icon note
end run
