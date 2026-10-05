package dev.zotstop.app;

import org.json.JSONArray;
import org.json.JSONException;

final class RideMath {
    private RideMath() {}

    static final class Progress {
        final double distance;
        final double progress;
        final double length;

        Progress(double distance, double progress, double length) {
            this.distance = distance;
            this.progress = progress;
            this.length = length;
        }
    }

    static Progress progress(JSONArray shape, double lon, double lat) throws JSONException {
        if (shape.length() < 2) return null;
        double east = 6371000d * Math.PI / 180d * Math.cos(lat * Math.PI / 180d);
        double north = 6371000d * Math.PI / 180d;
        double bestDistance = Double.POSITIVE_INFINITY;
        double bestProgress = 0;
        double length = 0;
        for (int index = 1; index < shape.length(); index++) {
            JSONArray start = shape.getJSONArray(index - 1);
            JSONArray end = shape.getJSONArray(index);
            double ax = start.getDouble(0);
            double ay = start.getDouble(1);
            double bx = end.getDouble(0);
            double by = end.getDouble(1);
            double dx = (bx - ax) * east;
            double dy = (by - ay) * north;
            double segment = Math.hypot(dx, dy);
            if (segment < 0.01) continue;
            double t = Math.max(0, Math.min(1, ((lon - ax) * east * dx + (lat - ay) * north * dy) / (segment * segment)));
            double distance = Math.hypot((lon - ax) * east - t * dx, (lat - ay) * north - t * dy);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestProgress = length + segment * t;
            }
            length += segment;
        }
        if (!Double.isFinite(bestDistance)) return null;
        return new Progress(bestDistance, bestProgress, length);
    }

    static double forward(double from, double to, double length, boolean loop) {
        if (length <= 0) return Double.POSITIVE_INFINITY;
        if (!loop) return to + 0.5 >= from ? to - from : Double.POSITIVE_INFINITY;
        double value = (to - from) % length;
        if (value < 0) value += length;
        return value;
    }
}
