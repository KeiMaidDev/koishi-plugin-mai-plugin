# Generated Maimai Render Assets

These PNGs are deterministic geometric assets authored by this project. They contain no external artwork, game captures, logos, or copied Shinobu pixels.

The generated files are checked into the plugin because they are required at runtime.

The Kotlin source was inspected for missing Shinobu names. Functional mappings are:

- `rating_base_*.png` -> `rating-number-plate.png`
- `dani_*.png` -> `dan-badge.png`
- `background_1.png`, `background_2.png`, `background_3.png` -> `course-background-1.png`, `course-background-2.png`, `course-background-3.png`
- `final_2.png`, `result_2.png` -> `course-final-plate.png`
- `rank_*.png`, `icon_*.png`, `icon_dxstar_*.png` -> `status-plate.png` with live text labels
- `base_Utage.png` -> `utage-icon.png` plus the required `#ff6ffd` difficulty color

Type, genre, version, level, score digit, and life digit image families are replaced by bundled-font text and stable Node layouts.
