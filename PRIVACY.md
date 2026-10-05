# Privacy

## Moving from the online play preview

Atlas VTT Connect copies the preview's online settings, including your table key, from `atlas-vtt/.atlas-data/settings.json` into its own settings. It never edits Atlas's settings file, so the old copy of the key stays there until you remove the `online` entry from that file by hand while Obsidian is closed. Both copies are in your vault; nothing is sent anywhere.
