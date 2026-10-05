CREATE TABLE IF NOT EXISTS ux_aggregate (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, value)
);
