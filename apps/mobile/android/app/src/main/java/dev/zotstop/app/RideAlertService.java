package dev.zotstop.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class RideAlertService extends Service {
    static final String ACTION_START = "dev.zotstop.app.ride.START";
    static final String ACTION_SYNC = "dev.zotstop.app.ride.SYNC";
    static final String ACTION_STOP = "dev.zotstop.app.ride.STOP";
    static final String ACTION_PAUSE = "dev.zotstop.app.ride.PAUSE";
    static final String ACTION_RESUME = "dev.zotstop.app.ride.RESUME";
    static final String EXTRA_PLAN = "plan";
    static final String EXTRA_BACKGROUND = "background";
    static volatile boolean running = false;

    private static final String CHANNEL = "zotstop-ride";
    private static final int ONGOING = 42;
    private static final int ALERT = 43;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private JSONObject plan;
    private boolean backgroundLocation;
    private boolean paused;
    private boolean phone;
    private String lastStage = "";
    private LocationManager locationManager;
    private LocationListener locationListener;
    private final Runnable poll = this::pollSnapshot;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Get-off alert", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Ongoing alert for the bus or phone you are following");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            finish();
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            try {
                plan = new JSONObject(intent.getStringExtra(EXTRA_PLAN));
                phone = "phone".equals(plan.optString("mode"));
                backgroundLocation = intent.getBooleanExtra(EXTRA_BACKGROUND, false);
                running = true;
                paused = false;
                promote("ZotStop", plan.optString("letter") + " Line to " + plan.optString("stopName"), "");
                handler.removeCallbacks(poll);
                handler.post(poll);
            } catch (Exception error) {
                finish();
            }
            return START_STICKY;
        }
        if (!running || plan == null) return START_NOT_STICKY;
        if (ACTION_SYNC.equals(action)) {
            String stage = intent.getStringExtra("stage");
            promote(intent.getStringExtra("title"), intent.getStringExtra("body"), stage);
            return START_STICKY;
        }
        if (ACTION_PAUSE.equals(action)) {
            paused = true;
            if (phone && backgroundLocation) startPhoneLocation();
            handler.removeCallbacks(poll);
            handler.post(poll);
            return START_STICKY;
        }
        if (ACTION_RESUME.equals(action)) {
            paused = false;
            stopPhoneLocation();
            return START_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        promote("ZotStop", "Android stopped the background get-off update. Open ZotStop to continue it.", "soon");
        finish();
    }

    private void pollSnapshot() {
        if (!running || plan == null) return;
        if (!phone && paused) executor.execute(this::readSelectedBus);
        long pollMs = Math.max(4000, plan.optLong("pollMs", 8000));
        handler.postDelayed(poll, pollMs);
    }

    private void readSelectedBus() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(plan.optString("apiUrl")).openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(7000);
            try (InputStream stream = connection.getInputStream()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int count;
                while ((count = stream.read(chunk)) != -1) buffer.write(chunk, 0, count);
                JSONObject snapshot = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
                JSONArray vehicles = snapshot.optJSONArray("vehicles");
                JSONObject match = null;
                if (vehicles != null) {
                    for (int index = 0; index < vehicles.length(); index++) {
                        JSONObject vehicle = vehicles.getJSONObject(index);
                        if (plan.optString("vehicleId").equals(vehicle.optString("id")) && plan.optString("routeId").equals(vehicle.optString("routeId"))) match = vehicle;
                    }
                }
                JSONObject found = match;
                handler.post(() -> publishBus(found, snapshot.optLong("fetchedAt", System.currentTimeMillis())));
            }
        } catch (Exception ignored) {
            handler.post(() -> promote("ZotStop", "The bus report could not be refreshed.", lastStage));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void publishBus(JSONObject vehicle, long fetchedAt) {
        if (!running || plan == null) return;
        String name = plan.optString("fleetName", "The bus you selected");
        if (name.isEmpty()) name = "The bus you selected";
        if (vehicle == null) {
            promote(name, name + " is no longer reporting.", "waiting");
            return;
        }
        long reportedAt = vehicle.optLong("updatedAt", fetchedAt);
        describe(vehicle.optDouble("lon"), vehicle.optDouble("lat"), Math.max(0, fetchedAt - reportedAt), name);
    }

    @SuppressLint("MissingPermission")
    private void startPhoneLocation() {
        if (locationListener != null) return;
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        locationListener = location -> describe(location.getLongitude(), location.getLatitude(), 0, "This phone");
        if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, plan.optLong("pollMs", 8000), 5f, locationListener, Looper.getMainLooper());
        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, plan.optLong("pollMs", 8000), 5f, locationListener, Looper.getMainLooper());
    }

    private void stopPhoneLocation() {
        if (locationManager != null && locationListener != null) locationManager.removeUpdates(locationListener);
        locationListener = null;
        locationManager = null;
    }

    private void describe(double lon, double lat, long ageMs, String source) {
        try {
            JSONArray shape = plan.optJSONArray("shape");
            JSONObject destination = plan.getJSONObject("destination");
            RideMath.Progress here = shape == null ? null : RideMath.progress(shape, lon, lat);
            RideMath.Progress stop = shape == null ? null : RideMath.progress(shape, destination.getDouble("lon"), destination.getDouble("lat"));
            String stopName = plan.optString("stopName", "your stop");
            if (here == null || stop == null || here.distance > 75) {
                promote(source, source + " is not on the " + plan.optString("letter") + " Line shape.", "off-route");
                return;
            }
            double ahead = RideMath.forward(here.progress, stop.progress, here.length, plan.optBoolean("loop"));
            double nowMeters = plan.optDouble("nowMeters", 120);
            double soonMeters = plan.optDouble("soonMeters", 280);
            if (ageMs > 90_000 && ahead <= nowMeters) {
                promote(source, "Reported near " + stopName + ", but this position is too old to trust. Check the bus itself.", "soon");
            } else if (ahead <= nowMeters) {
                promote(source, "Get off at " + stopName + ".", "now");
            } else if (ahead <= soonMeters) {
                promote(source, "Your stop is soon. " + stopName + ".", "soon");
            } else {
                promote(source, "Still on the way to " + stopName + ".", "riding");
            }
        } catch (Exception error) {
            promote(source, "Open ZotStop to check " + plan.optString("stopName", "your stop") + ".", lastStage);
        }
    }

    private void promote(String title, String body, String stage) {
        if (!running) return;
        Notification ongoing = notification(title == null ? "ZotStop" : title, body == null ? "" : body, true);
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        if (phone) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        ServiceCompat.startForeground(this, ONGOING, ongoing, type);
        if (stage != null && !stage.equals(lastStage) && ("soon".equals(stage) || "now".equals(stage) || "passed".equals(stage))) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.notify(ALERT, notification(title, body, false));
        }
        if (stage != null) lastStage = stage;
    }

    private Notification notification(String title, String body, boolean ongoing) {
        Intent stop = new Intent(this, RideAlertService.class).setAction(ACTION_STOP);
        PendingIntent pending = PendingIntent.getService(this, ongoing ? 1 : 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setOngoing(ongoing)
            .setOnlyAlertOnce(ongoing)
            .setPriority(ongoing ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH)
            .addAction(0, "End ride", pending)
            .build();
    }

    private void finish() {
        running = false;
        handler.removeCallbacks(poll);
        stopPhoneLocation();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(poll);
        stopPhoneLocation();
        executor.shutdownNow();
        super.onDestroy();
    }
}
