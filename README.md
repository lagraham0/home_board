# Home Board

A wall dashboard for an iPad: clock, drive times, sailing conditions at the Golden Gate, snow at Heavenly, popular Bay Area weekend events, and shared household calendar, reminders and grocery lists.

- **Page:** `index.html`, served by GitHub Pages.
- **Weather, snow and events:** `scripts/refresh.mjs` runs every hour in GitHub Actions and writes `data/weather.json` and `data/events.json`.
- **Shared lists, places and drive times:** stored in Supabase. Only signed-in household members on the allowlist can read or change them.

Sources: National Weather Service, NOAA Tides & Currents, NRCS SNOTEL, the Heavenly snow report, and FunCheap SF (titles, links, times and prices only).

To refresh by hand: **Actions → Refresh and publish board → Run workflow**.
If the hourly job ever stops (GitHub pauses scheduled jobs in quiet public repositories after 60 days), open the Actions tab and click **Enable workflow**.
