package dev.zotstop.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AospLocation", permissions = {
    @Permission(alias = "coarse", strings = { Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "fine", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
})
public class AospLocationPlugin extends Plugin {
    private LocationManager trackingManager;
    private LocationListener trackingListener;

    private boolean hasLocationPermission() {
        return getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || hasPreciseLocation();
    }

    private boolean hasPreciseLocation() {
        return getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void startTracking(PluginCall call) {
        if (!hasLocationPermission()) {
            requestPermissionForAliases(new String[] { "coarse", "fine" }, call, "trackingPermissionCallback");
            return;
        }
        startTrackingWithPermission(call);
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        stopTrackingUpdates();
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void startTrackingWithPermission(PluginCall call) {
        stopTrackingUpdates();
        trackingManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean network = trackingManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        boolean gps = hasPreciseLocation() && trackingManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        if (!network && !gps) {
            call.reject("Location is unavailable on this device");
            return;
        }
        trackingListener = location -> notifyListeners("location", locationResult(location));
        if (network) trackingManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000L, 3f, trackingListener, Looper.getMainLooper());
        if (gps) trackingManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000L, 3f, trackingListener, Looper.getMainLooper());
        call.resolve();
    }

    private void stopTrackingUpdates() {
        if (trackingManager != null && trackingListener != null) trackingManager.removeUpdates(trackingListener);
        trackingListener = null;
        trackingManager = null;
    }

    @Override
    protected void handleOnDestroy() {
        stopTrackingUpdates();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void locate(PluginCall call) {
        if (!hasLocationPermission()) {
            requestPermissionForAliases(new String[] { "coarse", "fine" }, call, "locationPermissionCallback");
            return;
        }
        locateWithPermission(call);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (hasLocationPermission()) {
            locateWithPermission(call);
        } else {
            call.reject("Location permission was not granted");
        }
    }

    @PermissionCallback
    private void trackingPermissionCallback(PluginCall call) {
        if (hasLocationPermission()) startTrackingWithPermission(call);
        else call.reject("Location permission was not granted");
    }

    @SuppressLint("MissingPermission")
    private void locateWithPermission(PluginCall call) {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean network = manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        boolean gps = hasPreciseLocation() && manager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        if (!network && !gps) {
            call.reject(hasPreciseLocation() ? "Location is disabled on this device" : "Approximate location is unavailable on this device. Allow precise location to find nearby stops.");
            return;
        }
        Location cached = null;
        if (network) cached = manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
        if (gps) {
            Location gpsCached = manager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (gpsCached != null && (cached == null || gpsCached.getAccuracy() < cached.getAccuracy())) cached = gpsCached;
        }
        if (cached != null && cached.hasAccuracy() && cached.getAccuracy() <= 200 && SystemClock.elapsedRealtimeNanos() - cached.getElapsedRealtimeNanos() < 60_000_000_000L) {
            resolve(call, cached);
            return;
        }
        Handler handler = new Handler(Looper.getMainLooper());
        AtomicBoolean settled = new AtomicBoolean(false);
        Location[] best = new Location[] { cached };
        LocationListener[] listener = new LocationListener[1];
        listener[0] = location -> {
            if (best[0] == null || location.getAccuracy() < best[0].getAccuracy()) best[0] = location;
            if (location.hasAccuracy() && location.getAccuracy() <= 200 && settled.compareAndSet(false, true)) {
                manager.removeUpdates(listener[0]);
                resolve(call, location);
            }
        };
        handler.post(() -> {
            if (network) manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0L, 0f, listener[0], Looper.getMainLooper());
            if (gps) manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, listener[0], Looper.getMainLooper());
            handler.postDelayed(() -> {
                if (settled.compareAndSet(false, true)) {
                    manager.removeUpdates(listener[0]);
                    if (best[0] != null) resolve(call, best[0]);
                    else call.reject("Location timed out");
                }
            }, 8000);
        });
    }

    private void resolve(PluginCall call, Location location) {
        call.resolve(locationResult(location));
    }

    private JSObject locationResult(Location location) {
        JSObject result = new JSObject();
        result.put("lat", location.getLatitude());
        result.put("lon", location.getLongitude());
        result.put("accuracy", location.getAccuracy());
        return result;
    }
}
