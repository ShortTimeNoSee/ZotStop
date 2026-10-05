# Privacy

This document describes the current ZotStop implementation. The app needs no account and has no advertising integration.

## What stays on your device

Saved stops, watched stops, the last eight opened stop ids, named views, route selection, and map position are stored locally. Recent stops are ids only: no coordinates, no visit times, and no score. They are separate from stops you explicitly save. Web storage and cached route and map files remain in your browser. Native installations use storage in the app’s WebView. These preferences do not sync between devices or profiles.

Finding nearby stops and following your position happen on your device. **Find once** requests a location fix and leaves a marker without continuing to track. **Follow me** updates the marker while the app is active. Tracking pauses when the app is hidden or inactive. **Pause** keeps the last marker. **Stop** clears it from the current view.

These features do not send your coordinates to ZotStop unless you separately choose **Share ride**. Your operating system or browser may use its own location providers, governed by its settings and policies. Android uses the platform location APIs rather than Google Play Services.

## Active ride

Get-off alerts are separate from ride sharing. The choice is stored for the current tab session: the route, the destination stop, whether you are following this phone or a bus, and the fleet name you selected. A bus alert does not use this phone's location. It reads the public vehicle report, including the fleet name printed on the bus. That report can arrive late, so the alert can be early or late. If the bus you selected stops reporting, ZotStop does not switch to another bus.

A phone alert calculates progress on the device. Those coordinates are not sent to ZotStop. When exactly one fresh reported bus is close to the phone, the alert uses both and takes the more urgent result. If they disagree about being at the stop, it tells you to check the stop instead of saying to get off. If several buses are close, only the phone is used.

On Android, the alert you start keeps an ongoing notification and can keep updating after you leave the app. A phone alert needs background location for that to continue. If you decline it, the alert still works while the app is open and says the notification cannot keep updating. On iPhone, the notification updates while the app can run, and a phone alert can keep a location session in the background. A bus-only alert cannot refresh the operator's position after iOS suspends the app, so the last notification stays until you return. The web app can show a notification while the page is open. It cannot promise an alert after the tab is closed.

**End ride** stops the alert. A phone alert also stops location tracking unless you are using **Follow me** or **Share ride**. An optional sound alert stays on this device. Haptic feedback uses the system vibrator and does not leave the device.

Clear the site’s storage or the Android app’s storage to remove local preferences and cached data. This also removes saved views and usage-count consent. A browser’s offline cache may be evicted, so offline availability is not permanent.

## Optional ride sharing

When you choose **Share ride**, the app creates a random ID for that ride. While sharing, it sends the route, ride ID, latitude, longitude, and reported accuracy to the relay, at most once every 30 seconds as new suitable fixes arrive.

The relay receives the precise fix over HTTPS. It checks accuracy and distance from the route, then stores route progress rounded to 25 meters with the ride ID, update time, and movement-validation state. It does not store the exact submitted coordinates in application storage.

Active records expire about 20 minutes after their last accepted update. **Stop sharing** requests deletion of the current record. If that request cannot reach the relay, expiry handles it. Sharing ends when tracking is paused or stopped, including when the app goes into the background.

Public hints require at least two qualifying sessions with movement. They use route progress rounded to 200 meters, a report count, and the oldest contributing update time. Public responses do not include ride IDs. Distinct IDs are not proof of distinct people, so hints remain unverified.

The relay uses Cloudflare SQLite-backed Durable Objects. Cloudflare’s [point-in-time recovery](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) can retain recoverable database history for 30 days. Deleting an active record is not a promise of immediate erasure from provider recovery history.

## Optional usage counts

**Share randomized usage counts** is off by default and can be changed in About. When enabled, the app reports randomized yes or no values for three categories: finding a route quickly, finding a stop quickly, and using map zoom.

Reports contain only the category and a randomized value. They contain no coordinates, route or stop IDs, ride ID, device ID, or exact decision duration. Reports are buffered in memory, sent after a randomized delay, and dropped on failure. Turning the option off clears unsent reports.

The relay adds received counts into daily totals in Cloudflare D1. It does not store individual events. A daily cleanup retains the most recent 30 UTC days, including the current day. If cleanup is delayed or fails, older rows remain until a successful run. The totals cannot identify a person’s contribution to delete it individually. Application deletion does not remove the hosting provider’s recovery history immediately. See Cloudflare’s [D1 recovery documentation](https://developers.cloudflare.com/d1/reference/time-travel/).

## Network requests and hosting

Cloudflare serves the app, map assets, and transit relay. The relay and hosting provider can see request metadata, including IP addresses. The rider-report endpoint uses IP addresses transiently as rate-limit keys. Application code does not write them into ride records or usage totals, and Worker observability logging is disabled in the checked-in configuration. This does not eliminate the provider’s infrastructure processing or retention.

The relay retrieves live transit data from TransLoc. Ordinary production transit requests go through ZotStop’s relay, rather than sending each rider’s request directly to the operator. Opening official service links or GitHub takes you to those services under their own policies.

## Questions

Use [GitHub Issues](https://github.com/ShortTimeNoSee/ZotStop/issues) for general privacy questions. Avoid posting personal travel details. For a vulnerability or unintended disclosure, use [private reporting](SECURITY.md).
