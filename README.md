# BtrKorone

BtrKorone is a browser extension that enhances the **Korone** Roblox revival website (2017-2021 era) with quality-of-life improvements, better navigation, and a two-tier premium system verified through Roblox gamepass ownership.

---

## Features

### Free Tier
- **UI Enhancements** - Modernized cards, hover effects, and cleaner layout
- **Quick Navigation** - Sticky nav bar with keyboard shortcuts (Alt+H/C/G/T/I/F/S)
- **Compact Mode** - Reduce spacing for information-dense browsing
- **Pagination Enhancement** - Smooth scroll-to-top on page change

### BtrKorone+ (One-time Gamepass Purchase)
- **Trade Enhancements** - Value indicators, trade summaries, and fairness display
- **Dark Mode Override** - Force dark theme across all Korone pages
- **Profile Enhancements** - Better date formatting and layout improvements
- **Catalog Filters** - Price range filtering, advanced sorting options

### BtrKorone Pro (One-time Gamepass Purchase)
- All BtrKorone+ features, plus:
- **Item Value Estimates** - Estimated values on catalog/inventory items
- **Notification Popup** - Enhanced notification display with quick actions
- **Server Size Indicator** - Visual player count on game pages
- **Friend Activity Feed** - See what friends are playing on your homepage

---

## Premium Verification Flow

1. Open the BtrKorone extension popup
2. Go to the **Premium** tab
3. Enter your Roblox User ID
4. Click **Generate Token** - a unique verification code is created
5. Place the token anywhere in your Roblox profile description
6. Click **Verify & Activate**
7. The extension verifies token placement AND checks gamepass ownership
8. Your tier is activated and cached locally (auto-rechecks every 24h)

---

## Installation

### Chrome / Edge / Brave
1. Download or clone this repository
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer Mode**
4. Click **Load unpacked** and select the `src/` folder
5. The BtrKorone icon will appear in your extensions bar

---

## Project Structure

```
src/
  manifest.json           # Extension manifest (Manifest V3)
  background/
    service-worker.js     # Premium verification, message handling, alarms
  content/
    main.js               # Entry point, initializes modules
    ui-enhancements.js    # Visual improvements
    navigation.js         # Quick nav bar & keyboard shortcuts
    premium-features.js   # Plus/Pro exclusive features
    styles/
      btrkorone.css       # All injected styles
  popup/
    popup.html            # Extension popup UI
    popup.css             # Popup styles
    popup.js              # Popup logic & interaction
  shared/
    constants.js          # Configuration, tier definitions, feature maps
    storage.js            # chrome.storage.local wrapper utilities
    premium-verifier.js   # Roblox API verification logic
  icons/
    icon16.png            # Extension icons
    icon32.png
    icon48.png
    icon128.png
```

---

## Development

### Changing Gamepass IDs
Edit `src/shared/constants.js` and update the `gamepassId` values in `BTRKORONE.TIERS.PLUS` and `BTRKORONE.TIERS.PRO` with your actual Korone gamepass IDs.

### Adding Features
1. Define the feature key in `BTRKORONE.DEFAULT_SETTINGS`
2. Add it to the appropriate tier array in `BTRKORONE.FEATURES`
3. Implement the feature in the appropriate content script
4. Optionally add a toggle in `popup.html`

---

## License

Distributed under the MIT License. See `LICENSE.md` for more information.

---

## Disclaimer

BtrKorone is a third-party fan project and is not officially affiliated with, maintained by, or endorsed by the Korone administration team.
