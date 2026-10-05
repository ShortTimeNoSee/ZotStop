package dev.zotstop.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "RideAlert", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    @Permission(alias = "coarse", strings = { Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "fine", strings = { Manifest.permission.ACCESS_FINE_LOCATION }),
    @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
})
public class RideAlertPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationCallback");
            return;
        }
        continueStart(call);
    }

    @PermissionCallback
    private void notificationCallback(PluginCall call) {
        continueStart(call);
    }

    private void continueStart(PluginCall call) {
        String plan = call.getString("plan", "");
        boolean phone = plan.contains("\"mode\":\"phone\"");
        if (phone && Build.VERSION.SDK_INT >= 29 && getContext().checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            if (getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                requestPermissionForAlias("background", call, "backgroundCallback");
                return;
            }
        }
        launch(call, phone && hasBackgroundLocation());
    }

    @PermissionCallback
    private void backgroundCallback(PluginCall call) {
        launch(call, hasBackgroundLocation());
    }

    private boolean hasBackgroundLocation() {
        return Build.VERSION.SDK_INT < 29 || getContext().checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void launch(PluginCall call, boolean backgroundLocation) {
        Intent intent = new Intent(getContext(), RideAlertService.class);
        intent.setAction(RideAlertService.ACTION_START);
        intent.putExtra(RideAlertService.EXTRA_PLAN, call.getString("plan", ""));
        intent.putExtra(RideAlertService.EXTRA_BACKGROUND, backgroundLocation);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve(new com.getcapacitor.JSObject().put("backgroundLocation", backgroundLocation || !call.getString("plan", "").contains("\"mode\":\"phone\"")));
    }

    @PluginMethod
    public void sync(PluginCall call) {
        Intent intent = new Intent(getContext(), RideAlertService.class);
        intent.setAction(RideAlertService.ACTION_SYNC);
        intent.putExtra("title", call.getString("title", "ZotStop"));
        intent.putExtra("body", call.getString("body", ""));
        intent.putExtra("stage", call.getString("stage", ""));
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), RideAlertService.class);
        intent.setAction(RideAlertService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(new com.getcapacitor.JSObject().put("running", RideAlertService.running));
    }

    @Override
    protected void handleOnPause() {
        Intent intent = new Intent(getContext(), RideAlertService.class);
        intent.setAction(RideAlertService.ACTION_PAUSE);
        getContext().startService(intent);
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume() {
        Intent intent = new Intent(getContext(), RideAlertService.class);
        intent.setAction(RideAlertService.ACTION_RESUME);
        getContext().startService(intent);
        super.handleOnResume();
    }
}
